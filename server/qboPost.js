'use strict';

// Turns an allocation plan (from allocator.js) into the actual QuickBooks
// Online transactions and posts them.
//
// Three QBO objects per check:
//   1. CreditMemo (one per invoice that has a write-off) — books the early-pay
//      discount + accepted deductions to the write-off account (Merchant
//      Deposit Fees) so the invoice can close to zero.
//   2. Payment — applies the cash + those credits to each invoice, into
//      Undeposited Funds, marking invoices paid in full.
//   3. Deposit — sweeps the Undeposited Funds payment and adds the adjustment
//      lines (disputed deductions -> Disputed AR, fees -> expense, repayments
//      -> Disputed AR), netting to the actual ACH.
//
// Everything is built as plain payloads first so it can be reviewed (and unit
// tested) before anything is sent. postPlan() defaults to dryRun.

const { round2 } = require('./allocator');

/**
 * Build the Payment that closes the invoices into Undeposited Funds. Each
 * invoice is paid in full; there are no credit memos.
 *
 * @param resolved {
 *   customerId, undepositedFundsId, txnDate, checkNumber,
 *   invoices: [{ invoiceId, invoiceDoc, cash }]
 * }
 */
function buildPayment(resolved) {
  // Each invoice is paid in full. One line per invoice; no credit memos.
  const lines = resolved.invoices
    .filter((inv) => inv.cash > 0)
    .map((inv) => ({
      Amount: round2(inv.cash),
      LinkedTxn: [{ TxnId: String(inv.invoiceId), TxnType: 'Invoice' }],
    }));

  const cashTotal = round2(resolved.invoices.reduce((s, i) => s + (i.cash || 0), 0));

  return {
    CustomerRef: { value: String(resolved.customerId) },
    TxnDate: resolved.txnDate,
    TotalAmt: cashTotal,
    DepositToAccountRef: { value: String(resolved.undepositedFundsId) },
    PrivateNote: `Walmart check ${resolved.checkNumber}: payment applied to invoices`,
    Line: lines,
  };
}

/**
 * Build the Bank Deposit: the Undeposited Funds payment plus adjustment lines.
 *
 * @param resolved {
 *   bankId, txnDate, checkNumber, paymentId, undepositedTotal,
 *   adjustments: [{ accountId, amount, description }]
 * }
 */
function buildDeposit(resolved) {
  const lines = [];

  // sweep the payment out of Undeposited Funds
  if (resolved.undepositedTotal && resolved.paymentId) {
    // A line that links an existing (undeposited) payment carries ONLY the
    // amount + LinkedTxn — no DetailType and no DepositLineDetail block. The
    // LinkedTxn needs TxnLineId "0" (the payment as a whole).
    lines.push({
      Amount: round2(resolved.undepositedTotal),
      LinkedTxn: [{ TxnId: String(resolved.paymentId), TxnType: 'Payment', TxnLineId: '0' }],
    });
  }

  for (const adj of resolved.adjustments) {
    lines.push({
      Amount: round2(adj.amount),
      DetailType: 'DepositLineDetail',
      Description: adj.description,
      DepositLineDetail: { AccountRef: { value: String(adj.accountId) } },
    });
  }

  const total = round2(lines.reduce((s, l) => s + l.Amount, 0));

  return {
    payload: {
      DepositToAccountRef: { value: String(resolved.bankId) },
      TxnDate: resolved.txnDate,
      PrivateNote: `Walmart check ${resolved.checkNumber}. Net ACH ${total}.`,
      Line: lines,
    },
    total,
  };
}

/**
 * Map the allocation plan's deposit lines (which carry account *labels*) to
 * account *ids* using a label->id resolver.
 */
function resolveDepositAdjustments(plan, accountIdFor, opts = {}) {
  const { lenient = false, warnings = [] } = opts;
  return plan.bankDeposit.lines
    .filter((l) => l.type !== 'undeposited-funds')
    .map((l) => {
      const accountId = accountIdFor(l.account);
      if (!accountId) {
        if (lenient) {
          warnings.push(`No QuickBooks account found for "${l.account}" (needed for: ${l.description}).`);
          return { accountId: `UNRESOLVED:${l.account}`, amount: round2(l.amount), description: l.description };
        }
        const e = new Error(`No QuickBooks account found for "${l.account}" (needed for: ${l.description}).`);
        e.code = 'ACCOUNT_NOT_FOUND';
        throw e;
      }
      return { accountId, amount: round2(l.amount), description: l.description };
    });
}

/**
 * Orchestrate posting. `deps` supplies the side-effecting QBO calls so this is
 * testable with fakes:
 *   deps.findInvoiceId(doc) -> id | null
 *   deps.ensureCustomerId(name) -> id
 *   deps.ensureWriteOffItemId() -> id
 *   deps.accountIdFor(label) -> id | null
 *   deps.createCreditMemo(payload) -> {Id}
 *   deps.createPayment(payload) -> {Id}
 *   deps.createDeposit(payload) -> {Id}
 *
 * Returns a report. With opts.dryRun (default true) it resolves ids and builds
 * payloads but does NOT create anything.
 */
