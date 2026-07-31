'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const { config, configProblems } = require('./config');
const qbo = require('./quickbooks');
const store = require('./store');
const { parseRemittance } = require('./walmartFile');
const { allocateCheck } = require('./allocator');
const denials = require('./denials');
const { postPlan } = require('./qboPost');
const edi810 = require('./edi810');
const apdp = require('./apdpImport');
const { seedSandbox } = require('./seedSandbox');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// When hosted behind a TLS-terminating proxy (Render, etc.), trust it so
// secure cookies work and req.protocol is correct.
const secureCookies = process.env.SECURE_COOKIES === 'true' || !!process.env.RENDER;
if (secureCookies) app.set('trust proxy', 1);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: secureCookies },
  })
);

// --- Password gate (only active when APP_PASSWORD is set, i.e. when hosted) --
const APP_PASSWORD = process.env.APP_PASSWORD || '';

function loginPage(message) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — WalmartCheck</title>
  <style>
    :root{color-scheme:light dark}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f7;
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;color:#1d1d1f}
    @media(prefers-color-scheme:dark){body{background:#000;color:#f5f5f7}}
    .card{background:#fff;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,.1);padding:34px;width:min(360px,92vw);text-align:center}
    @media(prefers-color-scheme:dark){.card{background:#1c1c1e}}
    .mark{width:44px;height:44px;border-radius:11px;background:linear-gradient(180deg,#2ca01c,#1f8817);
      display:grid;place-items:center;color:#fff;font-weight:600;font-size:24px;margin:0 auto 16px}
    h1{font-size:20px;font-weight:600;letter-spacing:-.02em;margin:0 0 4px}
    p{color:#6e6e73;font-size:14px;margin:0 0 22px}
    input{width:100%;box-sizing:border-box;padding:11px 13px;font-size:15px;border-radius:11px;
      border:1px solid rgba(0,0,0,.15);background:transparent;color:inherit;margin-bottom:12px}
    @media(prefers-color-scheme:dark){input{border-color:rgba(255,255,255,.2)}}
    button{width:100%;padding:11px;font-size:15px;font-weight:500;border:none;border-radius:11px;background:#0071e3;color:#fff;cursor:pointer}
    .err{color:#d70015;font-size:13px;margin-bottom:12px}
  </style>
  <form class="card" method="post" action="/login">
    <div class="mark">✓</div>
    <h1>WalmartCheck</h1>
    <p>Enter the team password to continue.</p>
    ${message ? `<div class="err">${message}</div>` : ''}
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>`;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/login', (req, res) => {
  if (!APP_PASSWORD || (req.session && req.session.authed)) return res.redirect('/');
  res.send(loginPage(''));
});
app.post('/login', (req, res) => {
  if (!APP_PASSWORD) return res.redirect('/');
  const supplied = (req.body && req.body.password) || '';
  // constant-time compare to avoid leaking the password length/content via timing
  const ok =
    supplied.length === APP_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(APP_PASSWORD));
  if (ok) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.status(401).send(loginPage('Incorrect password. Try again.'));
});
app.post('/logout', (req, res) => {
  if (req.session) req.session.authed = false;
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (!APP_PASSWORD) return next(); // no password configured (local use) -> open
  if (req.session && req.session.authed) return next();
  if (req.path === '/login' || req.path === '/health') return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not signed in. Reload the page and enter the team password.' });
  }
  if (req.method === 'GET') return res.redirect('/login');
  return res.status(401).json({ error: 'Not signed in.' });
});

app.use(express.static(path.join(__dirname, '..', 'public')));

function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      // Persist for troubleshooting (includes Intuit's tid when present).
      store.logError({
        path: req.path,
        message: err.message,
        code: err.code,
        status: err.status,
        intuit_tid: err.intuit_tid,
        stack: err.stack,
      });
      res
        .status(err.status && err.status < 600 ? err.status : 500)
        .json({ error: err.message || 'Unexpected error', code: err.code, detail: err.body });
    });
  };
}

/**
 * Build the injected QuickBooks dependencies postPlan needs. Requires a live
 * connection.
 */
async function buildPostDeps() {
  const accountsCfg = store.getAccounts();
  const accountIdFor = await qbo.buildAccountResolver(accountsCfg.accountNumbers || {});
  // Cache invoices so a check with many lines doesn't hit QuickBooks once per
  // invoice (25+ sequential round-trips would time the request out). prefetch
  // loads them all in one batched query; findInvoiceId reads the cache.
  const invoiceCache = new Map();
  const toResult = (i) =>
    i
      ? {
          id: i.Id,
          customerId: i.CustomerRef && i.CustomerRef.value,
          customerName: i.CustomerRef && i.CustomerRef.name,
          balance: i.Balance,
        }
      : null;
  return {
    accountsCfg,
    deps: {
      findCustomerId: (name) => qbo.findCustomerByName(name).then((c) => (c ? c.Id : null)),
      ensureCustomerId: (name) => qbo.ensureCustomer(name).then((c) => (c ? c.Id : null)),
      prefetchInvoices: async (docNumbers) => {
        const map = await qbo.findInvoicesByDocNumbers(docNumbers);
        for (const [doc, inv] of map) invoiceCache.set(doc, inv);
      },
      findInvoiceId: async (doc) => {
        const key = String(doc);
        if (invoiceCache.has(key)) return toResult(invoiceCache.get(key));
        return toResult(await qbo.findInvoiceByDocNumber(doc));
      },
      accountIdFor,
      ensureWriteOffItemId: () => qbo.ensureWriteOffItem(accountIdFor(accountsCfg.paymentWriteOff)),
      createCreditMemo: qbo.createCreditMemo,
      createPayment: qbo.createPayment,
      deletePayment: qbo.deletePayment,
      createDeposit: qbo.createDeposit,
    },
  };
}

function buildPlanFromSession(req) {
  const rem = req.session.remittance;
  if (!rem) {
    const e = new Error('No remittance in this session. Please upload the Walmart file again.');
    e.status = 400;
    throw e;
  }
  const decoder = store.getDecoder();
  const accounts = store.getAccounts();
  // Pass the rebill index so a recovered dispute coming back under its rebill
  // "New Inv #" is recognized as a repayment, not a payment on a phantom invoice.
  return allocateCheck(rem.rows, decoder, accounts, { checkNumber: rem.checkNumber, datePaid: rem.datePaid }, store.getRebillIndex());
}

function recordClaimsForCheck(plan, postedAt) {
  const checkNumber = plan.meta.checkNumber;
  const entries = (plan.disputes || []).map((d) => ({
    checkNumber,
    postedAt,
    datePaid: plan.meta.datePaid,
    invoice: String(d.invoice),
    code: d.code,
    description: d.description,
    amount: d.amount,
    po: d.po || '',
    whse: d.whse || '',
    shipDate: d.shipDate || '',
  }));
  if (entries.length) store.addClaims(entries);
  if (plan.repayments && plan.repayments.length) {
    store.matchRepayments(plan.repayments, checkNumber);
  }
}

// --- Status & auth ---------------------------------------------------------

app.get(
  '/api/status',
  wrap(async (req, res) => {
    const connected = qbo.isConnected();
    let company = null;
    if (connected) {
      try {
        const info = await qbo.getCompanyInfo();
        company = { name: info.CompanyName, id: info.Id };
      } catch (err) {
        company = { error: err.message };
      }
    }
    res.json({
      connected,
      company,
      environment: config.qbo.environment,
      configProblems: configProblems(),
      accounts: store.getAccounts(),
      decoderCount: Object.keys(store.getDecoder()).length,
      authRequired: Boolean(APP_PASSWORD),
    });
  })
);

app.get('/auth/connect', (req, res) => {
  if (configProblems().length) return res.status(400).send('QuickBooks app not configured. See README.');
  // CSRF protection: a random state tied to this session, validated on callback.
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(qbo.getAuthorizeUrl(state));
});

app.get('/auth/callback', wrap(async (req, res) => {
  const returnedState = req.query.state;
  if (!returnedState || returnedState !== req.session.oauthState) {
    throw badRequest('Sign-in failed a security check (state mismatch). Please click Connect and try again.');
  }
  delete req.session.oauthState;
  await qbo.handleCallback(req.originalUrl);
  res.redirect('/?connected=1');
}));

app.post('/api/disconnect', wrap(async (req, res) => {
  qbo.disconnect();
  res.json({ ok: true });
}));

// --- Config: accounts + decoder -------------------------------------------

app.get('/api/accounts', wrap(async (req, res) => {
  res.json({ accounts: await qbo.listAccounts() });
}));

app.get('/api/config', wrap(async (req, res) => {
  res.json({ accounts: store.getAccounts(), decoder: store.getDecoder() });
}));

app.post('/api/config/accounts', wrap(async (req, res) => {
  store.saveAccounts({ ...store.getAccounts(), ...req.body });
  res.json({ ok: true, accounts: store.getAccounts() });
}));

app.post('/api/config/decoder', wrap(async (req, res) => {
  const { code, entry } = req.body || {};
  if (!code || !entry || !entry.category) throw badRequest('code and entry.category are required');
  res.json({ ok: true, decoder: store.upsertCode(code, entry) });
}));

// Seed a SANDBOX company with the accounts/customer/invoices needed to test a
// real post. Refuses to run against production.
app.post(
  '/api/setup-sandbox',
  wrap(async (req, res) => {
    if (!qbo.isConnected()) throw badRequest('Not connected to QuickBooks.');
    if (config.qbo.environment !== 'sandbox') {
      throw badRequest('Refusing to seed test data: this is not a sandbox company.');
    }
    const report = await seedSandbox(qbo, {});
    res.json({ ok: true, report });
  })
);

// History of checks posted from this machine (newest first).
app.get(
  '/api/history',
  wrap(async (req, res) => {
    const ledger = store.getLedger();
    res.json({ posted: (ledger.posted || []).slice().reverse() });
  })
);

// --- Walmart submission settings ------------------------------------------

app.get(
  '/api/walmart-config',
  wrap(async (req, res) => {
    res.json({
      config: store.getWalmartConfig(),
      minSafe: store.minSafeNewInvoice(),
      statHighWater: store.STAT_HIGH_WATER,
      recommended: store.DEFAULT_NEXT_NEW_INVOICE,
    });
  })
);

app.post(
  '/api/walmart-config',
  wrap(async (req, res) => {
    const cfg = store.getWalmartConfig();
    const body = req.body || {};
    const next = { ...cfg };

    for (const field of ['vendorNumber', 'dept', 'seq']) {
      if (body[field] === undefined) continue;
      const val = String(body[field]).trim();
      if (!val) throw badRequest(`${field} can't be blank.`);
      next[field] = val;
    }

    if (body.nextNewInvoice !== undefined) {
      const n = Number(body.nextNewInvoice);
      if (!Number.isInteger(n)) throw badRequest('Next New Inv # must be a whole number.');
      // Hard stop: below this we'd reissue a number Walmart has already seen,
      // either from STAT's block or from one of our own past exports.
      const floor = store.minSafeNewInvoice();
      if (n < floor) {
        throw badRequest(
          `Next New Inv # must be at least ${floor}. Anything lower would reuse an invoice number ` +
            `already submitted to Walmart (STAT filed through ${store.STAT_HIGH_WATER}), which gets the claim rejected.`
        );
      }
      next.nextNewInvoice = n;
    }

    store.saveWalmartConfig(next);
    res.json({ ok: true, config: next, minSafe: store.minSafeNewInvoice() });
  })
);

// --- Disputes / claims -----------------------------------------------------

function summarizeClaims(claims) {
  const by = (s) => claims.filter((c) => c.status === s);
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const open = claims.filter((c) => !['recovered', 'denied', 'writeoff'].includes(c.status));
  // Open dollars = what's still outstanding, net of any partial recovery.
  const openAmount = round(
    open.reduce((a, c) => a + Math.max(0, (Number(c.amount) || 0) - (Number(c.recoveredAmount) || 0)), 0)
  );
  // Recovered dollars = cash actually returned, including partials. Fall back to
  // the claim amount for a fully-recovered claim that predates amount tracking.
  const recoveredAmount = round(
    claims.reduce(
      (a, c) => a + (Number(c.recoveredAmount) || (c.status === 'recovered' ? Number(c.amount) || 0 : 0)),
      0
    )
  );
  // Open claims still missing their proof documents — can't be filed yet.
  const needsDocsCount = open.filter((c) => !store.claimDocsStatus(c).complete).length;
  return {
    count: claims.length,
    openCount: open.length,
    openAmount,
    recoveredAmount,
    needsDocsCount,
    readyCount: by('ready').length,
    filedCount: by('filed').length,
    partialCount: by('partial').length,
  };
}

app.get(
  '/api/claims',
  wrap(async (req, res) => {
    const data = store.getClaims();

    // Fill in the sales rep from each claim's QuickBooks invoice, once, then
    // cache it on the claim (store '' when blank so we don't keep re-querying).
    const needRep = data.claims.filter((c) => c.salesRep === undefined && c.invoice);
    if (needRep.length && qbo.isConnected()) {
      try {
        const repMap = await qbo.findInvoiceSalesReps(needRep.map((c) => c.invoice));
        for (const c of needRep) c.salesRep = repMap.get(String(c.invoice)) || '';
        store.saveClaims(data);
      } catch (_) {
        /* best effort — the tab still works without the rep */
      }
    }

    const claims = data.claims.slice().reverse();
    // Walmart's own adjudication, derived from the APDP status history. Kept
    // separate from claim.status (our filing pipeline) — see store.js.
    const historyByClaim = store.statusHistoryByClaim();
    const withStatus = claims.map((c) => ({
      ...c,
      docsStatus: store.claimDocsStatus(c),
      walmartStatus: apdp.rollUp(historyByClaim.get(c.id) || []),
    }));
    res.json({ claims: withStatus, totals: summarizeClaims(claims) });
  })
);

// --- Walmart APDP dispute status import ------------------------------------
// Upload -> preview (nothing written) -> confirm -> append status history.
// Mirrors the check-import flow: /api/apdp/analyze stashes the parse in the
// session, /api/apdp/import commits it.

app.post(
  '/api/apdp/analyze',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('No file uploaded.');
    const parsed = apdp.parseApdp(req.file.buffer);
    if (!parsed.rows.length) throw badRequest('No dispute rows found in the file.');

    const batchId = `apdp-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const preview = apdp.buildPreview(
      parsed.rows,
      store.getClaims().claims,
      store.getStatusHistory().entries,
      { fileName: req.file.originalname || '', batchId }
    );

    req.session.apdp = { batchId, fileName: req.file.originalname || '', rows: parsed.rows };

    res.json({ ...preview, warnings: parsed.warnings });
  })
);

// Commit the previewed import. Re-runs the preview against current state so a
// stale session can't write decisions made against data that has since moved.
app.post(
  '/api/apdp/import',
  wrap(async (req, res) => {
    const stash = req.session.apdp;
    if (!stash) throw badRequest('No APDP file in this session. Please upload the export again.');

    const claims = store.getClaims().claims;
    const preview = apdp.buildPreview(stash.rows, claims, store.getStatusHistory().entries, {
      fileName: stash.fileName,
      batchId: stash.batchId,
    });

    const importedAt = new Date().toISOString();
    const entries = apdp.historyEntries(preview, stash.rows, stash.batchId, importedAt);
    const { appended, skipped } = store.appendStatusHistory(entries);

    // Remember Walmart's identifiers on the claims we matched, so the next
    // import can match by DisputeNbr directly.
    const idsRecorded = store.recordWalmartIds(
      preview.matched.map((m) => ({ claimId: m.claimId, disputeNbr: m.disputeNbr, caseNbr: m.caseNbr }))
    );

    store.recordImportBatch({
      batchId: stash.batchId,
      fileName: stash.fileName,
      importedAt,
      rowCount: stash.rows.length,
      matched: preview.summary.matchedRows,
      unmatched: preview.summary.unmatchedRows,
      appended,
      skipped,
    });

    delete req.session.apdp;
    res.json({ ok: true, batchId: stash.batchId, appended, skipped, idsRecorded, summary: preview.summary });
  })
);

app.get(
  '/api/apdp/batches',
  wrap(async (req, res) => {
    res.json(store.getImportBatches());
  })
);

// Export selected (or all open) claims as a Walmart Recovery Submission .xlsx.
// NOTE: must be declared before '/api/claims/:id' so "export" isn't read as an id.
app.post(
  '/api/claims/export',
  wrap(async (req, res) => {
    const ExcelJS = require('exceljs');
    const cfg = store.getWalmartConfig();
    const all = store.getClaims();
    const ids = req.body && Array.isArray(req.body.ids) ? new Set(req.body.ids) : null;
    const selected = all.claims.filter((c) =>
      ids ? ids.has(c.id) : !['recovered', 'denied', 'writeoff'].includes(c.status)
    );
    if (!selected.length) throw badRequest('No claims to export.');

    // Failsafe: a claim can't be filed without its proof documents, or Walmart
    // denies it. Split the selection — file the ones with complete docs, hold
    // back the rest and report exactly what each is missing.
    const ready = [];
    const blocked = [];
    for (const c of selected) {
      const st = store.claimDocsStatus(c);
      if (st.complete) ready.push(c);
      else blocked.push({ id: c.id, invoice: c.invoice, missing: st.missing });
    }
    if (!ready.length) {
      const list = blocked.map((b) => `inv ${b.invoice} (needs ${b.missing.join(' + ')})`).join('; ');
      throw badRequest(
        `Nothing filed — every selected claim is missing documents: ${list}. ` +
          `Mark the proof of delivery and invoice as in-hand on each claim, then export again.`
      );
    }

    // Assign a rebill (New Inv #) to the documented claims only — undocumented
    // ones stay unfiled and don't consume a rebill number.
    // Floor the counter at the safe minimum so a stale or hand-edited config
    // can never reissue a number already submitted to Walmart.
    let next = Math.max(Number(cfg.nextNewInvoice) || 0, store.minSafeNewInvoice());
    for (const c of ready) {
      if (!c.newInvoice) {
        c.newInvoice = String(next++);
        store.updateClaim(c.id, { newInvoice: c.newInvoice, status: c.status === 'ready' ? 'filed' : c.status });
      }
    }
    store.saveWalmartConfig({ ...cfg, nextNewInvoice: next });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('RecoverySubmission');
    ws.addRow(['PO Number', 'Vendor #', 'Dept', 'Seq', 'Whse', 'Ship Date', 'Orig Inv #', 'New Inv #', 'Amt To Submit']);
    for (const c of ready) {
      ws.addRow([c.po, cfg.vendorNumber, cfg.dept, cfg.seq, c.whse, c.shipDate, c.invoice, c.newInvoice, c.amount]);
    }
    // Tell the browser which claims were held back for missing documents.
    if (blocked.length) res.setHeader('X-Skipped-Missing-Docs', JSON.stringify(blocked));
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Recovery_Submission_${cfg.vendorNumber}.xlsx"`);
    res.send(Buffer.from(buf));
  })
);

// Generate the EDI 810 re-invoice — the actual submission artifact — for the
// documented, already-numbered claims. Must be declared before '/api/claims/:id'.
app.post(
  '/api/claims/edi810',
  wrap(async (req, res) => {
    const all = store.getClaims();
    const ids = req.body && Array.isArray(req.body.ids) ? new Set(req.body.ids) : null;
    const selected = all.claims.filter((c) =>
      ids ? ids.has(c.id) : !['recovered', 'denied', 'writeoff'].includes(c.status)
    );

    // Only submit documented claims (same failsafe as filing).
    const ready = selected.filter((c) => store.claimDocsStatus(c).complete);
    if (!ready.length) throw badRequest('No documented claims to submit. Add each claim\'s proof of delivery first.');

    // The 810 re-invoices under the rebill "New Inv #". A claim only has one
    // after the Recovery Submission export, so require that first.
    const unnumbered = ready.filter((c) => !c.newInvoice);
    if (unnumbered.length) {
      throw badRequest(
        `These claims need a rebill number first — run "Export Recovery Submission" to assign one: ` +
          unnumbered.map((c) => `inv ${c.invoice}`).join(', ') + '.'
      );
    }

    // Enrich each claim with its QBO invoice line items + location UPC (best
    // effort — the generator falls back to a summary line if QBO is offline).
    const today = new Date().toISOString().slice(0, 10);
    const items = [];
    for (const c of ready) {
      let invoiceLines = [];
      let locationUpc = '';
      let poDate = '';
      if (qbo.isConnected()) {
        try {
          const inv = await qbo.getInvoiceForEdi(c.invoice);
          if (inv) {
            invoiceLines = inv.lines;
            locationUpc = edi810.upcFromMemo(inv.privateNote);
            poDate = inv.txnDate;
          }
        } catch (_) {
          /* best effort — fall back to a summary line */
        }
      }
      items.push({ claim: c, invoiceLines, locationUpc, invoiceDate: today, poDate });
    }

    const cfg = store.getWalmartConfig();
    const control = String(Date.now()).slice(-9);
    const { edi, warnings } = edi810.buildEdi810(items, {
      control,
      now: new Date().toISOString(),
      itemMaster: store.getItemMaster(),
    });

    // URI-encode so any non-ASCII in a warning can't produce an invalid header.
    if (warnings.length) res.setHeader('X-Edi-Warnings', encodeURIComponent(JSON.stringify(warnings)));
    res.setHeader('Content-Type', 'application/edi-x12');
    res.setHeader('Content-Disposition', `attachment; filename="Walmart_810_${cfg.vendorNumber}.edi"`);
    res.send(edi);
  })
);

// --- Denial follow-up (stage 6) -------------------------------------------

function findClaimOr404(id) {
  const claim = store.getClaims().claims.find((c) => c.id === id);
  if (!claim) throw badRequest('Claim not found.');
  return claim;
}

// The follow-up worklist: our tracked claims Walmart denied, bucketed by why,
// with a drafted appeal and the suggested next step. Reads the APDP status
// history (Walmart's ruling) — never changes it.
app.get(
  '/api/denials',
  wrap(async (req, res) => {
    const claims = store.getClaims().claims;
    const historyByClaim = store.statusHistoryByClaim();
    res.json(denials.buildWorklist(claims, historyByClaim, apdp.rollUp));
  })
);

// Re-file a denied claim: once its proof of delivery is attached, send it back
// to "ready" so it flows through the export/EDI path again with a fresh rebill
// number. Walmart's recorded ruling (walmartStatus) is left untouched — this
// only moves OUR pipeline status, per the deliberate separation.
app.post(
  '/api/claims/:id/refile',
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    if (!store.claimDocsStatus(claim).complete) {
      throw badRequest('Attach the proof of delivery first — that is usually what a denied shortage needs.');
    }
    const updated = store.updateClaim(claim.id, {
      status: 'ready',
      refileCount: (claim.refileCount || 0) + 1,
      newInvoice: null, // gets a fresh rebill number on the next export
    });
    res.json({ ok: true, claim: { ...updated, docsStatus: store.claimDocsStatus(updated) } });
  })
);

// --- Claim documents (dispute proof) --------------------------------------

function round2(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

// The candidate SKUs for a claim's dispute — the real line items on its QBO
// invoice, each with its resolved Walmart item number — so the shorted item can
// be picked precisely rather than guessed.
app.get(
  '/api/claims/:id/candidates',
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    let lines = [];
    let connected = qbo.isConnected();
    if (connected) {
      try {
        const inv = await qbo.getInvoiceForEdi(claim.invoice);
        if (inv) lines = inv.lines;
      } catch (_) {
        /* best effort */
      }
    }
    const master = store.getItemMaster();
    const candidates = lines.map((l) => ({
      description: l.description,
      unitPrice: round2(l.unitPrice),
      invoiceQty: l.quantity,
      itemNumber: edi810.itemNumberFor(l.description, master),
    }));
    res.json({ amount: round2(claim.amount), items: claim.items || [], candidates, connected });
  })
);

