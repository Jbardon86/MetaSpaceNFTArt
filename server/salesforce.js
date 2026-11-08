// Salesforce integration for the Endless Fun Orders backend.
//
// Design notes:
//   - Server-to-server only. The Connected App's Consumer Key/Secret live here
//     as env vars (on Render), NEVER in the app or in chat.
//   - Uses the OAuth 2.0 Client Credentials Flow (no interactive login).
//   - Everything is best-effort and NON-FATAL: if Salesforce is down or
//     misconfigured, placing an order at a trade show must still succeed. We log
//     the error and return it in the response so Staff can retry/sync later.
//
// What it creates per order (user chose "Both: Lead + order"):
//   1. A Lead  — captures the person even on an incomplete order.
//   2. An Opportunity — the order, with REAL OpportunityLineItems:
//        - the Opportunity is put on the Standard Price Book
//        - each app line is matched to a Product2 by SOS_Item_Id__c (the app's
//          product id) or, failing that, by ProductCode (the SKU)
//        - the line's UnitPrice is set to the app's effective per-unit price
//          (lineTotal / quantity) so the Salesforce Amount equals what the
//          customer saw, even with rep discounts
//        - unmatched lines are listed in the Opportunity Description so nothing
//          is silently lost
//   Kept in an OPEN stage (Proposal) on purpose so it does NOT auto-fire your
//   approval / Send-to-SOS flow. Verified against the sandbox:
//   - Opportunity requires only Name, StageName, CloseDate
//   - StageName 'Proposal' is valid; single Master record type
//   - Product2.SOS_Item_Id__c maps to the app's SOS item id; every active
//     product has a Standard Price Book entry
//   - OpportunityLineItem needs OpportunityId + PricebookEntryId + Quantity

const {
  SF_LOGIN_URL = '', // https://test.salesforce.com (sandbox) or https://login.salesforce.com (prod), or My Domain
  SF_CLIENT_ID = '',
  SF_CLIENT_SECRET = '',
  SF_API_VERSION = 'v62.0',
  SF_LEAD_SOURCE = 'Trade Show',
  SF_OPP_STAGE = 'Proposal', // an OPEN stage; avoid Closed Won so Send-to-SOS doesn't fire in testing
  SF_CREATE_OPPORTUNITY = '1',
  SF_ADD_LINE_ITEMS = '1',
  SF_PRICEBOOK_ID = '', // optional override; otherwise the Standard Price Book is auto-detected
  SF_LINK_ACCOUNT = '1', // match/create the Account and link it to the Opportunity
  SF_CREATE_ACCOUNT = '1', // create a new Account when no match is found (needs a company name)
  SF_DEFAULT_REP_SOS_ID = '', // booth fallback rep (SOS rep id, e.g. "5" = House) when the order names no rep
  SF_REP_MAP = '', // optional JSON overriding/extending the name -> SOS rep id map
} = process.env;

// Rep name -> SOS rep id (SOS_Sales_Rep__c is the numeric SOS rep id, as a
// string). Seeded from the Endless Fun roster; override/extend via SF_REP_MAP.
const REP_DEFAULTS = {
  'andy briggs': '1',
  'chris roseen': '2',
  'dave ehrlich': '3',
  'david ehrlich': '3',
  'dave & jess': '4',
  house: '5',
  'jeff bardon': '6',
  'jessica tollefson': '8',
  'jessica tollefson 2': '9',
  'mason rapp': '10',
  'obadiah patterson': '11',
  'roger corazzo': '13',
  'jackie resch': '14',
};
function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
let repMap = null;
function getRepMap() {
  if (repMap) return repMap;
  repMap = { ...REP_DEFAULTS };
  if (SF_REP_MAP) {
    try {
      const extra = JSON.parse(SF_REP_MAP);
      for (const [k, v] of Object.entries(extra)) repMap[normalizeName(k)] = String(v);
    } catch (err) {
      console.error('SF_REP_MAP is not valid JSON; ignoring:', err.message);
    }
  }
  return repMap;
}

function isConfigured() {
  return Boolean(SF_LOGIN_URL && SF_CLIENT_ID && SF_CLIENT_SECRET);
}

