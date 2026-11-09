import { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field, HighlightChips, ProductImage } from '../components/ui';
import { useApp } from '../store/AppContext';
import { ScreenProps } from '../navigation';
import { formatMoney, Product } from '../types';
import { colors, font, radius, spacing } from '../theme';

export default function CatalogScreen(_props: ScreenProps<'Catalog'>) {
  const {
    products,
    upsertProduct,
    toggleProductActive,
    setProductPrice,
    boothEvent,
    remoteCatalog,
    catalogSyncing,
    catalogError,
    refreshCatalog,
  } = useApp();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [products, query]);

  const shownCount = useMemo(() => products.filter((p) => p.active).length, [products]);

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
          clearButtonMode="while-editing"
        />
        {products.length > 0 ? (
          <Text style={styles.count}>
            {filtered.length} of {products.length}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={
          <View>
            <Card style={styles.approveCard}>
              <Text style={styles.syncTitle}>✅ Customer-visible items</Text>
              <Text style={styles.syncSub}>
                Only items toggled ON are shown to customers at the kiosk. New items stay hidden
                until you approve them. {shownCount} of {products.length} shown.
              </Text>
            </Card>
            {remoteCatalog ? (
              <Card style={styles.syncCard}>
                <Text style={styles.syncTitle}>📦 Catalog synced from SOS Inventory</Text>
                <Text style={styles.syncSub}>
                  Product details (name, price, photo) come from SOS; your show/hide choices here
                  stick through syncs. {catalogError ? `\n⚠️ ${catalogError}` : ''}
                </Text>
                <View style={{ height: spacing.md }} />
                <Button
                  title={catalogSyncing ? 'Syncing…' : 'Sync now'}
                  variant="secondary"
                  onPress={refreshCatalog}
                  loading={catalogSyncing}
                />
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Card style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => setEditing(item)}>
              <ProductImage uri={item.imageUri} name={item.name} size={52} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[styles.name, !item.active && styles.inactive]}>{item.name}</Text>
                <Text style={styles.sub}>
                  {item.sku ? `${item.sku} · ` : ''}
                  <Text style={item.listPrice != null && item.listPrice !== item.price ? styles.showPrice : undefined}>
                    {formatMoney(item.price)}
                  </Text>
                  {item.listPrice != null && item.listPrice !== item.price
                    ? ` (list ${formatMoney(item.listPrice)})`
                    : ''}{' '}
                  / {item.unit}
                </Text>
              </View>
            </Pressable>
            <View style={styles.switchWrap}>
              <Switch value={item.active} onValueChange={() => toggleProductActive(item.id)} />
              <Text style={[styles.switchLabel, item.active && styles.switchLabelOn]}>
                {item.active ? 'Shown' : 'Hidden'}
              </Text>
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {query.trim() ? `No products match “${query.trim()}”.` : 'No products yet. Add your first one below.'}
          </Text>
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button title="+ Add product" onPress={() => setEditing('new')} />
      </View>

      <ProductEditor
        target={editing}
        showName={boothEvent}
        onClose={() => setEditing(null)}
        onSave={async (p) => {
          const ex = editing && editing !== 'new' ? editing : null;
          if (ex) {
            // Route the price to the show-price override (null = use SOS list).
            const list = ex.listPrice != null ? ex.listPrice : ex.price;
            const entered = p.price ?? list;
            await setProductPrice(ex.id, entered === list ? null : entered);
          }
          await upsertProduct(p);
          setEditing(null);
        }}
      />
    </View>
  );
}

function ProductEditor({
  target,
  showName,
  onClose,
  onSave,
}: {
  target: Product | 'new' | null;
  showName: string;
  onClose: () => void;
  onSave: (p: Partial<Product> & { name: string }) => void;
}) {
  const existing = target && target !== 'new' ? target : null;
  const key = existing?.id ?? (target === 'new' ? 'new' : 'none');
  return (
    <Modal visible={!!target} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalCard}
        >
          {target ? (
            <EditorForm key={key} existing={existing} showName={showName} onClose={onClose} onSave={onSave} />
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function EditorForm({
  existing,
  showName,
  onClose,
  onSave,
}: {
  existing: Product | null;
  showName: string;
  onClose: () => void;
  onSave: (p: Partial<Product> & { name: string }) => void;
}) {
  const listPrice = existing ? (existing.listPrice != null ? existing.listPrice : existing.price) : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [sku, setSku] = useState(existing?.sku ?? '');
  const [price, setPrice] = useState(existing ? String(existing.price) : '');
  const [unit, setUnit] = useState(existing?.unit ?? 'each');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [highlights, setHighlights] = useState((existing?.highlights ?? []).join(', '));
  const [imageUri, setImageUri] = useState<string | null>(existing?.imageUri ?? null);

  const parsedHighlights = highlights
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (!res.canceled && res.assets.length > 0) {
      const asset = res.assets[0];
      // Store a data URI so the photo persists locally (and works on web).
      setImageUri(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
    }
  };

  const save = () => {
    const parsedPrice = parseFloat(price.replace(/[^0-9.]/g, '')) || 0;
    onSave({
      id: existing?.id,
      name: name.trim(),
      sku: sku.trim(),
      price: parsedPrice,
      unit: unit.trim() || 'each',
      description: description.trim(),
      highlights: parsedHighlights,
      imageUri,
      active: existing?.active ?? true,
    });
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Text style={styles.modalTitle}>{existing ? 'Edit product' : 'New product'}</Text>

      {/* Photo */}
      <Text style={styles.photoLabel}>Photo</Text>
      <View style={styles.photoRow}>
        <Pressable onPress={pickPhoto}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.photoPreview} resizeMode="cover" />
          ) : (
            <View style={[styles.photoPreview, styles.photoPlaceholder]}>
              <Text style={{ fontSize: 26 }}>📷</Text>
              <Text style={styles.photoHint}>Tap to add</Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Button title={imageUri ? 'Change photo' : 'Choose photo'} variant="secondary" onPress={pickPhoto} />
          {imageUri ? (
            <>
              <View style={{ height: spacing.sm }} />
              <Button title="Remove photo" variant="ghost" onPress={() => setImageUri(null)} />
            </>
          ) : null}
        </View>
      </View>

      <Field
        label="Or paste an image URL"
        value={imageUri && imageUri.startsWith('http') ? imageUri : ''}
        onChangeText={(t) => setImageUri(t.trim() ? t.trim() : null)}
        placeholder="https://…/photo.jpg"
        autoCapitalize="none"
        keyboardType="url"
      />

      <Field label="Name" value={name} onChangeText={setName} placeholder="Product name" />
      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="Short description shown at checkout"
      />
      <Field
        label="Highlights (separate with commas)"
        value={highlights}
        onChangeText={setHighlights}
        placeholder="Gluten Free, Non-GMO, BPA Free"
      />
      {parsedHighlights.length > 0 ? (
        <View style={{ marginTop: -spacing.sm, marginBottom: spacing.lg }}>
          <HighlightChips items={parsedHighlights} />
        </View>
      ) : null}
      <Field label="SKU" value={sku} onChangeText={setSku} placeholder="ABC-123" autoCapitalize="characters" />

      <Field
        label={showName ? `Show price ($) — ${showName}` : 'Show price ($)'}
        value={price}
        onChangeText={setPrice}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      {listPrice != null ? (
        <View style={styles.priceRefRow}>
          <Text style={styles.priceRef}>
            SOS list price: {formatMoney(listPrice)}
            {parseFloat(price || '0') !== listPrice ? '  ·  overridden for this show' : ''}
          </Text>
          {parseFloat(price || '0') !== listPrice ? (
            <Pressable onPress={() => setPrice(String(listPrice))}>
              <Text style={styles.priceReset}>Use list price</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={styles.priceRef}>Charged at the kiosk. Adjust per show as needed.</Text>
      )}

      <View style={{ height: spacing.md }} />
      <Field label="Unit" value={unit} onChangeText={setUnit} placeholder="each / case / hour" />

      <Button title="Save" onPress={save} disabled={name.trim().length === 0} />
      <View style={{ height: spacing.md }} />
      <Button title="Cancel" variant="ghost" onPress={onClose} />
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  rowMain: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  name: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  inactive: { color: colors.textMuted, textDecorationLine: 'line-through' },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: font.body },
  searchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: font.body,
    color: colors.text,
    minHeight: 48,
  },
  count: { fontSize: font.small, color: colors.textMuted, marginTop: spacing.xs, marginLeft: spacing.xs },
  syncCard: { marginBottom: spacing.lg },
  approveCard: { marginBottom: spacing.md },
  syncTitle: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  syncSub: { fontSize: font.small, color: colors.textMuted, marginTop: spacing.xs },
  switchWrap: { alignItems: 'center', marginLeft: spacing.sm },
  switchLabel: { fontSize: font.small, color: colors.textMuted, marginTop: 2, fontWeight: '600' },
  switchLabelOn: { color: colors.primary },
  priceRefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  priceRef: { fontSize: font.small, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.sm },
  priceReset: { fontSize: font.small, color: colors.primary, fontWeight: '700' },
  showPrice: { color: colors.primary, fontWeight: '700' },
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
    maxHeight: '90%',
  },
  modalTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text, marginBottom: spacing.lg },
  photoLabel: {
    fontSize: font.small,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  photoPreview: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.bg },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  photoHint: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
});
