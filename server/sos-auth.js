// One-time SOS Inventory authorization + discovery helper.
//
// Runs locally on your Mac. Your Client Secret and tokens stay on your machine
// — do NOT paste them into chat. This script:
//   1. Prints the SOS authorize URL (run with no code argument)
//   2. Exchanges the code for tokens, then probes the items endpoint and prints
//      ONE sample item so we can finalize the field mapping (run with the code)
//
// Usage (fill in your values; run from the repo root or the server/ folder):
//   SOS_CLIENT_ID=xxx SOS_REDIRECT_URI=https://endlessfun.biz/callback \
//     node server/sos-auth.js
//
//   SOS_CLIENT_ID=xxx SOS_CLIENT_SECRET=yyy SOS_REDIRECT_URI=https://endlessfun.biz/callback \
//     node server/sos-auth.js <the-code-from-the-redirect-url>
//
// Requires Node 18+ (uses built-in fetch). No npm install needed.

const BASE = process.env.SOS_BASE_URL || 'https://api.sosinventory.com';
const CLIENT_ID = process.env.SOS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SOS_CLIENT_SECRET || '';
const REDIRECT = process.env.SOS_REDIRECT_URI || 'https://endlessfun.biz/callback';
const code = process.argv[2];

if (!CLIENT_ID) {
  console.error('Set SOS_CLIENT_ID (and SOS_REDIRECT_URI) in the command.');
  process.exit(1);
}

if (!code) {
  const url =
    `${BASE}/oauth2/authorize?response_type=code` +
    `&client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}`;
  console.log('\n1) Open this URL in your browser, sign in to SOS, and click Approve:\n');
  console.log(url);
  console.log(
    '\n2) After approving, your browser lands on your redirect URL with "?code=..." in the address bar.'
  );
  console.log('   Copy that code, then re-run this command with the code at the end.\n');
  process.exit(0);
}

(async () => {
  // --- Exchange the authorization code for tokens ---
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const tokRes = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tokText = await tokRes.text();
  if (!tokRes.ok) {
    console.error(`\nToken exchange failed (${tokRes.status}):\n${tokText}\n`);
    process.exit(1);
  }
  const tokens = JSON.parse(tokText);
  console.log('\n✅ Got tokens. SAVE THESE somewhere safe — do NOT paste them in chat:\n');
  console.log('SOS_ACCESS_TOKEN=', tokens.access_token);
  console.log('SOS_REFRESH_TOKEN=', tokens.refresh_token);

  // --- Probe candidate item endpoints and show one sample item ---
  const candidates = ['/api/v2/items', '/api/v1/items', '/api/items', '/api/v2/item'];
  for (const path of candidates) {
    try {
      const res = await fetch(`${BASE}${path}?count=1`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        console.log(`\n(tried ${path} -> ${res.status})`);
        continue;
      }
      const data = await res.json();
      const first = Array.isArray(data) ? data[0] : data.data?.[0] || data.items?.[0] || data;
      console.log(`\n✅ Items endpoint that works: ${path}`);
      console.log('\n--- Paste the FIELD NAMES below to me (this is product data, safe to share) ---');
      console.log(JSON.stringify(first, null, 2));
      console.log('\n(You can redact any prices/quantities you prefer — I only need the field names.)');
      return;
    } catch (e) {
      console.log(`\n(error on ${path}: ${e.message})`);
    }
  }
  console.log('\nCould not find the items endpoint automatically — tell me and we will check the docs.');
})();
