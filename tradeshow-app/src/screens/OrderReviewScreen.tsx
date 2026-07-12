import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { formatMoney, lineTotal, orderTotal } from '../types';
import { colors, font, radius, spacing } from '../theme';

export default function OrderReviewScreen({ navigation }: ScreenProps<'OrderReview'>) {
  const { submitOrder } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState(false);

  const total = orderTotal(draft.lines);

  const submit = async () => {
    if (!draft.customer) {
      Alert.alert('Missing customer', 'Please pick a customer first.');
      return;
    }
    setSubmitting(true);
    try {
      const order = await submitOrder({
        customer: draft.customer,
        lines: draft.lines,
        notes: draft.notes,
      });
      draft.reset();
      // Replace the flow with the order detail so Back returns Home.
      navigation.reset({
        index: 1,
        routes: [{ name: 'Home' }, { name: 'OrderDetail', params: { orderId: order.id } }],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}
      >
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionLabel}>Customer</Text>
          <Text style={styles.company}>
            {draft.customer?.company || draft.customer?.name || '—'}
          </Text>
          {draft.customer?.company ? <Text style={styles.sub}>{draft.customer.name}</Text> : null}
          {draft.customer?.email ? <Text style={styles.sub}>{draft.customer.email}</Text> : null}
        </Card>

        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionLabel}>Items</Text>
          {draft.lines.map((l) => (
            <View key={l.productId} style={styles.lineRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineName}>{l.name}</Text>
                <Text style={styles.sub}>
                  {l.quantity} × {formatMoney(l.unitPrice)}
                  {l.discountPct > 0 ? `  (−${l.discountPct}%)` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.lineTotal}>{formatMoney(lineTotal(l))}</Text>
                <Pressable onPress={() => draft.removeLine(l.productId)} hitSlop={8}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(total)}</Text>
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionLabel}>Notes</Text>
          <TextInput
            value={draft.notes}
            onChangeText={draft.setNotes}
            placeholder="Delivery instructions, follow-ups, booth number…"
            placeholderTextColor={colors.textMuted}
            multiline
            style={styles.notes}
          />
        </Card>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          title={submitting ? 'Submitting…' : `Submit order · ${formatMoney(total)}`}
          onPress={submit}
          loading={submitting}
          disabled={draft.lines.length === 0}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: font.small,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  company: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineName: { fontSize: font.body, fontWeight: '600', color: colors.text },
  lineTotal: { fontSize: font.body, fontWeight: '700', color: colors.text },
  remove: { fontSize: font.small, color: colors.danger, marginTop: 2 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  totalLabel: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  notes: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: font.body,
    color: colors.text,
    textAlignVertical: 'top',
  },
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
