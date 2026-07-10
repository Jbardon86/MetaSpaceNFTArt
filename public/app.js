'use strict';

// Front-end controller for the import wizard. Talks to the /api/* endpoints.

const state = {
  headers: [],
  suggestedMapping: {},
  checks: [],
  accounts: [],
  settings: null,
};

const MAP_FIELDS = [
  { key: 'reference', label: 'Check / reference #', required: true },
  { key: 'date', label: 'Payment date', required: true },
  { key: 'gross', label: 'Gross / sales amount', required: false },
  { key: 'fees', label: 'Fees / deductions', required: false },
  { key: 'net', label: 'Net / check amount', required: false },
  { key: 'customer', label: 'Customer / payer', required: false },
  { key: 'memo', label: 'Memo / description', required: false },
];

const $ = (id) => document.getElementById(id);

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  setTimeout(() => t.classList.add('hidden'), 4200);
  t.classList.remove('hidden');
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function money(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// --- Connection / status ---------------------------------------------------

async function refreshStatus() {
  const s = await api('/api/status');
  state.settings = s.settings;
  const dot = $('statusDot');
  const text = $('connectionText');

  if (s.configProblems && s.configProblems.length) {
    const w = $('configWarning');
    w.classList.remove('hidden');
    w.innerHTML =
      '⚠ QuickBooks app not configured: ' +
      s.configProblems.join(', ') +
      '. Copy <code>.env.example</code> to <code>.env</code> and add your Intuit keys, then restart.';
  }

  if (s.connected) {
    dot.className = 'status-dot ok';
    const name = s.company && s.company.name ? s.company.name : 'Connected';
    text.textContent = `${name} · ${s.environment}`;
    $('connectBtn').classList.add('hidden');
    $('disconnectBtn').classList.remove('hidden');
    loadAccounts().catch((e) => toast(e.message, true));
  } else {
    dot.className = 'status-dot off';
    text.textContent = 'Not connected';
    $('connectBtn').classList.remove('hidden');
    $('disconnectBtn').classList.add('hidden');
  }
}

async function loadAccounts() {
  const { accounts } = await api('/api/accounts');
  state.accounts = accounts;
  const bank = accounts.filter((a) => a.type === 'Bank' || a.classification === 'Asset');
  const income = accounts.filter((a) => a.type === 'Income' || a.classification === 'Revenue');
  const expense = accounts.filter(
    (a) => a.type === 'Expense' || a.type === 'CostOfGoodsSold' || a.classification === 'Expense'
  );
  fillSelect($('acctBank'), bank);
  fillSelect($('acctIncome'), income);
  fillSelect($('acctFees'), expense, true);

  const saved = state.settings && state.settings.accounts;
  if (saved) {
    if (saved.bank) $('acctBank').value = saved.bank;
    if (saved.income) $('acctIncome').value = saved.income;
    if (saved.fees) $('acctFees').value = saved.fees;
  }
}

function fillSelect(sel, accounts, allowNone) {
  sel.innerHTML = '';
  if (allowNone) sel.append(new Option('— none —', ''));
  for (const a of accounts) sel.append(new Option(`${a.name} (${a.type})`, a.id));
}

// --- Step 1: upload --------------------------------------------------------

function setupDropzone() {
  const dz = $('dropzone');
  const input = $('fileInput');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) uploadFile(input.files[0]);
  });
}

async function uploadFile(file) {
  $('fileName').textContent = `Reading ${file.name}…`;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const data = await api('/api/upload', { method: 'POST', body: fd });
    state.headers = data.headers;
    state.suggestedMapping = data.suggestedMapping || {};
    $('fileName').textContent = `${data.filename} · ${data.rowCount} rows, ${data.headers.length} columns`;
    renderMap();
    show('step-map');
    show('step-accounts'); // reveal accounts alongside mapping
    $('step-map').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    $('fileName').textContent = '';
    toast(err.message, true);
  }
}

// --- Step 2: mapping -------------------------------------------------------

function renderMap() {
  const grid = $('mapGrid');
  grid.innerHTML = '';
  for (const field of MAP_FIELDS) {
    const label = document.createElement('label');
    label.innerHTML = `${field.label}${field.required ? ' *' : ''}`;
    const sel = document.createElement('select');
    sel.id = `map_${field.key}`;
    sel.append(new Option('— none —', ''));
    for (const h of state.headers) sel.append(new Option(h, h));
    const guess = state.suggestedMapping[field.key];
    if (guess) sel.value = guess;
    label.append(sel);
    grid.append(label);
  }
}

function currentMapping() {
  const map = {};
  for (const field of MAP_FIELDS) {
    const v = $(`map_${field.key}`).value;
    if (v) map[field.key] = v;
  }
  return map;
}

function currentOptions() {
  return {
    columnMap: currentMapping(),
    groupByReference: $('optGroup').checked,
    feesArePositiveMagnitude: $('optFeesPositive').checked,
    defaultCustomer: (state.settings && state.settings.defaults && state.settings.defaults.customerName) || 'Walmart',
  };
}

async function preview() {
  const map = currentMapping();
  if (!map.reference) return toast('Please map the Check / reference # column.', true);
  if (!map.date) return toast('Please map the Payment date column.', true);
  if (!map.gross && !map.net) return toast('Map at least a Gross or a Net amount column.', true);

  const opts = currentOptions();
  try {
    const data = await api('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnMap: map, options: opts }),
    });
    state.checks = data.checks;
    renderPreview(data);
    show('step-preview');
    $('step-preview').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    toast(err.message, true);
  }
}

