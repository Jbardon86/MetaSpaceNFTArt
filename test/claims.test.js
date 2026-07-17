'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the store's data dir before requiring it.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-'));
const store = require('../server/store');

test('addClaims is idempotent by check/invoice/code', () => {
  const entry = { checkNumber: '900', invoice: '46226', code: '0022', description: 'MBNS', amount: 9.52, po: 'P1' };
  store.addClaims([entry]);
  store.addClaims([entry]); // second time should not duplicate
  const claims = store.getClaims().claims.filter((c) => c.checkNumber === '900');
  assert.strictEqual(claims.length, 1);
  assert.strictEqual(claims[0].status, 'ready');
  assert.strictEqual(claims[0].id, '900-46226-0022');
});

test('updateClaim changes status', () => {
  store.addClaims([{ checkNumber: '901', invoice: '5', code: '0022', amount: 10 }]);
  const updated = store.updateClaim('901-5-0022', { status: 'filed', newInvoice: '8974100' });
  assert.strictEqual(updated.status, 'filed');
  assert.strictEqual(updated.newInvoice, '8974100');
});

test('matchRepayments marks a matching open claim recovered', () => {
  store.addClaims([{ checkNumber: '902', invoice: '77', code: '0022', amount: 50 }]);
  const matched = store.matchRepayments([{ invoice: '77', code: '0022', amount: 50 }], '910');
  assert.strictEqual(matched.length, 1);
  const claim = store.getClaims().claims.find((c) => c.id === '902-77-0022');
  assert.strictEqual(claim.status, 'recovered');
  assert.strictEqual(claim.recoveredOnCheck, '910');
});

test('walmart config has the Recovery Submission defaults', () => {
  const cfg = store.getWalmartConfig();
  assert.strictEqual(cfg.vendorNumber, '540153');
  assert.strictEqual(cfg.dept, '92');
  assert.ok(cfg.nextNewInvoice > 0);
});

// --- Rebill numbering safety ------------------------------------------------
// Reusing an invoice number Walmart has already seen gets the claim rejected,
// so the floor has to hold against both STAT's block and our own past exports.

test('the default rebill start clears STAT high-water mark with real headroom', () => {
  // STAT filed 137 rebills through 8974007, 125 of them in a single day, and is
  // still winding down. Starting just above their max would not survive one
  // more batch.
  assert.ok(
    store.DEFAULT_NEXT_NEW_INVOICE > store.STAT_HIGH_WATER + 1000,
    `default ${store.DEFAULT_NEXT_NEW_INVOICE} leaves too little room above STAT's ${store.STAT_HIGH_WATER}`
  );
});

test('minSafeNewInvoice never returns a number inside STAT block', () => {
  assert.ok(store.minSafeNewInvoice() > store.STAT_HIGH_WATER);
});

test('minSafeNewInvoice rises above our own already-issued rebills', () => {
  store.addClaims([{ checkNumber: '920', invoice: '600', code: '0022', amount: 5 }]);
  store.updateClaim('920-600-0022', { newInvoice: '8985000' });
  assert.strictEqual(store.minSafeNewInvoice(), 8985001);
});

test('minSafeNewInvoice ignores claims with no rebill number yet', () => {
  store.addClaims([{ checkNumber: '921', invoice: '601', code: '0022', amount: 5 }]);
  // 8985000 from the previous test is still the highest assigned; an unassigned
  // claim must not drag the floor back down.
  assert.strictEqual(store.minSafeNewInvoice(), 8985001);
});
