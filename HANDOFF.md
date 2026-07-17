# WalmartCheck → QuickBooks — Project Handoff

Complete state of the project so a new chat can continue with zero context loss.

## What this is
An A2X-style tool for **Endless Fun LLC** (Jeff Bardon, jbardon@endlessfun.biz)
that turns weekly **Walmart ACH remittance checks** into QuickBooks Online
transactions, and tracks **deduction disputes** for recovery.

Each Walmart check is a spreadsheet: invoice payments minus deductions
(early-pay discounts, price differences, shortages/"merchandise billed not
shipped", ad/compliance fees). The app decodes each line and posts it to QBO,
then logs the disputes for recovery.

Business facts: Walmart **vendor # 540153**, **dept 92**. Product brand is Magic
Straws (magicstraws.com). Walmart customer in their QBO is **"Walmart
Corporate"**. They had ~**$164,942** in Disputed AR. They currently pay for
**STAT Recovery** to file disputes — this project aims to replicate it.

## Where it lives
- **Repo:** github.com/Jbardon86/MetaSpaceNFTArt — **branch
  `claude/quickbooks-check-entry-3ze2wy`** (⚠️ everything is on this branch;
  `main` is an empty placeholder, never merged).
- **Hosted app:** https://walmartcheck.onrender.com (Render web service
  "walmartcheck", **Starter plan + 1 GB persistent disk at `/var/data`**).
  **Auto-deploys from the branch on every push** — no re-downloads. Password
  protected.
- **Updating = commit + push to the branch.** Render redeploys in ~1–2 min.

## Live configuration

**Render env vars** (secrets set in Render dashboard, not in repo):
| Var | Value |
|---|---|
| QBO_CLIENT_ID | Intuit **Production** client id (NOT the dev key) |
| QBO_CLIENT_SECRET | Intuit Production secret |
| QBO_ENVIRONMENT | `production` |
| QBO_REDIRECT_URI | `https://walmartcheck.onrender.com/auth/callback` |
| SESSION_SECRET | random string |
| APP_PASSWORD | team password (user set it; reveal/edit in Render → Environment) |
| DATA_DIR | `/var/data` |
| SECURE_COOKIES | `true` |

**Intuit app:** "A3X" (App ID `acaf29f4-dd60-43e7-87ca-9f964c6f16b8`), workspace
EndlessFun, **In Production**, Accounting scope (Payments scope is locked-on but
unused — app only requests Accounting).
- **Production Redirect URI** (must be under the **Production** tab, exact
  match): `https://walmartcheck.onrender.com/auth/callback`
- EULA + Privacy pages: published (simple docs) to satisfy Intuit.
- Dev/sandbox client id (unused in prod): starts `ABLQY6nY...`. Its secret was
  shared in chat early on — **rotate it** eventually (low risk, sandbox only).

**QuickBooks:** connected to the real **Endless Fun LLC** company in production.

## Account mapping (server/defaultAccounts.js — verified against real QBO)
| Bucket | QBO account |
|---|---|
| Bank (ACH lands) | **American National Bank** |
| Undeposited Funds | Undeposited Funds |
| Discounts + accepted deductions (write-off) | **Merchant Deposit Fees** #60410 (full name "Operating Expenses:Merchant deposit fees") |
| Disputed deductions + repayments | **Disputed AR** (Other Current Asset) |
| Advertising fees | **Marketing** #60120 |
| Compliance fees | **Walmart Compliance** #42500 |

Resolver matches by **AcctNum first, then exact name**.

## Deduction decoder (server/defaultDecoder.js)
- `0100` Price Difference As Documented → **accept** (write off to Merchant Deposit Fees)
- `0022` Merchandise Billed Not Shipped → **dispute** (→ Disputed AR)
- Unknown codes are flagged in the UI for classification. Advertising/compliance
  fee codes haven't appeared on a real check yet — add them (category `fee`,
  feeAccount `advertising`/`compliance`) when they show up.

## How posting works (the accounting model)
Two QBO transactions per check:
1. **Receive Payment** — every invoice paid **in full** into Undeposited Funds
   (one line per invoice, matched by DocNumber). **Customer is taken from the
   invoice's CustomerRef** (Walmart Corporate), not a hardcoded name. No credit
   memos.
2. **Bank Deposit** — sweeps the full UF payment (line = only `Amount` +
   `LinkedTxn{TxnId, TxnType:"Payment", TxnLineId:"0"}`), then negative
   adjustment lines: discounts+accepted → Merchant Deposit Fees; disputes →
   Disputed AR; fees → expense; repayments → positive to Disputed AR. Each
   adjustment line is tagged with the customer (`Entity` = "Received From") so
   Disputed AR is trackable by customer. Deposit total = the real ACH.

