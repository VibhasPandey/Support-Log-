const express = require("express");
const path = require("path");
const { db, all, file } = require("./db");
const { clean, cleanEntry, normalizeRow } = require("./lib/normalize");
const { readSheets, buildWorkbook } = require("./lib/xlsxIO");

const WORKDAY_HOURS = parseFloat(process.env.WORKDAY_HOURS || "8");
const DEFAULT_RESPONDER = process.env.DEFAULT_RESPONDER || "";
const DEFAULT_MODULES = ["CRM", "HRMS", "Infra", "Other"];

const wrap = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((e) => {
      console.error(e);
      res.status(500).json({ error: e.message });
    });

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoDaysBack = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoLocal(d);
};
const mondayThisWeek = () => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoLocal(d);
};
const who = (v) => (clean(v) ? clean(v) : null);

// Named parameters for the INSERT / UPDATE statements below.
const entryParams = (e) => ({
  sno: e.sno,
  seq: e.snoSeq || 1,
  date: e.date,
  task: e.task,
  type: e.taskType,
  module: e.module ?? null,
  requestedBy: e.requestedBy,
  by: e.respondedBy,
  mins: e.mins,
  remarks: e.remarks ?? null,
});

const insertStmt = db.prepare(
  `INSERT INTO SupportEntries (SNo, SNoSeq, EntryDate, Task, TaskType, Module, RequestedBy, RespondedBy, DurationMins, Remarks)
   VALUES (@sno, @seq, @date, @task, @type, @module, @requestedBy, @by, @mins, @remarks)`,
);
const updateStmt = db.prepare(
  `UPDATE SupportEntries SET EntryDate = @date, Task = @task, TaskType = @type, Module = @module,
          RequestedBy = @requestedBy, DurationMins = @mins, Remarks = @remarks WHERE Id = @id`,
);
const nextSnoStmt = db.prepare(
  "SELECT IFNULL(MAX(SNo), 0) + 1 AS n FROM SupportEntries WHERE RespondedBy = ?",
);

