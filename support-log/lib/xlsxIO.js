const ExcelJS = require('exceljs');

// Headers are matched ignoring case, spaces and punctuation, so "Responsed By",
// "responsed by" and "Responded By" all work.
const HEADERS = {
  sno: ['sno', 'srno', 'serialno'],
  date: ['date'],
  task: ['task'],
  module: ['module'],
  requestedBy: ['requestedby'],
  respondedBy: ['responsedby', 'respondedby'],
  mins: ['durationmins', 'duration', 'minutes'],
  remarks: ['remarks'],
};
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellValue(v.result);
    if ('text' in v) return v.text;
    return null; // errors and anything else unreadable
  }
  return v;
}

// Reads every sheet that has the expected header row.
async function readSheets(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const rows = [];
  const sheetsSkipped = [];
  wb.eachSheet((ws) => {
    const col = {};
    ws.getRow(1).eachCell((cell, c) => {
      const h = norm(cellValue(cell.value));
      for (const [key, names] of Object.entries(HEADERS)) if (names.includes(h)) col[key] = c;
    });
    if (!col.sno || !col.date || !col.respondedBy) { sheetsSkipped.push(ws.name); return; }
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const raw = {};
      for (const key of Object.keys(HEADERS)) raw[key] = col[key] ? cellValue(row.getCell(col[key]).value) : null;
      rows.push({ sheet: ws.name, row: rowNumber, raw });
    });
  });
  return { rows, sheetsSkipped };
}

// Builds a workbook in the same format as the original sheet: one tab per person.
async function buildWorkbook(entries) {
  const wb = new ExcelJS.Workbook();
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.respondedBy)) groups.set(e.respondedBy, []);
    groups.get(e.respondedBy).push(e);
  }
  if (!groups.size) groups.set('Sheet1', []);

  const used = new Set();
  for (const [person, list] of groups) {
    let name = person.split(' ')[0].toLowerCase().replace(/[\\\/?*\[\]:]/g, '').slice(0, 28) || 'sheet';
    while (used.has(name)) name += '2';
    used.add(name);

    const ws = wb.addWorksheet(name);
    ws.columns = [
      { header: 'S No.', key: 'sno', width: 7 },
      { header: 'Date', key: 'date', width: 13, style: { numFmt: 'dd-mmm-yyyy' } },
      { header: 'Task', key: 'task', width: 42 },
      { header: 'Module', key: 'module', width: 10 },
      { header: 'Requested By', key: 'requestedBy', width: 26 },
      { header: 'Responsed By', key: 'respondedBy', width: 20 },
      { header: 'Duration(mins)', key: 'mins', width: 15 },
      { header: 'Remarks', key: 'remarks', width: 44 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const e of list) {
      ws.addRow({ ...e, date: new Date(e.date + 'T00:00:00Z'), mins: Number(e.mins) });
    }
  }
  return wb.xlsx.writeBuffer();
}

module.exports = { readSheets, buildWorkbook };
