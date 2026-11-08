import { BACKEND_URL } from '../config';

export interface CardFields {
  name: string;
  company: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

// Sends a business-card photo to the backend, which uses AI vision to extract
// the contact fields. Returns null if no backend is configured.
export async function scanBusinessCard(
  imageBase64: string,
  mediaType = 'image/jpeg'
): Promise<CardFields | null> {
  if (!BACKEND_URL) return null;
  const res = await fetch(`${BACKEND_URL}/api/scan-card`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mediaType }),
  });
  if (!res.ok) {
    throw new Error(`Scan failed (${res.status})`);
  }
  const data = await res.json();
  return (data.fields ?? null) as CardFields | null;
}
