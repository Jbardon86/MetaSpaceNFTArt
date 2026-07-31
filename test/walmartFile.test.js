'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const { parseRemittance, extractCheckNumber, findHeaderRow } = require('../server/walmartFile');
const { allocateCheck } = require('../server/allocator');

// Synthetic remittance (fake invoice numbers/amounts) with the same shape and
// quirks as a real Walmart file: header row, one payment line per invoice, and
// deduction lines carrying a bracketed code — plus a standalone chargeback.
const HEADERS = ['PO Number','Invoice Number','DC Number','Store Number','Division',
  'Microfilm Number','Invoice Date','Invoice Amount($)','Date Paid','Discount($)','Amount Paid($)','DEDUCTION CODE'];
const DATA = [
  ['9000000001','90001','6000','8000','5','28','2026-06-01',-2.00,'2026-06-20',0,-2.00,'PRICE DIFFERENCE AS DOCUMENTED [0100]'],
  ['9000000001','90001','6000','8000','5','111','2026-06-01',100.00,'2026-06-20',2.00,98.00,''],
  ['9000000002','90002','6000','8000','5','25','2026-06-02',-50.00,'2026-06-20',0,-50.00,'MERCHANDISE BILLED NOT SHIPPED [0022]'],
  ['9000000002','90002','6000','8000','5','222','2026-06-02',200.00,'2026-06-20',4.00,196.00,''],
  ['9000000003','90003','6000','8000','5','25','2026-06-03',-10.00,'2026-06-20',0,-10.00,'MERCHANDISE BILLED NOT SHIPPED [0022]'],
];
// Expected (invoices paid in full): UF = 100 + 200 = 300
//           deposit = 300 - 8 (writeoff: disc+accept) - 50 (disp 90002) - 10 (90003) = 232
//           remittance net = -2 +98 -50 +196 -10 = 232  -> balanced

const DECODER = {
  '0100': { description: 'Price Difference As Documented', category: 'accept' },
  '0022': { description: 'Merchandise Billed Not Shipped', category: 'dispute' },
};

async function buildXlsxBuffer(sheetName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName || 'Sheet1');
  ws.addRow(HEADERS);
  DATA.forEach((r) => ws.addRow(r));
  return wb.xlsx.writeBuffer();
}

test('extractCheckNumber preserves leading zeros', () => {
  assert.strictEqual(extractCheckNumber('Check_004041349.xls'), '004041349');
  assert.strictEqual(extractCheckNumber('62326_ck_004041349.xlsx'), '004041349');
});

test('findHeaderRow locates the Walmart header row', () => {
  const { rowIndex, colMap } = findHeaderRow([['garbage'], HEADERS, ...DATA]);
  assert.strictEqual(rowIndex, 1);
  assert.strictEqual(colMap.invoice, 1);
  assert.strictEqual(colMap.amountPaid, 10);
  assert.strictEqual(colMap.deductionCode, 11);
});

test('parseRemittance reads an xlsx into normalized rows', async () => {
  const buf = await buildXlsxBuffer('Check_000123456');
  const parsed = await parseRemittance(Buffer.from(buf), 'check_000123456.xlsx');
  assert.strictEqual(parsed.checkNumber, '000123456');
  assert.strictEqual(parsed.rows.length, 5);
  const payment = parsed.rows.find((r) => r.invoice === '90001' && !r.deductionCode);
  assert.strictEqual(payment.invoiceAmount, 100);
  assert.strictEqual(payment.amountPaid, 98);
});

test('parsed xlsx flows through the allocator and balances', async () => {
  const buf = await buildXlsxBuffer('Check_000123456');
  const parsed = await parseRemittance(Buffer.from(buf), 'check_000123456.xlsx');
  const plan = allocateCheck(parsed.rows, DECODER, { deductionsBucket: 'Disputed AR' }, {});
  assert.strictEqual(plan.receivePayment.total, 300);
  assert.strictEqual(plan.bankDeposit.total, 232);
  assert.strictEqual(plan.reconciliation.remittanceNet, 232);
  assert.ok(plan.reconciliation.balanced);
  // standalone chargeback 90003 has a dispute line but no payment invoice
  assert.ok(plan.bankDeposit.lines.some((l) => l.type === 'disputed-deduction' && l.invoice === '90003'));
  assert.ok(!plan.receivePayment.invoices.some((i) => i.invoice === '90003'));
});

test('an HTML-for-Excel .xls (Retail Link "To Excel") parses the same way', async () => {
  // Retail Link serves an HTML <table> saved as .xls with padded numbers.
  const cell = (v) => `<td>${String(v)}</td>`;
  const trs = [HEADERS, ...DATA.map((r) => r.map((c, i) => (i === 1 ? '00000000' + c : c)))]
    .map((r) => `<tr>${r.map(cell).join('')}</tr>`)
    .join('');
  const html =
    '﻿<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><xml><x:ExcelWorkbook>' +
    '<x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Check_003996479.xls</x:Name></x:ExcelWorksheet>' +
    `</x:ExcelWorksheets></x:ExcelWorkbook></xml></head><body><table>${trs}</table></body></html>`;
  const parsed = await parseRemittance(Buffer.from(html, 'utf8'), 'Check_003996479.xls');
  assert.strictEqual(parsed.checkNumber, '003996479');
  assert.strictEqual(parsed.rows.length, 5);
  assert.strictEqual(parsed.rows[0].invoice, '90001'); // padding stripped
  const plan = allocateCheck(parsed.rows, DECODER, {}, {});
  assert.strictEqual(plan.bankDeposit.total, 232); // identical result to xlsx/csv
});

test('CSV export of the remittance parses the same way', async () => {
  const csv = [HEADERS.join(',')]
    .concat(DATA.map((r) => r.map((c) => (typeof c === 'string' && c.includes(',') ? `"${c}"` : c)).join(',')))
    .join('\n');
  const parsed = await parseRemittance(Buffer.from(csv, 'utf8'), 'remittance.csv');
  assert.strictEqual(parsed.rows.length, 5);
  const plan = allocateCheck(parsed.rows, DECODER, {}, {});
  assert.strictEqual(plan.bankDeposit.total, 232);
});
