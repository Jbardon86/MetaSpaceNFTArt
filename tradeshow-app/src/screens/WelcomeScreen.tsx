import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, PressableScale } from '../components/ui';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { brand } from '../brand';
import { colors, font, radius, spacing } from '../theme';

// The kiosk landing screen. Customer picks up the iPad and sees this.
// Staff tap the logo to open the admin number pad.
export default function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const [padOpen, setPadOpen] = useState(false);

  const start = () => {
    draft.reset();
    navigation.navigate('Details');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.primary }}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl },
        ]}
      >
        <View style={styles.hero}>
          {/* Tap the logo to open the admin number pad. */}
          {brand.logoImage ? (
            <Pressable onPress={() => setPadOpen(true)} style={styles.logoTile}>
              <Image source={brand.logoImage} style={styles.logoTileImg} resizeMode="contain" />
            </Pressable>
          ) : (
            <Pressable onPress={() => setPadOpen(true)} style={styles.logoBadge}>
              <Text style={styles.logo}>{brand.logoEmoji}</Text>
            </Pressable>
          )}
          <Text style={styles.subtitle}>{brand.welcomeSubtitle}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.about}>{brand.aboutText}</Text>
          <View style={{ height: spacing.xl }} />
          <Button title="Start your order" onPress={start} />
          <Text style={styles.footnote}>Powered by {brand.companyName}</Text>
        </View>
      </ScrollView>

      <AdminKeypadModal
        visible={padOpen}
        onClose={() => setPadOpen(false)}
        onSuccess={() => {
          setPadOpen(false);
          navigation.navigate('Staff');
        }}
      />
    </View>
  );
}

// On-screen number pad for admin access.
function AdminKeypadModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [entry, setEntry] = useState('');
  const [error, setError] = useState(false);
  const codeLength = brand.staffPin.length;

  const reset = () => {
    setEntry('');
    setError(false);
  };

  const press = (digit: string) => {
    if (entry.length >= codeLength) return;
    const next = entry + digit;
    setError(false);
    setEntry(next);
    if (next.length === codeLength) {
      // Validate once the full code is entered.
      if (next === brand.staffPin) {
        setTimeout(() => {
          reset();
          onSuccess();
        }, 120);
      } else {
        setTimeout(() => {
          setError(true);
          setEntry('');
        }, 120);
      }
    }
  };

  const backspace = () => {
    setError(false);
    setEntry((e) => e.slice(0, -1));
  };

  const close = () => {
    reset();
    onClose();
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.modalBackdrop}>
        <View style={styles.padCard}>
          <Text style={styles.padTitle}>Admin access</Text>
          <Text style={[styles.padSub, error && { color: colors.danger }]}>
            {error ? 'Incorrect code — try again' : 'Enter your code'}
          </Text>

          {/* Progress dots */}
          <View style={styles.dotsRow}>
            {Array.from({ length: codeLength }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < entry.length && styles.dotFilled,
                  error && { borderColor: colors.danger },
                ]}
              />
            ))}
          </View>

          {/* Number grid */}
          <View style={styles.grid}>
            {keys.map((k) => (
              <Key key={k} label={k} onPress={() => press(k)} />
            ))}
            <View style={styles.keyEmpty} />
            <Key label="0" onPress={() => press('0')} />
            <Key label="⌫" onPress={backspace} muted />
          </View>

          <Button title="Cancel" variant="ghost" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

function Key({ label, onPress, muted }: { label: string; onPress: () => void; muted?: boolean }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.9} style={styles.key}>
      <Text style={[styles.keyText, muted && { color: colors.textMuted, fontSize: font.h2 }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

const KEY_SIZE = 72;

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  hero: { alignItems: 'center', marginBottom: spacing.xxl },
  logoTile: {
    width: '86%',
    maxWidth: 320,
    height: 150,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  logoTileImg: { width: '100%', height: '100%' },
  logoBadge: {
    width: 116,
    height: 116,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  logo: { fontSize: 60 },
  title: { fontSize: font.h1, fontWeight: '800', color: '#fff', textAlign: 'center' },
  subtitle: {
    fontSize: font.h3,
    color: '#ffffffcc',
    marginTop: spacing.sm,
    textAlign: 'center',
    fontWeight: '500',
  },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: spacing.xl },
  about: { fontSize: font.body, color: colors.text, lineHeight: 24, textAlign: 'center' },
  footnote: {
    fontSize: font.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },

  // Keypad modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  padCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: spacing.xl,
    alignItems: 'center',
  },
  padTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  padSub: { fontSize: font.body, color: colors.textMuted, marginTop: spacing.xs },
  dotsRow: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.xl },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
  },
  dotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: KEY_SIZE * 3 + spacing.md * 2,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: { width: KEY_SIZE, height: KEY_SIZE },
  keyText: { fontSize: font.h1, fontWeight: '600', color: colors.text },
});
