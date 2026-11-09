/* Post-export step: give the hosted web app a proper iOS "Add to Home Screen"
 * icon. Expo's web export only sets the favicon, but iOS looks for an
 * apple-touch-icon; without one it falls back to a page screenshot. This copies
 * our branded icon into dist/ and injects the needed <head> tags. Idempotent.
 *
 * Wired into render.yaml's web build: `... && node scripts/inject-pwa-icon.js`.
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const indexPath = path.join(dist, 'index.html');
const srcIcon = path.join(__dirname, '..', 'assets', 'apple-touch-icon.png');

if (!fs.existsSync(indexPath)) {
  console.log('[inject-pwa-icon] dist/index.html not found — skipping.');
  process.exit(0);
}

// Copy the touch icon next to index.html so it's served at /apple-touch-icon.png
try {
  fs.copyFileSync(srcIcon, path.join(dist, 'apple-touch-icon.png'));
} catch (e) {
  console.log('[inject-pwa-icon] could not copy icon:', e.message);
}

let html = fs.readFileSync(indexPath, 'utf8');

const tags = [
  '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="Endless Fun">',
].join('');

if (html.includes('apple-touch-icon')) {
  console.log('[inject-pwa-icon] tags already present — nothing to do.');
} else if (html.includes('</head>')) {
  html = html.replace('</head>', tags + '</head>');
  fs.writeFileSync(indexPath, html);
  console.log('[inject-pwa-icon] injected apple-touch-icon + PWA meta tags.');
} else {
  console.log('[inject-pwa-icon] no </head> found — skipping injection.');
}