// Set the precise shorted SKUs for a claim. They MUST sum to the exact deduction
// — a re-invoice that doesn't tie to what Walmart took isn't submittable. Any
// item numbers entered here are learned into the master for next time.
app.post(
  '/api/claims/:id/items',
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    const clean = (Array.isArray(req.body.items) ? req.body.items : [])
      .map((i) => ({
        description: String(i.description || '').trim(),
        quantity: Number(i.quantity) || 0,
        unitPrice: round2(i.unitPrice),
        itemNumber: String(i.itemNumber || '').trim(),
      }))
      .filter((i) => i.description && i.quantity > 0 && i.unitPrice > 0);
    if (!clean.length) throw badRequest('Add at least one shorted item with a quantity.');

    const total = round2(clean.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
    if (Math.abs(total - round2(claim.amount)) > 0.005) {
      throw badRequest(
        `The items add up to $${total.toFixed(2)}, but Walmart deducted $${round2(claim.amount).toFixed(2)}. ` +
          `They have to match exactly before this can be submitted.`
      );
    }

    for (const i of clean) {
      if (i.itemNumber) store.upsertItemMaster(i.description, { itemNumber: i.itemNumber, unitPrice: i.unitPrice });
    }
    const updated = store.updateClaim(claim.id, { items: clean });
    res.json({ ok: true, claim: { ...updated, docsStatus: store.claimDocsStatus(updated) } });
  })
);

