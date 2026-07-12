import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Customer, Order, Product, Session } from '../types';
import { newId } from './id';
import * as db from './db';
import { MockSalesforceAdapter } from '../salesforce/adapter';
// Phase 2: import { RestSalesforceAdapter } from '../salesforce/restAdapter';

// Swap this line to go live in Phase 2:
//   const adapter = new RestSalesforceAdapter(BACKEND_URL, getToken);
const adapter = new MockSalesforceAdapter(/* failureRate */ 0);

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

  // customers
  addCustomer: (c: Omit<Customer, 'id'>) => Promise<Customer>;

  // orders
  submitOrder: (
    draft: Omit<Order, 'id' | 'createdAt' | 'status' | 'repName' | 'eventName'>
  ) => Promise<Order>;
  syncPending: () => Promise<void>;
  pendingCount: number;
}

const Ctx = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const syncing = useRef(false);

  // Initial load.
  useEffect(() => {
    (async () => {
      await db.ensureSeeded();
      const [s, p, c, o] = await Promise.all([
        db.getSession(),
        db.getProducts(),
        db.getCustomers(),
        db.getOrders(),
      ]);
      setSession(s);
      setProducts(p);
      setCustomers(c);
      setOrders(o);
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (repName: string, eventName: string) => {
    const s: Session = { repName: repName.trim(), eventName: eventName.trim() };
    await db.saveSession(s);
    setSession(s);
  }, []);

  const logout = useCallback(async () => {
    await db.saveSession(null);
    setSession(null);
  }, []);

  const upsertProduct = useCallback(
    async (p: Partial<Product> & { name: string }) => {
      setProducts((prev) => {
        let next: Product[];
        if (p.id && prev.some((x) => x.id === p.id)) {
          next = prev.map((x) => (x.id === p.id ? { ...x, ...p } : x));
        } else {
          const created: Product = {
            id: p.id ?? newId(),
            name: p.name,
            sku: p.sku ?? '',
            price: p.price ?? 0,
            unit: p.unit ?? 'each',
            active: p.active ?? true,
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

  const toggleProductActive = useCallback(async (id: string) => {
    setProducts((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, active: !x.active } : x));
      db.saveProducts(next);
      return next;
    });
  }, []);

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
        repName: session?.repName ?? 'Unknown Rep',
        eventName: session?.eventName ?? '',
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
    [persistOrders, pushOne, session]
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
    upsertProduct,
    toggleProductActive,
    addCustomer,
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
