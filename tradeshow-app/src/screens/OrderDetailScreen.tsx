import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, Card, EmptyState, ProductImage } from '../components/ui';
import { SignatureView } from '../components/SignaturePad';
import { useApp } from '../store/AppContext';
import { ScreenProps } from '../navigation';
import { formatMoney, lineTotal, orderTotal } from '../types';
import { colors, font, spacing, statusMeta } from '../theme';

export default function OrderDetailScreen({ route }: ScreenProps<'OrderDetail'>) {
  const { orders, syncPending } = useApp();
  const insets = useSafeAreaInsets();
  const order = orders.find((o) => o.id === route.params.orderId);

  if (!order) {
    return <EmptyState title="Order not found" />;
  }

  const meta = statusMeta(order.status);
  const total = orderTotal(order.lines);
  const when = new Date(order.createdAt).toLocaleString();

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
      <View style={styles.statusRow}>
        <Badge text={meta.label} color={meta.color} />
        {order.salesforceId ? (
          <Text style={styles.sfId}>SF: {order.salesforceId}</Text>
        ) : null}
      </View>

      {order.status === 'error' || (order.status === 'pending' && order.syncError) ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>{order.syncError}</Text>
          <View style={{ height: spacing.md }} />
          <Button title="Retry sync" variant="secondary" onPress={syncPending} />
        </Card>
      ) : null}

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={styles.sectionLabel}>Customer</Text>
        <Text style={styles.company}>{order.customer.company || order.customer.name}</Text>
        {order.customer.company ? <Text style={styles.sub}>{order.customer.name}</Text> : null}
        {order.customer.email ? <Text style={styles.sub}>{order.customer.email}</Text> : null}
        {order.customer.phone ? <Text style={styles.sub}>{order.customer.phone}</Text> : null}
      </Card>

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={styles.sectionLabel}>Items</Text>
        {order.lines.map((l) => (
          <View key={l.productId} style={styles.lineRow}>
            <ProductImage uri={l.imageUri} name={l.name} size={44} />
            <View style={{ flex: 1, marginHorizontal: spacing.md }}>
              <Text style={styles.lineName}>{l.name}</Text>
              <Text style={styles.sub}>
                {l.quantity} × {formatMoney(l.unitPrice)}
                {l.discountPct > 0 ? `  (−${l.discountPct}%)` : ''}
              </Text>
            </View>
            <Text style={styles.lineTotal}>{formatMoney(lineTotal(l))}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatMoney(total)}</Text>
        </View>
      </Card>

      {order.notes ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionLabel}>Notes</Text>
          <Text style={styles.body}>{order.notes}</Text>
        </Card>
      ) : null}

      {order.signature ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionLabel}>Signature</Text>
          <SignatureView data={order.signature} />
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionLabel}>Details</Text>
        <Text style={styles.body}>Rep: {order.repName}</Text>
        {order.eventName ? <Text style={styles.body}>Event: {order.eventName}</Text> : null}
        <Text style={styles.body}>Taken: {when}</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sfId: { fontSize: font.small, color: colors.textMuted },
  errorCard: { marginBottom: spacing.lg, borderColor: colors.danger + '55' },
  errorText: { color: colors.danger, fontSize: font.body },
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
  body: { fontSize: font.body, color: colors.text, marginTop: 2 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lineName: { fontSize: font.body, fontWeight: '600', color: colors.text },
  lineTotal: { fontSize: font.body, fontWeight: '700', color: colors.text },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  totalLabel: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: font.h2, fontWeight: '800', color: colors.text },
});
