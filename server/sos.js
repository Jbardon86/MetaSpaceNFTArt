// SOS Inventory catalog integration.
//
// Pulls the product/item list from SOS Inventory so the app can show ONE shared
// catalog across all devices. Products are managed in SOS; the app mirrors them.
//
// Auth: SOS uses OAuth 2.0. You register an app in the SOS Developer Portal
// (developer.sosinventory.com) to get a client id/secret, then authorize your
// SOS company to get an access token + refresh token. Those go in .env.
//
// NOTE: the exact items endpoint path and field names below are based on SOS's
// public docs and MUST be verified against your live API (see markers). Once we
// can hit the real API with your credentials, we lock these in.

const BASE_URL = process.env.SOS_BASE_URL || 'https://api.sosinventory.com';
const TOKEN_URL = process.env.SOS_TOKEN_URL || `${BASE_URL}/oauth2/token`;

let accessToken = process.env.SOS_ACCESS_TOKEN || '';
let refreshToken = process.env.SOS_REFRESH_TOKEN || '';

// Simple in-memory catalog cache so we don't hammer the SOS API on every request.
let cache = { items: [], fetchedAt: 0 };
const CACHE_MS = 5 * 60 * 1000; // 5 minutes

// --- Token persistence -------------------------------------------------------
// SOS access tokens last 90 days, and every refresh issues a NEW refresh token
// (the old one stops working). Render's free plan restarts this service often,
// and a restart reloads the tokens from env vars. So after each refresh we write
// the new tokens back to this service's env vars through the Render API.
// Needs RENDER_API_KEY (Render account API key). RENDER_SERVICE_ID is set by
// Render automatically. Without RENDER_API_KEY we never refresh proactively.
const REFRESH_EVERY_DAYS = 60;

