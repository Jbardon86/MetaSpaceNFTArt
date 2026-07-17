'use strict';

// Tiny file-backed JSON store. Not a database, but enough to persist the
// QuickBooks tokens, the saved column mapping, and a ledger of already-posted
// checks (for duplicate protection) across restarts.

const fs = require('fs');
const path = require('path');
const defaultDecoder = require('./defaultDecoder');
const defaultAccounts = require('./defaultAccounts');

// Where persisted files live. Override with DATA_DIR when hosted so it points
// at a persistent disk (Render, etc.) that survives restarts/redeploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

function writeJson(name, value) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(value, null, 2), 'utf8');
}

// --- Error log (persistent, shareable for troubleshooting) -----------------

function logError(entry) {
  ensureDir();
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
  try {
    fs.appendFileSync(filePath('errors.log'), line);
  } catch (_) {
    /* logging must never crash the request */
  }
}

// --- QuickBooks tokens -----------------------------------------------------

function getTokens() {
  return readJson('tokens.json', null);
}

function saveTokens(tokens) {
  writeJson('tokens.json', tokens);
}

function clearTokens() {
  try {
    fs.unlinkSync(filePath('tokens.json'));
  } catch (_) {
    /* already gone */
  }
}

// --- Column mapping + account settings -------------------------------------

function getSettings() {
  return readJson('mappings.json', {
    columnMap: {},
    accounts: { bank: null, income: null, fees: null },
    defaults: { customerName: 'Walmart', feesAreNegativeInFile: true },
  });
}

function saveSettings(settings) {
  writeJson('mappings.json', settings);
}

// --- Decoder (deduction code -> handling) ----------------------------------

function getDecoder() {
  const saved = readJson('decoder.json', null);
  // start from defaults, let saved entries override/extend
  return { ...defaultDecoder, ...(saved || {}) };
}

function saveDecoder(decoder) {
  writeJson('decoder.json', decoder);
}

function upsertCode(code, entry) {
  const saved = readJson('decoder.json', {});
  saved[code] = entry;
  writeJson('decoder.json', saved);
  return getDecoder();
}

// --- Account routing -------------------------------------------------------

function getAccounts() {
  const saved = readJson('accounts.json', null);
  return { ...defaultAccounts, ...(saved || {}) };
}

function saveAccounts(accounts) {
  writeJson('accounts.json', accounts);
}

// --- Walmart submission config (for the Recovery Submission export) --------

function getWalmartConfig() {
  const saved = readJson('walmart.json', null);
  return {
    vendorNumber: '540153',
    dept: '92',
    seq: '1',
    nextNewInvoice: 8974100, // rolling rebill invoice number for disputes
    ...(saved || {}),
  };
}

function saveWalmartConfig(cfg) {
  writeJson('walmart.json', cfg);
}

// --- Dispute claims (the disputes pipeline) --------------------------------
//
// Each disputed deduction becomes a claim that moves through stages:
//   'ready'      -> ready to dispute (default when a check is posted)
//   'filed'      -> submitted to Walmart
//   'research'   -> Walmart researching
//   'recovered'  -> Walmart paid it back
//   'denied'     -> dispute rejected
//   'writeoff'   -> given up / written off

function getClaims() {
  return readJson('claims.json', { claims: [] });
}

function saveClaims(data) {
  writeJson('claims.json', data);
}

function claimId(checkNumber, invoice, code) {
  return `${checkNumber || 'na'}-${invoice || 'na'}-${code || 'na'}`;
}

/**
 * Add claims for a posted check's disputes. Idempotent by id — re-posting or
 * re-recording the same check won't duplicate claims.
 */
function addClaims(entries) {
  const data = getClaims();
  const byId = new Map(data.claims.map((c) => [c.id, c]));
  for (const e of entries) {
    const id = claimId(e.checkNumber, e.invoice, e.code);
    if (byId.has(id)) continue;
    const claim = { id, status: 'ready', ...e };
    data.claims.push(claim);
    byId.set(id, claim);
  }
  saveClaims(data);
  return data;
}

function updateClaim(id, patch) {
  const data = getClaims();
  const claim = data.claims.find((c) => c.id === id);
  if (!claim) return null;
  Object.assign(claim, patch);
  saveClaims(data);
  return claim;
}

/**
 * Given the repayments on a freshly-posted check, mark any matching open claims
 * as recovered (matched by invoice + code).
 */
function matchRepayments(repayments, checkNumber) {
  if (!repayments || !repayments.length) return [];
  const data = getClaims();
  const matched = [];
  for (const r of repayments) {
    const claim = data.claims.find(
      (c) => c.invoice === String(r.invoice) && (!r.code || c.code === r.code) && c.status !== 'recovered'
    );
    if (claim) {
      claim.status = 'recovered';
      claim.recoveredOnCheck = checkNumber;
      matched.push(claim);
    }
  }
  if (matched.length) saveClaims(data);
  return matched;
}

// --- Posted-check ledger (duplicate guard) ---------------------------------

function getLedger() {
  return readJson('ledger.json', { posted: [] });
}

/**
 * Records that a check reference was posted. Returns the updated ledger.
 */
function recordPosted(entry) {
  const ledger = getLedger();
  ledger.posted.push(entry);
  writeJson('ledger.json', ledger);
  return ledger;
}

function isAlreadyPosted(reference) {
  if (!reference) return false;
  const ledger = getLedger();
  return ledger.posted.some((p) => p.reference === reference);
}

module.exports = {
  DATA_DIR,
  logError,
  getTokens,
  saveTokens,
  clearTokens,
  getSettings,
  saveSettings,
  getDecoder,
  saveDecoder,
  upsertCode,
  getAccounts,
  saveAccounts,
  getWalmartConfig,
  saveWalmartConfig,
  getClaims,
  saveClaims,
  addClaims,
  updateClaim,
  matchRepayments,
  getLedger,
  recordPosted,
  isAlreadyPosted,
};
