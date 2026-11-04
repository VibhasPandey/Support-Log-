const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
}
const hrs = (m) => Math.round(m / 6) / 10 + ' h';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const store = (k, v) => { try { v === undefined ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
const stored = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

/* ---------- tabs ---------- */
function show(view) {
  for (const v of ['log', 'report', 'import']) {
    $('#view-' + v).classList.toggle('hidden', v !== view);
    $('#tab-' + v).setAttribute('aria-current', v === view ? 'page' : 'false');
  }
  if (view === 'report') loadReport();
}
['log', 'report', 'import'].forEach((v) => { $('#tab-' + v).onclick = () => show(v); });

/* ---------- lookups ---------- */
let meta = { responders: [], defaultResponder: '' };
function fillWho(select, selected) {
  select.innerHTML = '<option value="">Everyone</option>' + meta.responders.map((r) => `<option>${esc(r)}</option>`).join('');
  select.value = selected && meta.responders.includes(selected) ? selected : '';
}
async function loadMeta() {
  meta = await api('/api/meta');
  $('#module').innerHTML = meta.modules.map((m) => `<option>${esc(m)}</option>`).join('');
  $('#tasks').innerHTML = meta.tasks.map((t) => `<option value="${esc(t)}">`).join('');
  $('#requesters').innerHTML = meta.requesters.map((r) => `<option value="${esc(r)}">`).join('');
  $('#responders').innerHTML = meta.responders.map((r) => `<option value="${esc(r)}">`).join('');
  const lastModule = stored('module');
  if (lastModule && meta.modules.includes(lastModule)) $('#module').value = lastModule;
  if (!$('#respondedBy').value) $('#respondedBy').value = stored('respondedBy') || meta.defaultResponder;
  const mine = meta.responders.find((r) => r.toLowerCase() === (meta.defaultResponder || '').toLowerCase());
  fillWho($('#listWho'), $('#listWho').value || stored('listWho') || mine);
  fillWho($('#repWho'), $('#repWho').value || stored('repWho') || mine);
}

/* ---------- log ---------- */
async function loadList() {
  const who = $('#listWho').value;
  const rows = await api('/api/entries?responder=' + encodeURIComponent(who));
  if (!rows.length) { $('#list').innerHTML = '<div class="empty">Nothing logged yet. Add a request above, or upload your sheet on the Import / export tab.</div>'; return; }
  $('#list').innerHTML = `<table><thead><tr><th>Date</th><th>Task</th><th>Module</th><th>Requested by</th><th class="num">Mins</th><th></th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td class="when">${esc(fmtDate(r.date))}</td>
      <td>${esc(r.task)}${r.remarks ? `<small>${esc(r.remarks)}</small>` : ''}</td>
      <td>${esc(r.module || '')}</td>
      <td>${esc(r.requestedBy)}${who ? '' : `<small>${esc(r.respondedBy)}</small>`}</td>
      <td class="num">${r.mins}</td>
      <td><button class="del" data-id="${r.id}" title="Delete this entry" aria-label="Delete entry">&times;</button></td></tr>`).join('') +
    '</tbody></table>';
}
$('#listWho').onchange = () => { store('listWho', $('#listWho').value); loadList(); };
$('#list').addEventListener('click', async (e) => {
  const id = e.target.dataset && e.target.dataset.id;
  if (!id || !confirm('Delete this entry?')) return;
  await api('/api/entries/' + id, { method: 'DELETE' });
  loadList();
});

function setMsg(text, err) { const m = $('#msg'); m.textContent = text; m.className = 'msg' + (err ? ' err' : ''); }

async function save() {
  try {
    await api('/api/entries', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: $('#date').value, task: $('#task').value, module: $('#module').value, requestedBy: $('#requestedBy').value,
        respondedBy: $('#respondedBy').value, mins: $('#mins').value, remarks: $('#remarks').value,
      }),
    });
    store('module', $('#module').value);
    store('respondedBy', $('#respondedBy').value);
    ['task', 'requestedBy', 'remarks'].forEach((id) => { $('#' + id).value = ''; });
    $('#mins').value = 5;
    $('#task').focus();
    setMsg('Logged.');
    setTimeout(() => setMsg(''), 2500);
    await loadMeta();
    loadList();
  } catch (e) { setMsg(e.message, true); }
}
$('#save').onclick = save;
['task', 'requestedBy', 'respondedBy', 'mins', 'remarks'].forEach((id) =>
  $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); }));

