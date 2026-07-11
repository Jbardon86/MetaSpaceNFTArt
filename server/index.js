'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const { config, configProblems } = require('./config');
const qbo = require('./quickbooks');
const store = require('./store');
const { parseRemittance } = require('./walmartFile');
const { allocateCheck } = require('./allocator');
const { postPlan } = require('./qboPost');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '20mb' }));
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));

function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
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
      findInvoiceId: (doc) => qbo.findInvoiceByDocNumber(doc).then((i) => (i ? i.Id : null)),
      accountIdFor,
      ensureWriteOffItemId: () => qbo.ensureWriteOffItem(accountIdFor(accountsCfg.paymentWriteOff)),
      createCreditMemo: qbo.createCreditMemo,
      createPayment: qbo.createPayment,
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
    });
  })
);

app.get('/auth/connect', (req, res) => {
  if (configProblems().length) return res.status(400).send('QuickBooks app not configured. See README.');
  res.redirect(qbo.getAuthorizeUrl('walmartcheck'));
});

app.get('/auth/callback', wrap(async (req, res) => {
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
      store.recordPosted({
        reference: plan.meta.checkNumber,
        net: report.depositTotal,
        postedAt: new Date().toISOString(),
        steps: report.steps,
      });
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
