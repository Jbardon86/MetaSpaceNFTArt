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
  const posted =
    data.alreadyPosted ? ' <span class="pill dup">already posted</span>'
    : data.review && data.review.alreadyInQuickBooks ? ' <span class="pill dup">already in QuickBooks</span>'
    : '';
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

  // A check is "already recorded" if the app posted it (its ledger) OR its
  // invoices already show paid in QuickBooks (posted another way). Either way,
  // posting again would double-book — so block Post and offer to just record
  // its disputes instead (that posts nothing).
  const alreadyInQBO = !!(data.review && data.review.alreadyInQuickBooks);
  const alreadyRecorded = data.alreadyPosted || alreadyInQBO;
  const canBackfill = alreadyRecorded && unclassified.length === 0 && (plan.disputes || []).length > 0;
  $('backfillBtn').classList.toggle('hidden', !canBackfill);
  if (canBackfill) {
    const n = plan.disputes.length;
    $('backfillBtn').textContent = `Record ${n} dispute${n === 1 ? '' : 's'}`;
  }

  // buttons
  const canPost = state.connected && unclassified.length === 0 && r.balanced && !alreadyRecorded;
  $('postBtn').disabled = !canPost;
  $('postHint').textContent = !state.connected ? 'Connect QuickBooks first'
    : unclassified.length ? 'Classify the new codes first'
    : !r.balanced ? 'Does not balance — not safe to post'
    : canBackfill ? 'Already in QuickBooks — you can still track its disputes (nothing is posted)'
    : alreadyInQBO && !data.alreadyPosted ? 'Already in QuickBooks — posting would double-book it'
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

// --- Walmart APDP dispute status import ------------------------------------

const APDP_BUCKET_CLASS = { approved: 'good', denied: 'bad', cancelled: '', pending: '', unknown: '' };

const APDP_BUCKET_LABEL = {
  approved: 'Approved', denied: 'Denied', cancelled: 'Cancelled',
  pending: 'Pending', mixed: 'Mixed', unknown: 'Unknown',
};

/**
 * Walmart's own ruling on a claim, as a pill. Deliberately separate from the
 * claim's own status: this is what Walmart says, not where we are in filing.
 * A claim whose dispute lines disagree reads "Mixed" with the split spelled out
 * rather than being flattened into a single verdict.
 */
function walmartStatusCell(ws) {
  if (!ws) return '<span class="acct">—</span>';
  const cls = ws.status === 'mixed' ? 'warn' : ws.status === 'approved' ? 'ok' : ws.status === 'denied' ? 'bad' : '';
  const label = APDP_BUCKET_LABEL[ws.status] || ws.status;
  const detail =
    ws.status === 'mixed'
      ? Object.entries(ws.counts).map(([b, n]) => `${n} ${APDP_BUCKET_LABEL[b] || b}`).join(', ')
      : ws.lineCount > 1
      ? `${ws.lineCount} lines`
      : '';
  const amt = ws.deniedAmount ? `<div class="acct small">${money(ws.deniedAmount)} denied</div>` : '';
  return `<span class="pill ${cls}">${label}</span>${detail ? `<div class="acct small">${esc(detail)}</div>` : ''}${amt}`;
}

function showApdpImport() {
  setNav('disputes');
  document.querySelectorAll('main > .step').forEach((s) => s.classList.add('hidden'));
  hide('sandboxBar');
  show('step-apdp');
}

// --- Denial follow-up (stage 6) --------------------------------------------

const DENIAL_ACTIONS = {
  're-file': ['Ready to re-file', 'ok'],
  'attach-pod': ['Needs proof of delivery', 'warn'],
  review: ['Review', ''],
  duplicate: ['Duplicate', ''],
  expired: ['Past window', ''],
  upheld: ['Walmart upheld', ''],
};

function showDenials() {
  setNav('disputes');
  document.querySelectorAll('main > .step').forEach((s) => s.classList.add('hidden'));
  hide('sandboxBar');
  show('step-denials');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  loadDenials();
}