/* timer (survives a page reload) */
let tick = null;
function renderTimer() {
  const start = parseInt(stored('timerStart') || '0', 10);
  const btn = $('#timer');
  if (!start) { btn.textContent = 'Start timer'; btn.classList.remove('running'); clearInterval(tick); tick = null; return; }
  const s = Math.floor((Date.now() - start) / 1000);
  btn.textContent = `Stop timer (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
  btn.classList.add('running');
  if (!tick) tick = setInterval(renderTimer, 1000);
}
$('#timer').onclick = () => {
  const start = parseInt(stored('timerStart') || '0', 10);
  if (start) { $('#mins').value = Math.max(1, Math.round((Date.now() - start) / 60000)); store('timerStart', undefined); }
  else store('timerStart', String(Date.now()));
  renderTimer();
};

/* ---------- report ---------- */
function bars(list, withHours = true) {
  const max = Math.max(1, ...list.map((x) => x.n));
  return list.map((x) => `<div class="row"><span>${esc(x.label)}</span>
    <div class="track"><div class="fill" style="width:${(x.n / max) * 100}%"></div></div>
    <small>${x.n} req${withHours ? ' Â· ' + hrs(x.minutes) : ''}</small></div>`).join('');
}

async function loadReport() {
  const days = $('#days').value, who = $('#repWho').value;
  const d = await api(`/api/report?days=${days}&responder=${encodeURIComponent(who)}`);
  const t = d.totals;
  if (!t.n) { $('#report').innerHTML = '<div class="panel empty">No requests in this period for this selection.</div>'; return; }

  const topTask = d.topTasks[0];
  const perDay = (t.n / Math.max(1, t.activeDays)).toFixed(1);
  const cap = d.weekCapacityMinutes, wk = d.thisWeek;
  const wkPct = Math.min(100, (wk.minutes / cap) * 100);
  const dayMax = Math.max(1, ...d.byDay.map((x) => x.n));
  const dayBars = d.byDay.map((x) =>
    `<div class="day" style="height:${(x.n / dayMax) * 100}%" title="${x.day}: ${x.n} requests, ${x.minutes} min"><span>${x.n}</span></div>`).join('');

  $('#report').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${t.n}</b><span>requests handled</span></div>
      <div class="stat"><b>${hrs(t.minutes)}</b><span>spent on support</span></div>
      <div class="stat"><b>${perDay}</b><span>interruptions per working day</span></div>
      <div class="stat"><b>${Math.round((topTask.n / t.n) * 100)}%</b><span>are "${esc(topTask.label)}"</span></div>
    </div>

    <div class="panel">
      <h2>This week: ${hrs(wk.minutes)} of ${hrs(cap)} went to support</h2>
      <div class="week" aria-hidden="true"><i style="width:${wkPct}%"></i></div>
      <div class="legend"><span><em style="background:var(--support)"></em>Support (${wk.n} requests)</span>
        <span><em style="background:var(--dev)"></em>Left for development</span></div>
    </div>

    <div class="panel"><h2>By type of request</h2>${bars(d.byType)}</div>
    <div class="panel"><h2>Most repeated tasks</h2>${bars(d.topTasks)}</div>
    <div class="panel"><h2>By module</h2>${bars(d.byModule)}</div>
    <div class="panel"><h2>Requests per day</h2><div class="days">${dayBars}</div></div>

    <div class="panel"><h2>Support hours per week</h2>
      ${d.byWeek.map((w) => `<div class="row"><span>Week of ${esc(fmtDate(w.week))}</span>
        <div class="track"><div class="fill" style="width:${Math.min(100, (w.minutes / cap) * 100)}%"></div></div>
        <small>${hrs(w.minutes)}</small></div>`).join('')}
    </div>

    <div class="panel"><h2>Who asks most</h2>${bars(d.topRequesters)}</div>

    ${d.repeats.length ? `<div class="panel"><h2>Same person, same type of request</h2>
      <table><tbody>${d.repeats.map((r) => `<tr><td>${esc(r.requester)}</td><td>${esc(r.type)}</td><td class="num">${r.n} times</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}
$('#days').onchange = loadReport;
$('#repWho').onchange = () => { store('repWho', $('#repWho').value); loadReport(); };
$('#xlsx').onclick = () => { location.href = `/api/export.xlsx?days=${$('#days').value}&responder=${encodeURIComponent($('#repWho').value)}`; };
$('#print').onclick = () => window.print();

/* ---------- import / export ---------- */
let picked = null;
const setImportMsg = (t, err) => { const m = $('#importMsg'); m.textContent = t; m.className = 'msg' + (err ? ' err' : ''); };

$('#file').onchange = (e) => {
  picked = e.target.files[0] || null;
  $('#check').disabled = !picked;
  $('#doImport').disabled = true;
  $('#importOut').innerHTML = '';
  setImportMsg('');
};

async function sendFile(commit) {
  const r = await fetch('/api/import?commit=' + commit, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: picked });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error || r.statusText);
  return b;
}

function renderImport(s) {
  const n = s.notes;
  const lines = [];
  if (s.sheetsSkipped.length) lines.push(`<li class="warn">Tabs ignored because the header row was not recognised: ${s.sheetsSkipped.map(esc).join(', ')}</li>`);
  if (n.durationMissing) lines.push(`<li>${n.durationMissing} row(s) had no usable duration and count as 0 minutes.</li>`);
  if (n.taskBlank) lines.push(`<li>${n.taskBlank} row(s) had no task and are saved as "(Not specified)".</li>`);
  if (n.repeatedSNo) lines.push(`<li>${n.repeatedSNo} row(s) reuse an S No. that appears earlier in the same tab. They are kept as separate entries.</li>`);
  const skipped = s.skipped.slice(0, 25).map((x) => `<li class="warn">Tab "${esc(x.sheet)}", row ${x.row}: ${esc(x.reason)}</li>`).join('');
  const more = s.skipped.length > 25 ? `<li class="warn">â€¦and ${s.skipped.length - 25} more skipped rows.</li>` : '';

  $('#importOut').innerHTML = `
    <h2 style="margin-top:18px">${s.committed ? '<span class="ok">Imported.</span>' : 'Ready to import'}</h2>
    <p class="hint" style="margin:0">${s.firstDate ? `Dates in this file run from ${esc(fmtDate(s.firstDate))} to ${esc(fmtDate(s.lastDate))}.` : 'No usable rows found.'}</p>
    <div class="result-stats">
      <div><b>${s.inserted}</b><span>${s.committed ? 'new rows added' : 'new rows'}</span></div>
      <div><b>${s.updated}</b><span>${s.committed ? 'rows updated' : 'rows that changed'}</span></div>
      <div><b>${s.unchanged}</b><span>already up to date</span></div>
      <div><b>${s.skipped.length}</b><span>skipped</span></div>
    </div>
    ${s.people.length ? `<table><thead><tr><th>Person</th><th class="num">Rows</th><th class="num">Time</th></tr></thead><tbody>${
      s.people.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.rows}</td><td class="num">${hrs(p.mins)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${lines.length || skipped ? `<ul class="notes">${lines.join('')}${skipped}${more}</ul>` : ''}`;
}

$('#check').onclick = async () => {
  try {
    setImportMsg('Reading fileâ€¦');
    const s = await sendFile(0);
    renderImport(s);
    $('#doImport').disabled = !(s.inserted || s.updated);
    setImportMsg(s.inserted || s.updated ? '' : 'Nothing new to import.');
  } catch (e) { setImportMsg(e.message, true); }
};

$('#doImport').onclick = async () => {
  try {
    $('#doImport').disabled = true;
    setImportMsg('Importingâ€¦');
    const s = await sendFile(1);
    renderImport(s);
    setImportMsg('');
    await loadMeta();
    loadList();
  } catch (e) { setImportMsg(e.message, true); $('#doImport').disabled = false; }
};
$('#exportAll').onclick = () => { location.href = '/api/export.xlsx'; };

/* ---------- start ---------- */
$('#date').value = today();
renderTimer();
loadMeta().then(loadList).catch((e) => setMsg(e.message, true));
