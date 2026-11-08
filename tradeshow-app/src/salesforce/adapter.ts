import { Address, Customer, Order, Product } from '../types';
import { buildConfirmationEmail } from '../email/confirmation';

// ---------------------------------------------------------------------------
// SalesforceAdapter is the seam between the app and Salesforce.
//
// Phase 1 (now): MockSalesforceAdapter fakes the network so the whole app is
//   clickable with no credentials.
// Phase 2 (later): implement RestSalesforceAdapter that calls your backend
//   proxy, which holds the Connected App secret and talks to the Salesforce
//   REST API. The app code above this interface does NOT change.
// ---------------------------------------------------------------------------

export interface PushOrderResult {
  salesforceId: string;
}

/** A contact captured at the booth who isn't ordering today. */
export interface LeadCapture {
  contact: { name: string; email: string; phone: string };
  account: { name: string };
  shippingAddress?: Address | null;
  billingAddress?: Address | null;
  /** The show, stored as LeadSource in Salesforce. */
  eventName: string;
  /** Rep working the booth (for the Lead description). */
  repName: string;
  repSosId?: string | null;
  notes?: string;
}

export interface PushLeadResult {
  salesforceLeadId: string | null;
}

export interface SalesforceAdapter {
  /** Human label shown in the UI (e.g. "Mock (offline demo)"). */
  readonly label: string;

  /** Pull the product catalog from Salesforce (Product2 / Pricebook). */
  fetchProducts(): Promise<Product[]>;

  /** Pull customers/accounts from Salesforce. */
  fetchCustomers(): Promise<Customer[]>;

  /**
   * Push one order to Salesforce. Should create Account/Contact if needed,
   * then Order + OrderItems, and return the new Salesforce Order Id.
   * Throws on failure (network, validation) so the queue can retry.
   */
  pushOrder(order: Order): Promise<PushOrderResult>;

  /** Create a Lead only (no order) for a contact captured at the booth. */
  pushLead(lead: LeadCapture): Promise<PushLeadResult>;
}

// A deliberately imperfect fake: it adds latency and occasionally "fails" so
// the offline queue + retry UI can be exercised during the demo.
export class MockSalesforceAdapter implements SalesforceAdapter {
  readonly label = 'Mock Salesforce (offline demo)';

  // Toggle to simulate a flaky tradeshow connection. 0 = always succeed.
  constructor(private failureRate = 0) {}

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetchProducts(): Promise<Product[]> {
    await this.delay(400);
    // In the mock we don't override the local catalog; return empty so the
    // app keeps using its locally-managed products.
    return [];
  }

  async fetchCustomers(): Promise<Customer[]> {
    await this.delay(400);
    return [];
  }

  async pushOrder(order: Order): Promise<PushOrderResult> {
    await this.delay(900);
    if (this.failureRate > 0 && Math.random() < this.failureRate) {
      throw new Error('Simulated network error — order re-queued.');
    }
    // In the real backend, this is where the confirmation email is sent from
    // order@endlessfun.biz. The mock just logs what *would* be sent.
    if (order.emailConfirmation && order.customer.email) {
      const email = buildConfirmationEmail(order);
      console.log('[mock email] would send confirmation:', {
        from: email.from,
        to: email.to,
        subject: email.subject,
      });
    }

    // Pretend Salesforce returned a fresh 18-char-ish Order Id.
    const fakeId = `801${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
    return { salesforceId: fakeId };
  }

  async pushLead(lead: LeadCapture): Promise<PushLeadResult> {
    await this.delay(600);
    console.log('[mock lead] would create Salesforce Lead:', {
      name: lead.contact.name,
      company: lead.account.name,
      source: lead.eventName,
    });
    const fakeId = `00Q${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
    return { salesforceLeadId: fakeId };
  }
}
