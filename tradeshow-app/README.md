# MetaSpace Tradeshow Order App

A native mobile app for sales staff to capture orders at tradeshows and push
them to **Salesforce**. Built with **Expo (React Native)** so one codebase runs
on iOS (and Android). Works **offline** — orders queue locally and sync when a
connection returns.

> **Status: Phase 1 (working prototype).** The app is fully clickable end-to-end
> against a **mock Salesforce** — no credentials needed. Phase 2 swaps in the
> real Salesforce integration (see below).

---

## What it does

- **Sign in** with your name + the event (Phase 2 → Salesforce login).
- **New order** flow: pick/create a **customer** → add **products** with
  quantity steppers and a live total → **review** + notes → **submit**.
- **Offline-first:** every order is saved locally the instant you submit, then
  synced to Salesforce in the background. The Home screen shows each order's
  status (Pending / Syncing / Synced / Failed) with a **Sync now** / **Retry**.
- **Catalog admin:** add / edit / activate / deactivate products right in the
  app — no QuickBooks, no spreadsheet imports.

## Run it

Requires Node 18+ and the **Expo Go** app on your phone (App Store / Play Store).

```bash
cd tradeshow-app
npm install
npx expo start
```

Then scan the QR code with your iPhone camera (opens in Expo Go). Or press `i`
in the terminal to open the iOS simulator (macOS only).

On first launch the app seeds a sample catalog + a few customers so you can try
a full order immediately.

### Try the offline behavior
The mock adapter can simulate a flaky booth connection. In
`src/store/AppContext.tsx`:

```ts
const adapter = new MockSalesforceAdapter(/* failureRate */ 0.5); // 50% fail
```

Failed orders stay **Pending** and can be retried from the order detail screen
or the **Sync now** link on Home.

## Project layout

```
tradeshow-app/
├─ App.tsx                     # providers + navigation stack
├─ src/
│  ├─ types.ts                 # domain types + order math
│  ├─ theme.ts                 # colors / spacing / status colors
│  ├─ navigation.ts            # typed route params
│  ├─ components/ui.tsx        # Button, Field, Card, Badge, …
│  ├─ data/seed.ts             # first-launch catalog + customers
│  ├─ store/
│  │  ├─ db.ts                 # AsyncStorage persistence (local source of truth)
│  │  ├─ AppContext.tsx        # app state + sync engine (pick the adapter here)
│  │  └─ OrderDraft.tsx        # in-progress order across the 3 steps
│  ├─ salesforce/
│  │  ├─ adapter.ts            # SalesforceAdapter interface + MockSalesforceAdapter
│  │  └─ restAdapter.ts        # Phase 2 skeleton (talks to your backend proxy)
│  └─ screens/                 # Login, Home, Order* , Catalog
```

The **`SalesforceAdapter` interface** in `src/salesforce/adapter.ts` is the seam:
the entire app talks to that, so going live means implementing one file and
changing one line in `AppContext.tsx`.

---

## Phase 2 — wiring real Salesforce

The recommended architecture keeps Salesforce secrets **off the devices** by
putting a thin backend proxy between the app and Salesforce:

```
App  ──HTTPS──▶  Backend proxy (holds Connected App secret)  ──▶  Salesforce REST API
```

Steps:

1. **Confirm API access.** Salesforce API is included in Enterprise / Unlimited /
   Developer editions (Professional needs the API add-on).
2. **Create a Connected App** in Salesforce (Setup → App Manager → New Connected
   App) with OAuth enabled. This yields a **Consumer Key/Secret** — store these
   in the **backend**, never in the app.
3. **Stand up the backend** (Node + [`jsforce`](https://github.com/jsforce/jsforce)
   or a serverless function). Implement three endpoints the app already expects:
   - `GET  /api/products`   → Salesforce Product2 / PricebookEntry
   - `GET  /api/customers`  → Salesforce Accounts (+ Contacts)
   - `POST /api/orders`     → create Order + OrderItem (payload shape is in
     `restAdapter.ts` → `toSalesforceOrderPayload`)
4. **Flip the adapter** in `src/store/AppContext.tsx`:
   ```ts
   import { RestSalesforceAdapter } from '../salesforce/restAdapter';
   const adapter = new RestSalesforceAdapter('https://your-proxy.example.com', getToken);
   ```

### Object mapping (default)
| App concept | Salesforce object |
|-------------|-------------------|
| Customer (company) | **Account** |
| Customer (contact) | **Contact** |
| Product (catalog)  | **Product2** / **PricebookEntry** |
| Order              | **Order** |
| Order line         | **OrderItem** |

*(Alternative: map Order → **Opportunity** and lines → **OpportunityLineItem**
if your team tracks these as pipeline deals. Only the backend mapping changes.)*

## Distribution to reps
When ready, build with **Expo EAS** for internal distribution so reps install it
directly (no full App Store review needed for internal/ad-hoc builds).
