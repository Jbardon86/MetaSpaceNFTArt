---
name: endless-fun-tradeshow-kiosk
description: >-
  Work on the Endless Fun trade-show order kiosk — the Expo/React Native app in
  tradeshow-app/ and its Node/Express backend in server/. Covers the SOS
  Inventory catalog (read-only), the Salesforce order + lead push (Client
  Credentials Connected App), per-product show pricing, admin product approvals,
  the booth rep/show settings, Render deployment, and how to connect to
  Salesforce/SOS to verify. Use this whenever the user mentions the trade-show
  app, the kiosk, the order app, the endlessfun-orders backend, pushing kiosk
  orders or leads to Salesforce, show pricing, product approvals, the SOS
  catalog in this app, or resuming/verifying that work — even if they don't name
  the skill. For Endless Fun's broader Salesforce internals (approvals,
  Send-to-SOS, Method history, rep home pages) see the endless-fun-salesforce
  skill; this skill is specifically the kiosk app and its backend.
---

# Endless Fun trade-show order kiosk

A customer-facing kiosk (iPad / web) where trade-show visitors browse a curated
product catalog and place orders. Orders flow to **Salesforce** (Lead +
Opportunity); the Salesforce side then handles approval and Send-to-SOS through
Endless Fun's existing automation. **The kiosk is read-only toward SOS** — it
pulls the catalog from SOS but never writes back to it.

Repo: `Jbardon86/MetaSpaceNFTArt`. App: `tradeshow-app/` (Expo RN, SDK 57,
TypeScript). Backend: `server/` (Node/Express). Related skill for Salesforce
internals: **endless-fun-salesforce**.

## Current state (as of go-live)

- ✅ **Live in production.** Backend points at the production Salesforce org; a
  full order was verified end to end (Lead + Opportunity + matched SOS line
  item + Account + rep + show as Lead Source) and the test records deleted.
- ✅ SOS catalog reconnected (~451 items, ~220 active with SOS ids).
- ✅ Admin-approved catalog, per-product show pricing, booth rep + show settings,
  lead-only capture — all shipped to `main`.
- ✅ Email-hang, env-var-whitespace, and web-Alert bugs fixed.

### Open items (pick up here)
1. **Kiosk-order list views in production.** Kiosk Opportunities are owned by the
   run-as user (order@endlessfun.biz), in **Proposal** stage, so they do NOT land
   in the "Waiting for approval" queue. Jeff needs an easy way to find them.
   Reliable filter: **Opportunity Name contains `Trade Show #`** (every kiosk
   order's name has it), plus `Stage = Proposal`; per show add
   `Lead Source = <show name>`. List views are UI-created (or metadata deploy);
   a **report grouped by Lead Source** auto-covers every show and can be deployed.
2. **Confirmation emails.** They go to the customer's email (correct recipient)
   but won't actually send until Microsoft 365 is configured (`SMTP_PASS`, or
   switch to Microsoft Graph sendMail). See `server/README.md`.
3. **Render paid tier** — free tier sleeps (~30–50s cold start on the first order
   after idle). User deferred the paid decision.
4. **Rotate the sandbox Connected App secret** — it appeared in a screenshot once
   (sandbox only, low risk).

## Architecture

- **App** (`tradeshow-app/`): Expo RN. Customer flow Welcome → Details →
  OrderProducts → OrderReview → signature → Confirmation. Admin (tap logo → PIN
  **5680**): Staff → Booth rep picker, Show/event, View orders, Manage catalog.
  Local state via AsyncStorage (`src/store/db.ts`); Salesforce calls go through
  the backend (`src/salesforce/restAdapter.ts`, auto-selected when
  `src/config.ts` `BACKEND_URL` is set, else the offline mock).
- **Backend** (`server/`): Express. `GET /api/catalog` (SOS, `sos.js`),
  `POST /api/orders` (Lead + Opportunity, `salesforce.js`), `POST /api/leads`
  (lead only), `POST /api/scan-card` / `POST /api/scan-order` (Claude vision),
  `GET /health`.
- **Deploy**: Render Blueprint (`render.yaml`) from `main`:
  - `endlessfun-orders-backend` → https://endlessfun-orders-backend.onrender.com
  - `endlessfun-orders-web` (Expo web export) → https://endlessfun-orders-web.onrender.com
  - Free tier (sleeps). Blueprint auto-syncs `render.yaml` (branch + env-var
    keys) on `main`; secret **values** are set in the dashboard (`sync:false`).
  - iOS native: EAS build; JS-only changes ship via `npx eas-cli update --branch preview`.

## How orders/leads map to Salesforce

