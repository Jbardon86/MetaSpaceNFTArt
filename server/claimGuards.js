'use strict';

// Submittability guards shared by the Recovery Submission (.xlsx) export and
// the EDI 810 re-invoice. Both key on the original PO (the 810 references it;
// Walmart's AP matches the dispute on PO + DC), so a claim whose PO or DC is
// blank or all-zeros can't be matched and would be auto-denied. Such claims are
// held back rather than transmitted.

/** True when a value is empty or all zeros ("", "0", "0000000000", "000000000"). */
function isBlankOrZero(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '' || /^0+$/.test(s);
}

// Bare numeric form of a deduction code — strip brackets/padding so "[0025]",
// "0025", and "25" all compare equal.
function bareCode(v) {
  const digits = String(v == null ? '' : v).replace(/\D/g, '');
  return digits.replace(/^0+/, '') || (digits ? '0' : '');
}

// Deduction codes whose disputes carry no PO by nature: POD / "no merchandise
// received" claims are won with a proof-of-delivery document, not by re-invoicing
// against a PO. For these a blank PO is expected, not an error — but the DC
// (store/warehouse) is still required, since that's how the POD is located.
// Extend as other document-based (non-re-invoice) codes surface.
const NO_PO_CODES = new Set([
  '25', // 0025 POD / No Merchandise Received For Invoice
]);

/** True when this claim's deduction code is a document dispute that needs no PO. */
function isNoPoCode(code) {
  return NO_PO_CODES.has(bareCode(code));
}

// A Walmart store-direct (DSD) invoice's "PO" is the location code
// 28-<store>-<seq>, e.g. "28-7087-0016". Walmart's APDP dispute export carries
// exactly this as PoNbr, and QuickBooks stores it in the invoice "Sales Rep"
// field. The store number in the middle is the DC/location. Decode it so DSD
// claims the remittance zero-filled can be backfilled. Returns { po, whse } or
// null for a non-DSD value.
function decodeDsdRep(rep) {
  const m = /^\s*28-(\d{2,5})-(\w+)\s*$/.exec(String(rep == null ? '' : rep));
  if (!m) return null;
  const store = m[1].replace(/^0+/, '') || '0';
  return { po: String(rep).trim(), whse: store };
}

/** Which required identifiers a claim is missing ([] => submittable). */
function missingIdentifiers(c) {
  const missing = [];
  if (!isNoPoCode(c.code) && isBlankOrZero(c.po)) missing.push('PO');
  if (isBlankOrZero(c.whse)) missing.push('DC/Whse');
  return missing;
}

module.exports = { isBlankOrZero, missingIdentifiers, isNoPoCode, NO_PO_CODES, decodeDsdRep };
