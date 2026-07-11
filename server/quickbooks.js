'use strict';

// Thin wrapper around the QuickBooks Online Accounting API.
//
// Responsibilities:
//   - build the OAuth authorize URL and exchange the code for tokens
//   - transparently refresh access tokens when they expire
//   - expose small helpers for the entities this app uses (accounts,
//     customers, deposits, and connection info)
//
// Tokens are persisted through server/store.js so the connection survives
// server restarts.

const OAuthClient = require('intuit-oauth');
const { config } = require('./config');
const store = require('./store');

function newOAuthClient() {
  return new OAuthClient({
    clientId: config.qbo.clientId,
    clientSecret: config.qbo.clientSecret,
    environment: config.qbo.environment,
    redirectUri: config.qbo.redirectUri,
  });
}

/**
 * URL the browser is redirected to so the user can grant access.
 */
function getAuthorizeUrl(state) {
  const oauthClient = newOAuthClient();
  return oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: state || 'walmartcheck',
  });
}

/**
 * Exchanges the ?code=... callback URL for access/refresh tokens and persists
 * them (along with the realmId, which identifies the connected company).
 */
async function handleCallback(fullCallbackUrl) {
  const oauthClient = newOAuthClient();
  const authResponse = await oauthClient.createToken(fullCallbackUrl);
  const token = authResponse.getJson();
  const realmId = oauthClient.getToken().realmId;
  const stored = {
    ...token,
    realmId,
    obtained_at: nowSeconds(),
  };
  store.saveTokens(stored);
  return stored;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isConnected() {
  const t = store.getTokens();
  return Boolean(t && t.access_token && t.realmId);
}

/**
 * Returns a valid access token + realmId, refreshing first if the current
 * access token is expired or close to it. Throws if not connected.
 */
async function getValidToken() {
  const tokens = store.getTokens();
  if (!tokens) throw new Error('Not connected to QuickBooks. Please connect first.');

  const ageSeconds = nowSeconds() - (tokens.obtained_at || 0);
  const expiresIn = tokens.expires_in || 3600;
  const needsRefresh = ageSeconds > expiresIn - 120; // refresh 2 min early

  if (!needsRefresh) return tokens;

  const oauthClient = newOAuthClient();
  oauthClient.setToken(tokens);
  const refreshed = await oauthClient.refresh();
  const updated = {
    ...tokens,
    ...refreshed.getJson(),
    realmId: tokens.realmId,
    obtained_at: nowSeconds(),
  };
  store.saveTokens(updated);
  return updated;
}

/**
 * Low-level authenticated request against the company's API namespace.
 */
async function apiRequest(pathAndQuery, { method = 'GET', body } = {}) {
  const tokens = await getValidToken();
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const url =
    `${config.qbo.apiBaseUrl}/v3/company/${tokens.realmId}${pathAndQuery}` +
    `${sep}minorversion=${config.qbo.minorVersion}`;

  // Never hang forever on a stuck call — abort after 25s so it surfaces as a
  // clear error instead of freezing the whole post.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`QuickBooks did not respond within 25s for ${method} ${pathAndQuery}.`);
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }

  if (!res.ok) {
    const fault = json && json.Fault && json.Fault.Error && json.Fault.Error[0];
    const message = fault
      ? `${fault.Message}${fault.Detail ? ' — ' + fault.Detail : ''}`
      : `QuickBooks API error (HTTP ${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.body = json;
    throw error;
  }
  return json;
}

/**
 * Runs a QBO SQL-like query (used for accounts / customers).
 */
async function query(statement) {
  const encoded = encodeURIComponent(statement);
  const json = await apiRequest(`/query?query=${encoded}`);
  return json.QueryResponse || {};
}

// --- Convenience helpers ---------------------------------------------------

async function getCompanyInfo() {
  const tokens = await getValidToken();
  const json = await apiRequest(`/companyinfo/${tokens.realmId}`);
  return json.CompanyInfo;
}

/**
 * All active accounts, trimmed to the fields the UI needs. Used to populate
 * the bank / income / fee dropdowns.
 */
async function listAccounts() {
  const qr = await query(
    "SELECT Id, Name, AcctNum, AccountType, AccountSubType, Classification, CurrentBalance " +
      'FROM Account WHERE Active = true ORDERBY Name MAXRESULTS 1000'
  );
  return (qr.Account || []).map((a) => ({
    id: a.Id,
    name: a.Name,
    acctNum: a.AcctNum,
    type: a.AccountType,
    subType: a.AccountSubType,
    classification: a.Classification,
  }));
}

async function findCustomerByName(name) {
  const safe = String(name).replace(/'/g, "\\'");
  const qr = await query(
    `SELECT Id, DisplayName FROM Customer WHERE DisplayName = '${safe}' MAXRESULTS 1`
  );
  return (qr.Customer && qr.Customer[0]) || null;
}

async function createCustomer(name) {
  const json = await apiRequest('/customer', {
    method: 'POST',
    body: { DisplayName: name },
  });
  return json.Customer;
}

async function ensureCustomer(name) {
  if (!name) return null;
  const existing = await findCustomerByName(name);
  if (existing) return existing;
  return createCustomer(name);
}

/**
 * Find an invoice by its user-visible number (DocNumber). Returns the QBO Id
 * or null.
 */
async function findInvoiceByDocNumber(docNumber) {
  const safe = String(docNumber).replace(/'/g, "\\'");
  const qr = await query(
    `SELECT Id, DocNumber, Balance, TotalAmt FROM Invoice WHERE DocNumber = '${safe}' MAXRESULTS 1`
  );
  return (qr.Invoice && qr.Invoice[0]) || null;
}

/**
 * Build a label -> account resolver from the live chart of accounts. Matches on
 * AcctNum first (via the known-numbers map), then on exact name (case
 * insensitive). Returns a function label -> id|null.
 */
async function buildAccountResolver(accountNumbers = {}) {
  const accounts = await listAccounts();
  const byNum = new Map();
  const byName = new Map();
  for (const a of accounts) {
    if (a.acctNum) byNum.set(String(a.acctNum), a.id);
    byName.set(a.name.toLowerCase(), a.id);
  }
  return function accountIdFor(label) {
    if (!label) return null;
    const num = accountNumbers[label];
    if (num && byNum.has(String(num))) return byNum.get(String(num));
    return byName.get(String(label).toLowerCase()) || null;
  };
}

/**
 * Ensure a service item exists to carry deduction write-offs, mapped to the
 * given income/expense account. Returns its Id.
 */
async function ensureWriteOffItem(accountId, name = 'Walmart Deduction Write-off') {
  const safe = name.replace(/'/g, "\\'");
  const qr = await query(`SELECT Id, Name FROM Item WHERE Name = '${safe}' MAXRESULTS 1`);
  if (qr.Item && qr.Item[0]) return qr.Item[0].Id;
  const json = await apiRequest('/item', {
    method: 'POST',
    body: {
      Name: name,
      Type: 'Service',
      IncomeAccountRef: { value: String(accountId) },
    },
  });
  return json.Item.Id;
}

async function createCreditMemo(payload) {
  const json = await apiRequest('/creditmemo', { method: 'POST', body: payload });
  return json.CreditMemo;
}

async function createPayment(payload) {
  const json = await apiRequest('/payment', { method: 'POST', body: payload });
  return json.Payment;
}

/**
 * Delete a payment (used to roll back if the deposit fails). Needs Id +
 * SyncToken from the created payment.
 */
async function deletePayment({ Id, SyncToken }) {
  return apiRequest('/payment?operation=delete', {
    method: 'POST',
    body: { Id: String(Id), SyncToken: String(SyncToken != null ? SyncToken : '0') },
  });
}

/**
 * Posts a Bank Deposit. `deposit` is the QBO Deposit payload built in
 * server/deposit.js.
 */
async function createDeposit(deposit) {
  const json = await apiRequest('/deposit', { method: 'POST', body: deposit });
  return json.Deposit;
}

function disconnect() {
  store.clearTokens();
}

module.exports = {
  getAuthorizeUrl,
  handleCallback,
  isConnected,
  getValidToken,
  apiRequest,
  query,
  getCompanyInfo,
  listAccounts,
  findCustomerByName,
  createCustomer,
  ensureCustomer,
  findInvoiceByDocNumber,
  buildAccountResolver,
  ensureWriteOffItem,
  createCreditMemo,
  createPayment,
  deletePayment,
  createDeposit,
  disconnect,
};