// --- Step 4: preview table -------------------------------------------------

function renderPreview(data) {
  const t = data.totals;
  $('totals').innerHTML = `
    ${tile('Checks', t.checkCount)}
    ${tile('Ready to post', t.readyCount, 'good')}
    ${tile('Duplicates', t.duplicateCount, t.duplicateCount ? 'bad' : '')}
    ${tile('Needs fixing', t.invalidCount, t.invalidCount ? 'bad' : '')}
    ${tile('Gross total', money(t.grossTotal))}
    ${tile('Fees total', money(t.feesTotal))}
    ${tile('Net total', money(t.netTotal), 'good')}
  `;

  const warn = $('warnings');
  warn.innerHTML = (data.warnings || [])
    .map((w) => `<div class="banner warn">${escapeHtml(w)}</div>`)
    .join('');

  const tbody = $('checksTable').querySelector('tbody');
  tbody.innerHTML = '';
  data.checks.forEach((c, i) => {
    const tr = document.createElement('tr');
    const canPost = c.valid && !c.duplicate;
    if (c.duplicate) tr.className = 'dup';
    else if (!c.valid) tr.className = 'invalid';

    let statusHtml;
    if (c.duplicate) statusHtml = '<span class="pill dup">duplicate</span>';
    else if (!c.valid) statusHtml = `<span class="pill bad">check</span><div class="issues">${(c.issues || []).map(escapeHtml).join('; ')}</div>`;
    else statusHtml = '<span class="pill ok">ready</span>';

    tr.innerHTML = `
      <td><input type="checkbox" class="rowsel" data-i="${i}" ${canPost ? 'checked' : ''} ${canPost ? '' : 'disabled'} /></td>
      <td>${escapeHtml(c.reference || '—')}${c.lineItemCount > 1 ? ` <span class="muted small">(${c.lineItemCount} lines)</span>` : ''}</td>
      <td>${escapeHtml(c.date || '—')}</td>
      <td>${escapeHtml(c.customer || '—')}</td>
      <td class="num">${money(c.gross)}</td>
      <td class="num">${money(c.fees)}</td>
      <td class="num">${money(c.net)}</td>
      <td>${statusHtml}</td>`;
    tbody.append(tr);
  });

  updatePostHint();
  tbody.querySelectorAll('.rowsel').forEach((cb) => cb.addEventListener('change', updatePostHint));
}

function updatePostHint() {
  const n = selectedIndexes().length;
  $('postHint').textContent = n ? `${n} deposit${n === 1 ? '' : 's'} selected` : 'Nothing selected';
  $('postBtn').disabled = n === 0;
}

function selectedIndexes() {
  return Array.from(document.querySelectorAll('.rowsel'))
    .filter((cb) => cb.checked && !cb.disabled)
    .map((cb) => Number(cb.dataset.i));
}

function tile(k, v, cls) {
  return `<div class="tile ${cls || ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

// --- Step 5: post ----------------------------------------------------------

async function post() {
  const idx = selectedIndexes();
  if (!idx.length) return;
  const accounts = {
    bank: $('acctBank').value,
    income: $('acctIncome').value,
    fees: $('acctFees').value || null,
  };
  if (!accounts.bank) return toast('Choose a bank account (step 3).', true);
  if (!accounts.income) return toast('Choose an income account (step 3).', true);

  const checks = idx.map((i) => state.checks[i]);
  $('postBtn').disabled = true;
  $('postHint').textContent = 'Posting…';
  try {
    const data = await api('/api/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks, accounts, options: { columnMap: currentMapping() } }),
    });
    renderResults(data);
    show('step-results');
    $('step-results').scrollIntoView({ behavior: 'smooth' });
    toast(`Posted ${data.summary.posted}, skipped ${data.summary.skipped}, errors ${data.summary.errors}`);
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('postBtn').disabled = false;
    updatePostHint();
  }
}

function renderResults(data) {
  const s = data.summary;
  $('resultsSummary').innerHTML = `
    <div class="totals">
      ${tile('Posted', s.posted, 'good')}
      ${tile('Skipped', s.skipped)}
      ${tile('Errors', s.errors, s.errors ? 'bad' : '')}
    </div>`;
  const tbody = $('resultsTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const r of data.results) {
    const pill =
      r.status === 'posted' ? '<span class="pill ok">posted</span>'
      : r.status === 'skipped' ? '<span class="pill skip">skipped</span>'
      : '<span class="pill bad">error</span>';
    const detail =
      r.status === 'posted' ? `Deposit #${r.depositId}` : escapeHtml(r.message || '');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(r.reference || '—')}</td><td class="num">${money(r.net)}</td><td>${pill}</td><td>${detail}</td>`;
    tbody.append(tr);
  }
}

// --- helpers ---------------------------------------------------------------

function show(id) {
  $(id).classList.remove('hidden');
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// --- wiring ----------------------------------------------------------------

$('connectBtn').addEventListener('click', () => (window.location.href = '/auth/connect'));
$('disconnectBtn').addEventListener('click', async () => {
  await api('/api/disconnect', { method: 'POST' });
  refreshStatus();
});
$('previewBtn').addEventListener('click', preview);
$('postBtn').addEventListener('click', post);
$('startOverBtn').addEventListener('click', () => window.location.reload());

setupDropzone();
refreshStatus().catch((e) => toast(e.message, true));
