// ---------------------------------------------------------------------------
// COMPANY BRANDING & KIOSK CONFIG — change these to make the app yours.
//
// This is the one place to set your company's "vibe" and the customer-facing
// welcome copy. The primary color also lives in theme.ts (colors.primary).
// ---------------------------------------------------------------------------

export const brand = {
  /** Company name shown throughout. */
  companyName: 'MetaSpace',

  /** Logo on the welcome screen. Either an emoji, a require('../assets/logo.png'),
   *  or a { uri: 'https://…' } remote image. Set `logoImage` to use an image. */
  logoEmoji: '🎨',
  logoImage: null as null | number | { uri: string },

  // ---- Welcome screen (what the customer sees first) ----
  welcomeTitle: 'Welcome to MetaSpace',
  welcomeSubtitle: 'Browse our collection and place your order',
  /** Short "about us" blurb shown on the welcome screen. */
  aboutText:
    'MetaSpace creates premium prints, canvases, and collectibles bridging digital art and the physical world. Tap below to start your order — a team member will follow up to finalize the details.',

  // ---- Order attribution ----
  /** Label stored on each order (which booth/kiosk it came from). */
  deviceName: 'Booth Kiosk',
  /** Event/tradeshow name stored on each order. Staff can leave blank. */
  eventName: '',

  // ---- Staff access ----
  /** PIN to reach the staff area (view orders + manage catalog). CHANGE THIS. */
  staffPin: '1234',

  /** Your brand color. Keep in sync with colors.primary in theme.ts. */
  brandColor: '#007AFF',
};
