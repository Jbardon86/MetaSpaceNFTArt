'use strict';

// The core "decipher" engine.
//
// Takes the rows of a Walmart remittance plus a decoder (code -> category) and
// splits every line into the two QuickBooks transactions the user actually
// books:
//
//   1. Receive Payment  -> closes invoices "paid in full" into Undeposited
//      Funds. Early-pay discounts and ACCEPTED deductions are absorbed here as
//      write-offs so each invoice zeroes out.
//
//   2. Bank Deposit     -> brings the Undeposited Funds payment in, then adds
//      adjustment lines for everything that can't sit on an invoice:
//        - DISPUTED deductions  -> negative line to the deductions bucket
//        - REPAID disputes      -> positive line to the deductions bucket
//        - FEES (ad/compliance) -> negative line to an expense account
//      The deposit total equals the cash that actually hit the bank (the ACH).
//
// Categories a code can map to:
//   'accept'    negative deduction written off on the payment
//   'dispute'   negative deduction parked in the deductions bucket (recoverable)
//   'fee'       negative Walmart charge (advertising/compliance) -> expense
//   'repayment' positive line giving back a previously disputed deduction
//
// Anything whose code isn't in the decoder comes back as 'unclassified' so the
// UI can ask the user where it goes (and never silently post it).

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Extract the bracketed code from a Walmart deduction string.
 * "MERCHANDISE BILLED NOT SHIPPED [0022]" -> "0022"
 */
function extractCode(text) {
  if (!text) return '';
  const m = String(text).match(/\[([^\]]+)\]/);
  return m ? m[1].trim() : String(text).trim();
}

/**
 * Classify a single remittance row.
 * `row` fields used: invoice, amountPaid (signed), deductionCode (text), discount.
 */
function classifyLine(row, decoder) {
  const hasCode = Boolean(row.deductionCode);
  const amount = Number(row.amountPaid) || 0;

  if (!hasCode && amount > 0) {
    return { kind: 'payment', code: '', category: 'payment' };
  }

  const code = extractCode(row.deductionCode);
  const rule = decoder[code];

  if (!rule) {
    return { kind: 'deduction', code, category: 'unclassified' };
  }

  // A positive amount on a coded line is money coming back = a repayment,
  // regardless of the code's default category.
  if (amount > 0) {
    return { kind: 'repayment', code, category: 'repayment', description: rule.description };
  }

  return {
    kind: 'deduction',
    code,
    category: rule.category,
    description: rule.description,
    // for fee-category codes, which expense bucket to route to
    // (e.g. 'advertising' | 'compliance'); ignored for other categories
    feeAccount: rule.feeAccount,
  };
}

/**
 * Build the full allocation plan for one check.
 *
 * @param {Array} rows     normalized remittance rows:
 *                         { po, invoice, invoiceAmount, discount, amountPaid, deductionCode }
 * @param {Object} decoder { [code]: { description, category } }
 * @param {Object} accounts account ids/names for routing (all optional at plan time):
 *   { bank, undepositedFunds, deductionsBucket, discount, acceptWriteoff,
 *     feeAccounts: { [code]: accountId, default: accountId } }
 * @param {Object} meta    { checkNumber, datePaid }
 */