// --- token cache -----------------------------------------------------------
let cached = null; // { accessToken, instanceUrl, expiresAt }

async function getToken(force = false) {
  if (!isConfigured()) throw new Error('Salesforce not configured (SF_* env vars missing)');
  if (!force && cached && cached.expiresAt > Date.now() + 60_000) return cached;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });
  const res = await fetch(`${SF_LOGIN_URL.replace(/\/$/, '')}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Salesforce token request failed (${res.status}): ${text}`);
  const data = JSON.parse(text);
  if (!data.access_token || !data.instance_url) {
    throw new Error(`Salesforce token response missing fields: ${text}`);
  }
  cached = {
    accessToken: data.access_token,
    instanceUrl: data.instance_url.replace(/\/$/, ''),
    expiresAt: Date.now() + 90 * 60_000,
  };
  return cached;
}

// Generic authed request with one retry on auth expiry. `path` starts with /.
async function sfRequest(method, path, jsonBody, extraHeaders = {}) {
  const doIt = (t) =>
    fetch(`${t.instanceUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });

  let tok = await getToken();
  let res = await doIt(tok);
  if (res.status === 401) {
    tok = await getToken(true);
    res = await doIt(tok);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`SF ${method} ${path} failed (${res.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

async function createSObject(sobject, fields, extraHeaders = {}) {
  const data = await sfRequest(
    'POST',
    `/services/data/${SF_API_VERSION}/sobjects/${sobject}`,
    fields,
    extraHeaders
  );
  if (!data.id) throw new Error(`Create ${sobject} returned no id: ${JSON.stringify(data)}`);
  return data.id;
}

async function query(soql) {
  const data = await sfRequest(
    'GET',
    `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`
  );
  return data.records || [];
}

// --- field helpers ---------------------------------------------------------
function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: 'Trade Show Lead' };
  if (parts.length === 1) return { first: '', last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}
function orderTotal(order) {
  return (order.lines || []).reduce((s, l) => s + Number(l.lineTotal || 0), 0);
}
function shortId(order) {
  return String(order.id || '').slice(-6).toUpperCase() || 'NEW';
}
function linesText(order) {
  return (order.lines || [])
    .map((l) => `  ${l.quantity} x ${l.name}${l.sku ? ` (${l.sku})` : ''} — ${money(l.lineTotal)}`)
    .join('\n');
}
// Escape a value for safe inline use in SOQL.
function soql(v) {
  return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
// Effective per-unit price so the SF Amount matches the order total (incl. discounts).
function effectiveUnit(line) {
  const q = Number(line.quantity || 0);
  if (q > 0 && line.lineTotal != null) return Number(line.lineTotal) / q;
  return Number(line.unitPrice || 0);
}

// --- pricebook (cached) ----------------------------------------------------
let pricebookId = null;
async function getStandardPricebookId() {
  if (SF_PRICEBOOK_ID) return SF_PRICEBOOK_ID;
  if (pricebookId) return pricebookId;
  const rows = await query('SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1');
  if (!rows.length) throw new Error('No standard Pricebook2 found');
  pricebookId = rows[0].Id;
  return pricebookId;
}

// Resolve a PricebookEntry id for each order line, matching by SOS item id
// (app product id) or ProductCode (sku). Returns { byKey, unmatched }.
async function resolveLineEntries(lines, pbId) {
  const sosIds = [];
  const skus = [];
  for (const l of lines) {
    if (l.productId) sosIds.push(String(l.productId));
    if (l.sku) skus.push(String(l.sku));
  }
  if (!sosIds.length && !skus.length) return { bySos: {}, bySku: {} };

  const clauses = [];
  if (sosIds.length) clauses.push(`Product2.SOS_Item_Id__c IN (${sosIds.map((v) => `'${soql(v)}'`).join(',')})`);
  if (skus.length) clauses.push(`Product2.ProductCode IN (${skus.map((v) => `'${soql(v)}'`).join(',')})`);
  const rows = await query(
    `SELECT Id, UnitPrice, Product2.SOS_Item_Id__c, Product2.ProductCode ` +
      `FROM PricebookEntry WHERE Pricebook2Id = '${soql(pbId)}' AND IsActive = true ` +
      `AND (${clauses.join(' OR ')})`
  );
  const bySos = {};
  const bySku = {};
  for (const r of rows) {
    const p = r.Product2 || {};
    if (p.SOS_Item_Id__c) bySos[String(p.SOS_Item_Id__c)] = r.Id;
    if (p.ProductCode) bySku[String(p.ProductCode)] = r.Id;
  }
  return { bySos, bySku };
}

// Resolve the rep's SOS id for SOS_Sales_Rep__c. Precedence: explicit id on the
// order, then the name map, then the configured booth default. The kiosk sets
// repName to the device name ("Booth Kiosk"), which won't map — that's fine; it
// falls through to SF_DEFAULT_REP_SOS_ID (or blank = unassigned).
function resolveRepSosId(order) {
  if (order.repSosId) return String(order.repSosId);
  const mapped = getRepMap()[normalizeName(order.repName)];
  if (mapped) return mapped;
  return SF_DEFAULT_REP_SOS_ID || null;
}

// Find (or optionally create) the Account and return its Id, or null. Matches
// first by SOS customer id, then by exact name. Only creates when a company
// name is present, to avoid junk "Trade Show Customer" accounts.
async function resolveAccountId(order) {
  if (SF_LINK_ACCOUNT !== '1') return null;
  const sosCustId = order.account?.salesforceId ? String(order.account.salesforceId) : '';
  const name = (order.account?.name || '').trim();

  if (sosCustId) {
    const rows = await query(
      `SELECT Id FROM Account WHERE SOS_Customer_Id__c = '${soql(sosCustId)}' LIMIT 1`
    );
    if (rows.length) return rows[0].Id;
  }
  if (name) {
    const rows = await query(`SELECT Id FROM Account WHERE Name = '${soql(name)}' LIMIT 1`);
    if (rows.length) return rows[0].Id;
  }
  if (SF_CREATE_ACCOUNT === '1' && name) {
    const fields = { Name: name };
    if (sosCustId) fields.SOS_Customer_Id__c = sosCustId;
    return createSObject('Account', fields, { 'Sforce-Duplicate-Rule-Header': 'allowSave=true' });
  }
  return null;
}

// --- public API ------------------------------------------------------------

async function createLead(order) {
  const { first, last } = splitName(order.contact?.name);
  const addr = order.billingAddress || order.shippingAddress || {};
  const company = order.account?.name || 'Trade Show (no company)';
  const fields = {
    FirstName: first || undefined,
    LastName: last,
    Company: company,
    Email: order.contact?.email || undefined,
    Phone: order.contact?.phone || undefined,
    Street: addr.street || undefined,
    City: addr.city || undefined,
    State: addr.state || undefined,
    PostalCode: addr.zip || undefined,
    LeadSource: order.eventName || SF_LEAD_SOURCE,
    Description:
      `Trade show order #${shortId(order)} (total ${money(orderTotal(order))})` +
      (order.repName ? `\nRep: ${order.repName}` : '') +
      (order.notes ? `\nNotes: ${order.notes}` : '') +
      (order.lines?.length ? `\n\nItems:\n${linesText(order)}` : ''),
  };
  Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);
  return createSObject('Lead', fields, { 'Sforce-Duplicate-Rule-Header': 'allowSave=true' });
}

// Creates the Opportunity + line items. Returns { id, lineItemsCreated, unmatched, lineErrors }.
async function createOpportunity(order) {
  const company = order.account?.name || order.contact?.name || 'Trade Show Customer';
  const today = new Date().toISOString().slice(0, 10);

  let pbId = null;
  const addLines = SF_ADD_LINE_ITEMS === '1' && (order.lines?.length || 0) > 0;
  if (addLines) {
    try {
      pbId = await getStandardPricebookId();
    } catch (err) {
      console.error('Pricebook lookup failed (creating header only):', err);
    }
  }

  const fields = {
    Name: `${company} — Trade Show #${shortId(order)}`,
    StageName: SF_OPP_STAGE,
    CloseDate: today,
    LeadSource: order.eventName || SF_LEAD_SOURCE,
    Description:
      `Placed from the Endless Fun trade-show kiosk app.\n` +
      `Order #${shortId(order)}\n` +
      (order.repName ? `Rep: ${order.repName}\n` : '') +
      (order.contact?.email ? `Email: ${order.contact.email}\n` : '') +
      (order.contact?.phone ? `Phone: ${order.contact.phone}\n` : '') +
      (order.notes ? `Notes: ${order.notes}\n` : '') +
      (order.lines?.length ? `\nItems:\n${linesText(order)}\n` : '') +
      `\nTotal: ${money(orderTotal(order))}`,
  };
  if (pbId) fields.Pricebook2Id = pbId;
  // Without line items we still want a meaningful Amount on the header.
  if (!pbId) fields.Amount = orderTotal(order);

  // Account link (match or create) and rep attribution — both non-fatal.
  const attribErrors = [];
  let accountId = null;
  try {
    accountId = await resolveAccountId(order);
    if (accountId) fields.AccountId = accountId;
  } catch (err) {
    console.error('Account resolve/create failed:', err);
    attribErrors.push(`account: ${err.message || err}`);
  }
  const repSosId = resolveRepSosId(order);
  if (repSosId) fields.SOS_Sales_Rep__c = repSosId;

  Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

  const oppId = await createSObject('Opportunity', fields, {
    'Sforce-Duplicate-Rule-Header': 'allowSave=true',
  });

  const result = {
    id: oppId,
    accountId,
    repSosId,
    lineItemsCreated: 0,
    unmatched: [],
    lineErrors: attribErrors,
  };
  if (!pbId) return result; // header-only fallback

  let maps;
  try {
    maps = await resolveLineEntries(order.lines, pbId);
  } catch (err) {
    console.error('PricebookEntry resolve failed:', err);
    result.lineErrors.push(`resolve: ${err.message || err}`);
    return result;
  }

  for (const l of order.lines) {
    const pbeId =
      (l.productId && maps.bySos[String(l.productId)]) ||
      (l.sku && maps.bySku[String(l.sku)]) ||
      null;
    if (!pbeId) {
      result.unmatched.push(l.name || l.sku || l.productId || 'unknown');
      continue;
    }
    try {
      await createSObject('OpportunityLineItem', {
        OpportunityId: oppId,
        PricebookEntryId: pbeId,
        Quantity: Number(l.quantity || 0),
        UnitPrice: effectiveUnit(l),
      });
      result.lineItemsCreated += 1;
    } catch (err) {
      console.error('OpportunityLineItem create failed:', err);
      result.lineErrors.push(`${l.name || l.sku}: ${err.message || err}`);
    }
  }
  return result;
}

// Orchestrates both, never throwing.
async function pushOrder(order) {
  const result = {
    configured: isConfigured(),
    leadId: null,
    opportunityId: null,
    accountId: null,
    repSosId: null,
    lineItemsCreated: 0,
    unmatched: [],
    errors: [],
  };
  if (!isConfigured()) return result;

  try {
    result.leadId = await createLead(order);
  } catch (err) {
    console.error('Salesforce Lead create failed:', err);
    result.errors.push(`lead: ${err.message || err}`);
  }

  if (SF_CREATE_OPPORTUNITY === '1') {
    try {
      const opp = await createOpportunity(order);
      result.opportunityId = opp.id;
      result.accountId = opp.accountId;
      result.repSosId = opp.repSosId;
      result.lineItemsCreated = opp.lineItemsCreated;
      result.unmatched = opp.unmatched;
      if (opp.lineErrors.length) result.errors.push(...opp.lineErrors.map((e) => `line: ${e}`));
    } catch (err) {
      console.error('Salesforce Opportunity create failed:', err);
      result.errors.push(`opportunity: ${err.message || err}`);
    }
  }

  return result;
}

module.exports = {
  isConfigured,
  getToken,
  query,
  createLead,
  createOpportunity,
  pushOrder,
  getStandardPricebookId,
};
