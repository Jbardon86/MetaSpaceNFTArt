import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddButton, Avatar, Card, CartBar, QtyStepper } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { formatMoney, orderItemCount, orderTotal, Product } from '../types';
import { colors, font, radius, spacing } from '../theme';

// The "shop": browse products, tap Add, items collect in the cart bar.
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
          <ProductCard
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

      <CartBar
        count={count}
        total={formatMoney(total)}
        label={`Review order`}
        bottomInset={insets.bottom}
        onPress={() => navigation.navigate('OrderReview')}
      />
    </View>
  );
}

function ProductCard({
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
      <Avatar name={product.name} size={48} />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.price}>{formatMoney(product.price)}</Text>
        <Text style={styles.sub}>
          {product.sku ? `${product.sku} · ` : ''}per {product.unit}
        </Text>
      </View>
      {qty === 0 ? (
        <AddButton onAdd={onAdd} />
      ) : (
        <QtyStepper qty={qty} onInc={onInc} onDec={onDec} />
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
  price: { fontSize: font.body, fontWeight: '800', color: colors.primary, marginTop: 2 },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  noResults: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: font.body },
});
