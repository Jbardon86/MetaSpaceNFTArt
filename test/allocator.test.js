'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { allocateCheck, classifyLine, extractCode } = require('../server/allocator');

// The real check 004041349, as rows (po, invoice, invoiceAmount, discount,
// amountPaid, deductionCode).
const ROWS = [
  { po: '4634796325', invoice: '46364', invoiceAmount: -1.83, discount: 0, amountPaid: -1.83, deductionCode: 'PRICE DIFFERENCE AS DOCUMENTED [0100]' },
  { po: '4634796325', invoice: '46364', invoiceAmount: 756.04, discount: 15.27, amountPaid: 740.77, deductionCode: '' },
  { po: '7384737814', invoice: '46367', invoiceAmount: -218.96, discount: 0, amountPaid: -218.96, deductionCode: 'MERCHANDISE BILLED NOT SHIPPED [0022]' },
  { po: '7384737814', invoice: '46367', invoiceAmount: 785.03, discount: 15.86, amountPaid: 769.17, deductionCode: '' },
  { po: '1734659443', invoice: '46391', invoiceAmount: -1.08, discount: 0, amountPaid: -1.08, deductionCode: 'PRICE DIFFERENCE AS DOCUMENTED [0100]' },
  { po: '1734659443', invoice: '46391', invoiceAmount: -19.04, discount: 0, amountPaid: -19.04, deductionCode: 'MERCHANDISE BILLED NOT SHIPPED [0022]' },
  { po: '1734659443', invoice: '46391', invoiceAmount: 545.13, discount: 11.01, amountPaid: 534.12, deductionCode: '' },
  { po: '2634844588', invoice: '46408', invoiceAmount: -1.86, discount: 0, amountPaid: -1.86, deductionCode: 'PRICE DIFFERENCE AS DOCUMENTED [0100]' },
  { po: '2634844588', invoice: '46408', invoiceAmount: 766.18, discount: 15.48, amountPaid: 750.70, deductionCode: '' },
  { po: '6534972470', invoice: '46412', invoiceAmount: -1.62, discount: 0, amountPaid: -1.62, deductionCode: 'PRICE DIFFERENCE AS DOCUMENTED [0100]' },
  { po: '6534972470', invoice: '46412', invoiceAmount: 664.73, discount: 13.43, amountPaid: 651.30, deductionCode: '' },
  { po: '7139831885', invoice: '46595', invoiceAmount: -28.20, discount: 0, amountPaid: -28.20, deductionCode: 'MERCHANDISE BILLED NOT SHIPPED [0022]' },
];

const DECODER = {
  '0100': { description: 'Price Difference As Documented', category: 'accept' },
  '0022': { description: 'Merchandise Billed Not Shipped', category: 'dispute' },
};

const ACCOUNTS = {
  bank: 'Checking',
  undepositedFunds: 'Undeposited Funds',
  deductionsBucket: 'Disputed AR',
  discount: 'Discounts Given',
  acceptWriteoff: 'Deduction Write-offs',
  feeAccounts: { default: 'Walmart Fees' },
};

test('extractCode pulls the bracketed code', () => {
  assert.strictEqual(extractCode('MERCHANDISE BILLED NOT SHIPPED [0022]'), '0022');
  assert.strictEqual(extractCode('PRICE DIFFERENCE AS DOCUMENTED [0100]'), '0100');
  assert.strictEqual(extractCode(''), '');
});

test('classifyLine routes payment / accept / dispute correctly', () => {
  assert.strictEqual(classifyLine(ROWS[1], DECODER).category, 'payment');   // positive, no code
  assert.strictEqual(classifyLine(ROWS[0], DECODER).category, 'accept');     // 0100
  assert.strictEqual(classifyLine(ROWS[2], DECODER).category, 'dispute');    // 0022
});

test('a positive coded line is treated as a repayment', () => {
  const repay = { invoice: '46367', invoiceAmount: 0, discount: 0, amountPaid: 218.96, deductionCode: 'MERCHANDISE BILLED NOT SHIPPED [0022]' };
  assert.strictEqual(classifyLine(repay, DECODER).category, 'repayment');
});

test('unknown code comes back unclassified (never silently posted)', () => {
  const weird = { invoice: '999', invoiceAmount: -5, discount: 0, amountPaid: -5, deductionCode: 'SOME NEW THING [0099]' };
  assert.strictEqual(classifyLine(weird, DECODER).category, 'unclassified');
});

test('full allocation of check 004041349 ties out to the ACH', () => {
  const plan = allocateCheck(ROWS, DECODER, ACCOUNTS, { checkNumber: '004041349', datePaid: '2026-06-23' });

  // Receive Payment -> Undeposited Funds
  assert.strictEqual(plan.receivePayment.total, 3439.67);
  assert.strictEqual(plan.receivePayment.invoices.length, 5); // 46595 has no payment
  const inv46364 = plan.receivePayment.invoices.find((i) => i.invoice === '46364');
  assert.strictEqual(inv46364.appliedToUndepositedFunds, 738.94);
  assert.strictEqual(inv46364.writeOff, 17.10); // 15.27 discount + 1.83 accepted

  // Bank Deposit
  assert.strictEqual(plan.bankDeposit.total, 3173.47);

  // Disputes total 266.20, all routed to Disputed AR as negatives
  const disputeLines = plan.bankDeposit.lines.filter((l) => l.type === 'disputed-deduction');
  assert.strictEqual(disputeLines.length, 3);
  assert.ok(disputeLines.every((l) => l.account === 'Disputed AR' && l.amount < 0));
  const disputeTotal = disputeLines.reduce((s, l) => s + l.amount, 0);
  assert.strictEqual(Math.round(disputeTotal * 100) / 100, -266.20);

  // Reconciliation: deposit total == sum of Amount Paid on the remittance
  assert.strictEqual(plan.reconciliation.remittanceNet, 3173.47);
  assert.ok(plan.reconciliation.balanced);
  assert.strictEqual(plan.reconciliation.difference, 0);

  // 46595 standalone chargeback: a dispute line exists, no payment invoice
  assert.ok(disputeLines.some((l) => l.invoice === '46595' && l.amount === -28.20));
  assert.ok(!plan.receivePayment.invoices.some((i) => i.invoice === '46595'));
});

test('repayments increase the deposit and clear Disputed AR', () => {
  const rowsWithRepay = ROWS.concat([
    { po: '111', invoice: '46000', invoiceAmount: 0, discount: 0, amountPaid: 50.0, deductionCode: 'MERCHANDISE BILLED NOT SHIPPED [0022]' },
  ]);
  const plan = allocateCheck(rowsWithRepay, DECODER, ACCOUNTS, {});
  const repayLine = plan.bankDeposit.lines.find((l) => l.type === 'repaid-dispute');
  assert.strictEqual(repayLine.amount, 50.0);
  assert.strictEqual(repayLine.account, 'Disputed AR');
  // deposit grows by the repayment
  assert.strictEqual(plan.bankDeposit.total, 3223.47);
});
