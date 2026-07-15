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

async function refreshAccessToken() {
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
  return accessToken;
}

async function sosGet(path) {
  if (!accessToken) await refreshAccessToken();
  let res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (res.status === 401) {
    // token expired — refresh once and retry
    await refreshAccessToken();
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
  }
  if (!res.ok) throw new Error(`SOS GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

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
    const data = await sosGet(`/api/v2/items?start=${start}&count=${count}`);
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

module.exports = { getCatalog, refreshAccessToken };
