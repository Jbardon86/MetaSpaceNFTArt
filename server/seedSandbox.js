'use strict';

// One-time helper to populate a QuickBooks SANDBOX with the accounts, customer,
// item, and invoices needed to test posting a real Walmart check end-to-end.
//
// Guarded to sandbox only by the caller — never run against a real company.
// Every step is idempotent (checks before creating), so it's safe to re-run.

async function ensureAccount(qbo, spec) {
  const existing = (await qbo.listAccounts()).find(
    (a) => a.name.toLowerCase() === spec.name.toLowerCase()
  );
  if (existing) return { id: existing.id, name: spec.name, created: false };
  const body = { Name: spec.name, AccountType: spec.type };
  if (spec.subType) body.AccountSubType = spec.subType;
  if (spec.acctNum) body.AcctNum = spec.acctNum;
  const json = await qbo.apiRequest('/account', { method: 'POST', body });
  return { id: json.Account.Id, name: spec.name, created: true };
}

async function ensureItem(qbo, name, incomeAccountId) {
  const safe = name.replace(/'/g, "\\'");
  const qr = await qbo.query(`SELECT Id, Name FROM Item WHERE Name = '${safe}' MAXRESULTS 1`);
  if (qr.Item && qr.Item[0]) return { id: qr.Item[0].Id, created: false };
  const json = await qbo.apiRequest('/item', {
    method: 'POST',
    body: { Name: name, Type: 'Service', IncomeAccountRef: { value: String(incomeAccountId) } },
  });
  return { id: json.Item.Id, created: true };
}

async function ensureInvoice(qbo, { docNumber, amount, customerId, itemId, txnDate }) {
  const existing = await qbo.findInvoiceByDocNumber(docNumber);
  if (existing) return { id: existing.Id, docNumber, created: false };
  const json = await qbo.apiRequest('/invoice', {
    method: 'POST',
    body: {
      CustomerRef: { value: String(customerId) },
      DocNumber: String(docNumber),
      TxnDate: txnDate,
      Line: [
        {
          DetailType: 'SalesItemLineDetail',
          Amount: amount,
          SalesItemLineDetail: { ItemRef: { value: String(itemId) } },
        },
      ],
    },
  });
  return { id: json.Invoice.Id, docNumber, created: true };
}

// The invoices on check 004041349 that carry a payment.
const CHECK_INVOICES = [
  { docNumber: '46364', amount: 756.04 },
  { docNumber: '46367', amount: 785.03 },
  { docNumber: '46391', amount: 545.13 },
  { docNumber: '46408', amount: 766.18 },
  { docNumber: '46412', amount: 664.73 },
];

async function seedSandbox(qbo, { txnDate = '2026-05-15' } = {}) {
  const report = { accounts: {}, item: null, customer: null, invoices: [] };

  const accounts = {
    bank: await ensureAccount(qbo, { name: 'American National', type: 'Bank', subType: 'Checking' }),
    disputedAr: await ensureAccount(qbo, { name: 'Disputed AR', type: 'Other Current Asset', subType: 'OtherCurrentAssets' }),
    writeOff: await ensureAccount(qbo, { name: 'Merchant Deposit Fees', type: 'Expense', subType: 'BankCharges', acctNum: '60410' }),
    marketing: await ensureAccount(qbo, { name: 'Marketing', type: 'Expense', subType: 'AdvertisingPromotional', acctNum: '60120' }),
    compliance: await ensureAccount(qbo, { name: 'Walmart Compliance', type: 'Expense', subType: 'OtherMiscellaneousServiceCost', acctNum: '42500' }),
    sales: await ensureAccount(qbo, { name: 'Walmart Sales', type: 'Income', subType: 'SalesOfProductIncome' }),
  };
  report.accounts = accounts;

  const item = await ensureItem(qbo, 'Walmart Merchandise', accounts.sales.id);
  report.item = item;

  const customer = await qbo.ensureCustomer('Walmart');
  report.customer = { id: customer.Id, name: customer.DisplayName };

  for (const inv of CHECK_INVOICES) {
    const created = await ensureInvoice(qbo, {
      docNumber: inv.docNumber,
      amount: inv.amount,
      customerId: customer.Id,
      itemId: item.id,
      txnDate,
    });
    report.invoices.push(created);
  }

  return report;
}

module.exports = { seedSandbox, CHECK_INVOICES };