// The invoice document, pulled live from QuickBooks (we posted against it, so it
// exists there). No upload needed — this is the "QBO invoice pull" half.
app.get(
  '/api/claims/:id/invoice-pdf',
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    if (!qbo.isConnected()) throw badRequest('Connect QuickBooks to pull the invoice PDF.');
    const inv = await qbo.findInvoiceByDocNumber(claim.invoice);
    if (!inv) throw badRequest(`Invoice ${claim.invoice} was not found in QuickBooks.`);
    const pdf = await qbo.getInvoicePdf(inv.Id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice_${claim.invoice}.pdf"`);
    res.send(pdf);
  })
);

// Upload a proof-of-delivery file (BOL/POD) for a claim.
app.post(
  '/api/claims/:id/doc/pod',
  upload.single('file'),
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    if (!req.file) throw badRequest('No file uploaded.');
    // Replace any previous file so we don't orphan it on disk.
    if (claim.docs && claim.docs.pod && claim.docs.pod.kind === 'file') {
      store.deleteClaimDoc(claim.id, claim.docs.pod.storedName);
    }
    const meta = store.saveClaimDoc(claim.id, 'pod', req.file);
    const updated = store.updateClaim(claim.id, { docs: { ...(claim.docs || {}), pod: meta } });
    res.json({ ok: true, claim: { ...updated, docsStatus: store.claimDocsStatus(updated) } });
  })
);

