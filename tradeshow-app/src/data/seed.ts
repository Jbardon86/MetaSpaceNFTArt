import { Customer, Product } from '../types';
import { newId } from '../store/id';

// Starter catalog so the app is usable immediately. Admins add/edit their own
// products in the Catalog screen; this is just seed data on first launch.
export function seedProducts(): Product[] {
  return [
    {
      name: 'Genesis Print — Small',
      sku: 'ART-GEN-S',
      price: 120,
      unit: 'each',
      description: '12×12 archival giclée print, signed & numbered.',
      imageUri: 'https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400&q=80',
    },
    {
      name: 'Genesis Print — Large',
      sku: 'ART-GEN-L',
      price: 340,
      unit: 'each',
      description: '24×24 archival giclée print, gallery grade.',
      imageUri: 'https://images.unsplash.com/photo-1549887534-1541e9326642?w=400&q=80',
    },
    {
      name: 'Metaverse Canvas 24"',
      sku: 'CNV-24',
      price: 210,
      unit: 'each',
      description: 'Gallery-wrapped canvas, ready to hang.',
      imageUri: 'https://images.unsplash.com/photo-1578321272176-b7bbc0679853?w=400&q=80',
    },
    {
      name: 'Metaverse Canvas 36"',
      sku: 'CNV-36',
      price: 385,
      unit: 'each',
      description: 'Statement-size gallery canvas.',
      imageUri: 'https://images.unsplash.com/photo-1531913764164-f85c52e6e654?w=400&q=80',
    },
    {
      name: 'NFT Redemption Card',
      sku: 'NFT-CARD',
      price: 45,
      unit: 'each',
      description: 'Physical card with a scannable claim code.',
      imageUri: 'https://images.unsplash.com/photo-1621416894569-0f39ed31d247?w=400&q=80',
    },
    {
      name: 'Collector Bundle (5-pack)',
      sku: 'BND-5',
      price: 500,
      unit: 'bundle',
      description: 'Five curated prints at a bundle price.',
      imageUri: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=80',
    },
    { name: 'Framing Add-on', sku: 'ADD-FRAME', price: 60, unit: 'each', description: 'Premium wood frame.' },
    { name: 'Express Shipping', sku: 'SVC-SHIP', price: 25, unit: 'order', description: '2-day delivery.' },
  ].map((p) => ({ ...p, id: newId(), active: true, salesforceId: null, imageUri: (p as Partial<Product>).imageUri ?? null }));
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
