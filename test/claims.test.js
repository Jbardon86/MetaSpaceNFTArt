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

test('re-ingest self-heals a zero-filled PO/DC without disturbing the rest', () => {
  // First ingest stored zero-filled identifiers (Walmart's deduction line).
  store.addClaims([{ checkNumber: '905', invoice: '46218', code: '0022', amount: 942.48, po: '0000000000', whse: '000000000' }]);
  store.updateClaim('905-46218-0022', { status: 'filed', newInvoice: '8980000' });
  // Re-ingest now carries the real values from the invoice's payment line.
  store.addClaims([{ checkNumber: '905', invoice: '46218', code: '0022', amount: 942.48, po: '5501001222', whse: '6017' }]);
  const claims = store.getClaims().claims.filter((c) => c.checkNumber === '905');
  assert.strictEqual(claims.length, 1, 'still deduped — no duplicate');
  assert.strictEqual(claims[0].po, '5501001222');
  assert.strictEqual(claims[0].whse, '6017');
  assert.strictEqual(claims[0].status, 'filed', 'status untouched');
  assert.strictEqual(claims[0].newInvoice, '8980000', 'rebill number untouched');
});

test('backfillIdentifiers fills blank PO/DC from an authoritative source', () => {
  store.addClaims([{ checkNumber: '907', invoice: '46218', code: '0025', amount: 942.48, po: '0000000000', whse: '000000000' }]);
  const changed = store.backfillIdentifiers([{ claimId: '907-46218-0025', po: '28-7087-0016', whse: '7087' }]);
  assert.strictEqual(changed, 1);
  const claim = store.getClaims().claims.find((c) => c.id === '907-46218-0025');
  assert.strictEqual(claim.po, '28-7087-0016');
  assert.strictEqual(claim.whse, '7087');
});

test('backfillIdentifiers never overwrites a real value and ignores unknown claims', () => {
  store.addClaims([{ checkNumber: '908', invoice: '5', code: '0022', amount: 10, po: '5501001222', whse: '6017' }]);
  const changed = store.backfillIdentifiers([
    { claimId: '908-5-0022', po: '9999999999', whse: '0000' }, // must not overwrite
    { claimId: 'does-not-exist', po: '1', whse: '2' }, // ignored
  ]);
  assert.strictEqual(changed, 0);
  const claim = store.getClaims().claims.find((c) => c.id === '908-5-0022');
  assert.strictEqual(claim.po, '5501001222');
  assert.strictEqual(claim.whse, '6017');
});

test('re-ingest never overwrites an already-real PO/DC', () => {
  store.addClaims([{ checkNumber: '906', invoice: '5', code: '0022', amount: 10, po: '5501001222', whse: '6017' }]);
  store.addClaims([{ checkNumber: '906', invoice: '5', code: '0022', amount: 10, po: '9999999999', whse: '0000' }]);
  const claim = store.getClaims().claims.find((c) => c.id === '906-5-0022');
  assert.strictEqual(claim.po, '5501001222');
  assert.strictEqual(claim.whse, '6017');
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

// --- Filing failsafe: supporting documents --------------------------------

test('claimDocsStatus needs the proof of delivery (invoice comes from QBO)', () => {
  const none = store.claimDocsStatus({});
  assert.strictEqual(none.complete, false);
  assert.ok(none.missing.some((m) => /delivery|BOL|POD/i.test(m)));
  // A BOL/POD in hand is all the user must supply — the invoice is pulled from QBO.
  assert.strictEqual(store.claimDocsStatus({ docs: { pod: { have: true } } }).complete, true);
});

test('item master learns and merges Walmart item numbers', () => {
  store.upsertItemMaster('MM STRAWBRRY 24CT', { itemNumber: '650044999', unitPrice: 24.16 });
  const m = store.getItemMaster();
  assert.strictEqual(m['MM STRAWBRRY 24CT'].itemNumber, '650044999');
  // upsert merges rather than clobbering
  store.upsertItemMaster('MM STRAWBRRY 24CT', { unitPrice: 24.16 });
  assert.strictEqual(store.getItemMaster()['MM STRAWBRRY 24CT'].itemNumber, '650044999');
});

test('a learned item number flows into a precise EDI 810 line', () => {
  const { buildEdi810 } = require('../server/edi810');
  const claim = {
    id: 'p-1', invoice: '46226', code: '0022', amount: 24.16, po: 'P', shipDate: '2026-06-01', newInvoice: '8980050',
    items: [{ description: 'MM STRAWBRRY 24CT', quantity: 1, unitPrice: 24.16 }],
  };
  const { edi } = buildEdi810([{ claim, invoiceLines: [] }], { control: '1', now: '2026-07-17T00:00:00.000Z', itemMaster: store.getItemMaster() });
  assert.ok(edi.includes('IN*650044999'), 'uses the learned Walmart item number');
  assert.ok(edi.includes('TDS*2416'));
});

test('saveClaimDoc/readClaimDoc round-trips an uploaded file', () => {
  const file = { originalname: 'signed_bol.pdf', mimetype: 'application/pdf', size: 5, buffer: Buffer.from('hello') };
  const meta = store.saveClaimDoc('970-46226-0022', 'pod', file);
  assert.strictEqual(meta.have, true);
  assert.strictEqual(meta.kind, 'file');
  assert.strictEqual(meta.filename, 'signed_bol.pdf');
  const back = store.readClaimDoc('970-46226-0022', meta.storedName);
  assert.strictEqual(back.toString(), 'hello');
  store.deleteClaimDoc('970-46226-0022', meta.storedName);
  assert.strictEqual(store.readClaimDoc('970-46226-0022', meta.storedName), null);
});

test('a recovery matches despite zero-padded invoice numbers (real Retail Link format)', () => {
  // From real check 003896394: recoveries come back positive, coded 0022, under
  // the original invoice number — but Retail Link pads it to "000000000045342".
  store.addClaims([{ checkNumber: '941', invoice: '45342', code: '0022', amount: 141.03 }]);
  const matched = store.matchRepayments([{ invoice: '000000000045342', code: '0022', amount: 141.03 }], '003896394');
  assert.strictEqual(matched.length, 1);
  const claim = store.getClaims().claims.find((c) => c.id === '941-45342-0022');
  assert.strictEqual(claim.status, 'recovered');
  assert.strictEqual(claim.recoveredAmount, 141.03);
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

test('EDI config defaults to blank sender, Walmart receiver, and test mode', () => {
  const { edi } = store.getWalmartConfig();
  assert.strictEqual(edi.senderId, '', 'sender must start blank, never STAT\'s');
  assert.strictEqual(edi.receiverId, '925485US00');
  assert.strictEqual(edi.usage, 'T', 'defaults to test, not production');
});

test('saving EDI identity round-trips and keeps its defaults for unset fields', () => {
  const cfg = store.getWalmartConfig();
  store.saveWalmartConfig({ ...cfg, edi: { ...cfg.edi, senderId: 'ENDLESSFUN01', usage: 'P' } });
  const saved = store.getWalmartConfig();
  assert.strictEqual(saved.edi.senderId, 'ENDLESSFUN01');
  assert.strictEqual(saved.edi.usage, 'P');
  assert.strictEqual(saved.edi.receiverId, '925485US00'); // untouched default preserved
  // restore so later tests see the default
  store.saveWalmartConfig(cfg);
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
