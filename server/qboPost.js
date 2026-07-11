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
 * Build a CreditMemo that writes off `amount` for one invoice to the write-off
 * account (via a service item mapped to that account).
 */
function buildCreditMemo({ customerId, writeOffItemId, amount, invoiceDoc, checkNumber, txnDate }) {
  return {
    CustomerRef: { value: String(customerId) },
    TxnDate: txnDate,
    PrivateNote: `Walmart check ${checkNumber}: discount + accepted deductions written off for invoice ${invoiceDoc}`,
    Line: [
      {
        DetailType: 'SalesItemLineDetail',
        Amount: round2(amount),
        Description: `Early-pay discount + accepted deductions (inv ${invoiceDoc})`,
        SalesItemLineDetail: { ItemRef: { value: String(writeOffItemId) } },
      },
    ],
  };
}

/**
 * Build the Payment that closes the invoices into Undeposited Funds.
 *
 * @param resolved {
 *   customerId, undepositedFundsId, txnDate, checkNumber,
 *   invoices: [{ invoiceId, invoiceDoc, cash, creditMemoId?, writeOff }]
 * }
 */
function buildPayment(resolved) {
  const lines = [];
  for (const inv of resolved.invoices) {
    // cash applied to the invoice
    if (inv.cash > 0) {
      lines.push({
        Amount: round2(inv.cash),
        LinkedTxn: [{ TxnId: String(inv.invoiceId), TxnType: 'Invoice' }],
      });
    }
    // credit memo applied to the same invoice to cover the write-off
    if (inv.creditMemoId && inv.writeOff > 0) {
      lines.push({
        Amount: round2(inv.writeOff),
        LinkedTxn: [
          { TxnId: String(inv.invoiceId), TxnType: 'Invoice' },
          { TxnId: String(inv.creditMemoId), TxnType: 'CreditMemo' },
        ],
      });
    }
  }

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
    lines.push({
      Amount: round2(resolved.undepositedTotal),
      DetailType: 'DepositLineDetail',
      Description: `Walmart check ${resolved.checkNumber} payment`,
      DepositLineDetail: {
        // linking the payment tells QBO this deposit clears that UF payment
        LinkedTxn: [{ TxnId: String(resolved.paymentId), TxnType: 'Payment' }],
      },
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
function resolveDepositAdjustments(plan, accountIdFor) {
  return plan.bankDeposit.lines
    .filter((l) => l.type !== 'undeposited-funds')
    .map((l) => {
      const accountId = accountIdFor(l.account);
      if (!accountId) {
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
  const customerId = dryRun
    ? await (deps.findCustomerId ? deps.findCustomerId(customerName) : null)
    : await deps.ensureCustomerId(customerName);

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

  const undepositedFundsId = deps.accountIdFor(plan.receivePayment.depositToAccount);
  const bankId = deps.accountIdFor(plan.bankDeposit.depositToAccount);
  if (!undepositedFundsId) report.warnings.push('Undeposited Funds account not resolved.');
  if (!bankId) report.warnings.push(`Bank account "${plan.bankDeposit.depositToAccount}" not resolved.`);

  // 1. Credit memos for write-offs.
  const writeOffItemId = plan.receivePayment.invoices.some((i) => i.writeOff > 0)
    ? (dryRun ? 'WRITEOFF_ITEM' : await deps.ensureWriteOffItemId())
    : null;

  const creditMemoPayloads = [];
  for (const inv of resolvedInvoices) {
    if (inv.writeOff > 0) {
      const cm = buildCreditMemo({
        customerId,
        writeOffItemId,
        amount: inv.writeOff,
        invoiceDoc: inv.invoiceDoc,
        checkNumber,
        txnDate,
      });
      creditMemoPayloads.push({ invoiceDoc: inv.invoiceDoc, payload: cm });
      if (!dryRun) {
        const created = await deps.createCreditMemo(cm);
        inv.creditMemoId = created.Id;
      } else {
        inv.creditMemoId = `CM_${inv.invoiceDoc}`;
      }
    }
  }
  report.payloads.creditMemos = creditMemoPayloads;

  // 2. Payment.
  const paymentPayload = buildPayment({
    customerId,
    undepositedFundsId,
    txnDate,
    checkNumber,
    invoices: resolvedInvoices,
  });
  report.payloads.payment = paymentPayload;
  let paymentId = 'PAYMENT_DRYRUN';
  if (!dryRun) {
    const created = await deps.createPayment(paymentPayload);
    paymentId = created.Id;
    report.steps.push({ type: 'payment', id: paymentId });
  }

  // 3. Deposit.
  const undepositedTotal = round2(resolvedInvoices.reduce((s, i) => s + i.cash + (i.writeOff || 0), 0));
  const adjustments = resolveDepositAdjustments(plan, deps.accountIdFor);
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
    const created = await deps.createDeposit(deposit.payload);
    report.steps.push({ type: 'deposit', id: created.Id, total: deposit.total });
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
  buildCreditMemo,
  buildPayment,
  buildDeposit,
  resolveDepositAdjustments,
  postPlan,
};