async function loadDenials() {
  const body = $('denialsBody');
  body.innerHTML = '<p class="sub">Loading…</p>';
  try {
    const { items, totals } = await api('/api/denials');
    $('denialsTotals').innerHTML =
      tile('Denials', totals.count) +
      tile('Recoverable', money(totals.recoverableAmount), totals.recoverableAmount ? 'bad' : '') +
      tile('Ready to re-file', totals.readyToRefile, totals.readyToRefile ? 'good' : '') +
      tile('Need a POD', totals.needPod, totals.needPod ? 'bad' : '');
    if (!items.length) {
      body.innerHTML =
        '<p class="sub">No denials on your tracked disputes yet. Once you import an APDP export and any dispute you filed was denied, it shows up here — bucketed by why, with a drafted appeal — so you can re-file it.</p>';
      return;
    }
    body.innerHTML = items.map(denialCard).join('');
    body.querySelectorAll('[data-refile]').forEach((btn) =>
      btn.addEventListener('click', () => refileDenial(btn.dataset.refile))
    );
    body.querySelectorAll('[data-copy]').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (navigator.clipboard) navigator.clipboard.writeText(btn.dataset.copy);
        toast('Appeal text copied.');
      })
    );
  } catch (err) {
    body.innerHTML = `<div class="banner warn">${esc(err.message)}</div>`;
  }
}

function denialCard(d) {
  const [label, cls] = DENIAL_ACTIONS[d.action] || ['Review', ''];
  const ev = d.evidence || {};
  const cited = d.denialComment
    ? esc(d.denialComment)
    : ev.rcvDate
    ? `Walmart cites receipt ${esc(ev.rcvDate)}${ev.proNbr ? ' (PRO ' + esc(ev.proNbr) + ')' : ''}`
    : '—';
  const actionBtn =
    d.action === 're-file'
      ? `<button class="btn small" data-refile="${esc(d.claimId)}">Re-file</button>`
      : d.action === 'attach-pod'
      ? '<span class="hint">Attach the BOL on the Disputes tab, then re-file</span>'
      : '';
  return `<div class="denial">
    <div class="denial-head">
      <span class="pill ${cls}">${label}</span>
      <b>${money(d.amount)}</b>
      <span class="acct">inv ${esc(d.invoice)} · [${esc(d.code)}] · dispute ${esc(d.disputeNbr || '—')}</span>
      ${d.refileCount ? `<span class="acct small">re-filed ${d.refileCount}×</span>` : ''}
    </div>
    <div class="denial-line"><span class="doclabel">Walmart's reason</span> <span>${cited}</span></div>
    <div class="denial-line"><span class="doclabel">Draft appeal</span> <span class="appeal-text">${esc(d.appeal)}</span></div>
    <div class="denial-foot">
      ${actionBtn}
      <button class="btn tiny ghost" data-copy="${esc(d.appeal)}">Copy appeal</button>
    </div>
  </div>`;
}

async function refileDenial(id) {
  try {
    await api(`/api/claims/${encodeURIComponent(id)}/refile`, { method: 'POST' });
    toast('Re-filed — moved back to Ready to file. Export it again to submit.');
    loadDenials();
  } catch (err) {
    toast(err.message, true);
  }
}

function setupApdpDropzone() {
  const dz = $('apdpDrop');
  const input = $('apdpFile');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag');
    if (e.dataTransfer.files[0]) analyzeApdp(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) analyzeApdp(input.files[0]); });
}

async function analyzeApdp(file) {
  $('apdpPreview').innerHTML = `<p class="hint">Reading ${esc(file.name)}…</p>`;
  hide('apdpActions');
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch('/api/apdp/analyze', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not read that file.');
    renderApdpPreview(data);
  } catch (err) {
    $('apdpPreview').innerHTML = `<p class="bad">${esc(err.message)}</p>`;
    toast(err.message, true);
  }
}

