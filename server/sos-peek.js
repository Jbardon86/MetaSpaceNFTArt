// Quick look at your SOS items using the access token you already got.
// Non-sensitive product info only. Run:
//   export SOS_ACCESS_TOKEN=your_access_token
//   node server/sos-peek.js
//
// (If it says 401, the access token expired — re-run the sos-auth Step 1 & 2 to
//  get a fresh one, then export it again.)

const BASE = process.env.SOS_BASE_URL || 'https://api.sosinventory.com';
const token = process.env.SOS_ACCESS_TOKEN;
if (!token) {
  console.error('First run:  export SOS_ACCESS_TOKEN=your_access_token');
  process.exit(1);
}

(async () => {
  const res = await fetch(`${BASE}/api/v2/items?count=300`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`Fetch failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data : data.data || data.items || [];
  console.log(`\nTotal items returned: ${items.length}`);

  const byType = {};
  items.forEach((i) => (byType[i.type] = (byType[i.type] || 0) + 1));
  console.log('By type:', byType);

  const sellable = items.filter(
    (i) => i.type !== 'Category' && !i.archived && i.showOnSalesForms !== false
  );
  console.log(`\nSellable products: ${sellable.length}`);
  console.log('name | type | price | sku | hasImage');
  sellable.slice(0, 30).forEach((i) => {
    console.log(`  ${i.name} | ${i.type} | $${i.salesPrice} | ${i.sku || '—'} | ${i.hasImage}`);
  });
  const withImg = sellable.filter((i) => i.hasImage).length;
  console.log(`\n${withImg} of ${sellable.length} sellable products have an image in SOS.`);
})();
