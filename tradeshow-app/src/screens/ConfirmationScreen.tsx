import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { formatMoney, orderTotal } from '../types';
import { brand } from '../brand';
import { colors, font, spacing } from '../theme';

// Shown after an order is placed. Thanks the customer, then resets the kiosk
// back to the Welcome screen for the next person.
export default function ConfirmationScreen({ route, navigation }: ScreenProps<'Confirmation'>) {
  const { orders } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const order = orders.find((o) => o.id === route.params.orderId);

  const finish = () => {
    draft.reset();
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  const total = order ? orderTotal(order.lines) : 0;
  const firstName = order?.customer.name?.split(' ')[0];

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={styles.center}>
        <View style={styles.checkCircle}>
          <Text style={styles.check}>✓</Text>
        </View>
        <Text style={styles.title}>Thank you{firstName ? `, ${firstName}` : ''}!</Text>
        <Text style={styles.subtitle}>
          Your order has been received. A {brand.companyName} team member will follow up to finalize
          the details.
        </Text>

        {order ? (
          <View style={styles.summary}>
            <Text style={styles.summaryLine}>
              {order.lines.length} item{order.lines.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.summaryTotal}>{formatMoney(total)}</Text>
          </View>
        ) : null}

        {order?.emailConfirmation && order.customer.email ? (
          <Text style={styles.emailNote}>📧 A confirmation is on its way to {order.customer.email}</Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Button title="Start a new order" onPress={finish} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  checkCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  check: { color: '#fff', fontSize: 52, fontWeight: '800', lineHeight: 58 },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 24,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 16,
  },
  summaryLine: { fontSize: font.body, color: colors.textMuted },
  summaryTotal: { fontSize: font.h3, fontWeight: '800', color: colors.text },
  emailNote: {
    fontSize: font.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  footer: {},
});
