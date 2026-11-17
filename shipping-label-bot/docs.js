// OneDrive paperwork step for the Magic Straws label bot.
//
// For every shipped order from the last 7 days without the "docs-saved" tag:
//   1. download the Shopify shipping label PDF (4x6)
//   2. build a 4x6 packing slip PDF
//   3. upload both into OneDrive: order@endlessfun.biz > shopify orders > <today YYYY-MM-DD>
//      (creates the date folder and its "Shipped" subfolder; never touches Shipped)
//   4. tag the order "docs-saved" once OneDrive confirms both files
// Orders shipped without a Shopify label (nothing to print) get "docs-none".
//
// Env vars: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET ("Claude Shopify Uploader"
// app in the reachco.biz Microsoft tenant, Files.ReadWrite.All application permission).

import PDFDocument from "pdfkit";

const DRIVE = "b!9oZ533sffEmJslC4lA4NIQN_q08RREhMhCKnwg0IpwBlKT5RDLZOQ5mO_KPMN80u"; // order@endlessfun.biz OneDrive
const PARENT = process.env.ONEDRIVE_PARENT_ID || "01EKZPFRPI6ARZ6MXYKBFKOICJHAYGXOSV"; // "shopify orders" folder (override only for testing)
const G = "https://graph.microsoft.com/v1.0";

export function chicagoDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function longDate(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
}

async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!r.ok) throw new Error(`Microsoft sign-in failed: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).access_token;
}

async function graph(tok, method, path, body, ctype = "application/json") {
  const r = await fetch(`${G}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": ctype } : {}) },
    body,
  });
  const text = await r.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json };
}

async function ensureFolder(tok, parentId, name) {
  const list = await graph(tok, "GET", `/drives/${DRIVE}/items/${parentId}/children?$select=id,name,folder&$top=999`);
  if (list.status !== 200) throw new Error(`OneDrive list failed: ${list.status}`);
  const hit = (list.json.value || []).find((i) => i.name === name && i.folder);
  if (hit) return hit.id;
  const made = await graph(tok, "POST", `/drives/${DRIVE}/items/${parentId}/children`,
    JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }));
  if (made.status === 409) return ensureFolder(tok, parentId, name); // created at the same moment elsewhere
  if (made.status !== 200 && made.status !== 201) throw new Error(`OneDrive create folder "${name}" failed: ${made.status}`);
  return made.json.id;
}

// Upload one file. Never overwrites: if the same name is already there with the
// same size it counts as saved; a different size is an error for a person.
async function upload(tok, folderId, name, buf) {
  const path = `/drives/${DRIVE}/items/${folderId}:/${encodeURIComponent(name)}:`;
  const put = await graph(tok, "PUT", `${path}/content?@microsoft.graph.conflictBehavior=fail`, buf, "application/pdf");
  if (put.status === 200 || put.status === 201) {
    if (put.json.size !== buf.length) throw new Error(`${name}: OneDrive size ${put.json.size} != ${buf.length}`);
    return "uploaded";
  }
  if (put.status === 409) {
    const meta = await graph(tok, "GET", `${path}?$select=size`);
    if (meta.status === 200 && meta.json.size === buf.length) return "already there";
    throw new Error(`${name}: a different file with this name is already in the folder`);
  }
  throw new Error(`${name}: upload failed ${put.status} ${JSON.stringify(put.json).slice(0, 200)}`);
}

