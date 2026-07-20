'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildWorklist, categorize, action, draftAppeal } = require('../server/denials');
const { rollUp } = require('../server/apdpImport');

// A minimal history entry shaped like what apdpImport.historyEntries produces.
function deniedLine(disputeNbr, amount, extra = {}) {
  return {
    disputeNbr,
    bucket: 'denied',
    importedAt: '2026-07-19T00:00:00.000Z',
    amounts: { dispAmount: amount },
    denialComment: extra.comment || '',
    reasonCategory: extra.category || '',
    denialEvidence: extra.evidence || {},
  };
}

test('categorize buckets denials by reason', () => {
  assert.strictEqual(categorize({ denialComment: 'Duplicate claim already paid' }), 'duplicate');
  assert.strictEqual(categorize({ denialComment: 'Past the dispute window' }), 'expired');
  assert.strictEqual(categorize({ denialComment: 'Deduction valid as documented' }), 'upheld');
  // A shortage denial with a receipt citation defaults to the recoverable path.
  assert.strictEqual(categorize({ denialComment: 'Merchandise received per BOL' }), 'proof');
  assert.strictEqual(categorize({ denialComment: '' }), 'proof');
});

test('action routes proof denials by whether we have a POD', () => {
  assert.strictEqual(action('proof', false), 'attach-pod');
  assert.strictEqual(action('proof', true), 're-file');
  assert.strictEqual(action('expired', true), 'expired');
  assert.strictEqual(action('duplicate', true), 'duplicate');
});

test('draftAppeal cites the denial and references the proof of delivery', () => {
  const claim = { invoice: '46226', code: '0022', amount: 9.52 };
  const line = deniedLine('D1', 9.52, { comment: 'Merchandise received 06/01' });
  const text = draftAppeal(claim, line);
  assert.match(text, /Appeal of dispute D1/);
  assert.match(text, /\$9\.52/);
  assert.match(text, /proof of delivery/i);
  assert.match(text, /Merchandise received 06\/01/);
});

test('buildWorklist surfaces denied tracked claims, sorted by actionability', () => {
  const claims = [
    { id: 'c-refile', invoice: '46226', code: '0022', amount: 9.52, docs: { pod: { have: true } } },
    { id: 'c-needpod', invoice: '46300', code: '0022', amount: 25, docs: {} },
    { id: 'c-open', invoice: '46400', code: '0022', amount: 5 }, // no history -> not a denial
  ];
  const historyByClaim = new Map([
    ['c-refile', [deniedLine('D1', 9.52, { comment: 'received' })]],
    ['c-needpod', [deniedLine('D2', 25, { comment: 'received' })]],
  ]);
  const { items, totals } = buildWorklist(claims, historyByClaim, rollUp);

  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].action, 're-file'); // has POD, sorted first
  assert.strictEqual(items[1].action, 'attach-pod'); // no POD
  assert.strictEqual(totals.count, 2);
  assert.strictEqual(totals.readyToRefile, 1);
  assert.strictEqual(totals.needPod, 1);
  assert.strictEqual(totals.recoverableAmount, 34.52); // 9.52 + 25 both recoverable
});

test('a claim whose Walmart status is approved is NOT in the denial worklist', () => {
  const claims = [{ id: 'c1', invoice: '46226', code: '0022', amount: 9.52, docs: { pod: { have: true } } }];
  const approvedLine = { disputeNbr: 'D1', bucket: 'approved', importedAt: '2026-07-19T00:00:00.000Z', amounts: { dispAmount: 9.52 } };
  const { items } = buildWorklist(claims, new Map([['c1', [approvedLine]]]), rollUp);
  assert.strictEqual(items.length, 0);
});