async function persistTokens() {
  const key = process.env.RENDER_API_KEY;
  const svc = process.env.RENDER_SERVICE_ID;
  if (!key || !svc) {
    console.error('SOS TOKEN NOT SAVED: RENDER_API_KEY not set. SOS will stop working after the next restart.');
    return false;
  }
  const put = async (name, value) => {
    const r = await fetch(`https://api.render.com/v1/services/${svc}/env-vars/${name}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ value }),
    });
    if (!r.ok) throw new Error(`Render env update ${name} failed: ${r.status} ${await r.text()}`);
  };
  try {
    await put('SOS_REFRESH_TOKEN', refreshToken);
    await put('SOS_ACCESS_TOKEN', accessToken);
    await put('SOS_TOKEN_REFRESHED_AT', new Date().toISOString());
    console.log('SOS tokens refreshed and saved to Render env vars.');
    return true;
  } catch (e) {
    console.error('SOS TOKEN NOT SAVED:', e.message);
    return false;
  }
}

let refreshing = null; // one refresh at a time (a second one would use a dead refresh token)
async function refreshAccessToken() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!refreshToken) throw new Error('SOS_REFRESH_TOKEN not set');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.SOS_CLIENT_ID || '',
      client_secret: process.env.SOS_CLIENT_SECRET || '',
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`SOS token refresh failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    accessToken = json.access_token;
    if (json.refresh_token) refreshToken = json.refresh_token; // SOS rotates refresh tokens
    await persistTokens();
    return accessToken;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

// On startup: if we can save tokens and they are getting old (or their age is
// unknown), refresh now so the 90-day access token never expires on us.
async function refreshIfStale() {
  if (!process.env.RENDER_API_KEY || !refreshToken) return;
  const at = Date.parse(process.env.SOS_TOKEN_REFRESHED_AT || '');
  const ageDays = Number.isFinite(at) ? (Date.now() - at) / 86400000 : Infinity;
  if (ageDays < REFRESH_EVERY_DAYS) return;
  console.log(`SOS token age ${Number.isFinite(ageDays) ? ageDays.toFixed(0) + ' days' : 'unknown'}; refreshing.`);
  try {
    await refreshAccessToken();
  } catch (e) {
    console.error('Startup SOS refresh failed:', e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generic SOS call. Retries once on 401 (expired token) and waits out SOS's
// throttle (max 1 request per 500 ms; over-limit calls return 200 + a message).
async function sosRequest(method, path, body) {
  if (!accessToken) await refreshAccessToken();
  const go = () =>
    fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  for (let attempt = 0; attempt < 4; attempt++) {
    let res = await go();
    if (res.status === 401) {
      await refreshAccessToken();
      res = await go();
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`SOS ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
    if (/throttle limit exceeded/i.test(text)) {
      await sleep(800);
      continue;
    }
    return text ? JSON.parse(text) : {};
  }
  throw new Error(`SOS ${method} ${path}: still throttled after retries`);
}

const sosGet = (path) => sosRequest('GET', path);

// Map a raw SOS item to the app's Product shape. Field names confirmed against
// a real SOS /api/v2/items response.
function mapItem(raw) {
  const uom = Array.isArray(raw.uoms) && raw.uoms[0]?.name ? raw.uoms[0].name : 'each';
  return {
    id: String(raw.id),
    name: (raw.name || raw.fullname || '').trim(),
    sku: raw.sku || '',
    price: Number(raw.salesPrice ?? raw.baseSalesPrice ?? 0),
    unit: uom,
    description: raw.description || '',
    // SOS returns the image inline as base64 (imageAsBase64String) when included.
    imageUri: raw.imageAsBase64String
      ? `data:image/jpeg;base64,${raw.imageAsBase64String}`
      : null,
    hasImage: !!raw.hasImage,
    active: !raw.archived && raw.showOnSalesForms !== false,
    sosId: String(raw.id),
  };
}

// Only real, sellable products belong in the order catalog.
function isSellable(raw) {
  return raw && raw.type !== 'Category' && !raw.archived && raw.showOnSalesForms !== false;
}

// Fetch the full item list (handles basic pagination).
async function fetchAllItems() {
  const raw = [];
  let start = 0;
  const count = 200;
  for (let page = 0; page < 50; page++) {
    const data = await sosGet(`/api/v2/item?start=${start}&count=${count}`);
    const batch = Array.isArray(data) ? data : data.data || data.items || [];
    raw.push(...batch);
    if (batch.length < count) break;
    start += count;
  }
  return raw.filter(isSellable).map(mapItem);
}

/** Returns the catalog, using the cache unless it's stale. */
async function getCatalog({ force = false } = {}) {
  const stale = Date.now() - cache.fetchedAt > CACHE_MS;
  if (force || stale || cache.items.length === 0) {
    cache = { items: await fetchAllItems(), fetchedAt: Date.now() };
  }
  return cache.items;
}

// --- Shopify tracking -> SOS sales receipt ----------------------------------
// Finds the sales receipt whose Customer PO is "Shopify order #<n>", checks it
// matches the Shopify order, writes the tracking number, then reads the receipt
// back to prove the save worked and nothing else changed.
// SOS's update (PUT) REPLACES the whole receipt, so we always send back the
// full object we just read, changing only trackingNumber.
// Returns { result: 'saved'|'already'|'preview'|'mismatch', ... }.
const unwrap = (j) => (j && j.data && !Array.isArray(j.data) ? j.data : j);

async function saveTracking({ order, tracking, customer, total, dryRun }) {
  const po = `Shopify order #${order}`;
  const found = await sosGet(`/api/v2/salesreceipt?query=${encodeURIComponent(po)}&maxresults=20`);
  const list = (Array.isArray(found) ? found : found.data || []).filter((r) => (r.customerPO || '').trim() === po);
  if (list.length !== 1) return { result: list.length ? 'mismatch' : 'notfound', reason: `${list.length} receipts with Customer PO "${po}"` };

  await sleep(600);
  const rec = unwrap(await sosGet(`/api/v2/salesreceipt/${list[0].id}`));
  const num = rec.number;
  const problems = [];
  if (!Object.prototype.hasOwnProperty.call(rec, 'trackingNumber')) problems.push('SOS API returned no trackingNumber field');
  if ((rec.customer?.name || '').trim() !== customer) problems.push(`customer is "${rec.customer?.name}", expected "${customer}"`);
  if (Math.abs(Number(rec.total) - Number(total)) > 0.01) problems.push(`total is ${rec.total}, Shopify total is ${total}`);
  const existing = String(rec.trackingNumber || '').trim();
  if (existing && existing !== tracking) problems.push(`receipt already has a different tracking number (${existing})`);
  if (problems.length) return { result: 'mismatch', receipt: num, reason: problems.join('; ') };
  if (existing === tracking) return { result: 'already', receipt: num };
  if (dryRun) return { result: 'preview', receipt: num, fields: Object.keys(rec).sort() };

  const before = rec;
  await sleep(600);
  await sosRequest('PUT', `/api/v2/salesreceipt/${rec.id}`, { ...rec, trackingNumber: tracking });
  await sleep(600);
  const after = unwrap(await sosGet(`/api/v2/salesreceipt/${rec.id}`));
  const changed = [];
  if (String(after.trackingNumber || '').trim() !== tracking) changed.push('tracking number did not save');
  if (Math.abs(Number(after.total) - Number(before.total)) > 0.001) changed.push(`total changed ${before.total} -> ${after.total}`);
  if ((after.customerPO || '') !== (before.customerPO || '')) changed.push('Customer PO changed');
  if (after.customer?.id !== before.customer?.id) changed.push('customer changed');
  if ((after.lines || []).length !== (before.lines || []).length) changed.push('line count changed');
  for (const k of ['shipDate', 'shipMethod', 'channel', 'salesRep', 'comment', 'location']) {
    if (JSON.stringify(after[k] ?? null) !== JSON.stringify(before[k] ?? null)) changed.push(`${k} changed`);
  }
  if (changed.length) {
    console.error(`SOS receipt ${num} check after save FAILED: ${changed.join('; ')}`);
    return { result: 'mismatch', receipt: num, reason: `after save: ${changed.join('; ')}` };
  }
  return { result: 'saved', receipt: num };
}

refreshIfStale();

module.exports = { getCatalog, refreshAccessToken, saveTracking };
