// Endless Fun - Magic Straws shipping-label bot (Render cron job).
// THE ONE PLACE this workflow runs. Each run, in order:
//   1. buy USPS Ground Advantage labels for paid, unfulfilled orders
//   2. save label + 4x6 packing slip PDFs to OneDrive (docs.js) -> tag "docs-saved"
//   3. write tracking numbers into SOS sales receipts       -> tag "sos-saved"
// Every run: find paid, unfulfilled, open Shopify orders and buy a
// USPS Ground Advantage label for each (Shopify Shipping, charged to the
// store's Shopify billing). Tags each order "auto-labeled" or "label-error".
//
// Env vars (set in Render, never in code):
//   SHOPIFY_SHOP            myshopify subdomain, e.g. "magic-sparkle-shop-slbiu"
//   SHOPIFY_CLIENT_ID       Dev Dashboard app client ID
//   SHOPIFY_CLIENT_SECRET   Dev Dashboard app client secret
//   DRY_RUN                 "true" = only log what it would buy (default true)
//   MAX_LABELS_PER_RUN      safety cap per run (default 15)
//   MAX_UNITS_PER_ORDER     orders above this many units are held (default 24)
//   MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET  OneDrive upload app (docs.js)
//   SOS_SYNC                "on" = write tracking into SOS, "dry" = check only
//                           and log (default), "off" = skip the SOS step
//   BACKEND_URL             endlessfun-orders-backend URL (does the SOS calls)
//   LABEL_BOT_KEY           shared secret for the backend's /api/sos/tracking
//
// SOS step: every shipped order from the last 7 days without "sos-saved" or
// "sos-error" gets its tracking written onto the SOS sales receipt whose
// Customer PO is "Shopify order #N". Tags "sos-saved" when SOS confirms it,
// "sos-error" when something doesn't match (a person must look).

import { syncDocs } from "./docs.js";

const SHOP = process.env.SHOPIFY_SHOP;
const API = `https://${SHOP}.myshopify.com/admin/api/2026-10/graphql.json`;
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const MAX_LABELS = Number(process.env.MAX_LABELS_PER_RUN ?? 15);
const MAX_UNITS = Number(process.env.MAX_UNITS_PER_ORDER ?? 24);
const SKIP_TAGS = ["auto-labeled", "label-error", "label-hold"];

let token;
async function getToken() {
  if (token) return token;
  const r = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error(`Token request failed: ${r.status} ${await r.text()}`);
  token = (await r.json()).access_token;
  return token;
}

async function gql(query, variables = {}) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await getToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(j.errors)}`);
  return j.data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tag(orderId, tags) {
  if (DRY_RUN) return;
  await gql(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
    { id: orderId, tags });
}

async function buyLabel(fulfillmentOrderId) {
  const shippingDatetime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const d = await gql(
    `mutation($input: ShippingLabelPurchaseInput!) {
      shippingLabelPurchase(shippingLabelPurchase: $input) {
        shippingLabelPurchaseResult { id status }
        userErrors { code message }
      } }`,
    { input: {
        fulfillmentOrderId,
        shippingDatetime,
        notifyCustomer: true,
        preferredRateSelection: { carrierCode: "usps", serviceCode: "GroundAdvantage" },
    } });
  const res = d.shippingLabelPurchase;
  if (res.userErrors?.length) throw new Error(res.userErrors.map((e) => `${e.code}: ${e.message}`).join("; "));
  const id = res.shippingLabelPurchaseResult.id;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const p = await gql(`query($id: ID!) { node(id: $id) { ... on ShippingLabelPurchaseResult {
        done status errors { code message } shippingLabels { trackingInfo { number } } } } }`, { id });
    const n = p.node;
    if (n.done) {
      if (n.status !== "PURCHASED") throw new Error(`Purchase ${n.status}: ${JSON.stringify(n.errors)}`);
      return n.shippingLabels.map((l) => l.trackingInfo?.number).filter(Boolean);
    }
  }
  throw new Error("Purchase still pending after 60s; check Shopify before retrying");
}

const SOS_SYNC = (process.env.SOS_SYNC || "dry").toLowerCase();

async function sosTag(orderId, tags) {
  await gql(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
    { id: orderId, tags });
}

async function syncSos() {
  const base = (process.env.BACKEND_URL || "").replace(/\/$/, "");
  const key = process.env.LABEL_BOT_KEY;
  if (SOS_SYNC === "off") return;
  if (!base || !key) { console.log("SOS step skipped: BACKEND_URL or LABEL_BOT_KEY not set"); return; }
  const live = SOS_SYNC === "on";

  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const d = await gql(`query($q: String!) { orders(first: 40, query: $q, sortKey: CREATED_AT) { nodes {
      id name tags createdAt totalPriceSet { shopMoney { amount } }
      fulfillments { status trackingInfo { number } } } } }`,
    { q: `fulfillment_status:shipped created_at:>=${since} -tag:sos-saved -tag:sos-error` });
  const orders = d.orders.nodes;
  if (!orders.length) { console.log("SOS: nothing to do"); return; }

  // The backend sleeps when idle (free plan); wake it first.
  try { await fetch(`${base}/health`, { signal: AbortSignal.timeout(120000) }); }
  catch (e) { console.error(`SOS step skipped: backend not reachable (${e.message})`); return; }

  console.log(`SOS step (${live ? "LIVE" : "DRY - check only"}): ${orders.length} order(s)`);
  for (const o of orders) {
    const num = o.name.replace("#", "");
    const nums = [...new Set(o.fulfillments.filter((f) => f.status !== "CANCELLED")
      .flatMap((f) => f.trackingInfo.map((t) => (t.number || "").trim())).filter(Boolean))];
    if (nums.length !== 1) {
      console.log(`SOS ${o.name}: ${nums.length} tracking numbers; needs a person`);
      if (live && nums.length > 1) await sosTag(o.id, ["sos-error"]);
      continue;
    }
    const body = {
      order: num, tracking: nums[0],
      customer: o.tags.includes("Target") ? "Target+" : "Shopify Customer",
      total: Number(o.totalPriceSet.shopMoney.amount), dryRun: !live,
    };
    let out;
    try {
      const r = await fetch(`${base}/api/sos/tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bot-key": key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
      });
      out = await r.json().catch(() => ({ result: "error", error: `HTTP ${r.status}` }));
      if (!r.ok && !out.result) out.result = "error";
    } catch (e) { out = { result: "error", error: e.message }; }

    const tail = `${out.receipt ? " receipt " + out.receipt : ""}${out.reason ? " - " + out.reason : ""}${out.error ? " - " + out.error : ""}`;
    console.log(`SOS ${o.name}: ${out.result}${tail}${out.fields ? " fields=" + out.fields.join(",") : ""}`);
    if (!live) continue;
    if (out.result === "saved" || out.result === "already") await sosTag(o.id, ["sos-saved"]);
    else if (out.result === "mismatch") await sosTag(o.id, ["sos-error"]);
    else if (out.result === "notfound" && Date.now() - Date.parse(o.createdAt) > 86400000) await sosTag(o.id, ["sos-error"]);
    // "error" / recent "notfound": leave untagged, retry next run
  }
}