function renderApdpPreview(p) {
  const s = p.summary;
  const tiles =
    tile('Dispute lines', p.rowCount) +
    tile('Matched', s.matchedRows, s.matchedRows ? 'good' : '') +
    tile('To record', s.willWrite, s.willWrite ? 'good' : '') +
    tile('Unchanged', s.noops) +
    tile('Needs review', s.unmatchedRows, s.unmatchedRows ? 'bad' : '');

  const statusRows = Object.entries(p.statusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([st, n]) => `<tr><td>${esc(st)}</td><td class="num">${n}</td></tr>`)
    .join('');

  const warn = (p.warnings || []).length
    ? `<div class="note">${p.warnings.map((w) => esc(w)).join('<br>')}</div>`
    : '';

  // Matched rows carry the money and are what actually gets written — show them
  // all. Unmatched is routinely thousands of rows (STAT's filings against
  // invoices we never claimed), so it's summarized by reason and capped.
  const matchedRows = p.matched
    .map((m) => {
      const cls = APDP_BUCKET_CLASS[m.bucket] || '';
      const change =
        m.change === 'noop'
          ? '<span class="acct small">no change</span>'
          : m.prevStatus
          ? `<span class="acct small">${esc(m.prevStatus)} →</span> <b class="${cls}">${esc(m.status)}</b>`
          : `<b class="${cls}">${esc(m.status)}</b>`;
      const flag = m.poMismatch ? ' <span class="pill bad" title="PO differs from our claim">PO≠</span>' : '';
      return `<tr>
        <td>${esc(m.claimId)}${flag}</td>
        <td>${esc(m.invoice)}</td>
        <td>${esc(m.code)}</td>
        <td class="num">${money(m.amount)}</td>
        <td>${change}</td>
        <td class="acct small">${esc(m.disputeNbr)}</td>
      </tr>`;
    })
    .join('');

  const byReason = {};
  for (const u of p.unmatched) {
    const key = u.reason.replace(/invoice \d+/, 'invoice …').replace(/\(ours: [^)]*\)/, '').replace(/\d+ claims? \([^)]*\)/, 'multiple claims');
    byReason[key] = (byReason[key] || 0) + 1;
  }
  const reasonRows = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([r, n]) => `<tr><td>${esc(r)}</td><td class="num">${n}</td></tr>`)
    .join('');

  $('apdpPreview').innerHTML = `
    <div class="tiles">${tiles}</div>
    ${warn}
    <h3>Walmart's ruling in this file</h3>
    <table><thead><tr><th>Status</th><th class="num">Lines</th></tr></thead><tbody>${statusRows}</tbody></table>
    <h3>Matched to your claims${s.matchedRows ? ` (${s.matchedRows})` : ''}</h3>
    ${
      s.matchedRows
        ? `<table><thead><tr><th>Claim</th><th>Invoice</th><th>Code</th><th class="num">Amount</th><th>Status</th><th>Dispute #</th></tr></thead><tbody>${matchedRows}</tbody></table>`
        : '<p class="hint">No dispute line in this file matches a claim on record. Nothing will be written.</p>'
    }
    <h3>Not matched (${s.unmatchedRows}) — no changes will be made to these</h3>
    <p class="hint">These are dispute lines with no corresponding claim here — largely filings made against
      invoices you haven't recorded a deduction for. They're listed by reason, not individually.</p>
    <table><thead><tr><th>Reason</th><th class="num">Lines</th></tr></thead><tbody>${reasonRows}</tbody></table>
  `;

  show('apdpActions');
  $('apdpConfirmBtn').disabled = s.willWrite === 0;
  $('apdpHint').textContent = s.willWrite
    ? `${s.willWrite} status ${s.willWrite === 1 ? 'entry' : 'entries'} across ${s.claimsAffected} claim(s). Nothing is written until you confirm.`
    : 'Nothing new to record from this file.';
}

async function confirmApdpImport() {
  $('apdpConfirmBtn').disabled = true;
  try {
    const res = await api('/api/apdp/import', { method: 'POST' });
    toast(`Recorded ${res.appended} status ${res.appended === 1 ? 'entry' : 'entries'}.`);
    $('apdpPreview').innerHTML = `<div class="note">Recorded <b>${res.appended}</b> status
      ${res.appended === 1 ? 'entry' : 'entries'}${res.skipped ? `, skipped ${res.skipped} unchanged` : ''}.
      Walmart's identifiers were saved on ${res.idsRecorded} claim(s) for faster matching next time.${
        res.identifiersBackfilled ? ` Filled in a real PO/DC on <b>${res.identifiersBackfilled}</b> claim(s) that were missing one.` : ''
      }</div>`;
    hide('apdpActions');
  } catch (err) {
    toast(err.message, true);
    $('apdpConfirmBtn').disabled = false;
  }
}

// --- history ---------------------------------------------------------------

function setNav(view) {
  $('navImport').classList.toggle('active', view === 'import');
  $('navDisputes').classList.toggle('active', view === 'disputes');
  $('navHistory').classList.toggle('active', view === 'history');
  $('navSettings').classList.toggle('active', view === 'settings');
}

// POD / No-Merchandise (0025) claims are document disputes filed in Retail Link,
// never re-invoiced — kept out of the Recovery Submission / EDI 810 rebill path.
function isPodClaim(code) {
  return String(code == null ? '' : code).replace(/\D/g, '').replace(/^0+/, '') === '25';
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
      const id = esc(c.id);
      const idEnc = encodeURIComponent(c.id);
      const isPod = isPodClaim(c.code);
      const pod = c.docs && c.docs.pod;
      const podControls = pod && pod.have
        ? `<a href="/api/claims/${idEnc}/doc/pod" target="_blank" rel="noopener">${pod.kind === 'link' ? 'view link' : esc(pod.filename || 'file')}</a>
           <button class="linkbtn" data-act="remove-pod" data-id="${id}">remove</button>`
        : `<button class="btn tiny" data-act="upload-pod" data-id="${id}">Upload</button>
           <button class="btn tiny ghost" data-act="linkform-pod" data-id="${id}">Link</button>
           <input type="file" class="pod-file" data-id="${id}" hidden accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff">`;
      const podNote = isPod
        ? `<div class="docline"><span class="pill" title="POD / No Merchandise Received — won with a proof of delivery filed in Retail Link, not an EDI 810 re-invoice. Attach the POD, file in Retail Link, then set status to Filed.">POD → file in Retail Link</span></div>`
        : '';
      const docsCell = done
        ? '<span class="acct">—</span>'
        : `<div class="docs">
             <span class="pill ${ds.complete ? 'ok' : 'warn'}">${ds.complete ? 'Docs ready' : 'Needs BOL'}</span>${podNote}
             <div class="docline"><span class="doclabel">BOL</span> ${podControls}</div>
             <div class="docline podlink hidden"><input type="url" class="pod-linkinput" placeholder="paste BOL/POD link"><button class="btn tiny" data-act="save-podlink" data-id="${id}">Save</button></div>
             <div class="docline"><span class="doclabel">Invoice</span> <a href="/api/claims/${idEnc}/invoice-pdf" target="_blank" rel="noopener">from QuickBooks</a></div>
             <div class="docline"><span class="doclabel">Items</span> ${
               c.items && c.items.length
                 ? `<span class="pill ok">${c.items.length} SKU${c.items.length > 1 ? 's' : ''}</span> <button class="linkbtn" data-act="edit-items" data-id="${id}">edit</button>`
                 : `<button class="btn tiny" data-act="set-items" data-id="${id}">Set shorted SKU</button>`
             }</div>
           </div>`;
      return `<tr class="${done ? 'muted' : ''}">
        <td><input type="checkbox" class="clsel" data-id="${esc(c.id)}" ${c.status === 'ready' && ds.complete && !isPod ? 'checked' : ''}></td>
        <td>${esc(c.invoice)}</td>
        <td class="acct">${esc(c.po || '—')}</td>
        <td class="acct">${esc(c.salesRep || '—')}</td>
        <td>[${esc(c.code)}]</td>
        <td class="num neg">${amountCell}</td>
        <td class="acct">${esc(c.shipDate || '—')}</td>
        <td>${docsCell}</td>
        <td><select class="clstatus" data-id="${esc(c.id)}">${opts}</select></td>
        <td>${walmartStatusCell(c.walmartStatus)}</td>
        <td class="acct">${esc(c.newInvoice || '—')}</td>
      </tr>`;
    }).join('');
    body.innerHTML =
      `<div class="tbl-wrap"><table>
        <thead><tr><th></th><th>Invoice</th><th>PO</th><th>Rep</th><th>Code</th><th class="num">Amount</th><th>Ship date</th><th>Docs</th><th>Status</th><th title="Walmart's own ruling, from the APDP import">Walmart</th><th>New Inv #</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    body.querySelectorAll('.clstatus').forEach((sel) =>
      sel.addEventListener('change', async (e) => {
        try { await api(`/api/claims/${encodeURIComponent(e.target.dataset.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: e.target.value }) }); loadClaims(); }
        catch (err) { toast(err.message, true); }
      })
    );
    body.querySelectorAll('[data-act]').forEach((el) =>
      el.addEventListener('click', () => onDocAction(el.dataset.act, el.dataset.id, el)));
    body.querySelectorAll('.pod-file').forEach((inp) =>
      inp.addEventListener('change', (e) => uploadPod(inp.dataset.id, e.target.files[0])));
  } catch (err) {
    body.innerHTML = `<div class="banner warn">${esc(err.message)}</div>`;
  }
}