function allocateCheck(rows, decoder, accounts = {}, meta = {}) {
  const byInvoice = new Map();
  const feeLines = [];
  const repaymentLines = [];
  const unclassified = [];

  for (const row of rows) {
    const c = classifyLine(row, decoder);
    const invoice = String(row.invoice || '').trim();

    if (c.category === 'unclassified') {
      unclassified.push({ ...row, code: c.code });
      continue;
    }
    if (c.category === 'fee') {
      feeLines.push({ invoice, code: c.code, description: c.description, feeAccount: c.feeAccount, amount: round2(row.amountPaid) });
      continue;
    }
    if (c.category === 'repayment') {
      repaymentLines.push({ invoice, code: c.code, description: c.description, amount: round2(row.amountPaid) });
      continue;
    }

    // payment / accept / dispute all attach to an invoice group
    if (!byInvoice.has(invoice)) {
      byInvoice.set(invoice, {
        invoice,
        po: row.po,
        invoiceAmount: 0,
        discount: 0,
        accepted: 0,
        disputed: [],
        hasPayment: false,
      });
    }
    const g = byInvoice.get(invoice);
    if (c.category === 'payment') {
      g.hasPayment = true;
      g.invoiceAmount = round2(g.invoiceAmount + (Number(row.invoiceAmount) || 0));
      g.discount = round2(g.discount + (Number(row.discount) || 0));
    } else if (c.category === 'accept') {
      g.accepted = round2(g.accepted + Math.abs(Number(row.amountPaid) || 0));
    } else if (c.category === 'dispute') {
      g.disputed.push({
        code: c.code,
        description: c.description,
        amount: round2(Math.abs(row.amountPaid)),
        // claim fields (for the dispute pipeline / Recovery Submission export)
        po: row.po || g.po,
        whse: row.dc || row.store,
        shipDate: row.invoiceDate,
      });
    }
  }

  // ---- Transaction 1: Receive Payment (into Undeposited Funds) ----
  // Each invoice is paid IN FULL to Undeposited Funds. The early-pay discount
  // and accepted deductions are NOT netted here — they come out on the deposit
  // (below) as a write-off line. Same books, but the payment stays a simple,
  // reliable full-amount application (no credit memos).
  const paymentInvoices = [];
  let undepositedTotal = 0;
  let totalWriteOff = 0;
  for (const g of byInvoice.values()) {
    if (!g.hasPayment) continue; // e.g. a standalone chargeback invoice
    const writeOff = round2(g.discount + g.accepted);
    totalWriteOff = round2(totalWriteOff + writeOff);
    undepositedTotal = round2(undepositedTotal + g.invoiceAmount);
    paymentInvoices.push({
      invoice: g.invoice,
      po: g.po,
      invoiceAmount: g.invoiceAmount,
      discount: g.discount,
      acceptedDeductions: g.accepted,
      writeOff,
      appliedToUndepositedFunds: g.invoiceAmount, // paid in full
    });
  }

  // ---- Transaction 2: Bank Deposit ----
  const depositLines = [];
  if (undepositedTotal !== 0) {
    depositLines.push({
      type: 'undeposited-funds',
      description: 'Walmart payment (from Undeposited Funds)',
      account: accounts.undepositedFunds || 'Undeposited Funds',
      amount: undepositedTotal,
    });
  }
  // early-pay discounts + accepted deductions -> negative, to the write-off account
  if (totalWriteOff > 0) {
    depositLines.push({
      type: 'writeoff',
      description: `Early-pay discounts + accepted deductions (${paymentInvoices.length} invoices)`,
      account: accounts.paymentWriteOff || 'Merchant Deposit Fees',
      amount: round2(-totalWriteOff),
    });
  }
  // disputed deductions -> negative, to the bucket
  const disputes = [];
  for (const g of byInvoice.values()) {
    for (const d of g.disputed) {
      disputes.push({ invoice: g.invoice, ...d });
      depositLines.push({
        type: 'disputed-deduction',
        invoice: g.invoice,
        code: d.code,
        description: `Disputed: ${d.description} (inv ${g.invoice})`,
        account: accounts.deductionsBucket || 'Walmart Deductions Receivable',
        amount: round2(-Math.abs(d.amount)),
      });
    }
  }
  // fees -> negative, to expense
  for (const f of feeLines) {
    const acct =
      (accounts.feeAccounts &&
        (accounts.feeAccounts[f.feeAccount] ||
          accounts.feeAccounts[f.code] ||
          accounts.feeAccounts.default)) ||
      'Walmart Fees';
    depositLines.push({
      type: 'fee',
      code: f.code,
      description: `Walmart fee: ${f.description || f.code}`,
      account: acct,
      amount: round2(f.amount < 0 ? f.amount : -Math.abs(f.amount)),
    });
  }
  // repayments -> positive, clearing the bucket
  for (const r of repaymentLines) {
    depositLines.push({
      type: 'repaid-dispute',
      invoice: r.invoice,
      code: r.code,
      description: `Repaid dispute: ${r.description || r.code}`,
      account: accounts.deductionsBucket || 'Walmart Deductions Receivable',
      amount: round2(Math.abs(r.amount)),
    });
  }

  const depositTotal = round2(depositLines.reduce((s, l) => s + l.amount, 0));

  // ---- Reconciliation: deposit total should equal the sum of Amount Paid ----
  const remittanceNet = round2(rows.reduce((s, r) => s + (Number(r.amountPaid) || 0), 0));

  return {
    meta: { checkNumber: meta.checkNumber || '', datePaid: meta.datePaid || '' },
    receivePayment: {
      total: undepositedTotal,
      depositToAccount: accounts.undepositedFunds || 'Undeposited Funds',
      // discounts + accepted deductions are written off here, per invoice
      writeOffAccount: accounts.paymentWriteOff || 'Merchant Deposit Fees',
      invoices: paymentInvoices,
    },
    bankDeposit: {
      total: depositTotal,
      depositToAccount: accounts.bank || '(bank account)',
      lines: depositLines,
    },
    disputes,
    fees: feeLines,
    repayments: repaymentLines,
    unclassified,
    reconciliation: {
      remittanceNet,
      depositTotal,
      balanced: depositTotal === remittanceNet,
      difference: round2(depositTotal - remittanceNet),
    },
  };
}

module.exports = { allocateCheck, classifyLine, extractCode, round2 };
