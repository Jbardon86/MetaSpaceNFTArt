import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field, PressableScale } from '../components/ui';
import { useApp } from '../store/AppContext';
import { ScreenProps } from '../navigation';
import { REPS, Rep } from '../reps';
import { colors, font, spacing } from '../theme';

// The staff-only hub, reached from the Welcome screen after entering the PIN.
export default function StaffScreen({ navigation }: ScreenProps<'Staff'>) {
  const { orders, pendingCount, adapterLabel, boothRep, setBoothRep, boothEvent, setBoothEvent } =
    useApp();
  const insets = useSafeAreaInsets();
  const [repPickerOpen, setRepPickerOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
      <Text style={styles.title}>Admin</Text>
      <Text style={styles.sub}>{adapterLabel}</Text>

      <View style={{ height: spacing.xl }} />

      <MenuItem
        title="Booth rep"
        subtitle={boothRep ? `${boothRep.name} — gets credit for orders here` : 'Not set — tap to choose who gets credit'}
        emoji="🧑‍💼"
        onPress={() => setRepPickerOpen(true)}
      />
      <MenuItem
        title="Show / event"
        subtitle={boothEvent ? `${boothEvent} — tags orders & leads` : 'Not set — tap to name this show'}
        emoji="🎪"
        onPress={() => setEventOpen(true)}
      />
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

      <RepPicker
        visible={repPickerOpen}
        current={boothRep}
        onPick={(r) => {
          setBoothRep(r);
          setRepPickerOpen(false);
        }}
        onClose={() => setRepPickerOpen(false)}
      />

      <EventPicker
        visible={eventOpen}
        current={boothEvent}
        onSave={(name) => {
          setBoothEvent(name);
          setEventOpen(false);
        }}
        onClose={() => setEventOpen(false)}
      />
    </View>
  );
}

function EventPicker({
  visible,
  current,
  onSave,
  onClose,
}: {
  visible: boolean;
  current: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState(current);
  // Re-sync the field whenever the sheet reopens.
  useEffect(() => {
    if (visible) setText(current);
  }, [visible, current]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.sheetTitle}>Which show is this?</Text>
          <Text style={styles.sheetSub}>
            Tags every order and lead from this booth (saved as the Salesforce Lead Source).
          </Text>
          <View style={{ height: spacing.md }} />
          <Field
            label="Show / event name"
            value={text}
            onChangeText={setText}
            placeholder="e.g. Toy Fair 2026"
            autoCapitalize="words"
          />
          <View style={{ height: spacing.sm }} />
          <Button title="Save" onPress={() => onSave(text)} />
          <View style={{ height: spacing.sm }} />
          <Button title="Clear" variant="secondary" onPress={() => onSave('')} />
        </View>
      </View>
    </Modal>
  );
}

function RepPicker({
  visible,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  current: Rep | null;
  onPick: (r: Rep | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Text style={styles.sheetTitle}>Who's working this booth?</Text>
          <Text style={styles.sheetSub}>Orders placed here are credited to this rep.</Text>

          <View style={{ height: spacing.md }} />

          {REPS.map((r) => (
            <RepRow
              key={r.sosId}
              label={r.name}
              selected={current?.sosId === r.sosId}
              onPress={() => onPick(r)}
            />
          ))}
          <RepRow
            label="No rep (leave unassigned)"
            selected={!current}
            onPress={() => onPick(null)}
          />

          <View style={{ height: spacing.md }} />
          <Button title="Close" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function RepRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.repRow, pressed && { opacity: 0.6 }]}>
      <Text style={[styles.repName, selected && { color: colors.primary, fontWeight: '800' }]}>{label}</Text>
      {selected ? <Text style={styles.check}>✓</Text> : null}
    </Pressable>
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

  // Rep picker sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sheetTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  sheetSub: { fontSize: font.small, color: colors.textMuted, marginTop: 4 },
  repRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  repName: { fontSize: font.h3, color: colors.text, fontWeight: '600' },
  check: { fontSize: font.h3, color: colors.primary, fontWeight: '800' },
});
