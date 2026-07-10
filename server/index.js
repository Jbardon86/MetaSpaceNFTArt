'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const { config, configProblems } = require('./config');
const qbo = require('./quickbooks');
const store = require('./store');
const { parseCsv, guessMapping, normalizeChecks } = require('./csvParser');
const { buildDeposit } = require('./deposit');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

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

// Small helper so route handlers can throw and get a clean JSON error.
function wrap(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      res.status(err.status && err.status < 600 ? err.status : 500).json({
        error: err.message || 'Unexpected error',
        detail: err.body || undefined,
      });
    });
  };
}

// --- Status & auth ---------------------------------------------------------

app.get(
  '/api/status',
  wrap(async (req, res) => {
    const problems = configProblems();
    const connected = qbo.isConnected();
    let company = null;
    if (connected) {
      try {
        const info = await qbo.getCompanyInfo();
        company = { name: info.CompanyName, id: info.Id };
      } catch (err) {
        // Token might be stale/revoked — surface but stay usable.
        company = { error: err.message };
      }
    }
    res.json({
      connected,
      company,
      environment: config.qbo.environment,
      configProblems: problems,
      settings: store.getSettings(),
    });
  })
);

app.get('/auth/connect', (req, res) => {
  if (configProblems().length) {
    return res
      .status(400)
      .send('QuickBooks app is not configured. See the README / .env.example.');
  }
  const url = qbo.getAuthorizeUrl('walmartcheck');
  res.redirect(url);
});

app.get(
  '/auth/callback',
  wrap(async (req, res) => {
    await qbo.handleCallback(req.originalUrl);
    res.redirect('/?connected=1');
  })
);

app.post(
  '/api/disconnect',
  wrap(async (req, res) => {
    qbo.disconnect();
    res.json({ ok: true });
  })
);

// --- Accounts & settings ---------------------------------------------------

app.get(
  '/api/accounts',
  wrap(async (req, res) => {
    const accounts = await qbo.listAccounts();
    res.json({ accounts });
  })
);

app.post(
  '/api/settings',
  wrap(async (req, res) => {
    const current = store.getSettings();
    const merged = { ...current, ...req.body };
    store.saveSettings(merged);
    res.json({ ok: true, settings: merged });
  })
);

// --- Upload / preview / post ----------------------------------------------

app.post(
  '/api/upload',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) throw new Error('No file uploaded.');
    const text = req.file.buffer.toString('utf8');
    const { headers, rows } = parseCsv(text);
    if (!headers.length) throw new Error('Could not read any columns from the file.');

    // Stash for preview/post so the browser does not re-send the whole file.
    req.session.upload = { headers, rows, filename: req.file.originalname };

    const saved = store.getSettings();
    const guessed =
      saved.columnMap && Object.keys(saved.columnMap).length
        ? saved.columnMap
        : guessMapping(headers);

    res.json({
      filename: req.file.originalname,
      headers,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 5),
      suggestedMapping: guessed,
    });
  })
);

app.post(
  '/api/preview',
  wrap(async (req, res) => {
    const uploaded = req.session.upload;
    if (!uploaded) throw new Error('No uploaded file in this session. Please upload again.');
    const { columnMap, options } = req.body || {};
    if (!columnMap) throw new Error('A column mapping is required.');

    const { checks, warnings } = normalizeChecks(uploaded.rows, columnMap, options || {});

    // Flag duplicates against the local ledger.
    for (const c of checks) {
      c.duplicate = store.isAlreadyPosted(c.reference);
    }

    res.json({
      checks,
      warnings,
      totals: summarize(checks),
    });
  })
);

app.post(
  '/api/post',
  wrap(async (req, res) => {
    if (!qbo.isConnected()) throw new Error('Not connected to QuickBooks.');
    const { checks, accounts, options } = req.body || {};
    if (!Array.isArray(checks) || !checks.length) throw new Error('No checks to post.');
    if (!accounts || !accounts.bank || !accounts.income) {
      throw new Error('Please choose a bank account and an income account first.');
    }

    // Persist the account choice for next time.
    const settings = store.getSettings();
    settings.accounts = accounts;
    if (options && options.columnMap) settings.columnMap = options.columnMap;
    store.saveSettings(settings);

    const results = [];
    for (const check of checks) {
      const result = { reference: check.reference, net: check.net, status: 'pending' };
      try {
        if (!check.valid) throw new Error('Check has validation issues: ' + (check.issues || []).join('; '));
        if (store.isAlreadyPosted(check.reference)) {
          result.status = 'skipped';
          result.message = 'Already posted earlier (duplicate reference).';
          results.push(result);
          continue;
        }

        let customerRef = null;
        if (check.customer) {
          const customer = await qbo.ensureCustomer(check.customer);
          if (customer) customerRef = { value: customer.Id, name: customer.DisplayName };
        }

        const payload = buildDeposit(check, accounts, {
          customerRef,
          memoPrefix: (options && options.memoPrefix) || 'Walmart',
        });
        const deposit = await qbo.createDeposit(payload);

        store.recordPosted({
          reference: check.reference,
          net: check.net,
          depositId: deposit.Id,
          date: check.date,
          postedAt: new Date().toISOString(),
        });

        result.status = 'posted';
        result.depositId = deposit.Id;
      } catch (err) {
        result.status = 'error';
        result.message = err.message;
      }
      results.push(result);
    }

    res.json({
      results,
      summary: {
        posted: results.filter((r) => r.status === 'posted').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        errors: results.filter((r) => r.status === 'error').length,
      },
    });
  })
);

app.get(
  '/api/ledger',
  wrap(async (req, res) => {
    res.json(store.getLedger());
  })
);

function summarize(checks) {
  const valid = checks.filter((c) => c.valid && !c.duplicate);
  return {
    checkCount: checks.length,
    readyCount: valid.length,
    duplicateCount: checks.filter((c) => c.duplicate).length,
    invalidCount: checks.filter((c) => !c.valid).length,
    grossTotal: round2(sum(checks.map((c) => c.gross))),
    feesTotal: round2(sum(checks.map((c) => c.fees))),
    netTotal: round2(sum(checks.map((c) => c.net))),
  };
}

function sum(nums) {
  return nums.reduce((a, b) => a + (Number(b) || 0), 0);
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

if (require.main === module) {
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`WalmartCheck → QBO running at http://localhost:${config.port}`);
    const problems = configProblems();
    if (problems.length) {
      // eslint-disable-next-line no-console
      console.log('  ⚠ QuickBooks not fully configured:', problems.join(', '));
      console.log('  → Copy .env.example to .env and fill in your Intuit app keys.');
    }
  });
}

module.exports = app;
