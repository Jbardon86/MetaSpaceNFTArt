'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'apdp-'));
const store = require('../server/store');
const apdp = require('../server/apdpImport');

// A row in the real export's exact shape: 15-digit zero-padded invoice with
// trailing spaces, bare claim code, per-line DisputeNbr.
function csv(rows, extraCols = []) {
  const cols = [
    'VendorNumber', 'VendorName', 'ClaimNbr', 'ClaimCode', 'ClaimAmt', 'ClaimLineNbr', 'Currency',
    'CreatedDt', 'LastUpdatedDt', 'CaseNbr', 'DisputeNbr', 'Status', 'DisputeType', 'DispAmount',
    'PoNbr', 'InvoiceAmt', 'InvoiceNbr', 'DeniedDeductionCode', 'DeniedDeductionCategory',
    'DeniedUserComments', 'DeniedBolNbr', 'DeniedDenialAmt',
    ...extraCols,
  ];
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => (r[c] == null ? '' : String(r[c]))).join(','));
  return Buffer.from([header, ...lines].join('\n'), 'utf8');
}

function row(over = {}) {
  return {
    VendorNumber: '540153', ClaimNbr: '000000000045211', ClaimCode: '22', ClaimLineNbr: '2',
    CreatedDt: '07/10/2026', LastUpdatedDt: '07/10/2026', CaseNbr: '202607101747488050',
    DisputeNbr: '40538032', Status: 'Denied', DisputeType: 'US-WM-WHSE', DispAmount: '95.2',
    PoNbr: '7633909301', InvoiceAmt: '1906.58', InvoiceNbr: '000000000045211       ',
    DeniedDeductionCode: '22', DeniedDeductionCategory: 'Qty Difference: Shortage/Overage/Sub',
    DeniedDenialAmt: '95.2', ...over,
  };
}

// --- Parsing ---------------------------------------------------------------

test('parses the real export shape: padded invoice, trailing spaces, bare code', () => {
  const { rows } = apdp.parseApdp(csv([row()]));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].invoice, '45211', 'zero-padding and trailing spaces stripped');
  assert.strictEqual(rows[0].code, '22');
  assert.strictEqual(rows[0].disputeNbr, '40538032');
  assert.strictEqual(rows[0].amounts.dispAmount, 95.2);
  assert.strictEqual(rows[0].createdDt, '2026-07-10');
});

test('maps the real status values, including the ones the spec missed', () => {
  assert.strictEqual(apdp.statusBucket('Sent For Payment'), 'approved');
  assert.strictEqual(apdp.statusBucket('Denied'), 'denied');
  assert.strictEqual(apdp.statusBucket('Cancelled'), 'cancelled');
  assert.strictEqual(apdp.statusBucket('Sent For Revision'), 'pending');
  assert.strictEqual(apdp.statusBucket('Submitted'), 'pending');
  // Anything new Walmart starts emitting must not be silently bucketed wrong.
  assert.strictEqual(apdp.statusBucket('Escalated'), 'unknown');
});

test('an unrecognized status is imported but warned about', () => {
  const { rows, warnings } = apdp.parseApdp(csv([row({ Status: 'Escalated' })]));
  assert.strictEqual(rows[0].status, 'Escalated');
  assert.ok(warnings.some((w) => /Escalated/.test(w)));
});

test('rejects a file that is not an APDP export', () => {
  assert.throws(
    () => apdp.parseApdp(Buffer.from('Date,Amount\n2026-01-01,5\n')),
    /does not look like a Walmart APDP dispute export/
  );
});

test('normCode reconciles Walmart "22" with our "0022" and "[0022]"', () => {
  assert.strictEqual(apdp.normCode('22'), '22');
  assert.strictEqual(apdp.normCode('0022'), '22');
  assert.strictEqual(apdp.normCode('[0022]'), '22');
});

// --- Matching --------------------------------------------------------------

const claims = [
  { id: 'c1', invoice: '45211', code: '0022', amount: 95.2, po: '7633909301' },
  { id: 'c2', invoice: '43543', code: '0010', amount: 50 },
  { id: 'c3', invoice: '43543', code: '0022', amount: 60 },
];

