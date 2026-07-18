'use strict';

// Reads a Walmart remittance file (the .xls/.xlsx Walmart sends, or a CSV
// export of it) and turns it into the normalized rows the allocator consumes.
//
// Walmart's layout (one row per invoice line; deduction lines carry a code):
//   PO Number | Invoice Number | DC Number | Store Number | Division |
//   Microfilm Number | Invoice Date | Invoice Amount($) | Date Paid |
//   Discount($) | Amount Paid($) | DEDUCTION CODE
//
// Column order/spelling can drift, so we match by header text, not position.

const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { parseAmount } = require('./csvParser');

// field -> regex that identifies its header
const HEADER_PATTERNS = {
  po: /po\s*number/i,
  invoice: /invoice\s*number/i,
  dc: /dc\s*number/i,
  store: /store\s*number/i,
  division: /division/i,
  microfilm: /microfilm/i,
  invoiceDate: /invoice\s*date/i,
  invoiceAmount: /invoice\s*amount/i,
  datePaid: /date\s*paid/i,
  discount: /discount/i,
  amountPaid: /amount\s*paid/i,
  deductionCode: /deduction\s*code/i,
};

function matchHeaders(headerCells) {
  // headerCells: array of {index, text}
  const map = {};
  for (const field of Object.keys(HEADER_PATTERNS)) {
    const pat = HEADER_PATTERNS[field];
    const hit = headerCells.find((h) => h.text && pat.test(h.text));
    if (hit) map[field] = hit.index;
  }
  return map;
}

function toISODate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (us) {
    let [, m, d, y] = us;
    if (y.length === 2) y = '20' + y;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  return s;
}
function pad(n) {
  return String(n).padStart(2, '0');
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  return parseAmount(value);
}

/**
 * Pull the check/ACH number out of a sheet name or filename like
 * "Check_004041349.xls" or "62326_ck_004041349.xlsx".
 */
function extractCheckNumber(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const s = String(c);
    let m = s.match(/check[_\s-]*(\d{4,})/i) || s.match(/ck[_\s-]*(\d{4,})/i);
    if (m) return m[1];
  }
  // fall back to the longest digit run in the first candidate
  for (const c of candidates) {
    if (!c) continue;
    const runs = String(c).match(/\d{5,}/g);
    if (runs) return runs.sort((a, b) => b.length - a.length)[0];
  }
  return '';
}

function rowsFromMatrix(matrix, headerRowIndex, colMap) {
  const rows = [];
  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const cells = matrix[r];
    if (!cells || cells.every((c) => c === null || c === undefined || String(c).trim() === '')) {
      continue;
    }
    const cell = (field) => (colMap[field] != null ? cells[colMap[field]] : undefined);
    const invoice = cell('invoice');
    // skip trailing total/summary rows that have no invoice number
    if (invoice == null || String(invoice).trim() === '') continue;

    rows.push({
      po: str(cell('po')),
      invoice: normInvoice(invoice),
      dc: str(cell('dc')),
      store: str(cell('store')),
      division: str(cell('division')),
      microfilm: str(cell('microfilm')),
      invoiceDate: toISODate(cell('invoiceDate')),
      invoiceAmount: num(cell('invoiceAmount')),
      datePaid: toISODate(cell('datePaid')),
      discount: num(cell('discount')),
      amountPaid: num(cell('amountPaid')),
      deductionCode: str(cell('deductionCode')),
    });
  }
  return rows;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

// Invoice numbers arrive zero-padded from Retail Link ("000000000045342") but
// clean from other exports ("45342") and in QuickBooks ("45342"). Canonicalize
// to the unpadded form so the QBO invoice lookup and — critically — recovery
// matching (a repayment referencing the original invoice) always line up.
function normInvoice(v) {
  const s = str(v);
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') || '0' : s;
}

/**
 * Find the header row in a matrix (first row that matches >= 4 known headers).
 */
function findHeaderRow(matrix) {
  for (let r = 0; r < Math.min(matrix.length, 15); r++) {
    const cells = (matrix[r] || []).map((c, i) => ({ index: i, text: str(c) }));
    const map = matchHeaders(cells);
    if (Object.keys(map).length >= 4) return { rowIndex: r, colMap: map };
  }
  return { rowIndex: -1, colMap: {} };
}

/**
 * Parse an .xlsx/.xls workbook buffer.
 * @returns {Promise<{checkNumber, datePaid, rows, sheetName}>}
 */
async function parseWorkbook(buffer, filename) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets.');

  const matrix = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    // row.values is 1-indexed; drop the leading empty slot
    const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
    matrix.push(vals.map((v) => (v && v.text ? v.text : v))); // unwrap rich text
  });

  const { rowIndex, colMap } = findHeaderRow(matrix);
  if (rowIndex === -1) {
    throw new Error('Could not find the Walmart column headers (PO Number, Invoice Number, ...).');
  }
  const rows = rowsFromMatrix(matrix, rowIndex, colMap);
  return finalize(rows, wb, ws, filename);
}

/**
 * Parse a CSV export of the remittance.
 */
function parseCsvText(text, filename) {
  const records = parseCsv(text, { skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  const matrix = records; // array of arrays
  const { rowIndex, colMap } = findHeaderRow(matrix);
  if (rowIndex === -1) {
    throw new Error('Could not find the Walmart column headers in the CSV.');
  }
  const rows = rowsFromMatrix(matrix, rowIndex, colMap);
  return finalize(rows, null, null, filename);
}

function finalize(rows, wb, ws, filename) {
  const checkNumber = extractCheckNumber(ws && ws.name, wb && wb.title, filename);
  const datePaid = rows.map((r) => r.datePaid).find(Boolean) || '';
  return { checkNumber, datePaid, rows, sheetName: ws ? ws.name : undefined };
}

/**
 * Entry point: sniff by filename extension and parse accordingly.
 */
async function parseRemittance(buffer, filename = '') {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) {
    return parseCsvText(buffer.toString('utf8'), filename);
  }
  // default to workbook (covers .xlsx and the .xls-named files Walmart sends,
  // which are really xlsx under the hood)
  return parseWorkbook(buffer, filename);
}

module.exports = {
  parseRemittance,
  parseWorkbook,
  parseCsvText,
  extractCheckNumber,
  findHeaderRow,
  matchHeaders,
};