async function exportClaims() {
  const ids = Array.from(document.querySelectorAll('.clsel')).filter((c) => c.checked).map((c) => c.dataset.id);
  try {
    const res = await fetch('/api/claims/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids.length ? { ids } : {}) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Export failed'); }
    // Claims held back: missing documents, or a zero/blank PO or DC.
    let skipped = [];
    let badId = [];
    let pod = [];
    try { skipped = JSON.parse(res.headers.get('X-Skipped-Missing-Docs') || '[]'); } catch (_) { /* none */ }
    try { badId = JSON.parse(res.headers.get('X-Skipped-Bad-Identifiers') || '[]'); } catch (_) { /* none */ }
    try { pod = JSON.parse(res.headers.get('X-Skipped-Pod') || '[]'); } catch (_) { /* none */ }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Recovery_Submission.xlsx'; a.click();
    URL.revokeObjectURL(url);
    const notes = [];
    if (skipped.length) notes.push(`${skipped.length} missing docs (inv ${skipped.map((s) => s.invoice).join(', ')})`);
    if (badId.length) notes.push(`${badId.length} zero PO/DC (inv ${badId.map((s) => s.invoice).join(', ')})`);
    if (pod.length) notes.push(`${pod.length} POD/0025 → file in Retail Link (inv ${pod.map((s) => s.invoice).join(', ')})`);
    if (notes.length) {
      toast(`Filed the submittable claims. Held back ${notes.join('; ')}.`, true);
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

    const edi = config.edi || {};
    const ediWarn = !edi.senderId
      ? `<div class="banner warn">EDI Sender ID isn't set — the EDI 810 can't be generated until you enter your
         TrueCommerce interchange ID below.</div>`
      : edi.usage === 'P'
      ? `<div class="banner warn"><b>Production mode.</b> Generated 810s transmit as real invoices to Walmart's AP.
         Send a <b>Test</b> file and confirm TrueCommerce/Walmart accept it before switching to Production.</div>`
      : '';
    const ediFields = [
      ['senderId', 'EDI Sender ID', 'Your EDI interchange (ISA) sender ID — the ID your account transmits under (for Endless Fun, the 5074121162 you provided to STAT). Required to generate an 810.'],
      ['senderQual', 'Sender qualifier', 'The ISA qualifier for your sender ID (TrueCommerce tells you — commonly 12 or ZZ).'],
      ['receiverId', 'Walmart receiver ID', 'Walmart\'s interchange ID. Default 925485US00.'],
      ['receiverQual', 'Receiver qualifier', 'Qualifier for the receiver ID. Default 08 for Walmart.'],
    ];
    const ediRows = `
      <h3 class="set-h">EDI 810 submission</h3>
      ${ediWarn}
      ${ediFields.map(([key, label, hint]) => `
      <div class="set-row">
        <label for="set-edi-${key}">${label}</label>
        <div>
          <input type="text" id="set-edi-${key}" data-edikey="${key}" value="${esc(edi[key] || '')}" />
          <span class="set-hint">${esc(hint)}</span>
        </div>
      </div>`).join('')}
      <div class="set-row">
        <label for="set-edi-usage">Mode</label>
        <div>
          <select id="set-edi-usage" data-edikey="usage">
            <option value="T"${edi.usage !== 'P' ? ' selected' : ''}>Test</option>
            <option value="P"${edi.usage === 'P' ? ' selected' : ''}>Production</option>
          </select>
          <span class="set-hint">Test marks the interchange as a test file (ISA usage T). Switch to Production only
            after a test file has been accepted by TrueCommerce and Walmart.</span>
        </div>
      </div>`;

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
      </div>` + ediRows + `
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
  const edi = {};
  document.querySelectorAll('#settingsBody [data-edikey]').forEach((el) => {
    edi[el.dataset.edikey] = el.value.trim();
  });
  if (Object.keys(edi).length) payload.edi = edi;
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

// --- claim documents (proof of delivery) -----------------------------------

function onDocAction(act, id, el) {
  if (act === 'set-items' || act === 'edit-items') return openItemsEditor(id, el.closest('tr'));
  const docs = el.closest('.docs');
  if (act === 'upload-pod') {
    docs.querySelector('.pod-file').click();
  } else if (act === 'linkform-pod') {
    const row = docs.querySelector('.podlink');
    row.classList.remove('hidden');
    row.querySelector('.pod-linkinput').focus();
  } else if (act === 'save-podlink') {
    savePodLink(id, docs.querySelector('.pod-linkinput').value.trim());
  } else if (act === 'remove-pod') {
    removePod(id);
  }
}

async function uploadPod(id, file) {
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`/api/claims/${encodeURIComponent(id)}/doc/pod`, { method: 'POST', body: fd });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Upload failed'); }
    toast('Proof of delivery uploaded.');
    loadClaims();
  } catch (err) { toast(err.message, true); }
}

