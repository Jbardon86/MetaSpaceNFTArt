'use strict';

// Tiny file-backed JSON store. Not a database, but enough to persist the
// QuickBooks tokens, the saved column mapping, and a ledger of already-posted
// checks (for duplicate protection) across restarts.

const fs = require('fs');
const path = require('path');
const defaultDecoder = require('./defaultDecoder');
const defaultAccounts = require('./defaultAccounts');

function round2(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

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

// Rebill ("New Inv #") numbering safety.
//
// Walmart keys invoices by number per vendor, so reusing a number that has
// already been submitted for vendor 540153 gets the claim rejected or misapplied.
// Two separate sources of collision to stay clear of:
//
//  1. STAT Recovery's block. Verified from their EDI 810 (transmitted
//     2026-04-02): they used 8973800–8974007 — 137 rebills, $28,595.59, with
//     125 issued in a single day. STAT is winding down but may still file, so
//     starting just above their high-water mark is not enough headroom; one
//     more normal batch would run straight through it. Hence 8980000, which
//     leaves ~6k of clearance while staying in the 897xxxx family Walmart
//     already accepts.
//
//  2. Our own already-issued rebills. Numbers handed to Walmart on a past
//     export can never be reused, so the next number must also clear the
//     highest one we've assigned. See minSafeNewInvoice().
const STAT_HIGH_WATER = 8974007;
const DEFAULT_NEXT_NEW_INVOICE = 8980000;

function getWalmartConfig() {
  const saved = readJson('walmart.json', null);
  return {
    vendorNumber: '540153',
    dept: '92',
    seq: '1',
    nextNewInvoice: DEFAULT_NEXT_NEW_INVOICE, // rolling rebill invoice number for disputes
    ...(saved || {}),
  };
}

function saveWalmartConfig(cfg) {
  writeJson('walmart.json', cfg);
}

/**
 * The lowest rebill number that is safe to issue next: clear of STAT's block
 * and of every rebill we've already handed to Walmart. The export floors its
 * counter at this, so a stale or hand-edited config can't reissue a number.
 */
function minSafeNewInvoice() {
  const assigned = getClaims()
    .claims.map((c) => parseInt(c.newInvoice, 10))
    .filter((n) => Number.isInteger(n));
  return Math.max(STAT_HIGH_WATER + 1, ...assigned.map((n) => n + 1));
}

// --- Dispute claims (the disputes pipeline) --------------------------------
//
// Each disputed deduction becomes a claim that moves through stages:
//   'ready'      -> ready to dispute (default when a check is posted)
//   'filed'      -> submitted to Walmart
//   'research'   -> Walmart researching
//   'partial'    -> Walmart paid back part of it; the rest is still open
//   'recovered'  -> Walmart paid it back in full
//   'denied'     -> dispute rejected
//   'writeoff'   -> given up / written off

function getClaims() {
  return readJson('claims.json', { claims: [] });
}

// Supporting documents a dispute needs before it can be filed. Walmart denies a
// shortage claim without proof the goods shipped and were received. The original
// invoice is pulled live from QuickBooks on demand (we posted against it, so it
// always exists there), so the only document the user has to supply is the
// proof of delivery — a BOL/POD, either uploaded or linked. Tracked on the claim
// as `claim.docs.pod = { have, kind: 'file'|'link', ... }`.
const REQUIRED_DOCS = [{ key: 'pod', label: 'Proof of delivery (BOL/POD)' }];

/**
 * Whether a claim's user-supplied documents are in hand, and which are missing.
 * (The invoice is not listed — it's fetched from QuickBooks, not supplied here.)
 */
function claimDocsStatus(claim) {
  const docs = (claim && claim.docs) || {};
  const missing = REQUIRED_DOCS.filter((d) => !(docs[d.key] && docs[d.key].have));
  return { complete: missing.length === 0, missing: missing.map((d) => d.label) };
}

// --- Claim document files (proof of delivery uploads) ----------------------
// Stored under DATA_DIR/docs/<claimId>/ so they live on the persistent disk.
// The app is a convenience copy, not the system of record — the originals live
// in the fulfillment system / carrier / QuickBooks.

function docDir(claimId) {
  const safe = String(claimId).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(DATA_DIR, 'docs', safe);
}

/**
 * Persist an uploaded document (multer memory file) for a claim and return the
 * metadata to store on the claim. `file` = { originalname, mimetype, size, buffer }.
 */
function saveClaimDoc(claimId, key, file) {
  const dir = docDir(claimId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = String(path.extname(file.originalname || '')).replace(/[^.A-Za-z0-9]/g, '').slice(0, 10);
  const storedName = `${key}${ext}`;
  fs.writeFileSync(path.join(dir, storedName), file.buffer);
  return {
    have: true,
    kind: 'file',
    filename: String(file.originalname || storedName).slice(0, 200),
    mime: file.mimetype || 'application/octet-stream',
    size: file.size || (file.buffer ? file.buffer.length : 0),
    storedName,
    uploadedAt: new Date().toISOString(),
  };
}

/** Read a stored document back. Returns a Buffer, or null if missing. */
function readClaimDoc(claimId, storedName) {
  const p = path.join(docDir(claimId), path.basename(String(storedName)));
  try {
    return fs.readFileSync(p);
  } catch (_) {
    return null;
  }
}

/** Remove a stored document file (used when replacing with a link or deleting). */
function deleteClaimDoc(claimId, storedName) {
  if (!storedName) return;
  try {
    fs.unlinkSync(path.join(docDir(claimId), path.basename(String(storedName))));
  } catch (_) {
    /* already gone */
  }
}

/**
 * Lookup from a rebill "New Inv #" we've issued -> the original claim it stands
 * for. A recovered dispute comes back from Walmart under the rebill number, so
 * this is how a repayment line is tied back to the original invoice + code.
 */
function getRebillIndex() {
  const index = {};
  for (const c of getClaims().claims) {
    if (c.newInvoice) {
      index[String(c.newInvoice)] = { invoice: c.invoice, code: c.code, description: c.description };
    }
  }
  return index;
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
 * as recovered. A repayment is tied to a claim by EITHER:
 *   - the rebill "New Inv #" we issued (how Walmart most likely references a
 *     recovered dispute, since it was re-invoiced under that number), or
 *   - the original invoice + code (in case the remittance references the
 *     original instead).
 * Matching both keys means recovery works without us having to know in advance
 * which number Walmart's repayment remittance uses.
 *
 * Recovery can be partial: `recoveredAmount` accumulates the cash returned, and
 * the claim only flips to 'recovered' once that covers the full amount (penny
 * tolerance). Until then it's 'partial' and stays open for the remainder.
 */
function matchRepayments(repayments, checkNumber) {
  if (!repayments || !repayments.length) return [];
  const data = getClaims();
  const matched = [];
  for (const r of repayments) {
    const rInv = String(r.invoice == null ? '' : r.invoice).trim();
    const rRebill = String(r.rebillInvoice == null ? '' : r.rebillInvoice).trim();
    const amount = Math.abs(Number(r.amount) || 0);

    const claim = data.claims.find((c) => {
      if (c.status === 'recovered') return false; // already fully recovered
      const byRebill =
        c.newInvoice && (String(c.newInvoice) === rRebill || String(c.newInvoice) === rInv);
      const byOriginal =
        String(c.invoice) === rInv && rInv !== '' && (!r.code || String(c.code) === String(r.code));
      return byRebill || byOriginal;
    });
    if (!claim) continue;

    claim.recoveredAmount = round2((Number(claim.recoveredAmount) || 0) + amount);
    claim.recoveredOnCheck = checkNumber;
    claim.status = claim.recoveredAmount + 0.005 >= Number(claim.amount) ? 'recovered' : 'partial';
    matched.push(claim);
  }
  if (matched.length) saveClaims(data);
  return matched;
}

// --- Item master (SKU -> Walmart Buyer's Item Number) ----------------------
// Learned over time as SKUs get disputed, so the EDI 810 can carry the precise
// item number. Seeded in edi810.js from STAT's real file; this holds additions.

function getItemMaster() {
  return readJson('itemMaster.json', {}) || {};
}

function upsertItemMaster(description, entry) {
  const saved = getItemMaster();
  const key = String(description || '').trim();
  if (!key) return saved;
  saved[key] = { ...(saved[key] || {}), ...entry };
  writeJson('itemMaster.json', saved);
  return saved;
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
  minSafeNewInvoice,
  STAT_HIGH_WATER,
  DEFAULT_NEXT_NEW_INVOICE,
  getClaims,
  getRebillIndex,
  REQUIRED_DOCS,
  claimDocsStatus,
  saveClaimDoc,
  readClaimDoc,
  deleteClaimDoc,
  saveClaims,
  addClaims,
  updateClaim,
  matchRepayments,
  getItemMaster,
  upsertItemMaster,
  getLedger,
  recordPosted,
  isAlreadyPosted,
};
