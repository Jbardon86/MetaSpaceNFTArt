'use strict';

// Tiny file-backed JSON store. Not a database, but enough to persist the
// QuickBooks tokens, the saved column mapping, and a ledger of already-posted
// checks (for duplicate protection) across restarts.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

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
  getTokens,
  saveTokens,
  clearTokens,
  getSettings,
  saveSettings,
  getLedger,
  recordPosted,
  isAlreadyPosted,
};
