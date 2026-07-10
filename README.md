# WalmartCheck → QuickBooks Online

An [A2X](https://www.a2xaccounting.com)-style helper that turns the Walmart
payment spreadsheet into clean **Bank Deposits** in QuickBooks Online — so
entering the checks you get from Walmart takes a couple of clicks instead of
manual data entry.

Upload the CSV → confirm the column mapping → review the deposits → post. Each
Walmart check becomes one QBO Bank Deposit with an income line (gross sales)
and a fee line (Walmart's deductions), so the deposit total matches the actual
check and reconciles cleanly against your bank feed.

---

## Why a Bank Deposit?

Walmart pays you a single check that already nets out their fees. A Bank
Deposit models that exactly:

| Deposit line | Account | Amount |
| --- | --- | --- |
| Walmart sales | Income | **+** gross |
| Walmart fees / deductions | Expense | **–** fees |
| **Deposit total** | Bank | **=** net (the check) |

This mirrors how A2X posts marketplace payouts and keeps your income and fee
expense reported at gross, not net.

---

## Features

- **Upload any CSV** — Walmart's or your bank's export. Column names don't have
  to match anything.
- **Automatic column mapping** with manual override, remembered for next time.
- **Line-item grouping** — multiple rows sharing one check number are combined
  into a single deposit (gross and fees summed).
- **Money parsing** that understands `$1,234.56`, `(50.00)`, trailing-minus,
  and blank cells.
- **Pre-post review** with totals, per-check validation, and a warning when
  gross − fees doesn't equal net.
- **Duplicate protection** — a local ledger remembers posted check numbers so
  you never enter the same check twice.
- **Secure QuickBooks connection** via Intuit's official OAuth 2.0, with
  automatic token refresh. Sandbox and production supported.

---

## Setup

### 1. Create an Intuit app (one time)

1. Sign in at <https://developer.intuit.com> and create an app with the
   **Accounting** scope.
2. On **Keys & credentials**, copy the **Client ID** and **Client Secret**
   (use the *Development* keys for the sandbox, *Production* keys when live).
3. Under **Redirect URIs**, add exactly:
   `http://localhost:3000/auth/callback`

### 2. Configure and run

```bash
npm install
cp .env.example .env      # then fill in QBO_CLIENT_ID / QBO_CLIENT_SECRET
npm start
```

Open <http://localhost:3000>, click **Connect QuickBooks**, and approve the
company. That's it.

### 3. Import checks

1. **Upload** the Walmart spreadsheet (try `sample-data/walmart-checks-sample.csv`).
2. **Match your columns** — the app pre-fills its best guess.
3. **Choose accounts** — bank, income, and (optional) fee account, pulled live
   from your QuickBooks chart of accounts.
4. **Review & post** — untick anything you want to skip, then post.

---

## Configuration (`.env`)

| Variable | Meaning |
| --- | --- |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` | Your Intuit app keys |
| `QBO_ENVIRONMENT` | `sandbox` (default) or `production` |
| `QBO_REDIRECT_URI` | Must match a Redirect URI on your Intuit app |
| `PORT` | Web server port (default `3000`) |
| `SESSION_SECRET` | Random string used to sign the session cookie |

---

## Project layout

```
server/
  index.js       Express app + REST API (/api/*, /auth/*)
  config.js      env + validation
  quickbooks.js  OAuth flow, token refresh, QBO API calls
  csvParser.js   CSV parse, column guessing, normalize + grouping
  deposit.js     builds a balanced QBO Deposit payload
  store.js       file-backed tokens / settings / posted-check ledger
public/          browser wizard (HTML/CSS/JS, no build step)
sample-data/     example Walmart CSV
test/            unit tests (node --test)
```

Run the tests with `npm test`.

---

## Data & security notes

- Tokens, saved settings, and the posted-check ledger live in a local `data/`
  folder (git-ignored). Nothing is sent anywhere except QuickBooks.
- This is a single-tenant local tool. Before hosting it for multiple users
  you'd want real per-user auth and encrypted token storage.

---

## Roadmap ideas

- Apply checks as **payments against open invoices** (in addition to deposits).
- Read **PDF remittance** stubs and **email** notifications, not just CSV.
- Export a reconciliation report of everything posted.
