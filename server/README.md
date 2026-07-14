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

## Phase 2 — Salesforce
Add `jsforce`, authenticate with a Salesforce Connected App, and in
`POST /api/orders` create the Account/Contact + Order/OrderItem, returning the
real Salesforce Order Id instead of the `TODO` placeholder.
