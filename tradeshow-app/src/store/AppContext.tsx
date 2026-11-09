import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Address, Customer, Order, Product, Session } from '../types';
import { Rep } from '../reps';
import { newId } from './id';
import * as db from './db';
import { LeadCapture, MockSalesforceAdapter, PushLeadResult } from '../salesforce/adapter';
import { RestSalesforceAdapter } from '../salesforce/restAdapter';
import { brand } from '../brand';
import { fetchRemoteCatalog } from '../catalog/remote';
import { BACKEND_URL, usesRemoteCatalog } from '../config';

// Live when a backend is configured: orders POST to the backend, which sends
// the confirmation email and creates the Salesforce Lead + Opportunity. With no
// backend we fall back to the offline mock so the app stays clickable.
const adapter = BACKEND_URL
  ? new RestSalesforceAdapter(BACKEND_URL)
  : new MockSalesforceAdapter(/* failureRate */ 0);

interface AppState {
  loading: boolean;
  session: Session | null;
  products: Product[];
  customers: Customer[];
  orders: Order[];
  adapterLabel: string;

  // auth
  login: (repName: string, eventName: string) => Promise<void>;
  logout: () => Promise<void>;

  // catalog
  upsertProduct: (p: Partial<Product> & { name: string }) => Promise<void>;
  toggleProductActive: (id: string) => Promise<void>;
  /** Set the kiosk (show) price for a product; null = use the SOS list price. */
  setProductPrice: (id: string, value: number | null) => Promise<void>;
  /** Whether the catalog is managed remotely (SOS via backend). */
  remoteCatalog: boolean;
  catalogSyncing: boolean;
  lastCatalogSync: string | null;
  catalogError: string | null;
  refreshCatalog: () => Promise<void>;

  // booth rep (device setting used for order attribution)
  boothRep: Rep | null;
  setBoothRep: (r: Rep | null) => Promise<void>;
  // the show/event (device setting; stored as Salesforce LeadSource)
  boothEvent: string;
  setBoothEvent: (name: string) => Promise<void>;

  // customers
  addCustomer: (c: Omit<Customer, 'id'>) => Promise<Customer>;

  // lead-only capture (not ordering today) -> Salesforce Lead for this show
  captureLead: (info: {
    name: string;
    company: string;
    email: string;
    phone: string;
    shippingAddress?: Address | null;
    billingAddress?: Address | null;
    notes?: string;
  }) => Promise<PushLeadResult>;

  // orders
  submitOrder: (
    draft: Omit<Order, 'id' | 'createdAt' | 'status' | 'repName' | 'eventName'>
  ) => Promise<Order>;
  syncPending: () => Promise<void>;
  pendingCount: number;
}

const Ctx = createContext<AppState | undefined>(undefined);

