import { Customer, Product } from '../types';
import { newId } from '../store/id';

// Starter catalog so the app is usable immediately. Admins add/edit their own
// products in the Catalog screen; this is just seed data on first launch.
export function seedProducts(): Product[] {
  return [
    { name: 'Genesis Print — Small', sku: 'ART-GEN-S', price: 120, unit: 'each' },
    { name: 'Genesis Print — Large', sku: 'ART-GEN-L', price: 340, unit: 'each' },
    { name: 'Metaverse Canvas 24"', sku: 'CNV-24', price: 210, unit: 'each' },
    { name: 'Metaverse Canvas 36"', sku: 'CNV-36', price: 385, unit: 'each' },
    { name: 'NFT Redemption Card', sku: 'NFT-CARD', price: 45, unit: 'each' },
    { name: 'Collector Bundle (5-pack)', sku: 'BND-5', price: 500, unit: 'bundle' },
    { name: 'Framing Add-on', sku: 'ADD-FRAME', price: 60, unit: 'each' },
    { name: 'Express Shipping', sku: 'SVC-SHIP', price: 25, unit: 'order' },
  ].map((p) => ({ ...p, id: newId(), active: true, salesforceId: null }));
}

export function seedCustomers(): Customer[] {
  return [
    {
      name: 'Ava Thompson',
      company: 'Thompson Galleries',
      email: 'ava@thompsongalleries.com',
      phone: '(415) 555-0132',
    },
    {
      name: 'Marcus Lee',
      company: 'Lee Digital Collectibles',
      email: 'marcus@leedigital.io',
      phone: '(212) 555-0177',
    },
    {
      name: 'Priya Nair',
      company: 'Horizon Art Co.',
      email: 'priya@horizonart.co',
      phone: '(646) 555-0199',
    },
  ].map((c) => ({ ...c, id: newId(), salesforceId: null }));
}