Per order: a **Lead** (contact capture) + an **Opportunity**:
- Open **Proposal** stage on purpose (does NOT auto-fire approval / Send-to-SOS).
- Line items: each app line matched to a `Product2` by **`SOS_Item_Id__c`** (the
  app's product id) or **`ProductCode`** (SKU); `UnitPrice` = the effective
  per-unit price, so **show prices flow through** and `Amount` matches the order.
- **Account** matched by `SOS_Customer_Id__c` then Name, created if absent.
- **`SOS_Sales_Rep__c`** = the SOS rep **id** (number), from `repSosId` → roster
  name map → `SF_DEFAULT_REP_SOS_ID`.
- **`LeadSource`** = the show (the admin "Show / event" setting).
- Opportunity **Name** = `<company> — Trade Show #<shortId>` (the "Trade Show #"
  marker is how to find kiosk orders in list views/reports).

Lead-only ("Not ordering today — just save my info") → a Lead only, same show as
Lead Source.

## App-side curation (all persisted locally, survive SOS re-syncs)

- **Approvals** (`db` map `approvals`): customers only see approved products;
  everything defaults **hidden** (opt-in). `product.active` is derived from this.
- **Show prices** (`db` map `prices`): per-product override of the SOS list price;
  `product.listPrice` keeps the SOS price for reference/reset. One active price
  per product (not saved per show) — adjust when the show changes.
- **Booth rep** (`reps.ts`, SOS id → name) and **Show/event** (`boothEvent`):
  device settings set in admin; ride along on every order/lead.

## Key facts

- **Salesforce (Client Credentials)** requires the **My Domain** as `SF_LOGIN_URL`:
  - Prod: `https://java-platform-9703.my.salesforce.com` (org `00Dfn00000GOpcsEAD`)
  - Sandbox: `https://java-platform-9703--cloudblaze.sandbox.my.salesforce.com`
  - Env: `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_API_VERSION=v62.0`,
    `SF_OPP_STAGE=Proposal`, `SF_LEAD_SOURCE`, `SF_CREATE_OPPORTUNITY`,
    `SF_ADD_LINE_ITEMS`, `SF_LINK_ACCOUNT`, `SF_CREATE_ACCOUNT`,
    `SF_DEFAULT_REP_SOS_ID`, `SF_REP_MAP`.
  - Standard Price Book id `01sfn000001qkivAAA` (same in sandbox and prod).
  - Opportunity stages: Qualification, Needs Analysis, Proposal, Negotiation,
    Pending Approval, Closed Won, Closed Lost. Single Master record type.
- **SOS (read-only)**: app's own SOS developer app, Client ID
  `b5cea61597d7464fa2a68225d5256561` (separate from Salesforce's SOS connection).
  Env: `SOS_CLIENT_ID/SECRET/ACCESS_TOKEN/REFRESH_TOKEN`, `SOS_BASE_URL`. Items at
  `/api/v2/item`. SOS refresh tokens rotate → re-auth when `invalid_grant`.
- Rep SOS ids: 2 Chris Roseen, 3 Dave/David Ehrlich, 5 House, 6 Jeff Bardon,
  8 Jessica Tollefson, 13 Roger Corazzo (fuller list in endless-fun-salesforce).

## Branch & PR workflow

Develop on **`claude/tradeshow-order-app-889w6d`**. Each change → its own PR →
user merges. A merged PR is done: **restart the branch from `main`** before the
next change (`git fetch origin main && git checkout -B <branch> origin/main`,
carrying uncommitted edits via stash), never stack new work on merged history.
End commits with the session's attribution lines.

## Gotchas (all currently fixed — don't reintroduce)

- **Never let the confirmation email block an order.** `/api/orders` pushes to
  Salesforce FIRST, responds, then emails in the **background**; it skips email
  entirely when `SMTP_PASS` is unset, and the transporter has
  connection/greeting/socket timeouts. (A blocking SMTP send hung the kiosk.)
- **Trim env vars.** `SF_LOGIN_URL`/credentials are trimmed in `salesforce.js`
  because a pasted trailing space (or a pasted `KEY = value`) produced a
  malformed token URL. When guiding the user, stress: the Render **value** box
  holds the value only, no key name, no spaces.
- **React Native `Alert` is a no-op on web** — use a `Modal` for confirmations
  (the lead-save confirmation does).
- **Render free tier sleeps** — first order after idle is slow; it's not a bug.
- **Node `fetch` bypasses the agent proxy** in this environment — use `curl`
  for Salesforce/SOS/backend calls from the session (the deployed backend on
  Render is unaffected).

## Deeper runbooks

For the step-by-step procedures — deploying, reconnecting SOS tokens, connecting
to Salesforce (sandbox/prod) via the PKCE flow to verify, the curl helper
scripts, and allowlisting hosts from a cloud session — read
`references/runbooks.md`.