Safety: **dry-run preview** posts nothing; **rollback** deletes the payment if
the deposit fails; **duplicate guard** blocks re-posting the same check number.

**Real posts completed:**
- Check **004041349** (inv 46364–46412) → deposit **$3,173.47** ✅
- Check **003983648** (inv 46192, 46226, 46217, 46218) → deposit **$3,504.92** ✅
  **RESOLVED 2026-07-17 — the total is correct, don't re-investigate.** Verified
  three ways: the remittance's own "Amount Paid" column nets to $3,504.92; the
  allocator rebuilds it with `balanced: true, difference: 0`; and the per-invoice
  amounts match QBO's invoice faces exactly (695.14 + 1010.51 + 942.48 + 942.48 =
  $3,590.61, all four at zero balance). Breakdown: $3,590.61 into Undeposited
  Funds − $76.17 discounts/accepted deductions − $9.52 MBNS dispute (inv 46226) =
  $3,504.92. The "wrong" reaction was most likely $3,590.61 (the payment) being
  read next to $3,504.92 (the deposit) — two transactions, two totals, both right.

## Phase 1 Disputes module (just built — isolated from posting)
- On each real post, every dispute is saved as a **claim** (stages:
  ready/filed/research/recovered/denied/writeoff). Repayments auto-mark a claim
  **recovered**.
- **Disputes tab**: open/recovered totals, per-claim status dropdowns.
- **Export → Walmart "Recovery Submission" .xlsx** matching STAT's exact format:
  `PO Number · Vendor # · Dept · Seq · Whse · Ship Date · Orig Inv # · New Inv #
  · Amt To Submit`. Assigns a rebill "New Inv #" (starts at **8980000**), marks
  claims Filed.
- Config in `data/walmart.json`: vendorNumber 540153, dept 92, seq 1,
  nextNewInvoice 8980000. Editable in the **Settings tab**.

### Rebill numbering — why 8980000 (verified 2026-07-17)
Walmart rejects a rebill whose invoice number it has already seen for the vendor.
Parsing STAT's EDI 810 (`540153EDI810900000000.edi`, transmitted 2026-04-02)
shows they used **8973800–8974007** — 137 rebills, $28,595.59, with **125 issued
in a single day**. The old 8974100 start left only **93 numbers** of headroom
above their high-water mark — less than one of their batches — and STAT is
**winding down, not stopped**, so they may still file. Hence 8980000 (~6k clear,
still in the 897xxxx family Walmart accepts). QBO's own invoices are ~47k, so no
conflict there.

Two guards enforce this (`store.minSafeNewInvoice()`):
1. Never issue at/below STAT's `STAT_HIGH_WATER` (8974007).
2. Never reissue a number we've already assigned — the floor ratchets up past the
   highest `newInvoice` on any claim, so the counter can't be walked backwards.
The export floors its counter at this too, so a stale/hand-edited config can't
reuse a number. A config that's legal but tighter than recommended (e.g. a saved
8974100) still saves, but the Settings tab warns with the real headroom figure.

## Architecture / files
```
server/
  index.js         Express + all routes; password gate; error log; claim recording
  config.js        env config (sandbox vs production base URLs)
  quickbooks.js    OAuth (intuit-oauth lib), token refresh, 25s timeout,
                   intuit_tid capture, account resolver, invoice lookup (w/
                   CustomerRef), create payment/deposit/creditmemo, deletePayment
  walmartFile.js   parse Walmart .xls/.xlsx/.csv remittance -> normalized rows
  allocator.js     decode rows -> {receivePayment, bankDeposit} plan; disputes
                   enriched with PO/whse/shipDate
  qboPost.js       build+post Payment/Deposit; dry-run; rollback; customer from
                   invoice; entity tagging on deposit lines
  csvParser.js     amount/date parsing helpers (used by walmartFile)
  deposit.js       legacy deposit builder (still unit-tested; not in main flow)
  store.js         file-backed state (DATA_DIR): tokens, decoder, accounts,
                   walmart config, claims, ledger, error log
  defaultAccounts.js / defaultDecoder.js / seedSandbox.js
public/            Apple-style UI (index.html, app.js, styles.css). Tabs:
                   Import / Disputes / History. Login page. Dark+light.
test/              30 tests (allocator, walmartFile, qboPost, csvParser+deposit,
                   claims). Run: npm test
render.yaml        Render blueprint    HOSTING.md   deploy guide
run-mac.command    local Mac launcher (only needed for local runs)
sample-data/       sample checks
```