// Point a claim's proof of delivery at a link instead of an uploaded file (for
// PODs that live in the carrier portal or fulfillment system).
app.post(
  '/api/claims/:id/doc/pod-link',
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    const ref = String((req.body && req.body.ref) || '').trim();
    if (!/^https?:\/\//i.test(ref)) throw badRequest('Enter a full link starting with http:// or https://');
    if (claim.docs && claim.docs.pod && claim.docs.pod.kind === 'file') {
      store.deleteClaimDoc(claim.id, claim.docs.pod.storedName);
    }
    const updated = store.updateClaim(claim.id, {
      docs: { ...(claim.docs || {}), pod: { have: true, kind: 'link', ref, uploadedAt: new Date().toISOString() } },
    });
    res.json({ ok: true, claim: { ...updated, docsStatus: store.claimDocsStatus(updated) } });
  })
);

// View a claim's proof of delivery — streams the file, or redirects to the link.
app.get(
  '/api/claims/:id/doc/pod',
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    const pod = claim.docs && claim.docs.pod;
    if (!pod || !pod.have) throw badRequest('No proof of delivery on this claim yet.');
    if (pod.kind === 'link') return res.redirect(pod.ref);
    const buf = store.readClaimDoc(claim.id, pod.storedName);
    if (!buf) throw badRequest('The stored document is missing from disk.');
    res.setHeader('Content-Type', pod.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${String(pod.filename || 'bol').replace(/[^\w.\-]/g, '_')}"`);
    res.send(buf);
  })
);

