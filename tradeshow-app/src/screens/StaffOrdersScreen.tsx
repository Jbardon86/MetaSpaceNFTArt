import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, Badge, Card, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { ScreenProps } from '../navigation';
import { formatMoney, orderTotal, Order } from '../types';
import { colors, font, spacing, statusMeta } from '../theme';

// Staff-only list of all orders with sync status. Not visible to customers.
export default function StaffOrdersScreen({ navigation }: ScreenProps<'StaffOrders'>) {
  const { orders, pendingCount, syncPending } = useApp();

  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ padding: spacing.lg }}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.syncText}>
            {pendingCount > 0
              ? `${pendingCount} order${pendingCount === 1 ? '' : 's'} waiting to sync`
              : 'All orders synced'}
          </Text>
          {pendingCount > 0 ? (
            <Pressable onPress={syncPending}>
              <Text style={styles.syncNow}>Sync now</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => <OrderRow order={item} navigation={navigation} />}
      ListEmptyComponent={
        <EmptyState emoji="📋" title="No orders yet" subtitle="Orders placed at the kiosk will appear here." />
      }
    />
  );
}

function OrderRow({
  order,
  navigation,
}: {
  order: Order;
  navigation: ScreenProps<'StaffOrders'>['navigation'];
}) {
  const meta = statusMeta(order.status);
  const total = orderTotal(order.lines);
  const when = new Date(order.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return (
    <Pressable onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}>
      <Card style={styles.orderCard}>
        <Avatar name={order.customer.name || order.customer.company || 'New'} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.company} numberOfLines={1}>
            {order.customer.name || order.customer.company || 'Customer'}
          </Text>
          <Text style={styles.meta}>
            {order.lines.length} item{order.lines.length === 1 ? '' : 's'} · {when}
          </Text>
          <View style={{ marginTop: spacing.sm }}>
            <Badge text={meta.label} color={meta.color} />
          </View>
        </View>
        <Text style={styles.total}>{formatMoney(total)}</Text>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  syncText: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  syncNow: { fontSize: font.body, color: colors.primary, fontWeight: '700' },
  orderCard: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  company: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  total: { fontSize: font.h3, fontWeight: '800', color: colors.text, marginLeft: spacing.md },
});
