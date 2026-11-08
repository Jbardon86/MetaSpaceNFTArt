# Endless Fun Orders — backend

Sends order confirmations from **order@endlessfun.biz** and (Phase 2) will push
orders into Salesforce. The app talks to this so email/Salesforce credentials
never live inside the app.

## What it does today
- `POST /api/orders` — receives an order, emails the confirmation (if opted in),
  and creates a Salesforce Lead + Opportunity (with line items, Account, rep).
- `POST /api/leads` — lead-only capture: someone who isn't ordering today.
  Creates just a Salesforce **Lead** tagged to the show (`LeadSource`). Same
  contact/account/address/event payload as an order, minus the lines. Pairs with
  the badge / business-card scanner: scan → fields fill → "just save my info".
  The show comes from the booth's **Show / event** setting in the admin area
  (falls back to `SF_LEAD_SOURCE`).
- `GET /health` — health check.

## Run it locally
```bash
cd server
npm install
cp .env.example .env      # then fill in SMTP_PASS
npm start
```

## Sending as order@endlessfun.biz (Microsoft 365)
Two options:

1. **SMTP (simplest).** Works if your tenant allows SMTP AUTH for the mailbox.
   - In Microsoft 365 admin, ensure **SMTP AUTH** is enabled for order@endlessfun.biz.
   - If the mailbox has MFA, create an **app password** and use it as `SMTP_PASS`.
   - Fill in `.env` and you're done.

