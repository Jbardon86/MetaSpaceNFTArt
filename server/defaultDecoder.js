'use strict';

// Default Walmart deduction-code decoder. Each code maps to how it should be
// handled. Users extend this in the app as new codes appear; unknown codes are
// flagged for classification, never posted blindly.
//
// category: 'accept'   -> written off on the invoice payment
//           'dispute'  -> negative deposit line to Disputed AR (recoverable)
//           'fee'      -> negative deposit line to an expense account
//                         (feeAccount names which one)
//
// Positive-amount lines with a known code are auto-treated as repayments.

module.exports = {
  '0100': { description: 'Price Difference As Documented', category: 'accept' },
  '0022': { description: 'Merchandise Billed Not Shipped', category: 'dispute' },
  '0024': { description: 'Carton Shortage Freight Bill Signed Short', category: 'dispute' },
  // As advertising/compliance codes appear on real checks, add them here, e.g.:
  // '0089': { description: 'Advertising Allowance', category: 'fee', feeAccount: 'advertising' },
  // '0092': { description: 'OTIF / Compliance Fine', category: 'fee', feeAccount: 'compliance' },
};
