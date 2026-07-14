// ---------------------------------------------------------------------------
// COMPANY BRANDING & KIOSK CONFIG — change these to make the app yours.
//
// This is the one place to set your company's "vibe" and the customer-facing
// welcome copy. The primary color also lives in theme.ts (colors.primary).
// ---------------------------------------------------------------------------

export const brand = {
  /** Company name shown throughout. */
  companyName: 'Endless Fun',

  /** Logo on the welcome screen. Either an emoji, a require('../assets/logo.png'),
   *  or a { uri: 'https://…' } remote image. Set `logoImage` to use an image. */
  logoEmoji: '🎨',
  logoImage: null as null | number | { uri: string },

  // ---- Welcome screen (what the customer sees first) ----
  welcomeTitle: 'Welcome to Endless Fun',
  welcomeSubtitle: 'Browse our products and place your order',
  /** Short "about us" blurb shown on the welcome screen. */
  aboutText:
    'Thanks for stopping by the Endless Fun booth! Browse our products below and place your order right here — a team member will follow up to finalize the details.',

  // ---- Order attribution ----
  /** Label stored on each order (which booth/kiosk it came from). */
  deviceName: 'Booth Kiosk',
  /** Event/tradeshow name stored on each order. Staff can leave blank. */
  eventName: '',

  // ---- Staff access ----
  /** Code to reach the admin area (view orders + manage catalog).
   *  Tap the logo on the welcome screen, then enter this on the number pad. */
  staffPin: '5680',

  /** Your brand color. Keep in sync with colors.primary in theme.ts. */
  brandColor: '#0091D5',
};