2. **Microsoft Graph (more robust for orgs that block SMTP basic auth).**
   - Register an app in Entra ID (Azure AD) with `Mail.Send` application
     permission and admin consent.
   - Swap the `nodemailer` call for a Graph `sendMail` request as
     order@endlessfun.biz. (Ask and we'll wire this variant.)

## Connect the app to this backend
Set `BACKEND_URL` in the app's `src/config.ts` to this server's public URL.
The app automatically uses the live `RestSalesforceAdapter` whenever
`BACKEND_URL` is set (and falls back to the offline mock when it's empty) —
no code change needed. Orders then `POST /api/orders`, which sends the
confirmation email and creates the Salesforce Lead + Opportunity.

## Hosting (Render — easiest)
There's a `render.yaml` blueprint at the repo root for one-click deploy:
1. Create a free account at https://render.com and connect your GitHub.
2. **New → Blueprint** → pick the `MetaSpaceNFTArt` repo → it reads `render.yaml`.
3. In the dashboard, fill in the secret env vars (SOS_* and SMTP_PASS).
4. Deploy → you get a public URL like `https://endlessfun-orders-backend.onrender.com`.
5. Put that URL in the app's `src/config.ts` (`BACKEND_URL`) and publish an update.

(You can deploy anywhere that runs Node — Railway, Fly.io, a VM — with the same
env vars. Use HTTPS.)

> Free Render services sleep when idle and take ~30s to wake on the first
> request. Fine for a booth; upgrade the plan if you want it always-on.

## Shared catalog from SOS Inventory
The app pulls ONE shared product catalog from SOS Inventory via `GET /api/catalog`.
Products are managed in SOS; the app mirrors them (and caches locally for offline).

Setup:
1. **Register a developer app** at https://developer.sosinventory.com → get a
   **Client ID** and **Client Secret**. Set a redirect URI (use this server's
   `/sos/callback` once deployed, or a placeholder to start).
2. **Authorize your SOS company** (ENDLESS FUN LLC) via the OAuth flow to get an
   **access token + refresh token**.
3. Put all four values in `.env` (`SOS_CLIENT_ID`, `SOS_CLIENT_SECRET`,
   `SOS_ACCESS_TOKEN`, `SOS_REFRESH_TOKEN`).
4. Restart the server and hit `/api/catalog` — you should get your items.

> The item field mapping in `sos.js` (`mapItem`) is based on public docs and
> must be verified against a real SOS `/items` response, especially the image
> field. We lock this in once we can call the live API.

## Salesforce — Lead + Opportunity per order
Each order creates a **Lead** (contact capture) and an **Opportunity** (the
order itself) in Salesforce. This runs server-to-server — the Connected App's
secret never touches the app. **Test against your SANDBOX first.**

### 1. Create a Connected App (do this in the sandbox first)
In Salesforce **Setup → App Manager → New Connected App** (or New External
Client App):
1. Name it e.g. `Endless Fun Trade-Show App`.
2. Enable **OAuth Settings**. Callback URL can be `http://localhost/callback`
   (unused by the Client Credentials flow). Selected OAuth scopes: **Manage
   user data via APIs (api)** and **Perform requests at any time
   (refresh_token, offline_access)**.
3. Enable **Client Credentials Flow** and set a **Run As** user (a user with
   permission to create Leads and Opportunities — e.g. an integration user, or
   `order@endlessfun.biz` for testing).
4. Save, then open **Manage Consumer Details** to copy the **Consumer Key** and
   **Consumer Secret**.

> Tip: under the Connected App's policies, set IP relaxation / "Relax IP
> restrictions" if your host (Render) isn't on a trusted IP range.

### 2. Add the secrets to this backend (Render → Environment)
Never paste these into a chat — enter them in Render (or your `.env` locally):
- `SF_LOGIN_URL` = `https://test.salesforce.com` (sandbox) or
  `https://login.salesforce.com` (production), or your My Domain URL.
- `SF_CLIENT_ID` = Consumer Key
- `SF_CLIENT_SECRET` = Consumer Secret
- (optional) `SF_OPP_STAGE`, `SF_LEAD_SOURCE`, `SF_CREATE_OPPORTUNITY`

### 3. Test
Place an order in the app → check Salesforce for a new Lead **and** a new
Opportunity (named `<customer> — Trade Show #XXXXXX`). The API response from
`POST /api/orders` includes a `salesforce` object with `leadId`,
`opportunityId`, and any `errors`.

### Line items (implemented, verified against the sandbox)
The Opportunity carries **real OpportunityLineItems**, not just a text summary:
- It's placed on the **Standard Price Book**.
- Each app line is matched to a `Product2` by **`SOS_Item_Id__c`** (the app's
  product id) or, failing that, by **`ProductCode`** (the SKU).
- The line's `UnitPrice` is the app's **effective** per-unit price
  (`lineTotal / quantity`), so the Salesforce **Amount** equals what the
  customer saw even with rep discounts.
- Any line with no matching active product is listed in the Opportunity
  **Description** so nothing is silently lost (`salesforce.unmatched` in the
  API response names them).

Set `SF_ADD_LINE_ITEMS=0` to fall back to a header-only Opportunity (lines in
the Description, `Amount` = total). The Opportunity is kept in an **open** stage
(`Proposal`) on purpose, so it does **not** auto-fire your approval /
Send-to-SOS flow — a human moves it forward in Salesforce as usual.

### Account link + rep attribution (implemented, verified against the sandbox)
Each order's Opportunity is linked to an **Account** and attributed to a **rep**:
- **Account match/create.** Matched first by **`SOS_Customer_Id__c`** (the SOS
  customer id the app carries for known customers), then by exact **Name**. If
  nothing matches and a company name is present, a new Account is created (with
  `SOS_Customer_Id__c` when known). Turn off with `SF_LINK_ACCOUNT=0`, or keep
  matching but never create with `SF_CREATE_ACCOUNT=0`.
- **Rep attribution.** `SOS_Sales_Rep__c` is set to the **SOS rep id** (a number
  like `2`). Resolution order: an explicit `repSosId` on the order → a name→id
  map seeded from your roster (Chris Roseen→2, David Ehrlich→3, Jessica
  Tollefson→8, Roger Corazzo→13, Jeff→6, House→5, …) → `SF_DEFAULT_REP_SOS_ID`.
  The kiosk sets `repName` to the device name, which won't map — so set
  `SF_DEFAULT_REP_SOS_ID` to whoever is working the booth, or leave it blank to
  let Jeff assign. Extend the map with `SF_REP_MAP` (JSON).

The `POST /api/orders` response's `salesforce` object now also returns
`accountId` and `repSosId`.

> Tip: to attribute booth orders to the actual rep on duty, the cleanest next
> step is a small rep picker in the app's admin area that sends `repSosId` on
> the order — then you don't rely on the env default.

### Still open (next, if you want it)
- **Auto-advance to Send-to-SOS.** Today a person approves/advances the
  Opportunity. If you want kiosk orders to flow to SOS automatically, we set the
  stage/flag your `SosOrderService` watches (needs your Apex source to match the
  exact trigger).
