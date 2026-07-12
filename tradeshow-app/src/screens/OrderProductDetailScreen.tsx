import { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddButton, Button, ProductImage, QtyStepper } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { formatMoney } from '../types';
import { colors, font, radius, spacing } from '../theme';

// Amazon-style product page: big photo, description, price, add to cart.
export default function OrderProductDetailScreen({
  route,
  navigation,
}: ScreenProps<'OrderProductDetail'>) {
  const { products } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const product = useMemo(
    () => products.find((p) => p.id === route.params.productId),
    [products, route.params.productId]
  );

  if (!product) {
    return (
      <View style={styles.center}>
        <Text style={{ color: colors.textMuted }}>Product not found.</Text>
      </View>
    );
  }

  const qty = draft.lines.find((l) => l.productId === product.id)?.quantity ?? 0;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
        {/* Hero image */}
        <View style={styles.hero}>
          {product.imageUri ? (
            <Image source={{ uri: product.imageUri }} style={styles.heroImg} resizeMode="cover" />
          ) : (
            <ProductImage uri={null} name={product.name} size={220} rounded={radius.lg} />
          )}
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.price}>{formatMoney(product.price)}</Text>
          <Text style={styles.unit}>per {product.unit}{product.sku ? ` · ${product.sku}` : ''}</Text>

          {product.description ? (
            <>
              <Text style={styles.sectionLabel}>Description</Text>
              <Text style={styles.description}>{product.description}</Text>
            </>
          ) : null}

          {qty > 0 ? (
            <View style={styles.inCartRow}>
              <Text style={styles.inCartText}>In cart</Text>
              <QtyStepper
                qty={qty}
                onInc={() => draft.setQuantity(product.id, qty + 1)}
                onDec={() => draft.setQuantity(product.id, qty - 1)}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky action bar */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {qty === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerPrice}>{formatMoney(product.price)}</Text>
            </View>
            <View style={{ minWidth: 140 }}>
              <AddButton onAdd={() => draft.addProduct(product)} />
            </View>
          </View>
        ) : (
          <Button title="View cart" onPress={() => navigation.navigate('OrderReview')} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  heroImg: { width: '86%', height: 300, borderRadius: radius.lg, backgroundColor: colors.bg },
  body: { padding: spacing.lg },
  name: { fontSize: font.h1, fontWeight: '800', color: colors.text },
  price: { fontSize: font.h2, fontWeight: '800', color: colors.primary, marginTop: spacing.sm },
  unit: { fontSize: font.body, color: colors.textMuted, marginTop: 2 },
  sectionLabel: {
    fontSize: font.small,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  description: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  inCartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
  },
  inCartText: { fontSize: font.h3, fontWeight: '700', color: colors.primary },
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
  footerPrice: { fontSize: font.h2, fontWeight: '800', color: colors.text },
});