test('matches a row to its claim by invoice despite padding differences', () => {
  const { rows } = apdp.parseApdp(csv([row()]));
  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.matched.length, 1);
  assert.strictEqual(p.matched[0].claimId, 'c1');
  assert.strictEqual(p.matched[0].matchedBy, 'invoice');
  assert.strictEqual(p.matched[0].change, 'new');
});

test('deduction code disambiguates two claims on the same invoice', () => {
  const { rows } = apdp.parseApdp(csv([row({ InvoiceNbr: '000000000043543', ClaimCode: '10' })]));
  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.matched[0].claimId, 'c2');
});

test('an unmatchable invoice is flagged, never guessed', () => {
  const { rows } = apdp.parseApdp(csv([row({ InvoiceNbr: '000000000099999' })]));
  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.matched.length, 0);
  assert.strictEqual(p.unmatched.length, 1);
  assert.match(p.unmatched[0].reason, /No claim for invoice 99999/);
});

test('an ambiguous match is flagged with the competing claim ids', () => {
  // Two claims on one invoice, both carrying the same code -> cannot narrow.
  const dupCode = [
    { id: 'd1', invoice: '43543', code: '0022', amount: 10 },
    { id: 'd2', invoice: '43543', code: '0022', amount: 20 },
  ];
  const { rows } = apdp.parseApdp(csv([row({ InvoiceNbr: '000000000043543', ClaimCode: '22' })]));
  const p = apdp.buildPreview(rows, dupCode, []);
  assert.strictEqual(p.matched.length, 0);
  assert.match(p.unmatched[0].reason, /Ambiguous/);
  assert.match(p.unmatched[0].reason, /d1, d2/);
});

test('a dispute whose code does not match our claim is NOT absorbed', () => {
  // The real failure this caught: invoice 45211 carries a code-25 pricing
  // dispute for $942.48 that is Walmart's, not our code-22 shortage claim.
  // With one claim on the invoice it would otherwise match by default.
  const { rows } = apdp.parseApdp(csv([row({ ClaimCode: '25', DispAmount: '942.48' })]));
  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.matched.length, 0, 'must not attach a code-25 dispute to a code-22 claim');
  assert.match(p.unmatched[0].reason, /none with deduction code 25/);
  assert.match(p.unmatched[0].reason, /ours: 22/);
});

// --- Approval detail rows ---------------------------------------------------

test('approval detail rows fold into one entry instead of looking like duplicates', () => {
  // Walmart emits one row per ApprovedSeq when a dispute is approved across
  // several POs. Same DisputeNbr, same status, same DispAmount.
  const detail = [1, 2, 3].map((seq) =>
    row({
      Status: 'Sent For Payment', DispAmount: '1923.85',
      ApprovedSeq: String(seq), ApprovedPoNbr: `PO${seq}`, ApprovedTotalCostAmt: '100',
    })
  );
  const { rows, warnings } = apdp.parseApdp(csv(detail, ['ApprovedSeq', 'ApprovedPoNbr', 'ApprovedTotalCostAmt']));
  assert.strictEqual(rows.length, 1, 'three approval rows collapse to one dispute line');
  assert.strictEqual(rows[0].approvedLineCount, 3);
  assert.strictEqual(rows[0].approvedTotal, 300);
  assert.ok(warnings.some((w) => /approval detail/.test(w)));

  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.unmatched.length, 0, 'approval detail must not land in manual review');
  assert.strictEqual(p.matched[0].amount, 1923.85, 'dispute amount is not multiplied by the detail rows');
});

test('the same DisputeNbr with conflicting statuses is reported, newest kept', () => {
  const conflict = [
    row({ Status: 'Denied', LastUpdatedDt: '03/01/2026' }),
    row({ Status: 'Sent For Payment', LastUpdatedDt: '06/01/2026' }),
  ];
  const { rows, warnings } = apdp.parseApdp(csv(conflict));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].status, 'Sent For Payment', 'newest LastUpdatedDt wins');
  assert.ok(warnings.some((w) => /conflicting statuses/.test(w)));
});

