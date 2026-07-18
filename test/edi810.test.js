'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildEdi810, resolveLineItems, upcFromMemo } = require('../server/edi810');

function parse(edi) {
  return edi.split('~').map((s) => s.trim()).filter(Boolean);
}

// A recovered dispute: $9.52 MBNS on invoice 46226, rebilled under 8980000.
const CLAIM = {
  id: '003983648-46226-0022',
  invoice: '46226',
  code: '0022',
  amount: 9.52,
  po: '9034794755',
  shipDate: '2026-06-01',
  newInvoice: '8980000',
};
const OPTS = { control: '900000123', now: '2026-07-17T09:30:00.000Z' };

test('resolveLineItems maps a clean single-SKU shortage to the Walmart item number', () => {
  // Only one invoice line at $9.52 -> unambiguous.
  const inv = [
    { description: 'MM STRAW CHOCO 4PK', quantity: 11, unitPrice: 9.52 },
    { description: 'MM VARIETY 24PK', quantity: 6, unitPrice: 24.16 },
  ];
  const { lines, needsItemDetail } = resolveLineItems(CLAIM, inv, {});
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].quantity, 1);
  assert.strictEqual(lines[0].itemNumber, '554935983'); // from the seeded master
  assert.strictEqual(needsItemDetail, false);
});

test('resolveLineItems falls back to a summary line when the SKU is ambiguous', () => {
  // Two different SKUs at $9.52 -> can't tell which was shorted.
  const inv = [
    { description: 'MM STRAW CHOCO 4PK', quantity: 5, unitPrice: 9.52 },
    { description: 'MM STRAW STRWBRY 4PK', quantity: 5, unitPrice: 9.52 },
  ];
  const { lines, needsItemDetail } = resolveLineItems(CLAIM, inv, {});
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].unitPrice, 9.52);
  assert.strictEqual(needsItemDetail, true);
});

test('explicit claim.items win over inference', () => {
  const claim = { ...CLAIM, items: [{ description: 'MM VARIETY 24PK', quantity: 1, unitPrice: 24.16 }] };
  const { lines } = resolveLineItems(claim, [], {});
  assert.strictEqual(lines[0].itemNumber, '650044391');
});

test('upcFromMemo pulls the location UPC out of a QBO memo', () => {
  assert.strictEqual(upcFromMemo('0078742031446'), '0078742031446');
  assert.strictEqual(upcFromMemo('Ship 7/16/2026 0078742039725 ABF PRO#200927288'), '0078742039725');
  assert.strictEqual(upcFromMemo(''), '');
});

test('buildEdi810 produces a valid, balanced X12 810 interchange', () => {
  const { edi, transactions, warnings } = buildEdi810(
    [{ claim: CLAIM, invoiceLines: [{ description: 'MM STRAW CHOCO 4PK', quantity: 11, unitPrice: 9.52 }], locationUpc: '0078742031446' }],
    OPTS
  );
  const segs = parse(edi);

  // Envelope wraps exactly one group and one transaction.
  assert.ok(segs[0].startsWith('ISA*00*'));
  assert.ok(segs[1].startsWith('GS*IN*'));
  assert.strictEqual(segs[segs.length - 2], 'GE*1*900000123');
  assert.strictEqual(segs[segs.length - 1], 'IEA*1*900000123');

  // BIG carries the rebill number and original PO.
  const big = segs.find((s) => s.startsWith('BIG*')).split('*');
  assert.strictEqual(big[2], '8980000'); // rebill invoice number
  assert.strictEqual(big[4], '9034794755'); // original PO

  // The line resolves to the Walmart item number, and TDS is the amount in cents.
  assert.ok(segs.some((s) => s === 'IT1**1*EA*9.520**IN*554935983'));
  assert.ok(segs.some((s) => s === 'PID*F****MM STRAW CHOCO 4PK'));
  assert.ok(segs.some((s) => s === 'TDS*952')); // $9.52
  assert.ok(segs.some((s) => s === 'CTT*1'));

  // SE segment count is accurate (X12 requires it to match).
  const stIdx = segs.findIndex((s) => s.startsWith('ST*810*'));
  const seIdx = segs.findIndex((s) => s.startsWith('SE*'));
  const se = segs[seIdx].split('*');
  assert.strictEqual(Number(se[1]), seIdx - stIdx + 1); // inclusive count
  assert.strictEqual(se[2], '0001'); // control matches ST

  assert.strictEqual(transactions.length, 1);
  assert.strictEqual(transactions[0].total, 9.52);
  assert.strictEqual(warnings.length, 0);
});

test('a multi-claim batch numbers transactions and reports ambiguous ones', () => {
  const c2 = { ...CLAIM, id: 'x-2', invoice: '46300', newInvoice: '8980001', amount: 19.04 };
  const { edi, transactions, warnings } = buildEdi810(
    [
      { claim: CLAIM, invoiceLines: [{ description: 'MM STRAW CHOCO 4PK', quantity: 11, unitPrice: 9.52 }], locationUpc: '0078742031446' },
      { claim: c2, invoiceLines: [] }, // no invoice lines -> summary fallback -> flagged
    ],
    OPTS
  );
  const segs = parse(edi);
  assert.strictEqual(segs.filter((s) => s.startsWith('ST*810*')).length, 2);
  assert.deepStrictEqual(
    segs.filter((s) => s.startsWith('ST*810*')).map((s) => s.split('*')[2]),
    ['0001', '0002']
  );
  assert.strictEqual(segs[segs.length - 2], 'GE*2*900000123');
  assert.strictEqual(transactions.length, 2);
  assert.strictEqual(warnings.length, 1); // the second claim is flagged
});