async function postPlan(plan, deps, opts = {}) {
  const dryRun = opts.dryRun !== false;
  const txnDate = plan.meta.datePaid || opts.today;
  const checkNumber = plan.meta.checkNumber;

  const report = { dryRun, checkNumber, steps: [], warnings: [], payloads: {} };

  if (plan.unclassified && plan.unclassified.length) {
    const e = new Error(
      `${plan.unclassified.length} deduction line(s) have unmapped codes. Classify them before posting.`
    );
    e.code = 'UNCLASSIFIED';
    throw e;
  }

  // Resolve the Walmart customer.
  const customerName = opts.customerName || 'Walmart';
  let customerId = dryRun
    ? await (deps.findCustomerId ? deps.findCustomerId(customerName) : null)
    : await deps.ensureCustomerId(customerName);
  if (!customerId) {
    if (dryRun) customerId = `UNRESOLVED:${customerName}`;
    else throw new Error(`Could not resolve the "${customerName}" customer.`);
  }

  // Match invoices; flag any that are missing.
  const resolvedInvoices = [];
  for (const inv of plan.receivePayment.invoices) {
    const invoiceId = await deps.findInvoiceId(inv.invoice);
    if (!invoiceId) {
      report.warnings.push(`Invoice ${inv.invoice} not found in QuickBooks — it will be skipped.`);
      continue;
    }
    resolvedInvoices.push({
      invoiceId,
      invoiceDoc: inv.invoice,
      cash: round2(inv.appliedToUndepositedFunds),
      writeOff: round2(inv.writeOff),
    });
  }

  let undepositedFundsId = deps.accountIdFor(plan.receivePayment.depositToAccount);
  let bankId = deps.accountIdFor(plan.bankDeposit.depositToAccount);
  if (!undepositedFundsId) {
    report.warnings.push('Undeposited Funds account not resolved.');
    if (dryRun) undepositedFundsId = 'UNRESOLVED:Undeposited Funds';
  }
  if (!bankId) {
    report.warnings.push(`Bank account "${plan.bankDeposit.depositToAccount}" not resolved.`);
    if (dryRun) bankId = `UNRESOLVED:${plan.bankDeposit.depositToAccount}`;
  }

  // 1. Payment — invoices paid in full into Undeposited Funds (no credit memos;
  // discounts + accepted deductions are booked on the deposit instead).
  const paymentPayload = buildPayment({
    customerId,
    undepositedFundsId,
    txnDate,
    checkNumber,
    invoices: resolvedInvoices,
  });
  report.payloads.payment = paymentPayload;
  let paymentId = 'PAYMENT_DRYRUN';
  let createdPayment = null;
  if (!dryRun) {
    createdPayment = await deps.createPayment(paymentPayload);
    paymentId = createdPayment.Id;
    report.steps.push({ type: 'payment', id: paymentId });
  }

  // 2. Deposit — sweep the full Undeposited Funds payment, then the adjustment
  // lines (write-off, disputes, fees, repayments) net it down to the ACH.
  const adjustments = resolveDepositAdjustments(plan, deps.accountIdFor, { lenient: dryRun, warnings: report.warnings });
  const deposit = buildDeposit({
    bankId,
    txnDate,
    checkNumber,
    paymentId,
    undepositedTotal: round2(resolvedInvoices.reduce((s, i) => s + i.cash, 0)),
    adjustments,
  });
  report.payloads.deposit = deposit.payload;
  report.depositTotal = deposit.total;
  if (!dryRun) {
    try {
      const created = await deps.createDeposit(deposit.payload);
      report.steps.push({ type: 'deposit', id: created.Id, total: deposit.total });
    } catch (depErr) {
      // Roll back the payment so a failed deposit doesn't leave the invoices
      // paid with no matching deposit (which would block a clean retry).
      if (createdPayment && deps.deletePayment) {
        try {
          await deps.deletePayment(createdPayment);
          report.steps = report.steps.filter((s) => s.type !== 'payment');
        } catch (rollbackErr) {
          depErr.message += ` (also failed to roll back payment ${paymentId}: ${rollbackErr.message})`;
        }
      }
      throw depErr;
    }
  }

  // Reconciliation guard.
  report.balanced = deposit.total === plan.reconciliation.remittanceNet;
  if (!report.balanced) {
    report.warnings.push(
      `Deposit total ${deposit.total} does not equal remittance net ${plan.reconciliation.remittanceNet}.`
    );
  }

  return report;
}

module.exports = {
  buildPayment,
  buildDeposit,
  resolveDepositAdjustments,
  postPlan,
};
