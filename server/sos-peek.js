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

const CANDIDATES = ['/api/v2/item', '/api/v1/item', '/api/v2/items', '/api/v1/items'];

(async () => {
  let items = null;
  let workingPath = '';
  let saw401 = false;
  for (const path of CANDIDATES) {
    const res = await fetch(`${BASE}${path}?count=300`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 401) {
      saw401 = true;
      console.log(`(${path} -> 401: endpoint exists, but token rejected/expired)`);
      continue;
    }
    if (!res.ok) {
      console.log(`(tried ${path} -> ${res.status})`);
      continue;
    }
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      console.log(`(${path} -> returned HTML, not the API — skipping)`);
      continue;
    }
    const data = JSON.parse(text);
    items = Array.isArray(data) ? data : data.data || data.items || [];
    workingPath = path;
    break;
  }
  if (!items) {
    if (saw401) {
      console.error(
        '\n⚠️  Your access token expired. Re-run the two sos-auth.js steps to get a FRESH token,\n' +
          '   then: export SOS_ACCESS_TOKEN=the_new_token  and run this again.'
      );
    } else {
      console.error('\nNo endpoint worked. Paste the (tried …) lines to me.');
    }
    process.exit(1);
  }
  console.log(`\n✅ Working items endpoint: ${workingPath}`);
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
