'use strict';

// Default QuickBooks account routing, seeded with the real accounts the user
// gave us. Account *names* are placeholders for the real QBO account IDs, which
// get filled in once we can read the chart of accounts (the app resolves a name
// to its Id at connect time). Everything here is overridable in the app's
// settings so nothing is hard-coded into the posting logic.

module.exports = {
  // Where the Walmart ACH deposit lands.
  bank: 'American National',

  // Standard middle step: payments post here, then the deposit sweeps them.
  undepositedFunds: 'Undeposited Funds',

  // Disputed deductions (negative) and their later repayments (positive) both
  // ride the bank deposit into this Other Current Asset. Its balance == what
  // Walmart owes back.
  deductionsBucket: 'Disputed AR',

  // Early-pay discounts + ACCEPTED small deductions are written off here,
  // inside the Receive Payment, per invoice. (Acct #60410.)
  paymentWriteOff: 'Merchant Deposit Fees',

  // Walmart's own charges pulled off the check. These can't sit on an invoice,
  // so they ride the deposit to a real expense account (NOT Disputed AR).
  // Codes map to accounts here; `default` catches anything unmapped.
  // TODO: create/confirm these expense accounts in QBO, then set real names.
  feeAccounts: {
    default: 'Walmart Fees', // placeholder — split into Advertising / Compliance
  },
};
