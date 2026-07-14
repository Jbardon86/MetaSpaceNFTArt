import { Customer, Order, Product, lineTotal } from '../types';
import { PushOrderResult, SalesforceAdapter } from './adapter';

// ---------------------------------------------------------------------------
// PHASE 2 SKELETON — not wired up yet.
//
// This talks to YOUR backend proxy (not Salesforce directly). The backend holds
// the Connected App consumer key/secret and handles OAuth token refresh, so no
// Salesforce secret ever ships inside the app. The app just calls simple REST
// endpoints on the proxy.
//
// To enable: set BACKEND_URL, implement the matching endpoints on the backend
// (see README "Phase 2"), and swap MockSalesforceAdapter for this in
// src/store/AppContext.tsx.
// ---------------------------------------------------------------------------

const BACKEND_URL = ''; // e.g. 'https://your-proxy.example.com'

/** Shape the app sends to the backend; backend maps this to Order + OrderItem. */
function toSalesforceOrderPayload(order: Order) {
  return {
    id: order.id,
    account: { name: order.customer.company, salesforceId: order.customer.salesforceId },
    contact: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone,
    },
    emailConfirmation: order.emailConfirmation ?? false,
    signature: order.signature ?? null,
    shippingAddress: order.shippingAddress ?? null,
    billingAddress: order.billingAddress ?? null,
    eventName: order.eventName,
    repName: order.repName,
    notes: order.notes,
    createdAt: order.createdAt,
    lines: order.lines.map((l) => ({
      productId: l.productId,
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      lineTotal: lineTotal(l),
    })),
  };
}

export class RestSalesforceAdapter implements SalesforceAdapter {
  readonly label = 'Salesforce (live)';

  constructor(
    private baseUrl: string = BACKEND_URL,
    private getAuthToken: () => Promise<string | null> = async () => null
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.baseUrl) {
      throw new Error('BACKEND_URL is not configured (still in Phase 1 mock mode).');
    }
    const token = await this.getAuthToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Backend ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  fetchProducts(): Promise<Product[]> {
    return this.request<Product[]>('/api/products');
  }

  fetchCustomers(): Promise<Customer[]> {
    return this.request<Customer[]>('/api/customers');
  }

  async pushOrder(order: Order): Promise<PushOrderResult> {
    return this.request<PushOrderResult>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(toSalesforceOrderPayload(order)),
    });
  }
}
