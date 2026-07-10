'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseCsv,
  parseAmount,
  normalizeDate,
  guessMapping,
  normalizeChecks,
} = require('../server/csvParser');
const { buildDeposit } = require('../server/deposit');

test('parseAmount handles currency, commas, parens, and blanks', () => {
  assert.strictEqual(parseAmount('$1,234.56'), 1234.56);
  assert.strictEqual(parseAmount('(50.00)'), -50);
  assert.strictEqual(parseAmount('100-'), -100);
  assert.strictEqual(parseAmount(''), 0);
  assert.strictEqual(parseAmount('  $ 2,000 '), 2000);
  assert.strictEqual(parseAmount(42), 42);
});

test('normalizeDate converts common formats to ISO', () => {
  assert.strictEqual(normalizeDate('07/01/2026'), '2026-07-01');
  assert.strictEqual(normalizeDate('7/1/26'), '2026-07-01');
  assert.strictEqual(normalizeDate('2026-07-01'), '2026-07-01');
  assert.strictEqual(normalizeDate('7-1-2026'), '2026-07-01');
});

test('guessMapping picks sensible columns from headers', () => {
  const headers = ['Payment Date', 'Check Number', 'Gross Sales', 'Walmart Fees', 'Net Amount', 'Memo'];
  const map = guessMapping(headers);
  assert.strictEqual(map.date, 'Payment Date');
  assert.strictEqual(map.reference, 'Check Number');
  assert.strictEqual(map.gross, 'Gross Sales');
  assert.strictEqual(map.fees, 'Walmart Fees');
  assert.strictEqual(map.net, 'Net Amount');
  assert.strictEqual(map.memo, 'Memo');
});

test('normalizeChecks groups by reference and computes totals', () => {
  const csv = [
    'Payment Date,Check Number,Gross Sales,Walmart Fees,Net Amount',
    '07/08/2026,CHK1,"$3,105.00","$465.75","$2,639.25"',
    '07/08/2026,CHK1,"$1,000.00","$150.00","$850.00"',
    '07/15/2026,CHK2,"$6,980.20","$1,047.03","$5,933.17"',
  ].join('\n');
  const { rows } = parseCsv(csv);
  const map = guessMapping(Object.keys(rows[0]));
  const { checks } = normalizeChecks(rows, map, { groupByReference: true });

  assert.strictEqual(checks.length, 2);
  const chk1 = checks.find((c) => c.reference === 'CHK1');
  assert.strictEqual(chk1.gross, 4105);
  assert.strictEqual(chk1.fees, 615.75);
  assert.strictEqual(chk1.net, 3489.25);
  assert.strictEqual(chk1.lineItemCount, 2);
  assert.ok(chk1.valid, 'grouped check should be valid');
});

test('normalizeChecks flags a missing reference and bad net', () => {
  const csv = ['Date,Ref,Net', '07/01/2026,,0'].join('\n');
  const { rows } = parseCsv(csv);
  const { checks } = normalizeChecks(rows, { date: 'Date', reference: 'Ref', net: 'Net' });
  assert.strictEqual(checks[0].valid, false);
  assert.ok(checks[0].issues.some((i) => /reference/i.test(i)));
  assert.ok(checks[0].issues.some((i) => /positive/i.test(i)));
});

test('buildDeposit produces a balanced deposit equal to net', () => {
  const check = { reference: 'CHK1', date: '2026-07-08', gross: 4105, fees: 615.75, net: 3489.25, memo: 'W24', lineItemCount: 2 };
  const payload = buildDeposit(check, { bank: '35', income: '79', fees: '80' });
  assert.strictEqual(payload.DepositToAccountRef.value, '35');
  assert.strictEqual(payload.Line.length, 2);
  assert.strictEqual(payload.Line[0].Amount, 4105);
  assert.strictEqual(payload.Line[1].Amount, -615.75);
  const total = payload.Line.reduce((s, l) => s + l.Amount, 0);
  assert.strictEqual(Math.round(total * 100) / 100, 3489.25);
});

test('buildDeposit refuses an unbalanced deposit', () => {
  const check = { reference: 'X', date: '2026-07-08', gross: 100, fees: 10, net: 999, lineItemCount: 1 };
  assert.throws(() => buildDeposit(check, { bank: '1', income: '2', fees: '3' }), /unbalanced|does not equal/i);
});

test('buildDeposit skips the fee line when there are no fees', () => {
  const check = { reference: 'Y', date: '2026-07-08', gross: 500, fees: 0, net: 500, lineItemCount: 1 };
  const payload = buildDeposit(check, { bank: '1', income: '2' });
  assert.strictEqual(payload.Line.length, 1);
});
