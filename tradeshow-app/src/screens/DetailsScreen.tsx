import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { colors, font, spacing } from '../theme';

// Customer enters their own details. Deliberately a plain form — no search of
// existing customers, so no one sees anyone else's information.
export default function DetailsScreen({ navigation }: ScreenProps<'Details'>) {
  const { addCustomer } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();

  // Pre-fill if the customer went back from the cart to edit.
  const [name, setName] = useState(draft.customer?.name ?? '');
  const [company, setCompany] = useState(draft.customer?.company ?? '');
  const [email, setEmail] = useState(draft.customer?.email ?? '');
  const [phone, setPhone] = useState(draft.customer?.phone ?? '');

  const canContinue = name.trim().length > 0 && (email.trim().length > 0 || phone.trim().length > 0);

  const cont = async () => {
    const created = await addCustomer({
      name: name.trim(),
      company: company.trim(),
      email: email.trim(),
      phone: phone.trim(),
    });
    draft.setCustomer(created);
    navigation.navigate('OrderProducts');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
      >
        <Text style={styles.heading}>Your details</Text>
        <Text style={styles.sub}>So we can follow up on your order.</Text>

        <Card style={{ marginTop: spacing.lg }}>
          <Field label="Your name" value={name} onChangeText={setName} placeholder="First and last name" autoCapitalize="words" />
          <Field label="Company (optional)" value={company} onChangeText={setCompany} placeholder="Company / gallery name" autoCapitalize="words" />
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" keyboardType="phone-pad" />

          <View style={styles.optInRow}>
            <View style={{ flex: 1, marginRight: spacing.md }}>
              <Text style={styles.optInLabel}>Email me my confirmation</Text>
              <Text style={styles.optInSub}>We'll send a receipt to your email.</Text>
            </View>
            <Switch value={draft.emailConfirmation} onValueChange={draft.setEmailConfirmation} />
          </View>
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button title="Continue to products" onPress={cont} disabled={!canContinue} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: font.h1, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.body, color: colors.textMuted, marginTop: spacing.xs },
  optInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  optInLabel: { fontSize: font.body, fontWeight: '600', color: colors.text },
  optInSub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
