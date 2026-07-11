# WalmartCheck → QuickBooks Online

Reads the Walmart ACH remittance you get, decodes each line by its deduction
code and sign, and posts it to QuickBooks Online **exactly the way you'd enter
it by hand** — a Receive Payment that closes the invoices, plus a Bank Deposit
that nets down to the actual ACH and parks disputed deductions in Disputed AR.

You review both transactions on screen before anything posts.

---

## What it does with a check

For every row in the remittance, two facts decide where it goes: the **sign**
(+ payment / − deduction) and the **deduction code**.

**Transaction 1 — Receive Payment** (into Undeposited Funds)
- Applies the payment to each invoice, marked **paid in full**
- Early-pay discounts + **accepted** deductions are written off (Merchant
  Deposit Fees #60410) via a small credit memo per invoice

**Transaction 2 — Bank Deposit**
- Sweeps the Undeposited Funds payment, then adds adjustment lines for anything
  that can't sit on an invoice:
  - **Disputed** deductions → negative → **Disputed AR** (recoverable)
  - **Repaid** disputes → positive → **Disputed AR** (clears it)
  - **Advertising** fees → **Marketing #60120**; **compliance** fees → **#42500**
- Deposit total = the ACH that hit your bank

The decoder (code → accept / dispute / fee) is set once per code. Any code it
hasn't seen is flagged for you to classify — it never posts a code blindly.

### Worked example (real check 004041349)

| | |
|---|--:|
| Receive Payment → Undeposited Funds | **$3,439.67** (5 invoices) |
| Bank Deposit → American National | **$3,173.47** |
| …of which disputed → Disputed AR | −$266.20 |

Deposit ties to the ACH to the penny.

---

## Setup

### 1. Intuit app (one time)
Create an app at <https://developer.intuit.com> with the **Accounting** scope.
Copy the Client ID / Secret and add redirect URI `http://localhost:3000/auth/callback`.

### 2. Run
```bash
npm install
cp .env.example .env      # add QBO_CLIENT_ID / QBO_CLIENT_SECRET
npm start                 # http://localhost:3000
```
Click **Connect QuickBooks** and pick your company. **Use a sandbox company for
the first runs.**

### 3. Import a check
Upload the Walmart `.xls/.xlsx` → classify any new codes → review the two
transactions → **Preview payloads** (dry run) or **Post to QuickBooks**.

---

## Account routing (yours)

| Bucket | Account |
|---|---|
| Bank (ACH lands) | American National |
| Undeposited Funds | Undeposited Funds |
| Discounts + accepted deductions | Merchant Deposit Fees `#60410` |
| Disputed deductions + repayments | Disputed AR |
| Advertising fees | Marketing `#60120` |
| Compliance fees | Walmart Compliance `#42500` |

All of this lives in `server/defaultAccounts.js` and is overridable in the app.

---

## Project layout

```
server/
  index.js          Express app + API (/api/analyze, /api/post, auth, config)
  walmartFile.js    read the Walmart .xls/.xlsx/.csv into normalized rows
  allocator.js      decode each line -> Receive Payment + Bank Deposit plan
  qboPost.js        build + post the CreditMemo / Payment / Deposit (dry-run-able)
  quickbooks.js     OAuth, token refresh, QBO API + account/invoice resolvers
  defaultDecoder.js seed deduction-code map
  defaultAccounts.js account routing
  store.js          file-backed tokens / decoder / accounts / posted ledger
public/             upload + review UI (no build step)
test/               unit tests (node --test) — 26 passing
```

Run tests: `npm test`

---

## Status & safety

- **Allocation + file reading + payload building are complete and unit-tested**
  against the real check.
- **The live QuickBooks posting has not yet been run against a real company** —
  validate it on a **sandbox** first. Posting is dry-run unless you explicitly
  confirm, refuses to post unclassified codes or an unbalanced deposit, and
  guards against posting the same check twice.
- The write-off (discount + accepted deductions) uses a per-invoice credit memo
  to close the invoice; confirm it books the way you expect in the sandbox
  before going live.
- Tokens and data stay local (git-ignored `data/`).
