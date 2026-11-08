# Tradeshow Order Entry App — Plan

A native mobile app for sales staff to quickly enter orders at tradeshows,
wired directly to **Salesforce**. No QuickBooks. Product catalog is managed
inside the app.

---

## 1. Goals

- Let a sales rep, standing at a booth, capture an order in **under a minute**.
- Pick a customer (or create a new one on the spot), add products + quantities,
  see a running total, capture a signature/notes, and submit.
- Push the finished order into **Salesforce** as a real record.
- **Work with bad/no WiFi** (tradeshow floors are notorious) — orders queue
  locally and sync automatically when a connection returns.
- Let an admin **add/edit the product catalog in the app** — no QuickBooks,
  no spreadsheet imports required.

## 2. What the rep sees (screens)

1. **Login** — rep signs in (with their Salesforce account, or a shared team login).
2. **Home / New Order** — big "Start Order" button; list of recent/queued orders
   with sync status (✅ synced / ⏳ pending).
3. **Customer step** — search existing Salesforce Accounts/Contacts, or tap
   "New Customer" and type name, company, email, phone.
4. **Products step** — searchable catalog list, tap to add, set quantity,
   optional per-line discount; running subtotal/total at the bottom.
5. **Review + Submit** — summary, notes field, optional signature, "Submit Order".
6. **Admin → Catalog** — add/edit/deactivate products (name, SKU, price, unit).
   (Gated so only managers see it.)

## 3. Architecture

```
  ┌─────────────────────┐        HTTPS/REST        ┌──────────────────┐
  │  Mobile App          │  ───────────────────▶   │  Backend (proxy) │
  │  (Expo / React Native)│  ◀───────────────────   │  Node + small DB │
  │                      │                          └────────┬─────────┘
  │  • local SQLite cache │                                   │ Salesforce REST/OAuth
  │  • offline order queue│                                   ▼
  └─────────────────────┘                          ┌──────────────────┐
                                                    │   Salesforce Org │
                                                    │  Accounts, Orders │
                                                    └──────────────────┘
```

**Why a thin backend instead of talking to Salesforce straight from the phone:**
- Keeps Salesforce API secrets **off the devices** (you never want the client
  secret shipped in an app binary).
- One place to handle token refresh, retries, and field mapping.
- Lets us swap Salesforce object choices later without re-releasing the app.

If you'd rather avoid running any server, there's an alternative (see §7).

### Tech stack (recommended)

| Layer     | Choice                              | Why |
|-----------|-------------------------------------|-----|
| Mobile    | **Expo (React Native)**             | One codebase → iOS **and** Android; over-the-air updates; easy internal distribution to your reps without full App Store review. |
| Local data| **SQLite (expo-sqlite)**            | Caches the catalog + queues orders offline. |
| Backend   | **Node (Express or serverless)**    | Small OAuth proxy + catalog store. |
| SF client | **jsforce**                         | Mature Salesforce library for Node. |
| Auth to SF| **Connected App, OAuth 2.0**        | JWT bearer (service account) or per-rep login. |

## 4. Salesforce integration — decisions needed

You said "not sure" on the Salesforce side, so here's the guidance.

**a) Do you have a Salesforce org with API access?**
API access is included in **Enterprise / Unlimited / Developer** editions;
**Professional** needs the API add-on. We need this to write orders.

**b) Which object should an order become?** Recommended default:

- **Order + OrderItem** (standard objects) — best fit for "we took an order."
  Ties to an Account, has line items, quantities, prices, status.
- *Alternative:* **Opportunity + OpportunityLineItem** — better if your team
  tracks these as deals in a sales pipeline rather than firm orders.

Default plan: **Order + OrderItem**, linked to **Account** (+ **Contact**),
with products drawn from **Product2 / Pricebook**. We can change this in the
backend mapping without touching the app.

**c) Where does the catalog live?** Since you want to manage it in-app, two options:
- **In Salesforce (Product2/PricebookEntry)** — single source of truth; the
  app's admin screen creates real Salesforce products. *(Recommended.)*
- **In the backend DB only** — simpler, but the catalog and Salesforce drift apart.

**d) How do reps authenticate?**
- **Per-rep Salesforce login** — orders are attributed to the actual rep
  (needs each rep to have a Salesforce license).
- **Shared service account** — simpler, one login, but every order shows the
  same owner unless we set a "rep name" field manually.

### What I need from you to wire it up (later, not now)
1. Confirm Salesforce edition / that API access is on.
2. A **Connected App** in your org (I'll give you exact click-by-click steps) →
   yields a Consumer Key/Secret we store in the backend (never in the app).
3. Which object (Order vs Opportunity) — I'll default to **Order**.
4. The fields you care about per order (e.g. customer, company, products, qty,
   price, discount, notes, rep name, tradeshow/event name).

## 5. Build phases

**Phase 1 — Clickable app against a mock (no Salesforce creds needed yet)**
- Expo app scaffold, all screens, navigation.
- Local SQLite catalog + admin add/edit product screen.
- Order flow end to end with a **mock Salesforce adapter** (writes to local DB),
  so you can hand it to a rep and click through a full order today.
- Offline queue + sync-status UI.

**Phase 2 — Real Salesforce**
- Stand up the Node backend + `jsforce`.
- Connected App / OAuth; map order → Order/OrderItem (+ Account/Contact).
- Swap the mock adapter for the live backend. Two-way: pull Accounts + Products,
  push Orders.

**Phase 3 — Polish + rollout**
- Signature capture, order PDF/email receipt (optional).
- Manager admin: product catalog sync, per-event reporting.
- Internal distribution build (Expo EAS) so reps install it on their phones/tablets.

## 6. Open decisions for you
- [ ] Do you have a Salesforce org with API access today? (edition?)
- [ ] Per-rep login or a shared team account?
- [ ] Order object: **Order** (recommended) or **Opportunity**?
- [ ] iOS, Android, or both? (Expo does both — just confirming targets.)
- [ ] OK to start Phase 1 (mock) now while we sort out Salesforce access?

## 7. Alternative: no backend server
If you don't want to run/host any server, we can do a **serverless function**
(e.g. a single cloud function) that holds the Salesforce secret and does the
same proxy job — no always-on server to maintain. The app stays identical.
This is the recommended path if "run a server" is a concern.
