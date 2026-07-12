import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field } from '../components/ui';
import { useApp } from '../store/AppContext';
import { ScreenProps } from '../navigation';
import { formatMoney, Product } from '../types';
import { colors, font, spacing } from '../theme';

export default function CatalogScreen({ navigation }: ScreenProps<'Catalog'>) {
  const { products, upsertProduct, toggleProductActive } = useApp();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <Pressable style={{ flex: 1 }} onPress={() => setEditing(item)}>
              <Text style={[styles.name, !item.active && styles.inactive]}>{item.name}</Text>
              <Text style={styles.sub}>
                {item.sku ? `${item.sku} · ` : ''}
                {formatMoney(item.price)} / {item.unit}
              </Text>
            </Pressable>
            <Switch value={item.active} onValueChange={() => toggleProductActive(item.id)} />
          </Card>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No products yet. Add your first one below.</Text>
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button title="+ Add product" onPress={() => setEditing('new')} />
      </View>

      <ProductEditor
        target={editing}
        onClose={() => setEditing(null)}
        onSave={async (p) => {
          await upsertProduct(p);
          setEditing(null);
        }}
      />
    </View>
  );
}

function ProductEditor({
  target,
  onClose,
  onSave,
}: {
  target: Product | 'new' | null;
  onClose: () => void;
  onSave: (p: Partial<Product> & { name: string }) => void;
}) {
  const existing = target && target !== 'new' ? target : null;
  // Key forces field remount when switching between products.
  const key = existing?.id ?? (target === 'new' ? 'new' : 'none');
  return (
    <Modal visible={!!target} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalCard}
        >
          {target ? <EditorForm key={key} existing={existing} onClose={onClose} onSave={onSave} /> : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function EditorForm({
  existing,
  onClose,
  onSave,
}: {
  existing: Product | null;
  onClose: () => void;
  onSave: (p: Partial<Product> & { name: string }) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [sku, setSku] = useState(existing?.sku ?? '');
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [unit, setUnit] = useState(existing?.unit ?? 'each');

  const save = () => {
    const parsedPrice = parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
    onSave({
      id: existing?.id,
      name: name.trim(),
      sku: sku.trim(),
      price: parsedPrice,
      unit: unit.trim() || 'each',
      active: existing?.active ?? true,
    });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{existing ? 'Edit product' : 'New product'}</Text>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Product name" />
      <Field label="SKU" value={sku} onChangeText={setSku} placeholder="ABC-123" autoCapitalize="characters" />
      <Field label="Price ($)" value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad" />
      <Field label="Unit" value={unit} onChangeText={setUnit} placeholder="each / case / hour" />
      <Button title="Save" onPress={save} disabled={name.trim().length === 0} />
      <View style={{ height: spacing.md }} />
      <Button title="Cancel" variant="ghost" onPress={onClose} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  name: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  inactive: { color: colors.textMuted, textDecorationLine: 'line-through' },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: font.body },
  footer: {
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
  modalBackdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.xl,
    maxHeight: '85%',
  },
  modalTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text, marginBottom: spacing.lg },
});
