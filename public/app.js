'use strict';

// Front-end for the WalmartCheck → QuickBooks review + post flow.

const state = { connected: false, lastAnalyze: null };
const $ = (id) => document.getElementById(id);

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 4500);
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function money(n) {
  return (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function tile(k, v, cls) { return `<div class="tile ${cls || ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`; }

// --- status ----------------------------------------------------------------

async function refreshStatus() {
  const s = await api('/api/status');
  state.connected = s.connected;
  const dot = $('statusDot');
  if (s.configProblems && s.configProblems.length) {
    const w = $('configWarning');
    w.classList.remove('hidden');
    w.innerHTML = '⚠ QuickBooks app not configured: ' + s.configProblems.join(', ') +
      '. Copy <code>.env.example</code> to <code>.env</code>, add your Intuit keys, restart.';
  }
  if (s.authRequired) $('logoutBtn').classList.remove('hidden');
  if (s.connected) {
    dot.className = 'status-dot ok';
    $('connectionText').textContent = `${(s.company && s.company.name) || 'Connected'} · ${s.environment}`;
    hide('connectBtn'); show('disconnectBtn');
    if (s.environment === 'sandbox') show('sandboxBar'); else hide('sandboxBar');
  } else {
    dot.className = 'status-dot off';
    $('connectionText').textContent = 'Not connected';
    show('connectBtn'); hide('disconnectBtn');
    hide('sandboxBar');
  }
}

// --- upload / analyze ------------------------------------------------------

function setupDropzone() {
  const dz = $('dropzone');
  const input = $('fileInput');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files[0]) analyze(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) analyze(input.files[0]); });
}

async function analyze(file) {
  $('fileName').textContent = `Reading ${file.name}…`;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const data = await api('/api/analyze', { method: 'POST', body: fd });
    state.lastAnalyze = data;
    $('fileName').textContent = `${file.name} · check ${data.checkNumber || '(unknown)'}`;
    render(data);
  } catch (err) {
    $('fileName').textContent = '';
    toast(err.message, true);
  }
}

// --- render review ---------------------------------------------------------

function render(data) {
  const plan = data.plan;

  // unclassified codes gate everything
  const unclassified = dedupeCodes(plan.unclassified || []);
  if (unclassified.length) {
    renderUnclassified(unclassified);
    show('step-unclassified');
  } else {
    hide('step-unclassified');
  }

  // header + reconciliation
  const posted = data.alreadyPosted ? ' <span class="pill dup">already posted</span>' : '';
  $('reviewHeader').innerHTML =
    `<h1>Check ${esc(data.checkNumber || '—')}</h1>` +
    `<p class="sub">Paid ${esc(fmtDate(data.datePaid))} · ${plan.receivePayment.invoices.length} invoices${posted}</p>`;

  const r = plan.reconciliation;
  $('reconcile').innerHTML =
    tile('Remittance net', money(r.remittanceNet)) +
    tile('Bank deposit', money(r.depositTotal), 'good') +
    tile('Balanced', r.balanced ? 'Yes' : 'No', r.balanced ? 'good' : 'bad');

  // Receive Payment (invoices paid in full)
  $('rpDest').textContent = `into ${plan.receivePayment.depositToAccount} · paid in full`;
  const pt = $('paymentTable').querySelector('tbody');
  pt.innerHTML = plan.receivePayment.invoices.map((i) =>
    `<tr><td>${esc(i.invoice)}</td><td class="num">${money(i.invoiceAmount)}</td><td class="num">${money(i.appliedToUndepositedFunds)}</td></tr>`
  ).join('') +
    `<tr class="total"><td>Total</td><td></td><td class="num">${money(plan.receivePayment.total)}</td></tr>`;

  // Bank Deposit
  $('depDest').textContent = `into ${plan.bankDeposit.depositToAccount}`;
  const dt = $('depositTable').querySelector('tbody');
  dt.innerHTML = plan.bankDeposit.lines.map((l) => {
    const cls = l.amount < 0 ? 'neg' : '';
    let desc = esc(l.description);
    let pill = '';
    if (l.type === 'disputed-deduction') { pill = '<span class="pill dispute">Dispute</span> '; desc = desc.replace(/^Disputed:\s*/, ''); }
    return `<tr><td>${pill}${desc}</td><td class="acct">${esc(l.account || '')}</td><td class="num ${cls}">${money(l.amount)}</td></tr>`;
  }).join('') +
    `<tr class="total"><td>Deposit total</td><td></td><td class="num">${money(plan.bankDeposit.total)}</td></tr>`;

  // connection-dependent review notes
  const rw = $('reviewWarnings');
  let notes = '';
  if (!state.connected) {
    notes += `<div class="banner warn">Connect QuickBooks to match invoices and enable posting.</div>`;
  } else if (data.review && data.review.error) {
    notes += `<div class="banner warn">${esc(data.review.error)}</div>`;
  } else if (data.review && data.review.warnings && data.review.warnings.length) {
    notes += data.review.warnings.map((w) => `<div class="banner warn">${esc(w)}</div>`).join('');
  }
  rw.innerHTML = notes;

  // A check posted before the Disputes tab existed has its disputes sitting in
  // Disputed AR untracked. Offer to record them — this posts nothing.
  const canBackfill = data.alreadyPosted && unclassified.length === 0 && (plan.disputes || []).length > 0;
  $('backfillBtn').classList.toggle('hidden', !canBackfill);
  if (canBackfill) {
    const n = plan.disputes.length;
    $('backfillBtn').textContent = `Record ${n} dispute${n === 1 ? '' : 's'}`;
  }

  // buttons
  const canPost = state.connected && unclassified.length === 0 && r.balanced && !data.alreadyPosted;
  $('postBtn').disabled = !canPost;
  $('postHint').textContent = !state.connected ? 'Connect QuickBooks first'
    : unclassified.length ? 'Classify the new codes first'
    : !r.balanced ? 'Does not balance — not safe to post'
    : canBackfill ? 'Already posted — you can still track its disputes (nothing is posted)'
    : data.alreadyPosted ? 'This check was already posted'
    : 'Posts a Receive Payment + Bank Deposit';

  show('step-review');
  $('step-review').scrollIntoView({ behavior: 'smooth' });
}

