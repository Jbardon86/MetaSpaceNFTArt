# Endless Fun Orders — backend

Sends order confirmations from **order@endlessfun.biz** and (Phase 2) will push
orders into Salesforce. The app talks to this so email/Salesforce credentials
never live inside the app.

## What it does today
- `POST /api/orders` — receives an order from the app, emails the customer a
  confirmation from order@endlessfun.biz (if they opted in).
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
In the app's `src/salesforce/restAdapter.ts`, set `BACKEND_URL` to this
server's public URL, then switch the adapter in `src/store/AppContext.tsx`
from `MockSalesforceAdapter` to `RestSalesforceAdapter`.

## Hosting
Deploy anywhere that runs Node: Render, Railway, Fly.io, a small VM, etc.
Set the same environment variables there. Use HTTPS.

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

## Phase 2 — Salesforce
Add `jsforce`, authenticate with a Salesforce Connected App, and in
`POST /api/orders` create the Account/Contact + Order/OrderItem, returning the
real Salesforce Order Id instead of the `TODO` placeholder.
