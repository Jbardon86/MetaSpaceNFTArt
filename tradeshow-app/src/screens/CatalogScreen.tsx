import { useState } from 'react';
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
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Field, ProductImage } from '../components/ui';
import { useApp } from '../store/AppContext';
import { ScreenProps } from '../navigation';
import { formatMoney, Product } from '../types';
import { colors, font, radius, spacing } from '../theme';

export default function CatalogScreen(_props: ScreenProps<'Catalog'>) {
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
            <Pressable style={styles.rowMain} onPress={() => setEditing(item)}>
              <ProductImage uri={item.imageUri} name={item.name} size={52} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={[styles.name, !item.active && styles.inactive]}>{item.name}</Text>
                <Text style={styles.sub}>
                  {item.sku ? `${item.sku} · ` : ''}
                  {formatMoney(item.price)} / {item.unit}
                </Text>
              </View>
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
  const key = existing?.id ?? (target === 'new' ? 'new' : 'none');
  return (
    <Modal visible={!!target} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalCard}
        >
          {target ? (
            <EditorForm key={key} existing={existing} onClose={onClose} onSave={onSave} />
          ) : null}
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
  const [description, setDescription] = useState(existing?.description ?? '');
  const [imageUri, setImageUri] = useState<string | null>(existing?.imageUri ?? null);

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
      <Field label="SKU" value={sku} onChangeText={setSku} placeholder="ABC-123" autoCapitalize="characters" />
      <Field label="Price ($)" value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad" />
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