// Remove a claim's proof of delivery.
app.delete(
  '/api/claims/:id/doc/pod',
  wrap(async (req, res) => {
    const claim = findClaimOr404(req.params.id);
    if (claim.docs && claim.docs.pod && claim.docs.pod.kind === 'file') {
      store.deleteClaimDoc(claim.id, claim.docs.pod.storedName);
    }
    const updated = store.updateClaim(claim.id, { docs: { ...(claim.docs || {}), pod: { have: false } } });
    res.json({ ok: true, claim: { ...updated, docsStatus: store.claimDocsStatus(updated) } });
  })
);

app.post(
  '/api/claims/:id',
  wrap(async (req, res) => {
    const allowed = ['ready', 'filed', 'research', 'partial', 'recovered', 'denied', 'writeoff'];
    const patch = {};
    if (req.body.status) {
      if (!allowed.includes(req.body.status)) throw badRequest('Unknown status.');
      patch.status = req.body.status;
    }
    if (typeof req.body.notes === 'string') patch.notes = req.body.notes;

    // Supporting-document updates merge into the claim's existing docs so
    // setting one (e.g. proof of delivery) doesn't clear the other (invoice).
    if (req.body.docs && typeof req.body.docs === 'object') {
      const current = store.getClaims().claims.find((c) => c.id === req.params.id);
      if (!current) throw badRequest('Claim not found.');
      const merged = { ...(current.docs || {}) };
      for (const key of Object.keys(req.body.docs)) {
        merged[key] = { ...(merged[key] || {}), ...(req.body.docs[key] || {}) };
      }
      patch.docs = merged;
    }

    const claim = store.updateClaim(req.params.id, patch);
    if (!claim) throw badRequest('Claim not found.');
    res.json({ ok: true, claim: { ...claim, docsStatus: store.claimDocsStatus(claim) } });
  })
);

