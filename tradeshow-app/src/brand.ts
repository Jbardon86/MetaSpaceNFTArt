// ---------------------------------------------------------------------------
// COMPANY BRANDING — change these to make the app yours.
//
// This is the one place to set your company's "vibe". The primary color also
// lives in theme.ts (colors.primary) — update both to your brand color.
// ---------------------------------------------------------------------------

export const brand = {
  /** Shown on the login screen and as the app's identity. */
  companyName: 'MetaSpace',
  /** Full product/app name on the login screen. */
  appName: 'MetaSpace Orders',
  /** Small line under the app name. */
  tagline: 'Tradeshow order entry',
  /**
   * Logo shown on the login screen. Either:
   *  - an emoji (default), or
   *  - a require() to a local image, e.g. require('../assets/logo.png'), or
   *  - a { uri: 'https://…' } remote image.
   * Set `logoImage` to use an image instead of the emoji.
   */
  logoEmoji: '🎨',
  logoImage: null as null | number | { uri: string },
  /** Your brand color. Keep in sync with colors.primary in theme.ts. */
  brandColor: '#007AFF',
};
