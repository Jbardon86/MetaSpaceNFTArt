# Hosting WalmartCheck on Render

This runs the app at a permanent, secure `https://…onrender.com` address —
which is what QuickBooks *production* requires, and means no more re-downloads
or localhost. It's protected by a team password and its data persists across
restarts.

## What you'll need
- A free Render account (https://render.com) — sign in with GitHub.
- Your Intuit **Production** Client ID + Secret.
- ~10 minutes. Cost: Render **Starter** (~$7/mo) + a 1 GB persistent disk
  (~$0.25/mo). The disk is what keeps your QuickBooks connection and history
  from resetting on each restart.

## Steps

1. **Create the service from the blueprint.**
   In Render: **New + → Blueprint**, pick this repository. Render reads
   `render.yaml` and proposes a web service named `walmartcheck` with a disk.

2. **Fill in the secret env vars** (Render will prompt for the ones marked
   "sync: false"):
   - `QBO_CLIENT_ID` — your Production client id
   - `QBO_CLIENT_SECRET` — your Production client secret
   - `SESSION_SECRET` — any long random string
   - `APP_PASSWORD` — the password your team types to open the app
   - `QBO_REDIRECT_URI` — leave blank for now; you'll set it in step 4

3. **Deploy.** Render builds and starts it, then gives you a URL like
   `https://walmartcheck.onrender.com`. Copy it.

4. **Wire up the redirect URI (both places):**
   - Back in Render, set `QBO_REDIRECT_URI` to
     `https://walmartcheck.onrender.com/auth/callback` (your real URL) and let
     it redeploy.
   - In the Intuit app (**Keys & credentials → Production → Redirect URIs**),
     add the same URL: `https://walmartcheck.onrender.com/auth/callback`.

5. **Open the app** at your Render URL, enter the team password, click
   **Connect QuickBooks**, and choose your real company.

## Notes
- Without `APP_PASSWORD` set (e.g. running locally), the app has no login — the
  password gate only activates when that variable is present.
- `DATA_DIR=/var/data` points the app's tokens, history, decoder, and account
  settings at the persistent disk so they survive restarts and deploys.
- To update the app later, just push to the branch — Render auto-deploys. No
  re-downloads.
