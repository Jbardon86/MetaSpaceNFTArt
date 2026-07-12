import AsyncStorage from '@react-native-async-storage/async-storage';
import { Customer, Order, Product, Session } from '../types';
import { seedCustomers, seedProducts } from '../data/seed';

// Thin persistence layer. Everything is stored as JSON under a few keys.
// This is the local source of truth; the Salesforce adapter syncs from here.
// Swapping AsyncStorage for expo-sqlite later would only touch this file.

const KEYS = {
  products: 'tso.products',
  customers: 'tso.customers',
  orders: 'tso.orders',
  session: 'tso.session',
  // Bump this version to re-seed the sample catalog for existing installs
  // (e.g. after adding photos to the seed data).
  seeded: 'tso.seeded.v2',
};

async function readJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJSON<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/** Seed initial catalog + sample customers on first launch only. */
export async function ensureSeeded(): Promise<void> {
  const seeded = await AsyncStorage.getItem(KEYS.seeded);
  if (seeded) return;
  await writeJSON(KEYS.products, seedProducts());
  await writeJSON(KEYS.customers, seedCustomers());
  await writeJSON(KEYS.orders, [] as Order[]);
  await AsyncStorage.setItem(KEYS.seeded, '1');
}

// ---- Products ----
export const getProducts = () => readJSON<Product[]>(KEYS.products, []);
export const saveProducts = (p: Product[]) => writeJSON(KEYS.products, p);

// ---- Customers ----
export const getCustomers = () => readJSON<Customer[]>(KEYS.customers, []);
export const saveCustomers = (c: Customer[]) => writeJSON(KEYS.customers, c);

// ---- Orders ----
export const getOrders = () => readJSON<Order[]>(KEYS.orders, []);
export const saveOrders = (o: Order[]) => writeJSON(KEYS.orders, o);

// ---- Session ----
export const getSession = () => readJSON<Session | null>(KEYS.session, null);
export const saveSession = (s: Session | null) =>
  s ? writeJSON(KEYS.session, s) : AsyncStorage.removeItem(KEYS.session);

/** Danger: wipe everything (used by "Reset demo data" in Settings). */
export async function resetAll(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}
