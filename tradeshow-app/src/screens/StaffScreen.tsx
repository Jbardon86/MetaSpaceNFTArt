import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, PressableScale } from '../components/ui';
import { useApp } from '../store/AppContext';
import { ScreenProps } from '../navigation';
import { colors, font, spacing } from '../theme';

// The staff-only hub, reached from the Welcome screen after entering the PIN.
export default function StaffScreen({ navigation }: ScreenProps<'Staff'>) {
  const { orders, pendingCount, adapterLabel } = useApp();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <Text style={styles.title}>Staff</Text>
      <Text style={styles.sub}>{adapterLabel}</Text>

      <View style={{ height: spacing.xl }} />

      <MenuItem
        title="View orders"
        subtitle={`${orders.length} total · ${pendingCount} pending sync`}
        emoji="📋"
        onPress={() => navigation.navigate('StaffOrders')}
      />
      <MenuItem
        title="Manage catalog"
        subtitle="Add, edit, and photograph products"
        emoji="🏷️"
        onPress={() => navigation.navigate('Catalog')}
      />

      <View style={{ flex: 1 }} />
      <Button
        title="Back to kiosk"
        variant="secondary"
        onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] })}
      />
    </View>
  );
}

function MenuItem({
  title,
  subtitle,
  emoji,
  onPress,
}: {
  title: string;
  subtitle: string;
  emoji: string;
  onPress: () => void;
}) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={{ marginBottom: spacing.md }}>
      <Card style={styles.item}>
        <Text style={styles.emoji}>{emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle}>{title}</Text>
          <Text style={styles.itemSub}>{subtitle}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg },
  title: { fontSize: font.h1, fontWeight: '800', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center' },
  emoji: { fontSize: 30, marginRight: spacing.md },
  itemTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  itemSub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 28, color: colors.textMuted, marginLeft: spacing.md },
});
