'use strict';

// Builds a QuickBooks Online "Deposit" payload from a normalized check.
//
// Layout mirrors how A2X posts a marketplace payout:
//   Line 1  income account   +gross   (money coming in)
//   Line 2  fee account      -fees    (Walmart's deduction)
//   ------------------------------------------------------
//   Deposit total          =  net     (equals the physical check)

const { round2 } = require('./csvParser');

/**
 * @param {object} check      normalized check from csvParser.normalizeChecks
 * @param {object} accounts   { bank, income, fees } account ids (strings)
 * @param {object} opts       { customerRef?: {value,name}, memoPrefix? }
 */
function buildDeposit(check, accounts, opts = {}) {
  if (!accounts || !accounts.bank) throw new Error('No bank account selected.');
  if (!accounts.income) throw new Error('No income account selected.');

  const entity = opts.customerRef
    ? { Entity: { value: opts.customerRef.value, type: 'Customer' } }
    : {};

  const memoPrefix = opts.memoPrefix || 'Walmart';
  const baseMemo = check.memo ? `${memoPrefix}: ${check.memo}` : memoPrefix;

  const lines = [
    {
      Amount: round2(check.gross),
      DetailType: 'DepositLineDetail',
      Description: `${baseMemo} sales`.slice(0, 4000),
      DepositLineDetail: {
        AccountRef: { value: String(accounts.income) },
        ...entity,
      },
    },
  ];

  if (check.fees && check.fees > 0) {
    if (!accounts.fees) {
      throw new Error('Check has fees but no fee/expense account is selected.');
    }
    lines.push({
      Amount: round2(-Math.abs(check.fees)),
      DetailType: 'DepositLineDetail',
      Description: `${memoPrefix} fees / deductions`.slice(0, 4000),
      DepositLineDetail: {
        AccountRef: { value: String(accounts.fees) },
        ...entity,
      },
    });
  }

  const payload = {
    DepositToAccountRef: { value: String(accounts.bank) },
    TxnDate: check.date,
    // PrivateNote is our duplicate marker + human breadcrumb. It is not shown
    // on printed forms but is visible in the transaction and searchable.
    PrivateNote: `Imported by WalmartCheck. Check/Ref: ${check.reference || '(none)'}. ` +
      `Net: ${round2(check.net)}. Line items: ${check.lineItemCount || 1}.`,
    Line: lines,
  };

  // Sanity check: the deposit total must equal the net.
  const total = lines.reduce((sum, l) => round2(sum + l.Amount), 0);
  if (round2(total) !== round2(check.net)) {
    throw new Error(
      `Deposit lines total ${round2(total)} but net is ${round2(check.net)}. Refusing to post an unbalanced deposit.`
    );
  }

  return payload;
}

module.exports = { buildDeposit };