// --- Analyze (upload -> plan -> dry-run review) ----------------------------

app.post(
  '/api/analyze',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('No file uploaded.');
    const parsed = await parseRemittance(req.file.buffer, req.file.originalname);
    if (!parsed.rows.length) throw badRequest('No invoice rows found in the file.');

    req.session.remittance = parsed; // stash for the post step

    const plan = buildPlanFromSession(req);

    // If connected, do a dry-run posting pass so the review shows invoice
    // matches, account resolution, and the exact payloads.
    let review = null;
    if (qbo.isConnected()) {
      try {
        const { deps } = await buildPostDeps();
        review = await postPlan(plan, deps, { dryRun: true, today: parsed.datePaid });
      } catch (err) {
        review = { error: err.message, code: err.code };
      }
    }

    res.json({
      checkNumber: parsed.checkNumber,
      datePaid: parsed.datePaid,
      alreadyPosted: store.isAlreadyPosted(parsed.checkNumber),
      plan,
      review,
    });
  })
);

// Re-run the analysis on the file already in the session (after classifying a
// new code) without re-uploading.
app.get(
  '/api/reanalyze',
  wrap(async (req, res) => {
    const rem = req.session.remittance;
    if (!rem) throw badRequest('No remittance in this session. Please upload again.');
    const plan = buildPlanFromSession(req);
    let review = null;
    if (qbo.isConnected()) {
      try {
        const { deps } = await buildPostDeps();
        review = await postPlan(plan, deps, { dryRun: true, today: rem.datePaid });
      } catch (err) {
        review = { error: err.message, code: err.code };
      }
    }
    res.json({
      checkNumber: rem.checkNumber,
      datePaid: rem.datePaid,
      alreadyPosted: store.isAlreadyPosted(rem.checkNumber),
      plan,
      review,
    });
  })
);

