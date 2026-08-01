'use strict';

// Generates an X12 810 (Invoice) — the "re-invoice" a disputed Walmart
// deduction is actually submitted as. This is the submission artifact behind
// the Recovery Submission summary: STAT's recovery mechanism *is* this file.
//
// The segment layout and the constant fields are reverse-engineered from STAT's
// real production 810 for this vendor (540153EDI810900000000.edi — 137 live
// transactions), so it matches what Walmart's AP accepts. Output is standard
// X12 that flows through the vendor's EDI provider (TrueCommerce).
//
// A recovered dispute is re-invoiced under a NEW invoice number (the rebill
// "New Inv #"), referencing the original PO, for the disputed merchandise.

function round2(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

// Item master seeded from STAT's 810: our QBO item description -> the Walmart
// Buyer's Item Number (the IT1 "IN" qualifier the 810 needs, which isn't in
// QBO). Extend as new items get disputed. Matched loosely (case/space-
// insensitive) since QBO's abbreviations vary slightly.
// Seeded from STAT's real accepted 810 (each-level: IN = Walmart item #, UP =
// UPC-12, VN = vendor part #, UK = GTIN-14, unitPrice = per-EA). The 810 bills in
// eaches at these prices — NOT the case price — so Walmart's item/price match
// succeeds. Extend as new items get disputed.
const SEED_ITEM_MASTER = {
  'MM STRAW CHOCO 4PK':   { itemNumber: '554935983', unitPrice: 0.68, upc: '803810234951', vendorPart: '4403-23495', gtin: '00803810234951' },
  'MM STRAW STRWBRY 4PK': { itemNumber: '554935984', unitPrice: 0.68, upc: '803810234968', vendorPart: '4403-23496', gtin: '00803810234968' },
  'MM STRAW CKCRM 4PK':   { itemNumber: '554935985', unitPrice: 0.68, upc: '803810234975', vendorPart: '4403-23497', gtin: '00803810234975' },
  'MM VARIETY 24PK':      { itemNumber: '650044391', unitPrice: 3.02, upc: '803810243557', vendorPart: '42523-24356', gtin: '00803810243557' },
  'MM BIRTHDAY 4PK':      { itemNumber: '650081360', unitPrice: 0.68, upc: '803810235637', vendorPart: '4403-23567', gtin: '00803810235637' },
  'MM UNICORN 4PK':       { itemNumber: '650081361', unitPrice: 0.68, upc: '803810235620', vendorPart: '4403-23566', gtin: '00803810235620' },
  'MM VANILLA MILKSHAKE': { itemNumber: '650081362', unitPrice: 0.68, upc: '803810235804', vendorPart: '4403-23574', gtin: '00803810235804' },
  'MM STRAWBRRY 24CT':    { itemNumber: '650081364', unitPrice: 3.02, upc: '803810232896', vendorPart: '42517-23310', gtin: '00803810232896' },
  'MM CHOCOLATE 24PK':    { itemNumber: '650081371', unitPrice: 3.02, upc: '803810232889', vendorPart: '42505-23309', gtin: '00803810232889' },
};

const SUPPLIER = { name: 'Endless Fun, LLC' };
const SHIP_TO = { name: 'WALMART', addr: '702 SW 8TH ST', city: 'BENTONVILLE', state: 'AR', zip: '72716', country: 'US' };

// EDI constants for this vendor / dept 92. Overridable via config — senderId is
// the interchange (ISA) sender ID and MUST be the vendor's own EDI mailbox, not
// STAT's. The vendor-level refs (refIA/refDP) are Endless Fun's vendor 540153,
// so they carry over; only the transport identity (senderId + qualifiers) and
// usage come from the saved config.
const EDI_DEFAULTS = {
  senderId: '5074121162', // fallback only; the route supplies the saved value
  senderQual: '12',
  receiverId: '925485US00', // Walmart
  receiverQual: '08',
  refIA: '540153920', // vendor ref, matched to STAT's accepted 810
  usage: 'P', // P = production, T = test (route defaults this to T)
};

// --- helpers ---------------------------------------------------------------

function padRight(s, n) {
  return String(s == null ? '' : s).padEnd(n, ' ').slice(0, n);
}
function ymd(dateIso) {
  const m = String(dateIso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}
function cents(amount) {
  return Math.round((Number(amount) || 0) * 100);
}
function normDesc(d) {
  return String(d || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function price3(p) {
  return (Number(p) || 0).toFixed(3);
}
// IT1 unit price — 2 decimals, matching STAT's accepted 810 (e.g. 0.68, 3.02).
function money2(p) {
  return (Number(p) || 0).toFixed(2);
}
function upcFromMemo(memo) {
  const m = String(memo || '').match(/\b(\d{12,14})\b/);
  return m ? m[1] : '';
}
function lookupItem(description, master) {
  const key = normDesc(description);
  for (const [d, v] of Object.entries(master)) if (normDesc(d) === key) return v;
  return null;
}

/** The Walmart Buyer's Item Number for a description, or '' if unknown. */
function itemNumberFor(description, master) {
  const found = lookupItem(description, { ...SEED_ITEM_MASTER, ...(master || {}) });
  return found ? found.itemNumber : '';
}

/**
 * Decide the line items to re-invoice for a claim. Priority:
 *   1. explicit claim.items (user-confirmed shorted SKUs)
 *   2. inference from the QBO invoice — a single unit price that divides the
 *      disputed amount into a whole quantity, and only one SKU at that price
 *   3. a single summary line at the disputed amount (flagged needsItemDetail)
 * Returns { lines: [{description, quantity, unitPrice, itemNumber}], needsItemDetail }.
 */
function resolveLineItems(claim, invoiceLines, master) {
  const amount = round2(claim.amount);
  const m = { ...SEED_ITEM_MASTER, ...(master || {}) };

  const enrich = (it) => {
    const found = lookupItem(it.description, m);
    return {
      description: it.description || '',
      quantity: Number(it.quantity) || 0,
      unitPrice: round2(it.unitPrice != null ? it.unitPrice : found && found.unitPrice),
      itemNumber: it.itemNumber || (found && found.itemNumber) || '',
      upc: it.upc || (found && found.upc) || '',
      vendorPart: it.vendorPart || (found && found.vendorPart) || '',
      gtin: it.gtin || (found && found.gtin) || '',
    };
  };

  if (Array.isArray(claim.items) && claim.items.length) {
    const lines = claim.items.map(enrich);
    return { lines, needsItemDetail: lines.some((l) => !l.itemNumber) };
  }

  const lines = Array.isArray(invoiceLines) ? invoiceLines : [];
  const prices = [...new Set(lines.map((l) => round2(l.unitPrice)).filter((p) => p > 0))];
  const divisors = prices.filter((p) => Math.abs(amount / p - Math.round(amount / p)) < 0.001 && Math.round(amount / p) > 0);
  if (divisors.length === 1) {
    const price = divisors[0];
    const atPrice = lines.filter((l) => Math.abs(round2(l.unitPrice) - price) < 0.001);
    if (atPrice.length === 1) {
      const l = enrich({ description: atPrice[0].description, quantity: Math.round(amount / price), unitPrice: price });
      return { lines: [l], needsItemDetail: !l.itemNumber };
    }
  }

  return {
    lines: [{ description: `Merchandise billed not shipped (inv ${claim.invoice})`, quantity: 1, unitPrice: amount, itemNumber: '' }],
    needsItemDetail: true,
  };
}

/**
 * Build the segment list for one 810 transaction (one rebill). `input`:
 *   { claim, invoiceLines, locationUpc, invoiceDate, poDate }
 * Returns { segments: [...], needsItemDetail, total }.
 */
function buildTransaction(input, stCtrl, config, master) {
  const { claim } = input;
  const cfg = { ...EDI_DEFAULTS, ...(config || {}) };
  const { lines, needsItemDetail } = resolveLineItems(claim, input.invoiceLines, master);
  const total = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const shipDate = ymd(claim.shipDate || input.shipDate);

  const seg = [];
  seg.push(`ST*810*${stCtrl}`);
  // BIG: rebill invoice date, rebill number, PO date, PO number
  seg.push(`BIG*${ymd(input.invoiceDate)}*${claim.newInvoice || ''}*${ymd(input.poDate || claim.shipDate)}*${claim.po || ''}`);
  seg.push(`REF*IA*${cfg.refIA}`);
  seg.push(`N1*SU*${SUPPLIER.name}`);
  seg.push(`N1*ST*${SHIP_TO.name}${input.locationUpc ? `*UL*${input.locationUpc}` : ''}`);
  seg.push(`N3*${SHIP_TO.addr}`);
  seg.push(`N4*${SHIP_TO.city}*${SHIP_TO.state}*${SHIP_TO.zip}*${SHIP_TO.country}`);
  seg.push('ITD*08**2**30**45'); // 2% 30, net 45 — matched to STAT's accepted 810
  if (shipDate) seg.push(`DTM*011*${shipDate}`);
  seg.push('FOB*PP');
  let qtyTotal = 0;
  let lineNo = 0;
  for (const l of lines) {
    lineNo += 1;
    qtyTotal += l.quantity;
    // IT1*<line>*<qty>*EA*<each price>**IN*<item#>*UP*<UPC>***VN*<vendor part>*UK*<GTIN>
    let it1 = `IT1*${lineNo}*${l.quantity}*EA*${money2(l.unitPrice)}`;
    if (l.itemNumber) it1 += `**IN*${l.itemNumber}`;
    if (l.upc) it1 += `*UP*${l.upc}`;
    if (l.gtin || l.vendorPart) it1 += `***VN*${l.vendorPart || ''}*UK*${l.gtin || ''}`;
    seg.push(it1);
    seg.push(`PID*F****${l.description}`);
  }
  seg.push(`TDS*${cents(total)}`);
  seg.push(`ISS*${qtyTotal}*EA`);
  seg.push(`CTT*${lines.length}`);
  // SE count includes ST and SE themselves.
  seg.push(`SE*${seg.length + 1}*${stCtrl}`);
  return { segments: seg, needsItemDetail, total };
}

/**
 * Build a full X12 810 interchange for a batch of claims.
 * @param items  [{ claim, invoiceLines?, locationUpc?, invoiceDate?, poDate? }]
 * @param opts   { config, control (9-digit string/number), now (Date iso),
 *                 itemMaster }
 * Returns { edi, transactions: [{ id, newInvoice, total, needsItemDetail }], warnings }.
 */
function buildEdi810(items, opts = {}) {
  const cfg = { ...EDI_DEFAULTS, ...(opts.config || {}) };
  const master = { ...SEED_ITEM_MASTER, ...(opts.itemMaster || {}) };
  const ctrl = String(opts.control || '1').replace(/\D/g, '').padStart(9, '0').slice(-9);
  const iso = opts.now || '2026-01-01T00:00:00.000Z';
  const dm = String(iso).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/) || [];
  const ccyymmdd = dm.length ? `${dm[1]}${dm[2]}${dm[3]}` : '';
  const yymmdd = ccyymmdd.slice(2);
  const hhmm = dm.length ? `${dm[4]}${dm[5]}` : '0000';

  const warnings = [];
  const transactions = [];
  const body = [];
  let stCtrl = 0;
  for (const it of items) {
    stCtrl += 1;
    const ctrlStr = String(stCtrl).padStart(4, '0');
    const t = buildTransaction(it, ctrlStr, cfg, master);
    body.push(...t.segments);
    transactions.push({ id: it.claim.id, newInvoice: it.claim.newInvoice, total: t.total, needsItemDetail: t.needsItemDetail });
    if (t.needsItemDetail) {
      warnings.push(`Claim ${it.claim.invoice}: the exact shorted item could not be determined - re-invoiced as a summary line. Confirm the SKU/quantity before sending.`);
    }
  }

  const isa =
    `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}` +
    `*${padRight(cfg.senderQual, 2)}*${padRight(cfg.senderId, 15)}*${padRight(cfg.receiverQual, 2)}*${padRight(cfg.receiverId, 15)}` +
    `*${yymmdd}*${hhmm}*:*00501*${ctrl}*0*${cfg.usage}*:`;
  const gs = `GS*IN*${cfg.senderId}*${cfg.receiverId}*${ccyymmdd}*${hhmm}*${Number(ctrl)}*X*005010`;
  const ge = `GE*${transactions.length}*${Number(ctrl)}`;
  const iea = `IEA*1*${ctrl}`;

  const all = [isa, gs, ...body, ge, iea];
  const edi = all.join('~\n') + '~\n';
  return { edi, transactions, warnings };
}

module.exports = {
  buildEdi810,
  buildTransaction,
  resolveLineItems,
  itemNumberFor,
  upcFromMemo,
  SEED_ITEM_MASTER,
  EDI_DEFAULTS,
};
