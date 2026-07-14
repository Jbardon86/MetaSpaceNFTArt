import { useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { brand } from '../brand';
import { colors, font, radius, spacing } from '../theme';

// The kiosk landing screen. Customer picks up the iPad and sees this.
export default function WelcomeScreen({ navigation }: ScreenProps<'Welcome'>) {
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const [pinOpen, setPinOpen] = useState(false);

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
        {/* Discreet staff access, top-right */}
        <Pressable style={styles.staffBtn} onPress={() => setPinOpen(true)} hitSlop={16}>
          <Text style={styles.staffText}>Staff</Text>
        </Pressable>

        <View style={styles.hero}>
          <View style={styles.logoBadge}>
            {brand.logoImage ? (
              <Image source={brand.logoImage} style={styles.logoImg} resizeMode="contain" />
            ) : (
              <Text style={styles.logo}>{brand.logoEmoji}</Text>
            )}
          </View>
          <Text style={styles.title}>{brand.welcomeTitle}</Text>
          <Text style={styles.subtitle}>{brand.welcomeSubtitle}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.about}>{brand.aboutText}</Text>
          <View style={{ height: spacing.xl }} />
          <Button title="Start your order" onPress={start} />
          <Text style={styles.footnote}>Powered by {brand.companyName}</Text>
        </View>
      </ScrollView>

      <StaffPinModal
        visible={pinOpen}
        onClose={() => setPinOpen(false)}
        onSuccess={() => {
          setPinOpen(false);
          navigation.navigate('Staff');
        }}
      />
    </View>
  );
}

function StaffPinModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const submit = () => {
    if (pin === brand.staffPin) {
      setPin('');
      setError(false);
      onSuccess();
    } else {
      setError(true);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.pinCard} onPress={() => {}}>
          <Text style={styles.pinTitle}>Staff access</Text>
          <Text style={styles.pinSub}>Enter the staff PIN</Text>
          <TextInput
            value={pin}
            onChangeText={(t) => {
              setPin(t);
              setError(false);
            }}
            placeholder="••••"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            secureTextEntry
            style={[styles.pinInput, error && { borderColor: colors.danger }]}
            autoFocus
            maxLength={8}
          />
          {error ? <Text style={styles.pinError}>Incorrect PIN</Text> : null}
          <View style={{ height: spacing.md }} />
          <Button title="Enter" onPress={submit} disabled={pin.length === 0} />
          <View style={{ height: spacing.sm }} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  staffBtn: {
    position: 'absolute',
    top: 0,
    right: spacing.lg,
    padding: spacing.sm,
  },
  staffText: { color: '#ffffff99', fontSize: font.small, fontWeight: '600' },
  hero: { alignItems: 'center', marginBottom: spacing.xxl },
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
  logoImg: { width: 92, height: 92 },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#0009',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  pinCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.xl,
  },
  pinTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  pinSub: { fontSize: font.body, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  pinInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.h2,
    letterSpacing: 8,
    textAlign: 'center',
    color: colors.text,
  },
  pinError: { color: colors.danger, marginTop: spacing.sm, fontWeight: '600' },
});
