import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { colors, coloredShadow, font, radius, shadow, spacing } from '../theme';

// ---------------------------------------------------------------------------
// PressableScale — the "bubbly" feel: springs down slightly when pressed.
// ---------------------------------------------------------------------------
export function PressableScale({
  onPress,
  disabled,
  style,
  children,
  scaleTo = 0.96,
}: {
  onPress?: () => void;
  disabled?: boolean;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 8 }).start();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => spring(scaleTo)}
      onPressOut={() => spring(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }], opacity: disabled ? 0.5 : 1 }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Button — rounded, shadowed, springy.
// ---------------------------------------------------------------------------
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
}) {
  const palette: Record<string, { bg: string; fg: string; border?: string; glow?: string }> = {
    primary: { bg: colors.primary, fg: '#fff', glow: colors.primary },
    secondary: { bg: colors.surface, fg: colors.primary, border: colors.border },
    danger: { bg: colors.danger, fg: '#fff', glow: colors.danger },
    ghost: { bg: 'transparent', fg: colors.textMuted },
  };
  const p = palette[variant];
  return (
    <PressableScale onPress={onPress} disabled={disabled || loading}>
      <View
        style={[
          styles.btn,
          { backgroundColor: p.bg },
          p.border ? { borderWidth: 1, borderColor: p.border } : null,
          p.glow && !disabled ? coloredShadow(p.glow, 10) : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={p.fg} />
        ) : (
          <Text style={[styles.btnText, { color: p.fg }]}>{title}</Text>
        )}
      </View>
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// AddButton — e-commerce "Add" that flashes ✓ Added, springy.
// ---------------------------------------------------------------------------
export function AddButton({ onAdd }: { onAdd: () => void }) {
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handle = () => {
    onAdd();
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 900);
  };

  return (
    <PressableScale onPress={handle} scaleTo={0.9}>
      <View
        style={[
          styles.addBtn,
          { backgroundColor: added ? colors.success : colors.primary },
          coloredShadow(added ? colors.success : colors.primary, 8),
        ]}
      >
        <Text style={styles.addBtnText}>{added ? '✓ Added' : '＋ Add'}</Text>
      </View>
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------
// QtyStepper — rounded pill − 2 +
// ---------------------------------------------------------------------------
export function QtyStepper({
  qty,
  onInc,
  onDec,
}: {
  qty: number;
  onInc: () => void;
  onDec: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <PressableScale onPress={onDec} scaleTo={0.85}>
        <View style={styles.stepBtn}>
          <Text style={styles.stepText}>−</Text>
        </View>
      </PressableScale>
      <Text style={styles.qty}>{qty}</Text>
      <PressableScale onPress={onInc} scaleTo={0.85}>
        <View style={styles.stepBtn}>
          <Text style={styles.stepText}>＋</Text>
        </View>
      </PressableScale>
    </View>
  );
}

// ---------------------------------------------------------------------------
// CartBar — sticky bottom "N items · $total · View cart"
// ---------------------------------------------------------------------------
export function CartBar({
  count,
  total,
  onPress,
  label = 'View cart',
  bottomInset = 0,
}: {
  count: number;
  total: string;
  onPress: () => void;
  label?: string;
  bottomInset?: number;
}) {
  if (count <= 0) return null;
  return (
    <View style={[styles.cartBarWrap, { paddingBottom: bottomInset + spacing.md }]}>
      <PressableScale onPress={onPress} scaleTo={0.98}>
        <View style={[styles.cartBar, coloredShadow(colors.primary, 12)]}>
          <View style={styles.cartCountBubble}>
            <Text style={styles.cartCountText}>{count}</Text>
          </View>
          <Text style={styles.cartBarLabel}>{label}</Text>
          <Text style={styles.cartBarTotal}>{total}</Text>
        </View>
      </PressableScale>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avatar — colored circle with initials, gives product/customer rows an icon.
// ---------------------------------------------------------------------------
const AVATAR_COLORS = ['#007AFF', '#34C759', '#FF9500', '#AF52DE', '#FF2D55', '#5AC8FA'];
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const bg = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg + '22',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: bg, fontWeight: '800', fontSize: size * 0.36 }}>{initials || '•'}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Field / Card / Badge / EmptyState
// ---------------------------------------------------------------------------
export function Field({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.textMuted} style={styles.input} {...props} />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, shadow(5), style]}>{children}</View>;
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '22' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  subtitle,
  emoji,
}: {
  title: string;
  subtitle?: string;
  emoji?: string;
}) {
  return (
    <View style={styles.empty}>
      {emoji ? <Text style={styles.emptyEmoji}>{emoji}</Text> : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnText: { fontSize: font.body + 1, fontWeight: '700' },
  addBtn: {
    minWidth: 96,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  addBtnText: { color: '#fff', fontWeight: '800', fontSize: font.body },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 22, color: colors.primary, fontWeight: '800' },
  qty: { minWidth: 40, textAlign: 'center', fontSize: font.h3, fontWeight: '800', color: colors.text },
  cartBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  cartBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    height: 60,
  },
  cartCountBubble: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ffffff33',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  cartCountText: { color: '#fff', fontWeight: '800', fontSize: font.body },
  cartBarLabel: { flex: 1, color: '#fff', fontWeight: '700', fontSize: font.h3, marginLeft: spacing.md },
  cartBarTotal: { color: '#fff', fontWeight: '800', fontSize: font.h3 },
  label: {
    fontSize: font.small,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.body,
    color: colors.text,
    minHeight: 50,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  badgeText: { fontSize: font.small, fontWeight: '700' },
  empty: { alignItems: 'center', padding: spacing.xxl },
  emptyEmoji: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  emptySub: {
    fontSize: font.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