test('many dispute lines under one invoice all attach to the same claim', () => {
  // The real file has up to 18 lines on a single invoice.
  const lines = [1, 2, 3].map((n) =>
    row({ DisputeNbr: `4053800${n}`, ClaimLineNbr: String(n), DispAmount: String(n * 10) })
  );
  const { rows } = apdp.parseApdp(csv(lines));
  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.matched.length, 3);
  assert.ok(p.matched.every((m) => m.claimId === 'c1'));
  assert.strictEqual(p.summary.claimsAffected, 1);
});

test('a PO that disagrees with the claim is surfaced, not silently absorbed', () => {
  const { rows } = apdp.parseApdp(csv([row({ PoNbr: '9999999999' })]));
  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.matched[0].poMismatch, true);
  assert.strictEqual(p.summary.poMismatches, 1);
});

test('two byte-identical rows for one dispute collapse to a single entry', () => {
  const { rows } = apdp.parseApdp(csv([row(), row()]));
  assert.strictEqual(rows.length, 1);
  const p = apdp.buildPreview(rows, claims, []);
  assert.strictEqual(p.matched.length, 1);
  assert.strictEqual(p.unmatched.length, 0);
});

// --- Preview writes nothing / re-import safety ------------------------------

test('a status that has not changed is a no-op, not a duplicate row', () => {
  const { rows } = apdp.parseApdp(csv([row()]));
  const history = [
    { claimId: 'c1', disputeNbr: '40538032', status: 'Denied', importedAt: '2026-07-01T00:00:00.000Z' },
  ];
  const p = apdp.buildPreview(rows, claims, history);
  assert.strictEqual(p.matched[0].change, 'noop');
  assert.strictEqual(p.summary.willWrite, 0);
});

test('a genuine status change is previewed as old -> new', () => {
  const { rows } = apdp.parseApdp(csv([row({ Status: 'Sent For Payment' })]));
  const history = [
    { claimId: 'c1', disputeNbr: '40538032', status: 'Denied', importedAt: '2026-07-01T00:00:00.000Z' },
  ];
  const p = apdp.buildPreview(rows, claims, history);
  assert.strictEqual(p.matched[0].change, 'changed');
  assert.strictEqual(p.matched[0].prevStatus, 'Denied');
  assert.strictEqual(p.matched[0].status, 'Sent For Payment');
  assert.strictEqual(p.summary.willWrite, 1);
});

test('appendStatusHistory skips unchanged statuses so re-import cannot duplicate', () => {
  const entries = [
    { claimId: 'x1', disputeNbr: 'D1', status: 'Denied', bucket: 'denied', amounts: {}, importedAt: '2026-07-01T00:00:00.000Z' },
  ];
  const first = store.appendStatusHistory(entries);
  assert.strictEqual(first.appended, 1);
  const second = store.appendStatusHistory(entries);
  assert.strictEqual(second.appended, 0);
  assert.strictEqual(second.skipped, 1);
  assert.strictEqual(store.getStatusHistory().entries.filter((e) => e.disputeNbr === 'D1').length, 1);
});

test('history is append-only: a real change adds a row and keeps the old one', () => {
  store.appendStatusHistory([
    { claimId: 'x2', disputeNbr: 'D2', status: 'Submitted', bucket: 'pending', amounts: {}, importedAt: '2026-07-01T00:00:00.000Z' },
  ]);
  store.appendStatusHistory([
    { claimId: 'x2', disputeNbr: 'D2', status: 'Denied', bucket: 'denied', amounts: {}, importedAt: '2026-07-02T00:00:00.000Z' },
  ]);
  const trail = store.statusHistoryForClaim('x2');
  assert.strictEqual(trail.length, 2);
  assert.deepStrictEqual(trail.map((e) => e.status), ['Submitted', 'Denied']);
});

// --- Roll-up ---------------------------------------------------------------

test('rollUp reports a single status when every line agrees', () => {
  const r = apdp.rollUp([
    { disputeNbr: 'A', status: 'Denied', bucket: 'denied', amounts: { dispAmount: 10 }, importedAt: '1' },
    { disputeNbr: 'B', status: 'Denied', bucket: 'denied', amounts: { dispAmount: 5 }, importedAt: '1' },
  ]);
  assert.strictEqual(r.status, 'denied');
  assert.strictEqual(r.lineCount, 2);
  assert.strictEqual(r.deniedAmount, 15);
});

