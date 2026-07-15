// App configuration.
//
// BACKEND_URL: your deployed backend's base URL. When set, the app pulls the
// shared product catalog from it (which comes from SOS Inventory). When empty,
// the app uses its local catalog (the sample seed + any in-app edits).
//
// After you deploy the backend, set this to e.g.
//   'https://endlessfun-orders.onrender.com'
export const BACKEND_URL = 'https://endlessfun-orders-backend.onrender.com';

/** True when the app should use the shared (SOS) catalog via the backend. */
export const usesRemoteCatalog = BACKEND_URL.length > 0;
