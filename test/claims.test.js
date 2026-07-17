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

// --- Recovery matching by the rebill number Walmart pays back on ------------

test('getRebillIndex maps issued rebill numbers to their original claim', () => {
  store.addClaims([{ checkNumber: '930', invoice: '46226', code: '0022', amount: 9.52, description: 'MBNS' }]);
  store.updateClaim('930-46226-0022', { newInvoice: '8980500' });
  const idx = store.getRebillIndex();
  assert.strictEqual(idx['8980500'].invoice, '46226');
  assert.strictEqual(idx['8980500'].code, '0022');
});

test('matchRepayments recovers a claim by its rebill number (no code needed)', () => {
  store.addClaims([{ checkNumber: '931', invoice: '46300', code: '0022', amount: 25 }]);
  store.updateClaim('931-46300-0022', { newInvoice: '8980600', status: 'filed' });
  // Repayment arrives referencing the rebill number, no code — as classified
  // by the allocator's rebill path.
  const matched = store.matchRepayments([{ invoice: '46300', rebillInvoice: '8980600', amount: 25 }], '940');
  assert.strictEqual(matched.length, 1);
  const claim = store.getClaims().claims.find((c) => c.id === '931-46300-0022');
  assert.strictEqual(claim.status, 'recovered');
  assert.strictEqual(claim.recoveredAmount, 25);
  assert.strictEqual(claim.recoveredOnCheck, '940');
});

test('matchRepayments handles a PARTIAL recovery, then completes it', () => {
  store.addClaims([{ checkNumber: '932', invoice: '46400', code: '0022', amount: 40 }]);
  store.updateClaim('932-46400-0022', { newInvoice: '8980700', status: 'filed' });

  // First remittance pays back part of it.
  store.matchRepayments([{ rebillInvoice: '8980700', amount: 15 }], '950');
  let claim = store.getClaims().claims.find((c) => c.id === '932-46400-0022');
  assert.strictEqual(claim.status, 'partial');
  assert.strictEqual(claim.recoveredAmount, 15);

  // A later remittance pays the rest → fully recovered.
  store.matchRepayments([{ rebillInvoice: '8980700', amount: 25 }], '951');
  claim = store.getClaims().claims.find((c) => c.id === '932-46400-0022');
  assert.strictEqual(claim.status, 'recovered');
  assert.strictEqual(claim.recoveredAmount, 40);
});

test('an already fully-recovered claim is not matched again', () => {
  store.addClaims([{ checkNumber: '933', invoice: '46500', code: '0022', amount: 10 }]);
  store.updateClaim('933-46500-0022', { newInvoice: '8980800' });
  store.matchRepayments([{ rebillInvoice: '8980800', amount: 10 }], '960');
  const again = store.matchRepayments([{ rebillInvoice: '8980800', amount: 10 }], '961');
  assert.strictEqual(again.length, 0);
  const claim = store.getClaims().claims.find((c) => c.id === '933-46500-0022');
  assert.strictEqual(claim.recoveredAmount, 10); // not double-counted
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
