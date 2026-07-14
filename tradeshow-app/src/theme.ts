import { Platform, ViewStyle } from 'react-native';

// iOS-flavored design tokens: system colors, grouped backgrounds, soft shadows.
// Tuned to feel like a native iOS app.

export const colors = {
  primary: '#0091D5', // Milk Magic blue
  primaryDark: '#0073AA',
  primarySoft: '#E3F3FB',
  bg: '#F2F2F7', // iOS grouped background
  surface: '#FFFFFF',
  border: '#E5E5EA', // iOS separator
  text: '#1C1C1E',
  textMuted: '#8E8E93', // iOS secondary label
  success: '#34C759', // iOS green
  warning: '#FF9500', // iOS orange
  danger: '#FF3B30', // iOS red
  pending: '#FF9500',
  synced: '#34C759',
  error: '#FF3B30',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
};

export const font = {
  h1: 32,
  h2: 24,
  h3: 18,
  body: 16,
  small: 13,
};

// Soft, "bubbly" shadow used on buttons and cards.
export function shadow(elevation = 6, color = '#000'): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: elevation / 2 },
      shadowOpacity: 0.14,
      shadowRadius: elevation,
    },
    android: { elevation },
    default: {
      // web
      boxShadow: `0 ${elevation / 2}px ${elevation}px rgba(0,0,0,0.14)`,
    } as unknown as ViewStyle,
  })!;
}

/** Colored shadow that matches a button's fill, for a glossier pop. */
export function coloredShadow(color: string, elevation = 8): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: elevation / 2 },
      shadowOpacity: 0.35,
      shadowRadius: elevation,
    },
    android: { elevation },
    default: {
      boxShadow: `0 ${elevation / 2}px ${elevation}px ${color}59`,
    } as unknown as ViewStyle,
  })!;
}

export function statusMeta(status: string): { color: string; label: string } {
  switch (status) {
    case 'synced':
      return { color: colors.synced, label: 'Synced' };
    case 'syncing':
      return { color: colors.primary, label: 'Syncing…' };
    case 'pending':
      return { color: colors.pending, label: 'Pending sync' };
    case 'error':
      return { color: colors.error, label: 'Sync failed' };
    case 'draft':
    default:
      return { color: colors.textMuted, label: 'Draft' };
  }
}
