import { BACKEND_URL } from '../config';
import { CardFields } from './card';

export interface ScannedOrderLine {
  catalogId: string | null;
  description: string;
  quantity: number;
}

export interface ScannedOrder {
  customer: CardFields;
  lines: ScannedOrderLine[];
  notes: string;
}

// Sends a photo of a sales order form to the backend, which reads it AND matches
// each line to a catalog product. Returns null if no backend is configured.
export async function scanOrderForm(
  imageBase64: string,
  mediaType = 'image/jpeg'
): Promise<ScannedOrder | null> {
  if (!BACKEND_URL) return null;
  const res = await fetch(`${BACKEND_URL}/api/scan-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mediaType }),
  });
  if (!res.ok) {
    throw new Error(`Order scan failed (${res.status})`);
  }
  const data = await res.json();
  return {
    customer: data.customer ?? {},
    lines: Array.isArray(data.lines) ? data.lines : [],
    notes: data.notes ?? '',
  };
}
