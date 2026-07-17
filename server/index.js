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
const { postPlan } = require('./qboPost');
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
  return {
    accountsCfg,
    deps: {
      findCustomerId: (name) => qbo.findCustomerByName(name).then((c) => (c ? c.Id : null)),
      ensureCustomerId: (name) => qbo.ensureCustomer(name).then((c) => (c ? c.Id : null)),
      findInvoiceId: (doc) =>
        qbo.findInvoiceByDocNumber(doc).then((i) =>
          i
            ? { id: i.Id, customerId: i.CustomerRef && i.CustomerRef.value, customerName: i.CustomerRef && i.CustomerRef.name }
            : null
        ),
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
  return allocateCheck(rem.rows, decoder, accounts, { checkNumber: rem.checkNumber, datePaid: rem.datePaid });
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
  const sum = (list) => Math.round(list.reduce((a, c) => a + (Number(c.amount) || 0), 0) * 100) / 100;
  const open = claims.filter((c) => !['recovered', 'denied', 'writeoff'].includes(c.status));
  return {
    count: claims.length,
    openCount: open.length,
    openAmount: sum(open),
    recoveredAmount: sum(by('recovered')),
    readyCount: by('ready').length,
    filedCount: by('filed').length,
  };
}

app.get(
  '/api/claims',
  wrap(async (req, res) => {
    const claims = store.getClaims().claims.slice().reverse();
    res.json({ claims, totals: summarizeClaims(claims) });
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

    // Assign a rebill (New Inv #) to any claim that doesn't have one yet.
    // Floor the counter at the safe minimum so a stale or hand-edited config
    // can never reissue a number already submitted to Walmart.
    let next = Math.max(Number(cfg.nextNewInvoice) || 0, store.minSafeNewInvoice());
    for (const c of selected) {
      if (!c.newInvoice) {
        c.newInvoice = String(next++);
        store.updateClaim(c.id, { newInvoice: c.newInvoice, status: c.status === 'ready' ? 'filed' : c.status });
      }
    }
    store.saveWalmartConfig({ ...cfg, nextNewInvoice: next });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('RecoverySubmission');
    ws.addRow(['PO Number', 'Vendor #', 'Dept', 'Seq', 'Whse', 'Ship Date', 'Orig Inv #', 'New Inv #', 'Amt To Submit']);
    for (const c of selected) {
      ws.addRow([c.po, cfg.vendorNumber, cfg.dept, cfg.seq, c.whse, c.shipDate, c.invoice, c.newInvoice, c.amount]);
    }
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Recovery_Submission_${cfg.vendorNumber}.xlsx"`);
    res.send(Buffer.from(buf));
  })
);

app.post(
  '/api/claims/:id',
  wrap(async (req, res) => {
    const allowed = ['ready', 'filed', 'research', 'recovered', 'denied', 'writeoff'];
    const patch = {};
    if (req.body.status) {
      if (!allowed.includes(req.body.status)) throw badRequest('Unknown status.');
      patch.status = req.body.status;
    }
    if (typeof req.body.notes === 'string') patch.notes = req.body.notes;
    const claim = store.updateClaim(req.params.id, patch);
    if (!claim) throw badRequest('Claim not found.');
    res.json({ ok: true, claim });
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
