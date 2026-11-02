const TYPES = require('../taskTypes');

const ACRONYMS = new Set(['crm', 'hrms', 'sap', 'so', 'id', 'hr', 'it']);

const clean = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

// "AJAY KUMAR verma" -> "Ajay Kumar Verma", "crm attendance" -> "CRM Attendance"
function titleCase(v) {
  return clean(v).toLowerCase().replace(/[\p{L}\p{N}']+/gu, (w) =>
    ACRONYMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));
}

const pad = (n) => String(n).padStart(2, '0');
const validYear = (iso) => { const y = parseInt(iso.slice(0, 4), 10); return y >= 2000 && y <= 2100 ? iso : null; };

function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return validYear(v.toISOString().slice(0, 10));
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return validYear(new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10));
  }
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validYear(m[0]);
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/); // day first, as used in India
  if (m) {
    const d = +m[1], mo = +m[2], y = m[3].length === 2 ? '20' + m[3] : m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return validYear(`${y}-${pad(mo)}-${pad(d)}`);
    return null;
  }
  const t = Date.parse(s);
  if (!isNaN(t)) { const d = new Date(t); return validYear(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); }
  return null;
}

const clampMins = (x) => Math.max(0, Math.min(600, Math.round(x * 10) / 10));

// Numbers pass through; "_", blanks and text become 0 and are flagged as missing.
function parseDuration(v) {
  if (typeof v === 'number' && isFinite(v)) return { mins: clampMins(v), missing: false };
  const s = clean(v);
  const n = parseFloat(s.replace(',', '.'));
  if (/\d/.test(s) && isFinite(n)) return { mins: clampMins(n), missing: false };
  return { mins: 0, missing: true };
}

function classifyTask(task) {
  for (const [name, re] of TYPES) if (re.test(task)) return name;
  return 'Other';
}

// Shared by the sheet import and the web form. Returns { entry, notes } or { error }.
function cleanEntry(raw) {
  const date = parseDate(raw.date);
  if (!date) return { error: 'Date is missing or not a valid date' };
  const respondedBy = titleCase(raw.respondedBy).slice(0, 100);
  if (!respondedBy) return { error: '"Responsed By" is empty' };

  const dur = parseDuration(raw.mins);
  const task = titleCase(raw.task).slice(0, 200);
  const requestedBy = titleCase(raw.requestedBy).slice(0, 100);
  const notes = [];
  if (!task) notes.push('taskBlank');
  if (dur.missing) notes.push('durationMissing');

  return {
    notes,
    entry: {
      date,
      task: task || '(Not specified)',
      taskType: task ? classifyTask(task) : 'Other',
      module: titleCase(raw.module).slice(0, 30) || null,
      requestedBy: requestedBy || '(Unknown)',
      respondedBy,
      mins: dur.mins,
      remarks: clean(raw.remarks).slice(0, 500) || null,
    },
  };
}

// For one row of an uploaded sheet.
function normalizeRow(raw) {
  if (Object.values(raw).every((v) => clean(v) === '')) return { blank: true };
  const n = Number(clean(raw.sno));
  if (!clean(raw.sno) || !Number.isInteger(n) || n < 1) return { skip: '"S No." is missing or not a whole number' };
  const r = cleanEntry(raw);
  if (r.error) return { skip: r.error };
  r.entry.sno = n;
  return r;
}

module.exports = { clean, titleCase, parseDate, parseDuration, classifyTask, cleanEntry, normalizeRow };
