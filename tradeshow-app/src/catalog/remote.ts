import { BACKEND_URL } from '../config';
import { Product } from '../types';

// Fetches the shared catalog from the backend (which pulls it from SOS
// Inventory). Returns null when no backend is configured.

export async function fetchRemoteCatalog(): Promise<Product[] | null> {
  if (!BACKEND_URL) return null;
  const res = await fetch(`${BACKEND_URL}/api/catalog`);
  if (!res.ok) {
    throw new Error(`Catalog request failed: ${res.status}`);
  }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(normalizeProduct);
}

// Ensure a backend item matches the app's Product shape.
function normalizeProduct(raw: any): Product {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    sku: String(raw.sku ?? ''),
    price: Number(raw.price ?? 0),
    unit: String(raw.unit ?? 'each'),
    active: raw.active !== false,
    description: raw.description ?? '',
    highlights: Array.isArray(raw.highlights) ? raw.highlights : [],
    imageUri: raw.imageUri ?? null,
    salesforceId: raw.sosId ?? raw.salesforceId ?? null,
  };
}