async function main() {
  for (const k of ["SHOPIFY_SHOP", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"])
    if (!process.env[k]) throw new Error(`Missing env var ${k}`);
  console.log(`Run start ${new Date().toISOString()} DRY_RUN=${DRY_RUN}`);

  const q = `fulfillment_status:unfulfilled financial_status:paid status:open ` +
            SKIP_TAGS.map((t) => `-tag:${t}`).join(" ");
  const d = await gql(`query($q: String!) { orders(first: 50, query: $q, sortKey: CREATED_AT) { nodes {
      id name tags
      shippingAddress { countryCodeV2 address1 city zip }
      lineItems(first: 100) { nodes { quantity } }
      fulfillmentOrders(first: 5) { nodes { id status requestStatus } }
    } } }`, { q });

  let bought = 0;
  for (const o of d.orders.nodes) {
    if (bought >= MAX_LABELS) { console.log(`Cap of ${MAX_LABELS} labels reached; rest next run.`); break; }
    const units = o.lineItems.nodes.reduce((s, l) => s + l.quantity, 0);
    const a = o.shippingAddress;
    let hold = null;
    if (!a || !a.address1 || !a.city || !a.zip) hold = "incomplete address";
    else if (a.countryCodeV2 !== "US") hold = `non-US destination (${a.countryCodeV2})`;
    else if (units > MAX_UNITS) hold = `${units} units exceeds MAX_UNITS_PER_ORDER=${MAX_UNITS}`;
    if (hold) { console.log(`HOLD ${o.name}: ${hold}`); await tag(o.id, ["label-hold"]); continue; }

    const fos = o.fulfillmentOrders.nodes.filter((f) => f.status === "OPEN");
    if (!fos.length) { console.log(`SKIP ${o.name}: no open fulfillment order`); continue; }
    if (DRY_RUN) { console.log(`DRY_RUN would buy USPS Ground Advantage for ${o.name} (${units} units, ${a.city} ${a.zip})`); bought++; continue; }

    try {
      const tracking = [];
      for (const fo of fos) tracking.push(...(await buyLabel(fo.id)));
      await tag(o.id, ["auto-labeled"]);
      console.log(`BOUGHT ${o.name}: tracking ${tracking.join(", ")}`);
      bought++;
    } catch (e) {
      console.error(`ERROR ${o.name}: ${e.message}`);
      await tag(o.id, ["label-error"]);
    }
  }
  console.log(`Labels: ${bought} label(s) ${DRY_RUN ? "would be bought" : "bought"}.`);

  try {
    const r = await syncDocs({ gql, tag: sosTag });
    if (r.errors || r.skipped) process.exitCode = 1; // shows as a failed run in Render
  } catch (e) { console.error(`DOCS step failed: ${e.message}`); process.exitCode = 1; }

  try { await syncSos(); } catch (e) { console.error(`SOS step failed: ${e.message}`); process.exitCode = 1; }
  console.log("Run end.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
