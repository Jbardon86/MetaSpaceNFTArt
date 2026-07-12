import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { formatMoney, orderItemCount, orderTotal, Product } from '../types';
import { colors, font, radius, spacing } from '../theme';

export default function OrderProductsScreen({ navigation }: ScreenProps<'OrderProducts'>) {
  const { products } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const activeProducts = useMemo(() => products.filter((p) => p.active), [products]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeProducts;
    return activeProducts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [activeProducts, query]);

  const qtyFor = (id: string) => draft.lines.find((l) => l.productId === id)?.quantity ?? 0;
  const total = orderTotal(draft.lines);
  const count = orderItemCount(draft.lines);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search products…"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 130 }}
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            qty={qtyFor(item.id)}
            onAdd={() => draft.addProduct(item)}
            onInc={() => draft.setQuantity(item.id, qtyFor(item.id) + 1)}
            onDec={() => draft.setQuantity(item.id, qtyFor(item.id) - 1)}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.noResults}>
            No products. Add some in the Catalog screen first.
          </Text>
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.footerLabel}>
            {count} item{count === 1 ? '' : 's'}
          </Text>
          <Text style={styles.footerTotal}>{formatMoney(total)}</Text>
        </View>
        <View style={{ width: 160 }}>
          <Button
            title="Review"
            onPress={() => navigation.navigate('OrderReview')}
            disabled={draft.lines.length === 0}
          />
        </View>
      </View>
    </View>
  );
}

function ProductRow({
  product,
  qty,
  onAdd,
  onInc,
  onDec,
}: {
  product: Product;
  qty: number;
  onAdd: () => void;
  onInc: () => void;
  onDec: () => void;
}) {
  return (
    <Card style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.sub}>
          {product.sku ? `${product.sku} · ` : ''}
          {formatMoney(product.price)} / {product.unit}
        </Text>
      </View>
      {qty === 0 ? (
        <Pressable onPress={onAdd} style={styles.addBtn}>
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      ) : (
        <View style={styles.stepper}>
          <Pressable onPress={onDec} style={styles.stepBtn} hitSlop={8}>
            <Text style={styles.stepText}>−</Text>
          </Pressable>
          <Text style={styles.qty}>{qty}</Text>
          <Pressable onPress={onInc} style={styles.stepBtn} hitSlop={8}>
            <Text style={styles.stepText}>＋</Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  searchWrap: { padding: spacing.lg, paddingBottom: 0 },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.body,
    color: colors.text,
    minHeight: 50,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  name: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: font.body },
  stepper: { flexDirection: 'row', alignItems: 'center' },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 22, color: colors.primary, fontWeight: '700' },
  qty: { minWidth: 36, textAlign: 'center', fontSize: font.h3, fontWeight: '700', color: colors.text },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerLabel: { fontSize: font.small, color: colors.textMuted },
  footerTotal: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  noResults: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: font.body },
});
