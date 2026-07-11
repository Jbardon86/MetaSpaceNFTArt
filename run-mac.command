#!/bin/bash
# Double-click launcher for macOS. Put your keys in .env first (this script
# creates it from the template on first run), then double-click to start.
cd "$(dirname "$0")" || exit 1

echo "=== WalmartCheck -> QuickBooks ==="

# 1. Node.js present?
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "Node.js is not installed."
  echo "Install the 'LTS' version from https://nodejs.org, then run this again."
  echo ""
  read -r -p "Press Enter to close."
  exit 1
fi
echo "Node.js: $(node --version)"

# 2. .env present?
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "Created a .env file. Opening it now —"
  echo "paste your Client ID and Client Secret from the Intuit app, save, and run this again."
  open -e .env
  read -r -p "Press Enter to close."
  exit 0
fi

# 3. Install dependencies (first run only takes a bit)
if [ ! -d node_modules ]; then
  echo ""
  echo "Installing (first run only)…"
  npm install || { echo "npm install failed"; read -r -p "Press Enter to close."; exit 1; }
fi

# 4. Open the browser and start the server.
echo ""
echo "Starting… your browser will open at http://localhost:3000"
echo "Leave this window open while you use the app. Close it (or Ctrl+C) to stop."
( sleep 2 && open http://localhost:3000 ) &
npm start
