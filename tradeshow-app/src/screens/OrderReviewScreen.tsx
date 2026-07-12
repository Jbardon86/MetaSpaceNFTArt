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
import { Avatar, Button, Card, EmptyState, ProductImage, QtyStepper } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { formatMoney, lineTotal, orderTotal } from '../types';
import { colors, font, radius, spacing } from '../theme';

// The cart / checkout: adjust quantities, pick the customer, add notes, confirm.
export default function OrderReviewScreen({ navigation }: ScreenProps<'OrderReview'>) {
  const { submitOrder } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const [submitting, setSubmitting] = useState(false);

  const total = orderTotal(draft.lines);

  const submit = async () => {
    if (!draft.customer) {
      Alert.alert('Add a customer', 'Choose who this order is for before confirming.');
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
      navigation.reset({
        index: 1,
        routes: [{ name: 'Home' }, { name: 'OrderDetail', params: { orderId: order.id } }],
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (draft.lines.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState emoji="🛒" title="Your cart is empty" subtitle="Add some products to get started." />
        <View style={{ paddingHorizontal: spacing.xl }}>
          <Button title="Browse products" onPress={() => navigation.navigate('OrderProducts')} />
        </View>
      </View>
    );
  }

  const qtyFor = (id: string) => draft.lines.find((l) => l.productId === id)?.quantity ?? 0;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}
      >
        {/* Customer */}
        <Text style={styles.sectionLabel}>Customer</Text>
        <Pressable onPress={() => navigation.navigate('OrderCustomer')}>
          <Card style={styles.customerCard}>
            {draft.customer ? (
              <>
                <Avatar name={draft.customer.company || draft.customer.name} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.company}>
                    {draft.customer.company || draft.customer.name}
                  </Text>
                  {draft.customer.company ? (
                    <Text style={styles.sub}>{draft.customer.name}</Text>
                  ) : null}
                </View>
                <Text style={styles.change}>Change</Text>
              </>
            ) : (
              <>
                <View style={styles.addCustomerIcon}>
                  <Text style={{ fontSize: 22, color: colors.primary }}>＋</Text>
                </View>
                <Text style={styles.addCustomerText}>Add a customer</Text>
                <Text style={styles.change}>Choose</Text>
              </>
            )}
          </Card>
        </Pressable>

        {/* Items */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
          Cart · {draft.lines.length} item{draft.lines.length === 1 ? '' : 's'}
        </Text>
        <Card>
          {draft.lines.map((l, i) => (
            <View
              key={l.productId}
              style={[styles.lineRow, i < draft.lines.length - 1 && styles.lineDivider]}
            >
              <ProductImage uri={l.imageUri} name={l.name} size={48} />
              <View style={{ flex: 1, marginHorizontal: spacing.md }}>
                <Text style={styles.lineName} numberOfLines={2}>{l.name}</Text>
                <Text style={styles.sub}>
                  {formatMoney(l.unitPrice)} · {formatMoney(lineTotal(l))}
                </Text>
              </View>
              <QtyStepper
                qty={qtyFor(l.productId)}
                onInc={() => draft.setQuantity(l.productId, qtyFor(l.productId) + 1)}
                onDec={() => draft.setQuantity(l.productId, qtyFor(l.productId) - 1)}
              />
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatMoney(total)}</Text>
          </View>
        </Card>

        {/* Notes */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Notes</Text>
        <Card>
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
          title={submitting ? 'Submitting…' : `Confirm order · ${formatMoney(total)}`}
          onPress={submit}
          loading={submitting}
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
  customerCard: { flexDirection: 'row', alignItems: 'center' },
  addCustomerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCustomerText: { flex: 1, marginLeft: spacing.md, fontSize: font.h3, fontWeight: '700', color: colors.text },
  company: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  change: { fontSize: font.body, color: colors.primary, fontWeight: '700' },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  lineDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  lineName: { fontSize: font.body, fontWeight: '600', color: colors.text },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  notes: {
    minHeight: 80,
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