function dedupeCodes(unclassified) {
  const seen = new Map();
  for (const u of unclassified) {
    if (!seen.has(u.code)) seen.set(u.code, { code: u.code, sample: u.deductionCode || '', count: 0 });
    seen.get(u.code).count++;
  }
  return Array.from(seen.values());
}

function renderUnclassified(codes) {
  const box = $('unclassifiedList');
  box.innerHTML = codes.map((c) => `
    <div class="uc-row" data-code="${esc(c.code)}">
      <div><strong>[${esc(c.code)}]</strong> <span class="muted">${esc(c.sample)}</span> <span class="muted small">×${c.count}</span></div>
      <select class="uc-cat">
        <option value="">choose…</option>
        <option value="accept">Accept — write off on payment</option>
        <option value="dispute">Dispute — negative to Disputed AR</option>
        <option value="fee:advertising">Fee — Advertising (Marketing)</option>
        <option value="fee:compliance">Fee — Compliance</option>
      </select>
      <button class="btn small uc-save">Save</button>
    </div>`).join('');
  box.querySelectorAll('.uc-save').forEach((btn) => btn.addEventListener('click', saveCode));
}

async function saveCode(e) {
  const row = e.target.closest('.uc-row');
  const code = row.dataset.code;
  const val = row.querySelector('.uc-cat').value;
  if (!val) return toast('Pick where this code goes.', true);
  let entry;
  if (val.startsWith('fee:')) entry = { description: `Walmart ${val.split(':')[1]} fee`, category: 'fee', feeAccount: val.split(':')[1] };
  else entry = { description: `Code ${code}`, category: val };
  try {
    await api('/api/config/decoder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, entry }) });
    toast(`Saved code ${code}. Re-checking…`);
    const data = await api('/api/reanalyze');
    state.lastAnalyze = data;
    render(data);
  } catch (err) {
    toast(err.message, true);
  }
}

// --- post ------------------------------------------------------------------

async function doPost(dryRun) {
  const btn = dryRun ? $('dryRunBtn') : $('postBtn');
  btn.disabled = true;
  $('postHint').textContent = dryRun ? 'Building payloads…' : 'Posting…';
  try {
    const report = await api('/api/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun }) });
    renderResults(report, dryRun);
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

async function doBackfill() {
  const btn = $('backfillBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Recording…';
  try {
    const r = await api('/api/backfill-claims', { method: 'POST' });
    if (r.added === 0) {
      toast(`Check ${r.checkNumber}: its ${r.disputes} dispute${r.disputes === 1 ? '' : 's'} were already tracked.`);
    } else {
      toast(`Recorded ${r.added} dispute${r.added === 1 ? '' : 's'} from check ${r.checkNumber}. Nothing was posted.`);
    }
    showDisputes();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function renderResults(report, dryRun) {
  const body = $('resultsBody');
  if (dryRun) {
    body.innerHTML = `<p class="muted">Dry run — nothing was posted. These are the exact QuickBooks payloads:</p>
      <pre class="code">${esc(JSON.stringify(report.payloads, null, 2))}</pre>`;
  } else {
    const steps = (report.steps || []).map((s) => `<li>${esc(s.type)} #${esc(s.id)}${s.total ? ' · ' + money(s.total) : ''}</li>`).join('');
    body.innerHTML = `<div class="banner ok">Posted check ${esc(report.checkNumber)}.</div>
      <ul>${steps}</ul>
      ${(report.warnings || []).map((w) => `<div class="banner warn">${esc(w)}</div>`).join('')}`;
  }
  show('step-results');
  $('step-results').scrollIntoView({ behavior: 'smooth' });
}

// --- history ---------------------------------------------------------------

function setNav(view) {
  $('navImport').classList.toggle('active', view === 'import');
  $('navDisputes').classList.toggle('active', view === 'disputes');
  $('navHistory').classList.toggle('active', view === 'history');
  $('navSettings').classList.toggle('active', view === 'settings');
}

const CLAIM_STATUSES = [
  ['ready', 'Ready to file'],
  ['filed', 'Filed'],
  ['research', 'In research'],
  ['partial', 'Partly recovered'],
  ['recovered', 'Recovered'],
  ['denied', 'Denied'],
  ['writeoff', 'Written off'],
];

function showDisputes() {
  setNav('disputes');
  document.querySelectorAll('main > .step').forEach((s) => s.classList.add('hidden'));
  hide('sandboxBar');
  show('step-disputes');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadClaims();
}

async function loadClaims() {
  const body = $('disputesBody');
  body.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const { claims, totals } = await api('/api/claims');
    $('disputeTotals').innerHTML =
      tile('Open claims', totals.openCount) +
      tile('Needs docs', totals.needsDocsCount || 0, totals.needsDocsCount ? 'bad' : '') +
      tile('Open $', money(totals.openAmount), totals.openAmount ? 'bad' : '') +
      tile('Recovered $', money(totals.recoveredAmount), 'good');
    if (!claims.length) {
      body.innerHTML = '<p class="sub">No disputes yet. They show up here automatically when you post a check that has disputable deductions.</p>';
      return;
    }
    const rows = claims.map((c) => {
      const opts = CLAIM_STATUSES.map(([v, l]) => `<option value="${v}" ${c.status === v ? 'selected' : ''}>${l}</option>`).join('');
      const done = ['recovered', 'denied', 'writeoff'].includes(c.status);
      const rec = Number(c.recoveredAmount) || 0;
      const amountCell = rec > 0 && c.status !== 'recovered'
        ? `${money(c.amount)}<div class="acct small">${money(rec)} back</div>`
        : money(c.amount);
      const ds = c.docsStatus || { complete: false };
      const has = (k) => c.docs && c.docs[k] && c.docs[k].have;
      const docsCell = done
        ? '<span class="acct">—</span>'
        : `<div class="docs">
             <span class="pill ${ds.complete ? 'ok' : 'warn'}">${ds.complete ? 'Docs ready' : 'Needs docs'}</span>
             <label class="docchk"><input type="checkbox" class="docbox" data-id="${esc(c.id)}" data-doc="pod" ${has('pod') ? 'checked' : ''}> POD</label>
             <label class="docchk"><input type="checkbox" class="docbox" data-id="${esc(c.id)}" data-doc="invoice" ${has('invoice') ? 'checked' : ''}> Invoice</label>
           </div>`;
      return `<tr class="${done ? 'muted' : ''}">
        <td><input type="checkbox" class="clsel" data-id="${esc(c.id)}" ${c.status === 'ready' && ds.complete ? 'checked' : ''}></td>
        <td>${esc(c.invoice)}</td>
        <td class="acct">${esc(c.po || '—')}</td>
        <td>[${esc(c.code)}]</td>
        <td class="num neg">${amountCell}</td>
        <td class="acct">${esc(c.shipDate || '—')}</td>
        <td>${docsCell}</td>
        <td><select class="clstatus" data-id="${esc(c.id)}">${opts}</select></td>
        <td class="acct">${esc(c.newInvoice || '—')}</td>
      </tr>`;
    }).join('');
    body.innerHTML =
      `<div class="tbl-wrap"><table>
        <thead><tr><th></th><th>Invoice</th><th>PO</th><th>Code</th><th class="num">Amount</th><th>Ship date</th><th>Docs</th><th>Status</th><th>New Inv #</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    body.querySelectorAll('.clstatus').forEach((sel) =>
      sel.addEventListener('change', async (e) => {
        try { await api(`/api/claims/${encodeURIComponent(e.target.dataset.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: e.target.value }) }); loadClaims(); }
        catch (err) { toast(err.message, true); }
      })
    );
    body.querySelectorAll('.docbox').forEach((box) =>
      box.addEventListener('change', async (e) => {
        const { id, doc } = e.target.dataset;
        const have = e.target.checked;
        try {
          await api(`/api/claims/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docs: { [doc]: { have } } }) });
          loadClaims();
        } catch (err) { e.target.checked = !have; toast(err.message, true); }
      })
    );
  } catch (err) {
    body.innerHTML = `<div class="banner warn">${esc(err.message)}</div>`;
  }
}

async function exportClaims() {
  const ids = Array.from(document.querySelectorAll('.clsel')).filter((c) => c.checked).map((c) => c.dataset.id);
  try {
    const res = await fetch('/api/claims/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Export failed'); }
    // Claims held back for missing documents (the export files only documented ones).
    let skipped = [];
    try { skipped = JSON.parse(res.headers.get('X-Skipped-Missing-Docs') || '[]'); } catch (_) { /* none */ }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Recovery_Submission.xlsx'; a.click();
    URL.revokeObjectURL(url);
    if (skipped.length) {
      toast(`Filed the documented claims. Held back ${skipped.length} missing docs: inv ${skipped.map((s) => s.invoice).join(', ')}.`, true);
    } else {
      toast('Exported. Claims marked Filed. File it in Retail Link.');
    }
    loadClaims();
  } catch (err) {
    toast(err.message, true);
  }
}

// --- settings --------------------------------------------------------------

function showSettings() {
  setNav('settings');
  document.querySelectorAll('main > .step').forEach((s) => s.classList.add('hidden'));
  hide('sandboxBar');
  show('step-settings');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadSettings();
}

const SETTING_FIELDS = [
  ['vendorNumber', 'Vendor #', 'Your Walmart vendor number. Appears in every row of the export.'],
  ['dept', 'Dept', 'Walmart department number.'],
  ['seq', 'Seq', 'Sequence number for the submission.'],
];

async function loadSettings() {
  const body = $('settingsBody');
  body.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const { config, minSafe, statHighWater, recommended } = await api('/api/walmart-config');

    // A config saved before the safe block was chosen can still hold a number
    // that clears STAT's high-water mark but not by enough to survive another
    // of their batches. Legal, so the server won't refuse it — but say so.
    const headroom = Number(config.nextNewInvoice) - statHighWater;
    const warning = Number(config.nextNewInvoice) < recommended
      ? `<div class="banner warn">Next New Inv # is ${esc(config.nextNewInvoice)} — only
         <b>${headroom}</b> numbers above STAT's last filed rebill (${statHighWater}). STAT has issued as
         many as 125 rebills in a single batch, so one more filing from them would run straight through
         our numbers and Walmart would reject the duplicates. Recommended: <b>${recommended}</b>.</div>`
      : '';

    const rows = SETTING_FIELDS.map(([key, label, hint]) => `
      <div class="set-row">
        <label for="set-${key}">${label}</label>
        <div>
          <input type="text" id="set-${key}" data-key="${key}" value="${esc(config[key])}" />
          <span class="set-hint">${esc(hint)}</span>
        </div>
      </div>`).join('');

    body.innerHTML = warning + rows + `
      <div class="set-row">
        <label for="set-nextNewInvoice">Next New Inv #</label>
        <div>
          <input type="text" id="set-nextNewInvoice" data-key="nextNewInvoice" value="${esc(config.nextNewInvoice)}" />
          <span class="set-hint">
            The rebill invoice number the next export will assign, counting up from there.
            <b>Must be ${minSafe} or higher.</b> STAT Recovery already filed rebills through
            ${statHighWater} for this vendor, and any number we've already submitted is spent —
            reusing one gets the claim rejected by Walmart.
          </span>
        </div>
      </div>
      <div class="actions">
        <button class="btn primary" id="saveSettingsBtn">Save</button>
        <span class="hint" id="settingsHint"></span>
      </div>`;
    $('saveSettingsBtn').addEventListener('click', saveSettings);
  } catch (err) {
    body.innerHTML = `<div class="banner warn">${esc(err.message)}</div>`;
  }
}

async function saveSettings() {
  const btn = $('saveSettingsBtn');
  const payload = {};
  document.querySelectorAll('#settingsBody input[data-key]').forEach((el) => {
    el.classList.remove('bad');
    payload[el.dataset.key] = el.value.trim();
  });
  btn.disabled = true;
  $('settingsHint').textContent = 'Saving…';
  try {
    await api('/api/walmart-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    $('settingsHint').textContent = '';
    toast('Settings saved.');
    loadSettings();
  } catch (err) {
    // The server owns the numbering rules, so let its message stand rather
    // than second-guessing which field it objected to.
    if (/New Inv #/.test(err.message)) $('set-nextNewInvoice').classList.add('bad');
    $('settingsHint').textContent = '';
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function showHistory() {
  setNav('history');
  document.querySelectorAll('main > .step').forEach((s) => s.classList.add('hidden'));
  hide('sandboxBar');
  show('step-history');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadHistory();
}

function showImport() {
  setNav('import');
  hide('step-history');
  hide('step-disputes');
  hide('step-settings');
  show('step-upload');
  refreshStatus().catch(() => {});
}

async function loadHistory() {
  const body = $('historyBody');
  body.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const { posted } = await api('/api/history');
    if (!posted.length) {
      body.innerHTML = '<p class="sub">No checks posted from this computer yet. Once you post one, it shows up here.</p>';
      return;
    }
    const rows = posted.map((p) => {
      const pay = (p.steps || []).find((s) => s.type === 'payment');
      const dep = (p.steps || []).find((s) => s.type === 'deposit');
      const ids = [pay && `payment #${esc(pay.id)}`, dep && `deposit #${esc(dep.id)}`].filter(Boolean).join(' · ');
      return `<tr>
        <td>${esc(p.reference || '—')}</td>
        <td class="muted">${esc(fmtDate(p.postedAt))}</td>
        <td class="num">${money(p.net)}</td>
        <td class="acct">${ids || '—'}</td>
      </tr>`;
    }).join('');
    body.innerHTML =
      `<div class="tbl-wrap"><table>
        <thead><tr><th>Check #</th><th>Posted</th><th class="num">Deposit</th><th>In QuickBooks</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  } catch (err) {
    body.innerHTML = `<div class="banner warn">${esc(err.message)}</div>`;
  }
}

// --- wiring ----------------------------------------------------------------

$('navImport').addEventListener('click', showImport);
$('navDisputes').addEventListener('click', showDisputes);
$('navHistory').addEventListener('click', showHistory);
$('navSettings').addEventListener('click', showSettings);
$('exportClaimsBtn').addEventListener('click', exportClaims);
$('connectBtn').addEventListener('click', () => (window.location.href = '/auth/connect'));
$('disconnectBtn').addEventListener('click', async () => { await api('/api/disconnect', { method: 'POST' }); refreshStatus(); });
$('dryRunBtn').addEventListener('click', () => doPost(true));
$('backfillBtn').addEventListener('click', doBackfill);
$('postBtn').addEventListener('click', () => { if (confirm('Post this Receive Payment and Bank Deposit to QuickBooks?')) doPost(false); });
$('startOverBtn').addEventListener('click', () => location.reload());
$('logoutBtn').addEventListener('click', async () => { await fetch('/logout', { method: 'POST' }).catch(() => {}); location.href = '/login'; });
$('setupSandboxBtn').addEventListener('click', async () => {
  const btn = $('setupSandboxBtn');
  btn.disabled = true; btn.textContent = 'Setting up…';
  try {
    const { report } = await api('/api/setup-sandbox', { method: 'POST' });
    const invs = report.invoices.map((i) => i.docNumber).join(', ');
    toast(`Sandbox ready: accounts + Walmart customer + invoices ${invs}. Re-checking…`);
    if (state.lastAnalyze) { const data = await api('/api/reanalyze'); state.lastAnalyze = data; render(data); }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Set up sandbox test data';
  }
});

setupDropzone();
refreshStatus().catch((e) => toast(e.message, true));
