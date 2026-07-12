// Central design tokens. Kept small and flat so screens stay consistent and
// buttons are big/tappable for use on a busy tradeshow floor.

export const colors = {
  primary: '#2563EB', // blue-600
  primaryDark: '#1D4ED8',
  bg: '#F1F5F9', // slate-100
  surface: '#FFFFFF',
  border: '#E2E8F0', // slate-200
  text: '#0F172A', // slate-900
  textMuted: '#64748B', // slate-500
  success: '#16A34A', // green-600
  warning: '#D97706', // amber-600
  danger: '#DC2626', // red-600
  pending: '#D97706',
  synced: '#16A34A',
  error: '#DC2626',
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
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const font = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 16,
  small: 13,
};

/** Maps a sync status to a display color + label. */
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
