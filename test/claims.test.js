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
