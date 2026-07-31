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

/** Which required identifiers a claim is missing ([] => submittable). */
function missingIdentifiers(c) {
  const missing = [];
  if (isBlankOrZero(c.po)) missing.push('PO');
  if (isBlankOrZero(c.whse)) missing.push('DC/Whse');
  return missing;
}

module.exports = { isBlankOrZero, missingIdentifiers };
