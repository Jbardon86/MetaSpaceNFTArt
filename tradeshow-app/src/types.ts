// Core domain types for the tradeshow order-entry app.
// These are intentionally UI-friendly; the Salesforce adapter maps them to
// Salesforce objects (Account, Contact, Order, OrderItem, Product2).

export type ID = string;

/** A product a rep can add to an order. Managed in-app via the Catalog screen. */
export interface Product {
  id: ID;
  name: string;
  sku: string;
  /** Unit price in dollars. */
  price: number;
  /** e.g. "each", "case", "hour". Free text. */
  unit: string;
  active: boolean;
  /** Short marketing description shown on the product/checkout card. */
  description?: string;
  /** Short selling-point chips, e.g. ["Gluten Free", "Non-GMO"]. */
  highlights?: string[];
  /** Product photo — a data URI (picked photo) or an https image URL. */
  imageUri?: string | null;
  /** Salesforce Product2 Id once synced; null until then. */
  salesforceId?: string | null;
}

/** A customer captured at the booth. Maps to a Salesforce Account (+ Contact). */
export interface Customer {
  id: ID;
  name: string; // contact name
  company: string; // account name
  email: string;
  phone: string;
  /** Salesforce Account Id once synced; null until then. */
  salesforceId?: string | null;
}

/** One line on an order. */
export interface OrderLine {
  productId: ID;
  /** Snapshot of product details at time of order (prices can change later). */
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  /** Per-line discount as a percentage 0–100. */
  discountPct: number;
  /** Snapshot of the product photo at time of order. */
  imageUri?: string | null;
}

export type SyncStatus = 'draft' | 'pending' | 'syncing' | 'synced' | 'error';

/** A completed order, queued locally and pushed to Salesforce. */
export interface Order {
  id: ID;
  customer: Customer;
  lines: OrderLine[];
  notes: string;
  /** Name of the tradeshow / event, for reporting. */
  eventName: string;
  /** Rep who took the order. */
  repName: string;
  /** ISO timestamp string. */
  createdAt: string;
  status: SyncStatus;
  /** Salesforce Order Id once synced. */
  salesforceId?: string | null;
  /** Last sync error message, if status === 'error'. */
  syncError?: string | null;
}

/** The logged-in sales rep. */
export interface Session {
  repName: string;
  eventName: string;
}

// ---- Order math helpers (pure, easy to test) ----

export function lineTotal(line: OrderLine): number {
  const gross = line.unitPrice * line.quantity;
  const discount = gross * (line.discountPct / 100);
  return round2(gross - discount);
}

export function orderTotal(lines: OrderLine[]): number {
  return round2(lines.reduce((sum, l) => sum + lineTotal(l), 0));
}

export function orderItemCount(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}
