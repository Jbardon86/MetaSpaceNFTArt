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
const SEED_ITEM_MASTER = {
  'MM STRAW CHOCO 4PK': { itemNumber: '554935983', unitPrice: 9.52 },
  'MM STRAW CKCRM 4PK': { itemNumber: '554935985', unitPrice: 9.52 },
  'MM STRAW STRWBRY 4PK': { itemNumber: '554935984', unitPrice: 9.52 },
  'MM STRAWBRRY 24CT': { itemNumber: '650081364', unitPrice: 24.16 },
  'MM UNICORN 4PK': { itemNumber: '650081361', unitPrice: 9.52 },
  'MM VARIETY 24PK': { itemNumber: '650044391', unitPrice: 24.16 },
};

const SUPPLIER = { name: 'Endless Fun LLC' };
const SHIP_TO = { name: 'WALMART', addr: '702 SW 8TH ST', city: 'BENTONVILLE', state: 'AR', zip: '72716', country: 'US' };

// EDI constants STAT used for this vendor / dept 92. Overridable via config.
const EDI_DEFAULTS = {
  senderId: '5074121162',
  receiverId: '925485US00',
  refIA: '540153921',
  refDP: '00092',
  refMR: '0033',
  usage: 'P', // P = production, T = test
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
  seg.push(`REF*DP*${cfg.refDP}`);
  seg.push(`REF*MR*${cfg.refMR}`);
  seg.push(`N1*SU*${SUPPLIER.name}`);
  seg.push(`N1*ST*${SHIP_TO.name}${input.locationUpc ? `*UL*${input.locationUpc}` : ''}`);
  seg.push(`N3*${SHIP_TO.addr}`);
  seg.push(`N4*${SHIP_TO.city}*${SHIP_TO.state}*${SHIP_TO.zip}*${SHIP_TO.country}`);
  seg.push('ITD*05*3*****4');
  if (shipDate) seg.push(`DTM*011*${shipDate}`);
  seg.push('FOB*PP');
  let qtyTotal = 0;
  for (const l of lines) {
    qtyTotal += l.quantity;
    seg.push(`IT1**${l.quantity}*EA*${price3(l.unitPrice)}${l.itemNumber ? `**IN*${l.itemNumber}` : ''}`);
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
    `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*12*${padRight(cfg.senderId, 15)}*08*${padRight(cfg.receiverId, 15)}` +
    `*${yymmdd}*${hhmm}*:*00501*${ctrl}*0*${cfg.usage}*>`;
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