// --- Backfill --------------------------------------------------------------
//
// The Disputes tab only records going forward, from a real post. Checks posted
// before that module existed have their disputes sitting in Disputed AR with no
// claim tracking them for recovery. This re-reads the original remittance and
// records those claims from the same allocation the post used.
//
// It never calls QuickBooks — no deps are built, so it cannot post by
// construction. addClaims is idempotent by check/invoice/code, so running it
// twice is harmless.
app.post(
  '/api/backfill-claims',
  wrap(async (req, res) => {
    const plan = buildPlanFromSession(req);
    const checkNumber = plan.meta.checkNumber;

    // Only for checks already in QuickBooks. An unposted check should go
    // through the normal post, which records its claims automatically —
    // backfilling one would show disputes with nothing behind them. "Recorded"
    // means either the app's own ledger OR (for checks posted another way) its
    // invoices already showing paid in QuickBooks.
    let recorded = store.isAlreadyPosted(checkNumber);
    if (!recorded && qbo.isConnected()) {
      try {
        const { deps } = await buildPostDeps();
        const review = await postPlan(plan, deps, { dryRun: true, today: plan.meta.datePaid });
        recorded = Boolean(review.alreadyInQuickBooks);
      } catch (_) {
        /* fall back to the ledger check below */
      }
    }
    if (!recorded) {
      throw badRequest(
        `Check ${checkNumber} isn't recorded in QuickBooks yet, so there's nothing to backfill. ` +
          `Post it normally and its disputes are recorded automatically.`
      );
    }
    if (plan.unclassified.length) {
      throw badRequest('Classify the remaining deduction codes first so every dispute is recorded.');
    }

    const before = store.getClaims().claims.length;
    // Date the claims from the original post, not from now.
    const entry = (store.getLedger().posted || []).find((p) => p.reference === checkNumber);
    recordClaimsForCheck(plan, (entry && entry.postedAt) || new Date().toISOString());
    const added = store.getClaims().claims.length - before;

    res.json({ ok: true, checkNumber, added, disputes: (plan.disputes || []).length });
  })
);

