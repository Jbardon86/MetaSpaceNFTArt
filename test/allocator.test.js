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

const ACCOUNTS_WITH_FEES = {
  ...ACCOUNTS,
  feeAccounts: { advertising: 'Marketing', compliance: 'Walmart Compliance', default: 'Marketing' },
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

// --- Recovered dispute coming back under its rebill number ------------------

test('a positive line on a rebill number is a repayment, tied to the original', () => {
  const rebillIndex = { '8980000': { invoice: '46226', code: '0022', description: 'Merchandise Billed Not Shipped' } };
  // No deduction code — Walmart just pays the re-invoice like any invoice.
  const line = { invoice: '8980000', invoiceAmount: 9.52, discount: 0, amountPaid: 9.52, deductionCode: '' };
  const c = classifyLine(line, DECODER, rebillIndex);
  assert.strictEqual(c.category, 'repayment');
  assert.strictEqual(c.originalInvoice, '46226'); // tied back to the real invoice
  assert.strictEqual(c.rebillInvoice, '8980000');
  assert.strictEqual(c.code, '0022');
});

test('an uncoded positive line NOT matching a rebill stays an ordinary payment', () => {
  const line = { invoice: '46500', invoiceAmount: 100, discount: 0, amountPaid: 100, deductionCode: '' };
  assert.strictEqual(classifyLine(line, DECODER, { '8980000': { invoice: '1', code: '0022' } }).category, 'payment');
});

test('a recovered dispute books to Disputed AR, not a phantom invoice, and balances', () => {
  const rebillIndex = { '8980000': { invoice: '46226', code: '0022', description: 'Merchandise Billed Not Shipped' } };
  const rows = [
    // a normal invoice being paid this cycle
    { po: 'P1', invoice: '46600', invoiceAmount: 500, discount: 10, amountPaid: 490, deductionCode: '' },
    // last cycle's dispute, now recovered, arriving under the rebill number
    { po: 'P0', invoice: '8980000', invoiceAmount: 9.52, discount: 0, amountPaid: 9.52, deductionCode: '' },
  ];
  const plan = allocateCheck(rows, DECODER, ACCOUNTS, { checkNumber: 'C1', datePaid: '2026-07-17' }, rebillIndex);

  // The rebill line is a repayment — NOT an invoice in the Receive Payment.
  assert.strictEqual(plan.receivePayment.invoices.length, 1);
  assert.strictEqual(plan.receivePayment.invoices[0].invoice, '46600');
  assert.ok(!plan.receivePayment.invoices.some((i) => i.invoice === '8980000'), 'rebill is never a payment invoice');

  // It books a positive line to Disputed AR, tagged with the ORIGINAL invoice.
  const repay = plan.bankDeposit.lines.find((l) => l.type === 'repaid-dispute');
  assert.ok(repay, 'deposit has a recovered-dispute line');
  assert.strictEqual(repay.amount, 9.52);
  assert.strictEqual(repay.account, 'Disputed AR');
  assert.strictEqual(repay.invoice, '46226');
  assert.strictEqual(repay.rebillInvoice, '8980000');

  // plan.repayments carries both numbers so the claim can be matched either way.
  assert.strictEqual(plan.repayments.length, 1);
  assert.strictEqual(plan.repayments[0].invoice, '46226');
  assert.strictEqual(plan.repayments[0].rebillInvoice, '8980000');

  // Still ties to the ACH: 490 (net invoice) + 9.52 (recovery) = 499.52.
  assert.strictEqual(plan.reconciliation.remittanceNet, 499.52);
  assert.strictEqual(plan.bankDeposit.total, 499.52);
  assert.strictEqual(plan.reconciliation.balanced, true);
});

test('full allocation of check 004041349 ties out to the ACH', () => {
  const plan = allocateCheck(ROWS, DECODER, ACCOUNTS, { checkNumber: '004041349', datePaid: '2026-06-23' });

  // Receive Payment -> Undeposited Funds (invoices paid IN FULL)
  assert.strictEqual(plan.receivePayment.total, 3517.11); // sum of the 5 invoice amounts
  assert.strictEqual(plan.receivePayment.invoices.length, 5); // 46595 has no payment
  const inv46364 = plan.receivePayment.invoices.find((i) => i.invoice === '46364');
  assert.strictEqual(inv46364.appliedToUndepositedFunds, 756.04); // full invoice
  assert.strictEqual(inv46364.writeOff, 17.10); // 15.27 discount + 1.83 accepted (booked on deposit)

  // Deposit carries the write-off as a line to the write-off account
  const writeoffLine = plan.bankDeposit.lines.find((l) => l.type === 'writeoff');
  assert.ok(writeoffLine, 'deposit has a write-off line');
  assert.strictEqual(writeoffLine.amount, -77.44); // total discounts + accepted
  assert.strictEqual(writeoffLine.account, 'Merchant Deposit Fees');

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

test('fee codes route to their mapped expense account (advertising vs compliance)', () => {
  const decoder = {
    ...DECODER,
    '0055': { description: 'Advertising Allowance', category: 'fee', feeAccount: 'advertising' },
    '0077': { description: 'Compliance / OTIF Fine', category: 'fee', feeAccount: 'compliance' },
  };
  const rows = [
    { po: '1', invoice: '', invoiceAmount: 0, discount: 0, amountPaid: -300.0, deductionCode: 'ADVERTISING ALLOWANCE [0055]' },
    { po: '2', invoice: '', invoiceAmount: 0, discount: 0, amountPaid: -125.0, deductionCode: 'OTIF FINE [0077]' },
    { po: '3', invoice: '5000', invoiceAmount: 1000, discount: 0, amountPaid: 1000, deductionCode: '' },
  ];
  const plan = allocateCheck(rows, decoder, ACCOUNTS_WITH_FEES, {});
  const adv = plan.bankDeposit.lines.find((l) => l.code === '0055');
  const comp = plan.bankDeposit.lines.find((l) => l.code === '0077');
  assert.strictEqual(adv.account, 'Marketing');
  assert.strictEqual(adv.amount, -300.0);
  assert.strictEqual(comp.account, 'Walmart Compliance');
  assert.strictEqual(comp.amount, -125.0);
  // deposit = 1000 (UF) - 300 - 125 = 575
  assert.strictEqual(plan.bankDeposit.total, 575.0);
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
