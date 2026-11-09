# Trade-show kiosk — runbooks

Step-by-step procedures for the kiosk app + backend. Read the top-level SKILL.md
first for architecture and current state.

## Table of contents
- Deploying a change
- Verifying from a cloud session (allowlist + curl)
- Connecting to Salesforce to verify (PKCE)
- Testing the backend endpoints
- Reconnecting SOS tokens (when catalog 502 / invalid_grant)
- Going live / switching sandbox ↔ production
- Creating kiosk-order list views / report
- Setting up confirmation emails

---

## Deploying a change

1. On branch `claude/tradeshow-order-app-889w6d` (restart from `main` first if the
   last PR merged). Make edits.
2. App changes: `cd tradeshow-app && npx tsc --noEmit` must pass. Backend:
   `node --check server/*.js`.
3. Commit, push, open a PR, let the user merge.
4. Render auto-rebuilds from `main`:
   - Backend + web redeploy within ~1–2 min.
   - For the **iPad app**, JS-only changes ship over-the-air:
     `npx eas-cli update --branch preview` (run from the user's Mac, in
     `tradeshow-app/`), then fully quit/reopen the app. Native changes need an
     EAS build.
5. The web app's deployed bundle can be inspected (it's content-hash-named under
   `/_expo/static/js/web/`) to confirm a change actually shipped.

## Verifying from a cloud session (allowlist + curl)

The session's network is a limited allowlist. To reach a host, add it with the
environment tool `update_environment` (`add_allowed_hosts`), e.g.
`endlessfun-orders-backend.onrender.com`, `test.salesforce.com`,
`login.salesforce.com`, the My Domain hosts. **Node `fetch` bypasses the proxy
here — always use `curl`** for these calls (the Render backend itself is fine).

## Connecting to Salesforce to verify (PKCE)

Lets you query/delete records to verify orders. Uses the `PlatformCLI` public
client (no secret needed).

1. Generate a PKCE verifier + S256 challenge (save the verifier). Build:
   `https://<HOST>/services/oauth2/authorize?response_type=code&client_id=PlatformCLI&redirect_uri=http%3A%2F%2Flocalhost%3A1717%2FOauthRedirect&scope=refresh_token+api+web&code_challenge=<CHALLENGE>&code_challenge_method=S256`
   where `<HOST>` is `test.salesforce.com` (sandbox) or `login.salesforce.com`
   (production).
2. User opens it, signs in (`order@endlessfun.biz` prod; sandbox login per the
   endless-fun-salesforce skill), approves. Browser lands on
   `http://localhost:1717/OauthRedirect?code=...` (page fails to load — expected).
   User pastes back the full localhost URL.
3. Exchange via **curl** at `https://<HOST>/services/oauth2/token`:
   `grant_type=authorization_code`, `code=<decoded>`, `client_id=PlatformCLI`,
   `redirect_uri=http://localhost:1717/OauthRedirect`, `code_verifier=<VERIFIER>`.
   Save `access_token`, `instance_url`, `refresh_token`.
4. Refresh later (tokens expire in hours):
   `grant_type=refresh_token`, `client_id=PlatformCLI`, `refresh_token=<RT>`.

Helper pattern (`sf.sh` for sandbox, `sfprod.sh` for prod) reads the saved token
and does `query`/`del`:
```bash
TOKEN=$(node -e 'console.log(require("TOKENS.json").access_token)')
INST=$(node -e 'console.log(require("TOKENS.json").instance_url)')
# query:  curl -sS -G "$INST/services/data/v62.0/query" --data-urlencode "q=$2" -H "Authorization: Bearer $TOKEN"
# delete: curl -sS -X DELETE "$INST/services/data/v62.0/sobjects/$2" -H "Authorization: Bearer $TOKEN"
```
**Always delete test records you create in production**, and inline `node -e`
JSON parsers choke on complex arrow bodies — write the parser to a `.js` file.

## Testing the backend endpoints

