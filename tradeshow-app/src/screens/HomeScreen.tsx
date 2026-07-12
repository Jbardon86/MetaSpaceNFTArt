import { useLayoutEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, Card, EmptyState } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { formatMoney, orderTotal, Order } from '../types';
import { colors, font, spacing, statusMeta } from '../theme';

export default function HomeScreen({ navigation }: ScreenProps<'Home'>) {
  const { session, orders, pendingCount, syncPending, logout, adapterLabel } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable onPress={logout} hitSlop={12}>
          <Text style={styles.headerBtn}>Sign out</Text>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('Catalog')} hitSlop={12}>
          <Text style={styles.headerBtn}>Catalog</Text>
        </Pressable>
      ),
    });
  }, [navigation, logout]);

  const startOrder = () => {
    draft.reset();
    navigation.navigate('OrderCustomer');
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={styles.greeting}>Hi {session?.repName?.split(' ')[0]} 👋</Text>
            {session?.eventName ? (
              <Text style={styles.event}>{session.eventName}</Text>
            ) : null}
            <View style={styles.syncRow}>
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
            <Text style={styles.adapter}>{adapterLabel}</Text>
          </View>
        }
        renderItem={({ item }) => <OrderRow order={item} navigation={navigation} />}
        ListEmptyComponent={
          <EmptyState
            title="No orders yet"
            subtitle="Tap “New order” to capture your first order at the booth."
          />
        }
      />

      <View style={[styles.fabWrap, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button title="+ New order" onPress={startOrder} />
      </View>
    </View>
  );
}

function OrderRow({
  order,
  navigation,
}: {
  order: Order;
  navigation: ScreenProps<'Home'>['navigation'];
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
        <View style={{ flex: 1 }}>
          <Text style={styles.company} numberOfLines={1}>
            {order.customer.company || order.customer.name || 'New customer'}
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
  headerBtn: { color: '#fff', fontSize: font.body, fontWeight: '600' },
  greeting: { fontSize: font.h1, fontWeight: '800', color: colors.text },
  event: { fontSize: font.body, color: colors.textMuted, marginTop: 2 },
  syncRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  syncText: { fontSize: font.body, color: colors.text, fontWeight: '600' },
  syncNow: { fontSize: font.body, color: colors.primary, fontWeight: '700' },
  adapter: { fontSize: font.small, color: colors.textMuted, marginTop: spacing.xs },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  company: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  total: { fontSize: font.h3, fontWeight: '800', color: colors.text, marginLeft: spacing.md },
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
