import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Field } from '../components/ui';
import { useApp } from '../store/AppContext';
import { colors, font, spacing } from '../theme';

// Phase 1: simple rep name + event name. In Phase 2 this becomes
// "Sign in with Salesforce" (OAuth) or a shared team login.
export default function LoginScreen() {
  const { login } = useApp();
  const insets = useSafeAreaInsets();
  const [repName, setRepName] = useState('');
  const [eventName, setEventName] = useState('');

  const canContinue = repName.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.primary }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Text style={styles.logo}>🎨</Text>
          <Text style={styles.title}>MetaSpace Orders</Text>
          <Text style={styles.subtitle}>Tradeshow order entry</Text>
        </View>

        <View style={styles.card}>
          <Field
            label="Your name"
            value={repName}
            onChangeText={setRepName}
            placeholder="e.g. Jordan Bardon"
            autoCapitalize="words"
            returnKeyType="next"
          />
          <Field
            label="Event / tradeshow (optional)"
            value={eventName}
            onChangeText={setEventName}
            placeholder="e.g. NFT NYC 2026"
            autoCapitalize="words"
            returnKeyType="done"
          />
          <Button
            title="Start taking orders"
            onPress={() => login(repName, eventName)}
            disabled={!canContinue}
          />
          <Text style={styles.hint}>
            Phase 2 will replace this with Salesforce sign-in.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  brand: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: { fontSize: 56, marginBottom: spacing.md },
  title: { fontSize: font.h1, fontWeight: '800', color: '#fff' },
  subtitle: { fontSize: font.body, color: '#DBEAFE', marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.xl,
  },
  hint: {
    fontSize: font.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