// --- Post ------------------------------------------------------------------

app.post(
  '/api/post',
  wrap(async (req, res) => {
    if (!qbo.isConnected()) throw badRequest('Not connected to QuickBooks.');
    const dryRun = req.body && req.body.dryRun === true; // must explicitly opt into a real post
    const plan = buildPlanFromSession(req);

    if (!dryRun && store.isAlreadyPosted(plan.meta.checkNumber)) {
      throw badRequest(`Check ${plan.meta.checkNumber} was already posted.`);
    }

    const { deps } = await buildPostDeps();
    const report = await postPlan(plan, deps, { dryRun, today: plan.meta.datePaid });

    if (!dryRun) {
      const postedAt = new Date().toISOString();
      store.recordPosted({
        reference: plan.meta.checkNumber,
        datePaid: plan.meta.datePaid,
        net: report.depositTotal,
        postedAt,
        steps: report.steps,
      });
      // Record each dispute as a claim, and mark any repaid claims recovered.
      // Wrapped so a claims hiccup can never fail an already-successful post.
      try {
        recordClaimsForCheck(plan, postedAt);
      } catch (err) {
        console.error('claims recording failed (post still succeeded):', err);
      }
    }
    res.json(report);
  })
);

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

if (require.main === module) {
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`WalmartCheck → QBO running at http://localhost:${config.port}`);
    const problems = configProblems();
    if (problems.length) {
      // eslint-disable-next-line no-console
      console.log('  ⚠ QuickBooks not configured:', problems.join(', '), '- see README / .env.example');
    }
  });
}

module.exports = app;