// Apply the admin's overrides, which live in separate maps (db) so they survive
// SOS re-syncs:
//  - approval: a product is shown to customers only if approved (default hidden)
//  - show price: `price` uses the per-product override if set, else the SOS list
//    price (preserved in `listPrice`)
function applyCatalog(
  list: Product[],
  approvals: db.ApprovalMap,
  prices: db.PriceMap
): Product[] {
  return list.map((p) => {
    const listPrice = p.listPrice != null ? p.listPrice : p.price; // SOS list price
    const override = prices[p.id];
    return {
      ...p,
      listPrice,
      price: override != null ? override : listPrice,
      active: approvals[p.id] === true,
    };
  });
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [lastCatalogSync, setLastCatalogSync] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [boothRep, setBoothRepState] = useState<Rep | null>(null);
  const [boothEvent, setBoothEventState] = useState<string>('');
  const approvalsRef = useRef<db.ApprovalMap>({});
  const pricesRef = useRef<db.PriceMap>({});
  const syncing = useRef(false);

  // Pull the shared catalog from the backend (SOS). Falls back to the locally
  // cached products on failure, so booths keep working offline.
  const refreshCatalog = useCallback(async () => {
    if (!usesRemoteCatalog) return;
    setCatalogSyncing(true);
    setCatalogError(null);
    try {
      const remote = await fetchRemoteCatalog();
      if (remote && remote.length > 0) {
        // Apply approvals + show prices so curation survives the sync; new SOS
        // items arrive hidden and at list price until the admin changes them.
        const applied = applyCatalog(remote, approvalsRef.current, pricesRef.current);
        setProducts(applied);
        db.saveProducts(applied); // cache for offline
        setLastCatalogSync(new Date().toISOString());
      }
    } catch (e) {
      setCatalogError(e instanceof Error ? e.message : 'Catalog sync failed');
    } finally {
      setCatalogSyncing(false);
    }
  }, []);

  // Initial load.
  useEffect(() => {
    (async () => {
      await db.ensureSeeded();
      const [s, p, c, o, br, be, appr, prices] = await Promise.all([
        db.getSession(),
        db.getProducts(),
        db.getCustomers(),
        db.getOrders(),
        db.getBoothRep(),
        db.getBoothEvent(),
        db.getApprovals(),
        db.getPrices(),
      ]);
      approvalsRef.current = appr;
      pricesRef.current = prices;
      setSession(s);
      setProducts(applyCatalog(p, appr, prices)); // approvals + show prices applied
      setCustomers(c);
      setOrders(o);
      setBoothRepState(br);
      setBoothEventState(be ?? '');
      setLoading(false);
      // Then refresh from the backend in the background.
      refreshCatalog();
    })();
  }, [refreshCatalog]);

  const login = useCallback(async (repName: string, eventName: string) => {
    const s: Session = { repName: repName.trim(), eventName: eventName.trim() };
    await db.saveSession(s);
    setSession(s);
  }, []);

  const logout = useCallback(async () => {
    await db.saveSession(null);
    setSession(null);
  }, []);

  const setBoothRep = useCallback(async (r: Rep | null) => {
    await db.saveBoothRep(r);
    setBoothRepState(r);
  }, []);

  const setBoothEvent = useCallback(async (name: string) => {
    const v = name.trim();
    await db.saveBoothEvent(v || null);
    setBoothEventState(v);
  }, []);

  const upsertProduct = useCallback(
    async (p: Partial<Product> & { name: string }) => {
      setProducts((prev) => {
        let next: Product[];
        if (p.id && prev.some((x) => x.id === p.id)) {
          // Edit: visibility stays approval-derived and price stays override-
          // derived (the editor sets the price through setProductPrice), so the
          // form can't silently flip either.
          next = prev.map((x) => {
            if (x.id !== p.id) return x;
            const listPrice = x.listPrice != null ? x.listPrice : x.price;
            const override = pricesRef.current[x.id];
            return {
              ...x,
              ...p,
              listPrice,
              price: override != null ? override : listPrice,
              active: approvalsRef.current[x.id] === true,
            };
          });
        } else {
          const id = p.id ?? newId();
          // A product the admin adds by hand is approved (shown) by default.
          const nextApprovals: db.ApprovalMap = { ...approvalsRef.current, [id]: true };
          approvalsRef.current = nextApprovals;
          db.saveApprovals(nextApprovals);
          const base = p.price ?? 0;
          const created: Product = {
            id,
            name: p.name,
            sku: p.sku ?? '',
            price: base,
            listPrice: base,
            unit: p.unit ?? 'each',
            active: true,
            description: p.description ?? '',
            highlights: p.highlights ?? [],
            imageUri: p.imageUri ?? null,
            salesforceId: null,
          };
          next = [created, ...prev];
        }
        db.saveProducts(next);
        return next;
      });
    },
    []
  );

  // Approve / un-approve a product (show or hide it from customers). Persisted
  // to the approvals map so it survives SOS re-syncs.
  const toggleProductActive = useCallback(async (id: string) => {
    const nextApprovals: db.ApprovalMap = {
      ...approvalsRef.current,
      [id]: !(approvalsRef.current[id] === true),
    };
    approvalsRef.current = nextApprovals;
    db.saveApprovals(nextApprovals);
    setProducts((prev) => {
      const next = prev.map((x) =>
        x.id === id ? { ...x, active: nextApprovals[id] === true } : x
      );
      db.saveProducts(next);
      return next;
    });
  }, []);

  // Set the show price for a product (what the kiosk charges). Pass null to
  // clear it and fall back to the SOS list price. Survives SOS re-syncs.
  const setProductPrice = useCallback(async (id: string, value: number | null) => {
    const next: db.PriceMap = { ...pricesRef.current };
    if (value == null || Number.isNaN(value)) delete next[id];
    else next[id] = value;
    pricesRef.current = next;
    db.savePrices(next);
    setProducts((prev) => {
      const updated = prev.map((x) => {
        if (x.id !== id) return x;
        const listPrice = x.listPrice != null ? x.listPrice : x.price;
        return { ...x, listPrice, price: next[id] != null ? next[id] : listPrice };
      });
      db.saveProducts(updated);
      return updated;
    });
  }, []);

  const captureLead = useCallback(
    async (info: {
      name: string;
      company: string;
      email: string;
      phone: string;
      shippingAddress?: Address | null;
      billingAddress?: Address | null;
      notes?: string;
    }): Promise<PushLeadResult> => {
      const lead: LeadCapture = {
        contact: { name: info.name.trim(), email: info.email.trim(), phone: info.phone.trim() },
        account: { name: info.company.trim() },
        shippingAddress: info.shippingAddress ?? null,
        billingAddress: info.billingAddress ?? null,
        eventName: boothEvent || brand.eventName,
        repName: boothRep?.name ?? brand.deviceName,
        repSosId: boothRep?.sosId ?? null,
        notes: info.notes,
      };
      return adapter.pushLead(lead);
    },
    [boothRep, boothEvent]
  );

  const addCustomer = useCallback(async (c: Omit<Customer, 'id'>) => {
    const created: Customer = { ...c, id: newId(), salesforceId: null };
    setCustomers((prev) => {
      const next = [created, ...prev];
      db.saveCustomers(next);
      return next;
    });
    return created;
  }, []);

  // Try to push a single order; returns the updated order.
  const pushOne = useCallback(async (order: Order): Promise<Order> => {
    try {
      const { salesforceId } = await adapter.pushOrder(order);
      return { ...order, status: 'synced', salesforceId, syncError: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return { ...order, status: 'pending', syncError: msg };
    }
  }, []);

  const persistOrders = useCallback((next: Order[]) => {
    setOrders(next);
    db.saveOrders(next);
  }, []);

  const syncPending = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      // Snapshot current orders needing sync.
      const current = await db.getOrders();
      const toSync = current.filter(
        (o) => o.status === 'pending' || o.status === 'error'
      );
      if (toSync.length === 0) return;

      // Mark them syncing for UI feedback.
      let working = current.map((o) =>
        toSync.some((t) => t.id === o.id) ? { ...o, status: 'syncing' as const } : o
      );
      persistOrders(working);

      for (const o of toSync) {
        const updated = await pushOne({ ...o, status: 'syncing' });
        working = working.map((x) => (x.id === o.id ? updated : x));
        persistOrders(working);
      }
    } finally {
      syncing.current = false;
    }
  }, [persistOrders, pushOne]);

  const submitOrder = useCallback(
    async (
      draft: Omit<Order, 'id' | 'createdAt' | 'status' | 'repName' | 'eventName'>
    ) => {
      const order: Order = {
        ...draft,
        id: newId(),
        createdAt: new Date().toISOString(),
        status: 'pending',
        repName: boothRep?.name ?? brand.deviceName,
        repSosId: boothRep?.sosId ?? null,
        eventName: boothEvent || brand.eventName,
        salesforceId: null,
        syncError: null,
      };
      // Persist immediately (so nothing is lost even offline)...
      const withNew = [order, ...(await db.getOrders())];
      persistOrders(withNew);
      // ...then attempt to sync in the background.
      const pushed = await pushOne({ ...order, status: 'syncing' });
      persistOrders(withNew.map((o) => (o.id === order.id ? pushed : o)));
      return pushed;
    },
    [persistOrders, pushOne, boothRep, boothEvent]
  );

  const pendingCount = useMemo(
    () => orders.filter((o) => o.status === 'pending' || o.status === 'error').length,
    [orders]
  );

  const value: AppState = {
    loading,
    session,
    products,
    customers,
    orders,
    adapterLabel: adapter.label,
    login,
    logout,
    boothRep,
    setBoothRep,
    boothEvent,
    setBoothEvent,
    upsertProduct,
    toggleProductActive,
    setProductPrice,
    remoteCatalog: usesRemoteCatalog,
    catalogSyncing,
    lastCatalogSync,
    catalogError,
    refreshCatalog,
    addCustomer,
    captureLead,
    submitOrder,
    syncPending,
    pendingCount,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