export function pdfPageSize(buf) {
  const m = buf.toString("latin1").match(/\/MediaBox\s*\[\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : null;
}

export function buildSlip(o) {
  return new Promise((resolve, reject) => {
    const W = 288, H = 432, L = 18;
    const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `Packing slip ${o.name}` } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const a = o.shippingAddress || {};
    const po = (o.customAttributes || []).find((x) => x.key === "Target+ Purchase Order Id")?.value;
    const isTarget = (o.tags || []).includes("Target");
    let y = 22;
    doc.font("Helvetica-Bold").fontSize(14).text("MAGIC STRAWS", L, y, { lineBreak: false });
    doc.font("Helvetica").fontSize(8)
      .text(`Order ${o.name}`, L, y, { width: W - 2 * L, align: "right" })
      .text(longDate(o.createdAt), L, y + 11, { width: W - 2 * L, align: "right" });
    y += 30;
    if (po) { doc.font("Helvetica-Bold").fontSize(7).text(`TARGET+ PO: ${po}`, L, y); y += 14; }
    doc.font("Helvetica-Bold").fontSize(7).text("SHIP TO", L, y); y += 11;
    doc.font("Helvetica").fontSize(9);
    const cityLine = [a.city, [a.provinceCode, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    for (const t of [a.name || `${a.firstName || ""} ${a.lastName || ""}`.trim(), a.address1, a.address2, cityLine, "United States"].filter(Boolean)) {
      doc.text(t, L, y, { width: W - 2 * L, lineBreak: false }); y += 11;
    }
    y += 6; doc.moveTo(L, y).lineTo(W - L, y).lineWidth(0.5).stroke(); y += 8;
    doc.font("Helvetica-Bold").fontSize(7).text("ITEM", L, y).text("SKU", W - 79, y).text("QTY", L, y, { width: W - 2 * L, align: "right" });
    y += 12;
    let total = 0;
    for (const li of o.lineItems?.nodes || []) {
      total += li.quantity;
      let size = 8;
      doc.font("Helvetica");
      while (doc.fontSize(size).widthOfString(li.name) > W - 104 && size > 5.5) size -= 0.5;
      doc.fontSize(size).text(li.name, L, y, { lineBreak: false });
      doc.fontSize(8).text(li.sku || "", W - 79, y, { lineBreak: false })
        .text(String(li.quantity), L, y, { width: W - 2 * L, align: "right" });
      y += 13;
      if (y > H - 70) { doc.fontSize(7).text("(more items: see Shopify)", L, y); y += 12; break; }
    }
    y += 2; doc.moveTo(L, y).lineTo(W - L, y).stroke(); y += 8;
    doc.font("Helvetica-Bold").fontSize(8).text("Total items", L, y).text(String(total), L, y, { width: W - 2 * L, align: "right" });
    y += 20;
    doc.font("Helvetica").fontSize(7).text(`Channel: ${isTarget ? "Target+" : "Lovable Storefront"}  |  USPS Ground Advantage`, L, y);
    doc.text("Thank you for shopping with Magic Straws!", 0, H - 30, { width: W, align: "center" });
    doc.end();
  });
}

function shortName(o) {
  const a = o.shippingAddress || {};
  const first = (a.firstName || a.name || "Customer").trim();
  const lastInitial = (a.lastName || "").trim().charAt(0).toUpperCase();
  return `${first}${lastInitial ? " " + lastInitial : ""}`.replace(/[\\/:*?"<>|#%]/g, "");
}

export async function syncDocs({ gql, tag, log = console.log }) {
  for (const k of ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"]) {
    if (!process.env[k]) { log(`DOCS step skipped: ${k} not set`); return { skipped: true }; }
  }
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const d = await gql(`query($q: String!) { orders(first: 40, query: $q, sortKey: CREATED_AT) { nodes {
      id name tags createdAt customAttributes { key value }
      shippingAddress { firstName lastName name address1 address2 city provinceCode zip }
      lineItems(first: 60) { nodes { name sku quantity } }
      fulfillments { status shippingLabel { shippingDocuments { documentType url } } } } } }`,
    { q: `fulfillment_status:shipped created_at:>=${since} -tag:docs-saved -tag:docs-none` });
  const orders = d.orders.nodes;
  if (!orders.length) { log("DOCS: nothing to do"); return { saved: 0 }; }

  const tok = await graphToken();
  const day = chicagoDate();
  const folder = await ensureFolder(tok, PARENT, day);
  await ensureFolder(tok, folder, "Shipped");
  log(`DOCS: ${orders.length} order(s) -> shopify orders/${day}`);

  let saved = 0, errors = 0;
  for (const o of orders) {
    const num = o.name.replace("#", "");
    try {
      const labels = o.fulfillments.filter((f) => f.status !== "CANCELLED")
        .flatMap((f) => f.shippingLabel?.shippingDocuments || []).filter((x) => x.documentType === "LABEL" && x.url);
      if (!labels.length) { log(`DOCS ${o.name}: no Shopify label to print (shipped another way)`); await tag(o.id, ["docs-none"]); continue; }
      const who = shortName(o);
      const results = [];
      for (let i = 0; i < labels.length; i++) {
        const r = await fetch(labels[i].url, { signal: AbortSignal.timeout(60000) });
        if (!r.ok) throw new Error(`label download failed ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.subarray(0, 4).toString() !== "%PDF") throw new Error("label download is not a PDF");
        const size = pdfPageSize(buf);
        const warn = size && (size[0] !== 288 || size[1] !== 432) ? ` (WARNING: label is ${size[0]}x${size[1]} pt, not 4x6)` : "";
        const name = `${who} shipping label ${num}${labels.length > 1 ? ` (${i + 1})` : ""}.pdf`;
        results.push(`${name}: ${await upload(tok, folder, name, buf)}${warn}`);
      }
      const slipName = `${who} packing slip ${num}.pdf`;
      results.push(`${slipName}: ${await upload(tok, folder, slipName, await buildSlip(o))}`);
      await tag(o.id, ["docs-saved"]);
      saved++;
      log(`DOCS ${o.name}: ${results.join("; ")}`);
    } catch (e) {
      errors++;
      log(`DOCS ERROR ${o.name}: ${e.message}`);
    }
  }
  return { saved, errors };
}
