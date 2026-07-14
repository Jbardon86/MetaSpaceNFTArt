import { Customer, Product } from '../types';
import { newId } from '../store/id';

// Placeholder catalog so the app is usable on first launch. These are SAMPLES —
// replace them with your real products in the Staff → Catalog screen (add a
// name, price, description, and photo for each).
export function seedProducts(): Product[] {
  return [
    {
      name: 'Sample Product 1',
      sku: 'SAMPLE-1',
      price: 100,
      unit: 'each',
      description: 'This is a sample. Edit it or add your own products in the Catalog.',
    },
    {
      name: 'Sample Product 2',
      sku: 'SAMPLE-2',
      price: 250,
      unit: 'each',
      description: 'This is a sample. Edit it or add your own products in the Catalog.',
    },
    {
      name: 'Sample Product 3',
      sku: 'SAMPLE-3',
      price: 45,
      unit: 'each',
      description: 'This is a sample. Edit it or add your own products in the Catalog.',
    },
  ].map((p) => ({ ...p, id: newId(), active: true, salesforceId: null, imageUri: null }));
}

export function seedCustomers(): Customer[] {
  // Kiosk customers enter their own details, so we start with an empty list.
  return [];
}
