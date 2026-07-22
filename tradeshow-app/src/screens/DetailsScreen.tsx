import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { Address } from '../types';
import { BACKEND_URL } from '../config';
import { scanBusinessCard } from '../scan/card';
import { colors, font, spacing } from '../theme';

// Reusable street/city/state/zip inputs for ship-to and bill-to.
function AddressFields({
  value,
  onChange,
}: {
  value: Address;
  onChange: (patch: Partial<Address>) => void;
}) {
  return (
    <>
      <Field
        label="Street address"
        value={value.street}
        onChangeText={(t) => onChange({ street: t })}
        placeholder="123 Main St"
      />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 2 }}>
          <Field label="City" value={value.city} onChangeText={(t) => onChange({ city: t })} placeholder="City" />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="State"
            value={value.state}
            onChangeText={(t) => onChange({ state: t })}
            placeholder="ST"
            autoCapitalize="characters"
            maxLength={2}
          />
        </View>
        <View style={{ flex: 1.2 }}>
          <Field
            label="ZIP"
            value={value.zip}
            onChangeText={(t) => onChange({ zip: t })}
            placeholder="00000"
            keyboardType="number-pad"
            maxLength={10}
          />
        </View>
      </View>
    </>
  );
}

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
  const [scanning, setScanning] = useState(false);

  const canContinue = name.trim().length > 0 && (email.trim().length > 0 || phone.trim().length > 0);

  // Take a photo of a business card; AI fills in the fields.
  const scanCard = async () => {
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      base64: true,
    });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    setScanning(true);
    try {
      const f = await scanBusinessCard(res.assets[0].base64, 'image/jpeg');
      if (f) {
        if (f.name) setName(f.name);
        if (f.company) setCompany(f.company);
        if (f.email) setEmail(f.email);
        if (f.phone) setPhone(f.phone);
        if (f.street || f.city || f.zip) {
          draft.updateShipTo({ street: f.street, city: f.city, state: f.state, zip: f.zip });
        }
      }
    } catch (e) {
      Alert.alert('Scan failed', e instanceof Error ? e.message : 'Please enter the details manually.');
    } finally {
      setScanning(false);
    }
  };

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

        {BACKEND_URL ? (
          <View style={{ marginTop: spacing.lg }}>
            <Button
              title={scanning ? 'Reading card…' : '📷 Scan business card'}
              variant="secondary"
              onPress={scanCard}
              loading={scanning}
            />
            <Text style={styles.scanHint}>Snap a photo to auto-fill the fields.</Text>
          </View>
        ) : null}

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

        <Text style={styles.sectionHeading}>Shipping address</Text>
        <Card>
          <AddressFields value={draft.shipTo} onChange={draft.updateShipTo} />
        </Card>

        <Text style={styles.sectionHeading}>Billing address</Text>
        <Card>
          <View style={styles.sameRow}>
            <Text style={styles.optInLabel}>Same as shipping</Text>
            <Switch value={draft.billSameAsShip} onValueChange={draft.setBillSameAsShip} />
          </View>
          {!draft.billSameAsShip ? (
            <View style={{ marginTop: spacing.lg }}>
              <AddressFields value={draft.billTo} onChange={draft.updateBillTo} />
            </View>
          ) : null}
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
  scanHint: { fontSize: font.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  sectionHeading: {
    fontSize: font.h3,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
