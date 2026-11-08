// Salesforce integration for the Endless Fun Orders backend.
//
// Design notes:
//   - Server-to-server only. The Connected App's Consumer Key/Secret live here
//     as env vars (on Render), NEVER in the app or in chat.
//   - Uses the OAuth 2.0 Client Credentials Flow (no interactive login), so the
//     backend can mint its own access token from the Connected App.
//   - Everything is best-effort and NON-FATAL: if Salesforce is down or
//     misconfigured, placing an order at a trade show must still succeed (the
//     confirmation email + local record are what the customer sees). We log the
//     error and return it in the response so Staff can retry/sync later.
//
// What it creates per order (user chose "Both: Lead + order"):
//   1. A Lead  — captures the person even on an incomplete order.
//   2. An Opportunity — the order itself (header + lines in the description,
//      Amount = total). Kept in an OPEN stage on purpose so it does NOT auto-
//      fire your approval / Send-to-SOS flow during testing.
//
// Deeper fidelity (real OpportunityLineItems that feed your existing
// Send-to-SOS path, customer matching by SOS id, reusing SosOrderService) is a
// deliberate follow-up — see README "Salesforce Phase 2b".

const {
  SF_LOGIN_URL = '', // https://test.salesforce.com (sandbox) or https://login.salesforce.com (prod), or your My Domain URL
  SF_CLIENT_ID = '',
  SF_CLIENT_SECRET = '',
  SF_API_VERSION = 'v62.0',
  SF_LEAD_SOURCE = 'Trade Show',
  SF_OPP_STAGE = 'Proposal', // an OPEN stage; avoid Closed Won so Send-to-SOS doesn't fire in testing
  SF_CREATE_OPPORTUNITY = '1',
} = process.env;

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
  if (!res.ok) {
    throw new Error(`Salesforce token request failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  if (!data.access_token || !data.instance_url) {
    throw new Error(`Salesforce token response missing fields: ${text}`);
  }
  // Client-credentials tokens follow the session timeout; cache conservatively.
  cached = {
    accessToken: data.access_token,
    instanceUrl: data.instance_url.replace(/\/$/, ''),
    expiresAt: Date.now() + 90 * 60_000,
  };
  return cached;
}

// Low-level sObject create with one automatic retry on auth expiry.
async function createSObject(sobject, fields, extraHeaders = {}) {
  const doPost = (t) =>
    fetch(`${t.instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${sobject}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t.accessToken}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(fields),
    });

  let tok = await getToken();
  let res = await doPost(tok);
  if (res.status === 401) {
    tok = await getToken(true);
    res = await doPost(tok);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Create ${sobject} failed (${res.status}): ${text}`);
  }
  const data = JSON.parse(text);
  if (!data.id) throw new Error(`Create ${sobject} returned no id: ${text}`);
  return data.id;
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

// --- public API ------------------------------------------------------------

// Creates a Lead for the contact. Duplicate rules stay ON in production, so we
// pass allowSave=true to insert a vetted duplicate rather than hard-failing.
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
  // strip undefined
  Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);
  return createSObject('Lead', fields, { 'Sforce-Duplicate-Rule-Header': 'allowSave=true' });
}

// Creates an Opportunity that represents the order. Open stage on purpose.
async function createOpportunity(order) {
  const company = order.account?.name || order.contact?.name || 'Trade Show Customer';
  const today = new Date().toISOString().slice(0, 10);
  const fields = {
    Name: `${company} — Trade Show #${shortId(order)}`,
    StageName: SF_OPP_STAGE,
    CloseDate: today,
    Amount: orderTotal(order),
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
  Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);
  return createSObject('Opportunity', fields, { 'Sforce-Duplicate-Rule-Header': 'allowSave=true' });
}

// Orchestrates both, never throwing: returns a result object the caller can
// put in the HTTP response and that Staff can use to see what synced.
async function pushOrder(order) {
  const result = { configured: isConfigured(), leadId: null, opportunityId: null, errors: [] };
  if (!isConfigured()) return result;

  try {
    result.leadId = await createLead(order);
  } catch (err) {
    console.error('Salesforce Lead create failed:', err);
    result.errors.push(`lead: ${err.message || err}`);
  }

  if (SF_CREATE_OPPORTUNITY === '1') {
    try {
      result.opportunityId = await createOpportunity(order);
    } catch (err) {
      console.error('Salesforce Opportunity create failed:', err);
      result.errors.push(`opportunity: ${err.message || err}`);
    }
  }

  return result;
}

module.exports = { isConfigured, getToken, createLead, createOpportunity, pushOrder };
