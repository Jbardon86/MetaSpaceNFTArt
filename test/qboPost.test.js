'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { allocateCheck } = require('../server/allocator');
const { buildPayment, buildDeposit, postPlan } = require('../server/qboPost');

const ROWS = [
  { po: 'a', invoice: '46364', invoiceAmount: 756.04, discount: 15.27, amountPaid: 740.77, deductionCode: '' },
  { po: 'a', invoice: '46364', invoiceAmount: -1.83, discount: 0, amountPaid: -1.83, deductionCode: 'PRICE DIFFERENCE AS DOCUMENTED [0100]' },
  { po: 'b', invoice: '46367', invoiceAmount: 785.03, discount: 15.86, amountPaid: 769.17, deductionCode: '' },
  { po: 'b', invoice: '46367', invoiceAmount: -218.96, discount: 0, amountPaid: -218.96, deductionCode: 'MERCHANDISE BILLED NOT SHIPPED [0022]' },
];
const DECODER = {
  '0100': { description: 'Price Difference As Documented', category: 'accept' },
  '0022': { description: 'Merchandise Billed Not Shipped', category: 'dispute' },
};
const ACCOUNTS = { bank: 'American National', undepositedFunds: 'Undeposited Funds', deductionsBucket: 'Disputed AR', paymentWriteOff: 'Merchant Deposit Fees' };

function plan() {
  return allocateCheck(ROWS, DECODER, ACCOUNTS, { checkNumber: '004041349', datePaid: '2026-06-23' });
}

test('buildPayment applies each invoice in full, one line per invoice, into Undeposited Funds', () => {
  const pay = buildPayment({
    customerId: '7',
    undepositedFundsId: '90',
    txnDate: '2026-06-23',
    checkNumber: '004041349',
    invoices: [
      { invoiceId: '101', invoiceDoc: '46364', cash: 756.04 },
      { invoiceId: '102', invoiceDoc: '46367', cash: 785.03 },
    ],
  });
  assert.strictEqual(pay.DepositToAccountRef.value, '90');
  assert.strictEqual(pay.TotalAmt, 1541.07); // full invoice amounts
  assert.strictEqual(pay.Line.length, 2); // one line per invoice, no credit memos
  assert.strictEqual(pay.Line[0].Amount, 756.04);
  assert.strictEqual(pay.Line[0].LinkedTxn[0].TxnType, 'Invoice');
  assert.ok(pay.Line.every((l) => l.LinkedTxn.length === 1));
});

test('buildDeposit sweeps the payment and adds adjustment lines', () => {
  const { payload, total } = buildDeposit({
    bankId: '35',
    txnDate: '2026-06-23',
    checkNumber: '004041349',
    paymentId: '500',
    undepositedTotal: 3439.67,
    adjustments: [{ accountId: '80', amount: -266.20, description: 'Disputed' }],
  });
  assert.strictEqual(payload.DepositToAccountRef.value, '35');
  assert.strictEqual(payload.Line[0].LinkedTxn[0].TxnId, '500');
  assert.strictEqual(payload.Line[1].DepositLineDetail.AccountRef.value, '80');
  assert.strictEqual(total, 3173.47);
});

test('postPlan dry-run builds all payloads and ties out without posting', async () => {
  const accountIds = { 'Undeposited Funds': '90', 'American National': '35', 'Disputed AR': '80', 'Merchant Deposit Fees': '81' };
  let created = 0;
  const deps = {
    findCustomerId: async () => '7',
    findInvoiceId: async (doc) => ({ '46364': '101', '46367': '102' }[doc] || null),
    accountIdFor: (label) => accountIds[label] || null,
    ensureCustomerId: async () => { created++; return '7'; },
    ensureWriteOffItemId: async () => { created++; return '42'; },
    createCreditMemo: async () => { created++; return { Id: 'cm' }; },
    createPayment: async () => { created++; return { Id: 'pay' }; },
    createDeposit: async () => { created++; return { Id: 'dep' }; },
  };

  const report = await postPlan(plan(), deps, { dryRun: true });
  assert.strictEqual(created, 0, 'dry run must not create anything');
  assert.strictEqual(report.dryRun, true);
  // 2 invoices paid in full (1541.07) - writeoff 32.96 - disputed 218.96 = 1289.15
  assert.strictEqual(report.payloads.payment.TotalAmt, 1541.07);
  assert.strictEqual(report.depositTotal, 1289.15);
  assert.ok(report.balanced);
  assert.strictEqual(report.payloads.payment.Line.length, 2);
  assert.strictEqual(report.warnings.length, 0);
});

test('postPlan flags a missing invoice instead of failing', async () => {
  const deps = {
    findCustomerId: async () => '7',
    findInvoiceId: async (doc) => (doc === '46364' ? '101' : null), // 46367 missing
    accountIdFor: (label) => ({ 'Undeposited Funds': '90', 'American National': '35', 'Disputed AR': '80' }[label] || null),
  };
  const report = await postPlan(plan(), deps, { dryRun: true });
  assert.ok(report.warnings.some((w) => /46367 not found/.test(w)));
});

test('postPlan refuses to post when codes are unclassified', async () => {
  const rows = ROWS.concat([{ po: 'z', invoice: '99', invoiceAmount: -5, discount: 0, amountPaid: -5, deductionCode: 'NEW THING [0099]' }]);
  const p = allocateCheck(rows, DECODER, ACCOUNTS, { checkNumber: 'x', datePaid: '2026-06-23' });
  await assert.rejects(() => postPlan(p, {}, { dryRun: true }), /unmapped codes/);
});