async function savePodLink(id, ref) {
  if (!ref) return toast('Paste a link first.', true);
  try {
    await api(`/api/claims/${encodeURIComponent(id)}/doc/pod-link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref }) });
    toast('Linked the proof of delivery.');
    loadClaims();
  } catch (err) { toast(err.message, true); }
}

async function removePod(id) {
  try {
    const res = await fetch(`/api/claims/${encodeURIComponent(id)}/doc/pod`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Remove failed'); }
    loadClaims();
  } catch (err) { toast(err.message, true); }
}

// --- shorted-SKU editor (precise EDI 810 line items) -----------------------

const normKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function candidateRow(c, qty) {
  return `<div class="ited-row">
    <input type="number" class="it-qty" min="0" step="1" value="${qty || 0}" data-price="${c.unitPrice}" data-desc="${esc(c.description)}" data-num="${esc(c.itemNumber || '')}">
    <span>${esc(c.description)}</span>
    <span class="num">${money(c.unitPrice)}</span>
    <span>${c.itemNumber ? esc(c.itemNumber) : '<input type="text" class="it-num" placeholder="item #">'}</span>
  </div>`;
}
function manualItemRow() {
  return `<div class="ited-row">
    <input type="number" class="it-qty" min="0" step="1" value="0">
    <input type="text" class="it-desc" placeholder="other SKU">
    <input type="number" class="it-price" step="0.01" placeholder="0.00">
    <input type="text" class="it-num" placeholder="item #">
  </div>`;
}
function collectItems(editor) {
  const items = [];
  editor.querySelectorAll('.ited-row').forEach((tr) => {
    const qtyEl = tr.querySelector('.it-qty');
    if (!qtyEl) return;
    const qty = Number(qtyEl.value) || 0;
    if (qty <= 0) return;
    const descEl = tr.querySelector('.it-desc');
    const priceEl = tr.querySelector('.it-price');
    const numEl = tr.querySelector('.it-num');
    const description = descEl ? descEl.value.trim() : qtyEl.dataset.desc;
    const unitPrice = priceEl ? Number(priceEl.value) || 0 : Number(qtyEl.dataset.price) || 0;
    const itemNumber = numEl ? numEl.value.trim() : qtyEl.dataset.num || '';
    if (description && unitPrice > 0) items.push({ description, quantity: qty, unitPrice, itemNumber });
  });
  return items;
}
function updateItemsTotal(editor, amount) {
  const total = Math.round(collectItems(editor).reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100;
  const ties = Math.abs(total - amount) < 0.005;
  editor.querySelector('.itemsed-total').innerHTML =
    `Total: <b class="${ties ? 'tie-ok' : 'tie-off'}">${money(total)}</b> / ${money(amount)}${ties ? ' ✓' : ''}`;
  editor.querySelector('[data-act="save-items"]').disabled = !ties;
}
async function openItemsEditor(id, rowEl) {
  const next = rowEl.nextElementSibling;
  if (next && next.classList.contains('itemseditor')) return next.remove(); // toggle
  let data;
  try { data = await api(`/api/claims/${encodeURIComponent(id)}/candidates`); }
  catch (err) { return toast(err.message, true); }
  const amount = data.amount;
  const prefill = {};
  (data.items || []).forEach((it) => { prefill[normKey(it.description)] = it.quantity; });
  const rows = (data.candidates || []).map((c) => candidateRow(c, prefill[normKey(c.description)] || 0)).join('');
  const note = data.connected
    ? "Tick the quantity shorted for each SKU. They must total exactly what Walmart deducted."
    : "Connect QuickBooks to load this invoice's SKUs, or enter the shorted item manually.";
  // insertAdjacentHTML (not tr.innerHTML) so the nested table parses in proper
  // table context — setting innerHTML on a bare <tr> mangles it.
  rowEl.insertAdjacentHTML('afterend', `<tr class="itemseditor"><td colspan="9"><div class="itemsed">
    <div class="itemsed-head">${note} Target: <b>${money(amount)}</b>.</div>
    <div class="ited-head"><span>Shorted qty</span><span>SKU</span><span class="num">Unit</span><span>Walmart item #</span></div>
    ${rows}${manualItemRow()}
    <div class="itemsed-foot"><span class="itemsed-total"></span>
      <button class="btn tiny" data-act="save-items" disabled>Save</button>
      <button class="btn tiny ghost" data-act="cancel-items">Cancel</button></div>
  </div></td></tr>`);
  const tr = rowEl.nextElementSibling;
  const editor = tr.querySelector('.itemsed');
  editor.addEventListener('input', () => updateItemsTotal(editor, amount));
  editor.querySelector('[data-act="save-items"]').addEventListener('click', async () => {
    try {
      await api(`/api/claims/${encodeURIComponent(id)}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: collectItems(editor) }) });
      toast('Shorted SKUs saved — this claim will re-invoice precisely.');
      loadClaims();
    } catch (err) { toast(err.message, true); }
  });
  editor.querySelector('[data-act="cancel-items"]').addEventListener('click', () => tr.remove());
  updateItemsTotal(editor, amount);
}

