'use strict';

// Turns an uploaded Walmart payment spreadsheet into a normalized list of
// "checks" ready to be posted as Bank Deposits.
//
// Walmart / bank exports vary a lot, so nothing here is hard-coded to one
// layout. Instead we:
//   1. parse the CSV into header + rows
//   2. guess which column is which (date, reference, amounts, ...)
//   3. let the UI confirm/override that mapping
//   4. normalize + optionally group multiple line-items into one check

const { parse } = require('csv-parse/sync');

/**
 * Parse raw CSV text into { headers, rows } where each row is an object keyed
 * by header name.
 */
function parseCsv(text) {
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });
  const headers = records.length ? Object.keys(records[0]) : [];
  return { headers, rows: records };
}

/**
 * Parse a money-ish string into a Number. Handles "$1,234.56", "(50.00)"
 * (accounting negative), trailing minus, and blanks.
 */
function parseAmount(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  let s = String(value).trim();
  if (!s) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, '');
  }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return 0;
  return negative ? -n : n;
}

/**
 * Best-effort conversion of a date cell into ISO yyyy-mm-dd (what the QBO API
 * expects). Falls back to the original string if it can't be understood.
 */
function normalizeDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  // Already ISO.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // US style m/d/yyyy or m-d-yyyy.
  const us = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/);
  if (us) {
    let [, m, d, y] = us;
    if (y.length === 2) y = '20' + y;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return s;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

const FIELD_HINTS = {
  reference: ['check', 'chk', 'payment id', 'payment number', 'reference', 'ref', 'settlement id', 'txn id', 'transaction id', 'trace', 'eft'],
  date: ['date', 'paid', 'payment date', 'deposit date', 'posted'],
  gross: ['gross', 'sales', 'total sales', 'amount', 'earnings', 'revenue', 'income'],
  fees: ['fee', 'fees', 'commission', 'charge', 'deduction', 'adjustment', 'withhold'],
  net: ['net', 'net amount', 'net payment', 'deposit', 'payout', 'total', 'check amount', 'amount paid'],
  customer: ['customer', 'payer', 'source', 'account'],
  memo: ['memo', 'description', 'note', 'detail', 'type'],
};

/**
 * Suggest a column mapping from the header names. Returns a partial map like
 * { date: 'Payment Date', net: 'Net Amount', ... }. The UI shows this
 * pre-filled and the user can adjust it.
 */
function guessMapping(headers) {
  const map = {};
  const used = new Set();
  const lower = headers.map((h) => ({ raw: h, low: h.toLowerCase() }));

  for (const field of Object.keys(FIELD_HINTS)) {
    const hints = FIELD_HINTS[field];
    // Prefer exact-ish matches, then substring matches.
    let best = null;
    for (const hint of hints) {
      const exact = lower.find((h) => !used.has(h.raw) && h.low === hint);
      if (exact) {
        best = exact.raw;
        break;
      }
    }
    if (!best) {
      for (const hint of hints) {
        const sub = lower.find((h) => !used.has(h.raw) && h.low.includes(hint));
        if (sub) {
          best = sub.raw;
          break;
        }
      }
    }
    if (best) {
      map[field] = best;
      used.add(best);
    }
  }
  return map;
}

/**
 * Normalize rows into canonical checks using a column mapping.
 *
 * options:
 *   groupByReference (default true) — merge multiple line-items that share the
 *     same reference into a single check (summing gross + fees).
 *   feesArePositiveMagnitude (default true) — the fee column holds a positive
 *     number that should be SUBTRACTED. If false, fees are stored as-is
 *     (already signed in the file).
 *   defaultCustomer — used when no customer column / value is present.
 *
 * Returns { checks, warnings }.
 */
function normalizeChecks(rows, columnMap, options = {}) {
  const {
    groupByReference = true,
    feesArePositiveMagnitude = true,
    defaultCustomer = 'Walmart',
  } = options;

  const warnings = [];
  const get = (row, field) => (columnMap[field] ? row[columnMap[field]] : undefined);

  const items = rows.map((row, index) => {
    const reference = String(get(row, 'reference') || '').trim();
    const date = normalizeDate(get(row, 'date'));

    const hasGross = columnMap.gross !== undefined;
    const hasFees = columnMap.fees !== undefined;
    const hasNet = columnMap.net !== undefined;

    let gross = hasGross ? parseAmount(get(row, 'gross')) : 0;
    let feesRaw = hasFees ? parseAmount(get(row, 'fees')) : 0;
    // A fee expressed as a positive magnitude is a reduction.
    let fees = feesArePositiveMagnitude ? Math.abs(feesRaw) : Math.max(0, -feesRaw);
    let net = hasNet ? parseAmount(get(row, 'net')) : null;

    // Fill in whichever of gross/net was not provided.
    if (net === null) {
      net = round2(gross - fees);
    } else if (!hasGross) {
      gross = round2(net + fees);
    }

    const customer = String(get(row, 'customer') || defaultCustomer).trim() || defaultCustomer;
    const memo = String(get(row, 'memo') || '').trim();

    return { reference, date, gross, fees, net, customer, memo, rowIndex: index + 1, rows: [row] };
  });

  let checks = items;

  if (groupByReference) {
    const byRef = new Map();
    for (const item of items) {
      const key = item.reference || `__row_${item.rowIndex}`;
      if (!byRef.has(key)) {
        byRef.set(key, { ...item, rows: [...item.rows] });
      } else {
        const acc = byRef.get(key);
        acc.gross = round2(acc.gross + item.gross);
        acc.fees = round2(acc.fees + item.fees);
        acc.net = round2(acc.net + item.net);
        if (!acc.date && item.date) acc.date = item.date;
        if (item.memo && !acc.memo.includes(item.memo)) {
          acc.memo = acc.memo ? `${acc.memo}; ${item.memo}` : item.memo;
        }
        acc.rows.push(...item.rows);
      }
    }
    checks = Array.from(byRef.values());
  }

  // Validate and attach per-check status flags.
  for (const c of checks) {
    c.lineItemCount = c.rows.length;
    c.issues = [];
    if (!c.reference) c.issues.push('Missing check/reference number');
    if (!c.date) c.issues.push('Missing or unrecognized date');
    if (!(c.net > 0)) c.issues.push('Net deposit amount is not a positive number');
    if (round2(c.gross - c.fees) !== round2(c.net)) {
      // Not fatal — some files give net directly — but worth flagging.
      c.issues.push(
        `Gross (${c.gross}) minus fees (${c.fees}) = ${round2(c.gross - c.fees)}, which does not equal net (${c.net})`
      );
    }
    c.valid = c.issues.length === 0;
  }

  if (!checks.length) warnings.push('No rows found in the uploaded file.');

  return { checks, warnings };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  parseCsv,
  parseAmount,
  normalizeDate,
  guessMapping,
  normalizeChecks,
  round2,
};
