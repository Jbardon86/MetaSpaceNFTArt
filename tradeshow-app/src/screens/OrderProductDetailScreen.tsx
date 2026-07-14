import { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddButton, Button, HighlightChips, ProductImage, QtyStepper } from '../components/ui';
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
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }}>
        {/* Framed hero image — whole product visible, never cropped */}
        <View style={styles.heroCard}>
          {product.imageUri ? (
            <Image source={{ uri: product.imageUri }} style={styles.heroImg} resizeMode="contain" />
          ) : (
            <ProductImage uri={null} name={product.name} size={200} rounded={radius.lg} />
          )}
        </View>

        {/* Info card */}
        <View style={styles.infoCard}>
          <Text style={styles.name}>{product.name}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{formatMoney(product.price)}</Text>
            <Text style={styles.unit}>
              per {product.unit}
              {product.sku ? ` · ${product.sku}` : ''}
            </Text>
          </View>

          {product.highlights && product.highlights.length > 0 ? (
            <View style={{ marginTop: spacing.md }}>
              <HighlightChips items={product.highlights} />
            </View>
          ) : null}

          {product.description ? (
            <>
              <View style={styles.divider} />
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
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroImg: { width: '100%', height: 260 },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  name: { fontSize: font.h2, fontWeight: '800', color: colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.sm },
  price: { fontSize: font.h2, fontWeight: '800', color: colors.primary },
  unit: { fontSize: font.body, color: colors.textMuted, marginLeft: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.lg },
  sectionLabel: {
    fontSize: font.small,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  description: { fontSize: font.body, color: colors.text, lineHeight: 24 },
  inCartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
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