Allowlist `endlessfun-orders-backend.onrender.com`, then:
```bash
curl -sS https://endlessfun-orders-backend.onrender.com/health
curl -sS https://endlessfun-orders-backend.onrender.com/api/catalog   # SOS items (or an error)
curl -sS -X POST .../api/leads  -H 'Content-Type: application/json' -d '{...}'   # lead only
curl -sS -X POST .../api/orders -H 'Content-Type: application/json' -d '{...}'   # lead + opportunity
```
The `/api/orders` and `/api/leads` responses include `salesforce.{leadId,
opportunityId, accountId, repSosId, lineItemsCreated, unmatched, errors}` and
`configured`. `configured:false` ⇒ SF_* env vars missing/misread. Order payload
shape = `restAdapter.toSalesforceOrderPayload` (account, contact, lines with
productId/sku/quantity/unitPrice/lineTotal, eventName, repName, repSosId,
emailConfirmation, addresses). Keep `emailConfirmation:false` in tests unless
testing email.

## Reconnecting SOS tokens (catalog 502 / invalid_grant)

`GET /api/catalog` returning `502 {"error":"SOS token refresh failed ...
invalid_grant"}` means the SOS refresh token is dead (revoked or rotated). SOS
rotates refresh tokens and the backend stores a static one, so this recurs.

Re-auth is done **on the user's Mac** (Client Secret stays local). Give them an
interactive Node script (no repo dependency) that: prompts for the Client Secret,
prints the authorize URL (`https://api.sosinventory.com/oauth2/authorize?response_type=code&client_id=<id>&redirect_uri=https://endlessfun.biz/callback`),
prompts for the `code=` from the redirect, then exchanges at
`/oauth2/token` — try **Basic auth header** first, then **credentials in body**
(SOS accepts the latter). It prints `SOS_ACCESS_TOKEN=` and `SOS_REFRESH_TOKEN=`.

Then in **Render → endlessfun-orders-backend → Environment**, update the
**values** of the existing `SOS_ACCESS_TOKEN` and `SOS_REFRESH_TOKEN` rows (don't
add new rows — duplicates error), keep `SOS_CLIENT_ID`/`SOS_CLIENT_SECRET`, Save.
Then re-check `/api/catalog`. This SOS app is independent of Salesforce's SOS
connection — re-authing it does not affect SOS ↔ Salesforce.

## Going live / switching sandbox ↔ production

SOS doesn't change (one real SOS account). Only Salesforce switches:
1. Create a Connected App in the **target** Salesforce org (Setup → App Manager →
   New Connected App): enable OAuth, callback
   `https://login.salesforce.com/services/oauth2/success`, scopes **api** +
   **refresh_token/offline_access**, **Enable Client Credentials Flow**, Save.
   Manage → Edit Policies → **Run As** a user who can create Leads/Opps
   (order@endlessfun.biz), **Relax IP restrictions**, Save. Manage Consumer
   Details → Consumer Key + Secret.
2. Render backend env: `SF_LOGIN_URL` = that org's **My Domain** (prod
   `https://java-platform-9703.my.salesforce.com`), `SF_CLIENT_ID`,
   `SF_CLIENT_SECRET`. Save → redeploy. (No Salesforce code deploy needed.)
3. Verify: POST a test order, confirm Lead + Opportunity + line item in the
   target org, then **delete** the test records (connect via PKCE to do so).

## Creating kiosk-order list views / report

Kiosk orders are findable by **Opportunity Name contains `Trade Show #`**.
- **List view** (UI, ~90s): Opportunities tab → New → filter Name contains
  `Trade Show #` and Stage = Proposal; per show add Lead Source = `<show>`. Clone
  per show. (List views can only be made in the UI or a metadata deploy.)
- **Report grouped by Lead Source** (auto-covers every show): can be created via
  the Salesforce API/metadata; filter to kiosk orders (Name contains
  `Trade Show #`). Good complement to the list view.

## Setting up confirmation emails

Emails go to the customer's entered email, but only send once Microsoft 365 is
configured. Set `SMTP_HOST=smtp.office365.com`, `SMTP_PORT=587`,
`SMTP_USER=order@endlessfun.biz`, `SMTP_PASS=<mailbox or app password>` on the
backend (needs SMTP AUTH enabled on the tenant). If the tenant blocks SMTP basic
auth, switch the backend to Microsoft Graph `sendMail` (see `server/README.md`).
The order flow already sends in the background, so a misconfig can't hang orders.