async function generateEdi810() {
  const ids = Array.from(document.querySelectorAll('.clsel')).filter((c) => c.checked).map((c) => c.dataset.id);
  try {
    const res = await fetch('/api/claims/edi810', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids.length ? { ids } : {}) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'EDI generation failed'); }
    let warnings = [];
    try { const h = res.headers.get('X-Edi-Warnings'); if (h) warnings = JSON.parse(decodeURIComponent(h)); } catch (_) { /* none */ }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'Walmart_810.edi'; a.click();
    URL.revokeObjectURL(url);
    if (warnings.length) {
      toast(`EDI 810 generated — but ${warnings.length} claim(s) need the SKU confirmed before sending. Check the file.`, true);
    } else {
      toast('EDI 810 generated. Send it through your EDI provider (TrueCommerce).');
    }
  } catch (err) {
    toast(err.message, true);
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
        <td class="acct">${p.datePaid ? esc(fmtDate(p.datePaid)) : '—'}</td>
        <td class="muted">${esc(fmtDate(p.postedAt))}</td>
        <td class="num">${money(p.net)}</td>
        <td class="acct">${ids || '—'}</td>
      </tr>`;
    }).join('');
    body.innerHTML =
      `<div class="tbl-wrap"><table>
        <thead><tr><th>Check #</th><th>Check date</th><th>Posted</th><th class="num">Deposit</th><th>In QuickBooks</th></tr></thead>
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
$('edi810Btn').addEventListener('click', generateEdi810);
$('apdpImportBtn').addEventListener('click', showApdpImport);
$('apdpConfirmBtn').addEventListener('click', confirmApdpImport);
$('apdpCancelBtn').addEventListener('click', showDisputes);
$('denialsBtn').addEventListener('click', showDenials);
$('denialsBackBtn').addEventListener('click', showDisputes);
$('connectBtn').addEventListener('click', () => (window.location.href = '/auth/connect'));
$('disconnectBtn').addEventListener('click', async () => { await api('/api/disconnect', { method: 'POST' }); refreshStatus(); });
$('dryRunBtn').addEventListener('click', () => doPost(true));
$('backfillBtn').addEventListener('click', doBackfill);
// Two-click confirm instead of a native confirm() dialog — browsers silently
// suppress repeated native dialogs, which made the button appear to do nothing.
let postArmTimer = null;
function disarmPost() {
  clearTimeout(postArmTimer);
  postArmTimer = null;
  $('postBtn').classList.remove('confirming');
  $('postBtn').textContent = 'Post to QuickBooks';
}
$('postBtn').addEventListener('click', () => {
  if (postArmTimer) {
    disarmPost();
    doPost(false);
    return;
  }
  $('postBtn').classList.add('confirming');
  $('postBtn').textContent = 'Click again to confirm';
  postArmTimer = setTimeout(disarmPost, 5000);
});
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
setupApdpDropzone();
refreshStatus().catch((e) => toast(e.message, true));