## Key gotchas learned (don't re-discover these)
- Intuit **production requires an HTTPS redirect URI** (no localhost) → that's
  why it's hosted on Render.
- The redirect URI must be in Intuit's **Production** tab (not Development) AND
  equal Render's `QBO_REDIRECT_URI` exactly.
- Production uses **production** client keys, not the dev `ABLQY…` keys.
- Deposit linked-payment line: **no** DetailType/DepositLineDetail — only Amount
  + LinkedTxn with `TxnLineId:"0"`.
- Express route order: **`/api/claims/export` must be declared before
  `/api/claims/:id`** (else "export" is read as an id).

## Open items / where we're going
1. **Backfill** the 2 already-posted checks' disputes into the claims list
   (offered, not done — they aren't in the Disputes tab because it records
   going forward). Check 003983648's dispute is known: **inv 46226, code 0022,
   $9.52, PO 9034794755, whse 6043, ship 2026-06-01** — from the remittance at
   `~/Downloads/6-10-26 ck- 003983648 (1).xlsx`. Still need 004041349's file.
2. ~~Confirm the rebill New Inv # start + settings UI~~ — **DONE 2026-07-17.**
   Settings tab added; start moved 8974100 → 8980000; collision guards + tests.
   See "Rebill numbering" above.
3. ~~Resolve the "wrong total" on the 2nd posted check~~ — **DONE 2026-07-17,
   the total is correct.** See "Real posts completed" above.
4. **Repayment matching gap (found 2026-07-17, not yet fixed).**
   `store.matchRepayments()` matches a repayment to a claim by the **original**
   invoice number, but STAT's recovery mechanism re-invoices under a **new**
   number (the `newInvoice` we assign). If Walmart's repayment remittance
   references the rebill number, auto-recovery silently never matches and claims
   sit "filed" forever despite being paid. Related: a repayment row with no
   deduction code and a positive amount classifies as `payment` in
   `allocator.js`, so it'd be treated as an invoice payment and fail invoice
   lookup. **Confirm against a real repayment remittance before changing the
   matching logic** — we haven't seen one yet.
5. **Walmart takes the 2% early-pay discount on the PRE-promo invoice amount**
   (verified on 003983648: inv 46192 → 2% of $702.16 = $14.04, not 2% of the
   $695.14 face). Costs ~20–35¢ per invoice carrying a promo line. This is a
   vendor-agreement question, **not a code bug** — the app books Walmart's stated
   discount rather than recomputing it, which is correct. Don't "fix" it in code.
6. First posted deposit (004041349) has **blank "Received From"** on its
   adjustment lines (fixed for all future posts; that one check could be edited
   by hand in QBO).
7. **Phase 2 — Retail Link automation (the hard part, no public API):**
   - Pull deductions directly from Retail Link (RPA/scrape, needs their Retail
     Link login; STAT stores a credential to do this).
   - Auto-submit disputes. STAT's actual mechanism = **re-invoice via EDI 810**
     (new invoice number per disputed amount, referencing original PO). The
     Recovery Submission .xlsx is the summary; the EDI 810 file is the
     submission. Generating EDI 810 needs original-invoice **line-item detail**
     (item #, qty, unit price, product description) which the check remittance
     does NOT contain — would need Retail Link/invoice data.
   - This is fragile RPA with MFA/ToS caveats — the paywalled part even for STAT.
8. Add **advertising/compliance deduction codes** to the decoder when a real
   check contains them (route to Marketing #60120 / Walmart Compliance #42500).
9. Optional: merge branch → `main` for a tidier deploy (needs user OK).

## Reference files the user provided
- Walmart remittance for check 004041349 (the original sample).
- `Recovery_Submission_540153_4004_20260402.xlsx` — STAT's dispute submission
  format (basis for our export).
- `540153EDI810900000000.edi` — EDI 810 rebill invoices (the submission
  mechanism). Sender 5074121162, receiver 925485US00 (Walmart). Shows the
  line-item detail an EDI 810 needs.

## STAT Recovery (the product being replicated)
Single-page app: Home / Walmart / Credentials. Stores a **Retail Link
credential** to ingest deduction data (no API — RPA). Claims pipeline stages:
**Ready to Dispute · Queued · Retailer Research · Supplier Action · Redisputable
· Completed**. Claim codes (e.g. 22/24) map to Walmart deduction reasons. Actual
dispute submission is a **paid tier** (DMS). Also has Historical Audits and
Reports/Check-Research. Their whole moat is the Retail Link ingestion + EDI
submission — the parts with no public API.