test('rollUp reports mixed when lines disagree, rather than picking a winner', () => {
  const r = apdp.rollUp([
    { disputeNbr: 'A', status: 'Denied', bucket: 'denied', amounts: { dispAmount: 10 }, importedAt: '1' },
    { disputeNbr: 'B', status: 'Sent For Payment', bucket: 'approved', amounts: { dispAmount: 40 }, importedAt: '1' },
  ]);
  assert.strictEqual(r.status, 'mixed');
  assert.strictEqual(r.deniedAmount, 10);
  assert.strictEqual(r.approvedAmount, 40);
  assert.deepStrictEqual(r.counts, { denied: 1, approved: 1 });
});

test('rollUp uses only the newest entry per dispute line', () => {
  const r = apdp.rollUp([
    { disputeNbr: 'A', status: 'Denied', bucket: 'denied', amounts: { dispAmount: 10 }, importedAt: '2026-07-01T00:00:00.000Z' },
    { disputeNbr: 'A', status: 'Sent For Payment', bucket: 'approved', amounts: { dispAmount: 10 }, importedAt: '2026-07-05T00:00:00.000Z' },
  ]);
  assert.strictEqual(r.status, 'approved');
  assert.strictEqual(r.lineCount, 1, 'one dispute line, not two');
});

// --- Walmart identifiers ---------------------------------------------------

test('recordWalmartIds stores DisputeNbr/CaseNbr and enables direct matching next time', () => {
  store.addClaims([{ checkNumber: '990', invoice: '45211', code: '0022', amount: 95.2 }]);
  const id = '990-45211-0022';
  store.recordWalmartIds([{ claimId: id, disputeNbr: '40538032', caseNbr: '202607101747488050' }]);
  const claim = store.getClaims().claims.find((c) => c.id === id);
  assert.deepStrictEqual(claim.apdpDisputeNbrs, ['40538032']);

  // Next import matches by DisputeNbr even if the invoice number no longer lines up.
  const { rows } = apdp.parseApdp(csv([row({ InvoiceNbr: '000000000000001' })]));
  const p = apdp.buildPreview(rows, store.getClaims().claims, []);
  assert.strictEqual(p.matched[0].claimId, id);
  assert.strictEqual(p.matched[0].matchedBy, 'disputeNbr');
});

test('recordWalmartIds is additive and does not duplicate on re-import', () => {
  const id = '990-45211-0022';
  store.recordWalmartIds([{ claimId: id, disputeNbr: '40538032', caseNbr: '202607101747488050' }]);
  store.recordWalmartIds([{ claimId: id, disputeNbr: '40538099', caseNbr: '202607101747488050' }]);
  const claim = store.getClaims().claims.find((c) => c.id === id);
  assert.deepStrictEqual(claim.apdpDisputeNbrs.sort(), ['40538032', '40538099']);
  assert.strictEqual(claim.apdpCaseNbrs.length, 1);
});

// --- Against the real 5,019-row export, when present -----------------------

const REAL = path.join(os.homedir(), 'Downloads', 'Disputes (3).csv');

test('parses the real Walmart export end to end', { skip: !fs.existsSync(REAL) }, () => {
  const { rows, warnings } = apdp.parseApdp(fs.readFileSync(REAL));
  // 5,019 CSV rows -> 5,000 dispute lines; 19 are approval detail (ApprovedSeq).
  assert.strictEqual(rows.length, 5000);
  assert.strictEqual(new Set(rows.map((r) => r.disputeNbr)).size, 5000, 'one entry per dispute line');
  assert.ok(rows.every((r) => r.disputeNbr), 'every row has a DisputeNbr');
  assert.ok(rows.every((r) => r.bucket !== 'unknown'), `unexpected status: ${warnings.join(' ')}`);
  assert.ok(rows.every((r) => !/^0|\s/.test(r.invoice)), 'invoice numbers fully normalized');

  // The matcher must terminate and classify every row against a real claim set.
  const p = apdp.buildPreview(rows, store.getClaims().claims, []);
  assert.strictEqual(p.matched.length + p.unmatched.length, rows.length);
  assert.ok(p.unmatched.every((u) => u.reason), 'every unmatched row explains itself');
});