// Works out the next S No. for the person and inserts, as one step.
const insertWithNextSno = db.transaction((entry) => {
  const sno = nextSnoStmt.get(entry.respondedBy).n;
  insertStmt.run(entryParams({ ...entry, sno, snoSeq: 1 }));
  return sno;
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------- lookups for the form ---------- */
app.get(
  "/api/meta",
  wrap(async (req, res) => {
    const modules = all(
      `SELECT DISTINCT Module FROM SupportEntries WHERE Module IS NOT NULL`,
    );
    const tasks = all(
      `SELECT Task FROM SupportEntries GROUP BY Task ORDER BY COUNT(*) DESC LIMIT 300`,
    );
    const requesters = all(
      `SELECT RequestedBy FROM SupportEntries GROUP BY RequestedBy ORDER BY COUNT(*) DESC LIMIT 300`,
    );
    const responders = all(`SELECT DISTINCT RespondedBy FROM SupportEntries`);
    const mods = [
      ...new Set([...DEFAULT_MODULES, ...modules.map((m) => m.Module)]),
    ];
    res.json({
      modules: mods,
      tasks: tasks.map((r) => r.Task),
      requesters: requesters.map((r) => r.RequestedBy),
      responders: responders.map((r) => r.RespondedBy).sort(),
      defaultResponder: DEFAULT_RESPONDER,
      workdayHours: WORKDAY_HOURS,
    });
  }),
);

/* ---------- log ---------- */
app.post(
  "/api/entries",
  wrap(async (req, res) => {
    const b = req.body || {};
    if (!clean(b.task))
      return res.status(400).json({ error: "Task is required." });
    if (!clean(b.requestedBy))
      return res.status(400).json({ error: "Requested by is required." });
    const r = cleanEntry({
      date: b.date,
      task: b.task,
      module: b.module,
      requestedBy: b.requestedBy,
      respondedBy: b.respondedBy,
      mins: b.mins === "" ? null : Number(b.mins),
      remarks: b.remarks,
    });
    if (r.error) return res.status(400).json({ error: r.error });

    const sno = insertWithNextSno(r.entry);
    res.status(201).json({ sno });
  }),
);

app.get(
  "/api/entries",
  wrap(async (req, res) => {
    const rows = all(
      `SELECT Id AS id, SNo AS sno, EntryDate AS date, Task AS task, TaskType AS taskType,
            Module AS module, RequestedBy AS requestedBy, RespondedBy AS respondedBy, DurationMins AS mins, Remarks AS remarks
     FROM SupportEntries
     WHERE (@by IS NULL OR RespondedBy = @by)
     ORDER BY EntryDate DESC, SNo DESC
     LIMIT 100`,
      { by: who(req.query.responder) },
    );
    res.json(rows);
  }),
);

app.delete(
  "/api/entries/:id",
  wrap(async (req, res) => {
    db.prepare("DELETE FROM SupportEntries WHERE Id = ?").run(
      parseInt(req.params.id, 10),
    );
    res.json({ ok: true });
  }),
);

/* ---------- report ---------- */
app.get(
  "/api/report",
  wrap(async (req, res) => {
    const days = Math.min(
      3650,
      Math.max(1, parseInt(req.query.days, 10) || 30),
    );
    const by = who(req.query.responder);
    const p = { from: isoDaysBack(days - 1), by };
    const W = "WHERE EntryDate >= @from AND (@by IS NULL OR RespondedBy = @by)";
    // Monday of each row's week. strftime('%w') gives 0 for Sunday, so (w + 6) % 7 = days since Monday.
    const weekExpr = `date(EntryDate, '-' || ((CAST(strftime('%w', EntryDate) AS INTEGER) + 6) % 7) || ' days')`;
    const mins = "ROUND(SUM(DurationMins), 1)";

    const totals = all(
      `SELECT COUNT(*) AS n, IFNULL(${mins}, 0) AS minutes, COUNT(DISTINCT EntryDate) AS activeDays,
                             COUNT(DISTINCT RespondedBy) AS people FROM SupportEntries ${W}`,
      p,
    );
    const byType = all(
      `SELECT TaskType AS label, COUNT(*) AS n, ${mins} AS minutes FROM SupportEntries ${W}
                      GROUP BY TaskType ORDER BY COUNT(*) DESC`,
      p,
    );
    const byModule = all(
      `SELECT IFNULL(Module, 'Not set') AS label, COUNT(*) AS n, ${mins} AS minutes FROM SupportEntries ${W}
                        GROUP BY IFNULL(Module, 'Not set') ORDER BY COUNT(*) DESC`,
      p,
    );
    const topTasks = all(
      `SELECT Task AS label, COUNT(*) AS n, ${mins} AS minutes FROM SupportEntries ${W}
                        GROUP BY Task ORDER BY COUNT(*) DESC, SUM(DurationMins) DESC LIMIT 8`,
      p,
    );
    const byDay = all(
      `SELECT EntryDate AS day, COUNT(*) AS n, ${mins} AS minutes FROM SupportEntries ${W}
                     GROUP BY EntryDate ORDER BY EntryDate`,
      p,
    );
    const byWeek = all(
      `SELECT ${weekExpr} AS week, COUNT(*) AS n, ${mins} AS minutes FROM SupportEntries ${W}
                      GROUP BY ${weekExpr} ORDER BY week`,
      p,
    );
    const topRequesters = all(
      `SELECT RequestedBy AS label, COUNT(*) AS n, ${mins} AS minutes FROM SupportEntries ${W}
                             GROUP BY RequestedBy ORDER BY COUNT(*) DESC LIMIT 8`,
      p,
    );
    const repeats = all(
      `SELECT RequestedBy AS requester, TaskType AS type, COUNT(*) AS n FROM SupportEntries ${W}
                       GROUP BY RequestedBy, TaskType HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT 8`,
      p,
    );
    const thisWeek = all(
      `SELECT COUNT(*) AS n, IFNULL(${mins}, 0) AS minutes, COUNT(DISTINCT RespondedBy) AS people FROM SupportEntries
                        WHERE EntryDate >= @monday AND (@by IS NULL OR RespondedBy = @by)`,
      { monday: mondayThisWeek(), by },
    );

    const people = Math.max(1, by ? 1 : totals[0].people);
    res.json({
      days,
      totals: totals[0],
      byType,
      byModule,
      topTasks,
      byDay,
      byWeek,
      topRequesters,
      repeats,
      thisWeek: thisWeek[0],
      weekCapacityMinutes: WORKDAY_HOURS * 5 * 60 * people,
    });
  }),
);

/* ---------- Excel import ---------- */
app.post(
  "/api/import",
  express.raw({ type: () => true, limit: "15mb" }),
  wrap(async (req, res) => {
    const commit = req.query.commit === "1";
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      return res.status(400).json({ error: "No file received." });

    let parsed;
    try {
      parsed = await readSheets(req.body);
    } catch (e) {
      return res
        .status(400)
        .json({
          error: "That file could not be read. Please upload an .xlsx file.",
        });
    }

    const summary = {
      committed: commit,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skipped: [],
      people: [],
      notes: { durationMissing: 0, taskBlank: 0, repeatedSNo: 0 },
      sheetsSkipped: parsed.sheetsSkipped,
      firstDate: null,
      lastDate: null,
    };

    // 1. clean every row
    const items = [];
    // A repeated S No. (a numbering slip in the sheet) is kept as its own entry: rows are
    // identified by person + S No. + how many times that S No. has appeared so far.
    const seen = new Map();
    for (const r of parsed.rows) {
      const n = normalizeRow(r.raw);
      if (n.blank) continue;
      if (n.skip) {
        summary.skipped.push({ sheet: r.sheet, row: r.row, reason: n.skip });
        continue;
      }
      const base = n.entry.respondedBy.toLowerCase() + "|" + n.entry.sno;
      const occurrence = (seen.get(base) || 0) + 1;
      seen.set(base, occurrence);
      if (occurrence > 1) summary.notes.repeatedSNo++;
      n.entry.snoSeq = occurrence;
      if (n.notes.includes("durationMissing")) summary.notes.durationMissing++;
      if (n.notes.includes("taskBlank")) summary.notes.taskBlank++;
      items.push({ key: base + "|" + occurrence, entry: n.entry });
    }

    // 2. compare with what is already stored
    const existingRows = all(
      `SELECT Id AS id, SNo AS sno, SNoSeq AS seq, RespondedBy AS respondedBy, EntryDate AS date, Task AS task,
            Module AS module, RequestedBy AS requestedBy, DurationMins AS mins, Remarks AS remarks FROM SupportEntries`,
    );
    const existing = new Map(
      existingRows.map((x) => [
        x.respondedBy.toLowerCase() + "|" + x.sno + "|" + x.seq,
        x,
      ]),
    );
    const same = (x, e) =>
      x.date === e.date &&
      x.task === e.task &&
      (x.module || "") === (e.module || "") &&
      x.requestedBy === e.requestedBy &&
      Number(x.mins) === e.mins &&
      (x.remarks || "") === (e.remarks || "");

    const toInsert = [],
      toUpdate = [],
      people = new Map();
    for (const { key, entry } of items) {
      const x = existing.get(key);
      if (!x) {
        toInsert.push(entry);
        summary.inserted++;
      } else if (!same(x, entry)) {
        toUpdate.push({ id: x.id, entry });
        summary.updated++;
      } else summary.unchanged++;

      const p = people.get(entry.respondedBy) || {
        name: entry.respondedBy,
        rows: 0,
        mins: 0,
      };
      p.rows++;
      p.mins += entry.mins;
      people.set(entry.respondedBy, p);
      if (!summary.firstDate || entry.date < summary.firstDate)
        summary.firstDate = entry.date;
      if (!summary.lastDate || entry.date > summary.lastDate)
        summary.lastDate = entry.date;
    }
    summary.people = [...people.values()].map((p) => ({
      ...p,
      mins: Math.round(p.mins * 10) / 10,
    }));

    // 3. write (all or nothing: better-sqlite3 rolls back automatically if anything throws)
    if (commit && (toInsert.length || toUpdate.length)) {
      db.transaction(() => {
        for (const e of toInsert) insertStmt.run(entryParams(e));
        for (const u of toUpdate)
          updateStmt.run({ ...entryParams(u.entry), id: u.id });
      })();
    }
    res.json(summary);
  }),
);

/* ---------- Excel export (same columns as the original sheet) ---------- */
app.get(
  "/api/export.xlsx",
  wrap(async (req, res) => {
    const days = parseInt(req.query.days, 10);
    const rows = all(
      `SELECT SNo AS sno, EntryDate AS date, Task AS task, Module AS module, RequestedBy AS requestedBy,
            RespondedBy AS respondedBy, DurationMins AS mins, Remarks AS remarks
     FROM SupportEntries
     WHERE (@by IS NULL OR RespondedBy = @by) AND (@from IS NULL OR EntryDate >= @from)
     ORDER BY RespondedBy, SNo, SNoSeq`,
      {
        by: who(req.query.responder),
        from: days > 0 ? isoDaysBack(days - 1) : null,
      },
    );
    const buf = Buffer.from(await buildWorkbook(rows));
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="IT_Support.xlsx"',
    );
    res.send(buf);
  }),
);

/* ---------- start ---------- */
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log("Using SQLite database", file);
  console.log(`Support log running at http://${HOST}:${PORT}`);
});
