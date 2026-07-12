import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Card, Field } from '../components/ui';
import { useApp } from '../store/AppContext';
import { useDraft } from '../store/OrderDraft';
import { ScreenProps } from '../navigation';
import { Customer } from '../types';
import { colors, font, radius, spacing } from '../theme';

export default function OrderCustomerScreen({ navigation }: ScreenProps<'OrderCustomer'>) {
  const { customers, addCustomer } = useApp();
  const draft = useDraft();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  // New customer form fields
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [customers, query]);

  const choose = (c: Customer) => {
    draft.setCustomer(c);
    navigation.goBack(); // back to the cart
  };

  const saveNew = async () => {
    const created = await addCustomer({
      name: name.trim(),
      company: company.trim(),
      email: email.trim(),
      phone: phone.trim(),
    });
    draft.setCustomer(created);
    navigation.goBack(); // back to the cart
  };

  const canSaveNew = name.trim().length > 0 || company.trim().length > 0;

  if (creating) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg }}
        >
          <Card>
            <Text style={styles.formTitle}>New customer</Text>
            <Field label="Contact name" value={name} onChangeText={setName} placeholder="Ava Thompson" autoCapitalize="words" />
            <Field label="Company" value={company} onChangeText={setCompany} placeholder="Thompson Galleries" autoCapitalize="words" />
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="ava@example.com" keyboardType="email-address" autoCapitalize="none" />
            <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="(415) 555-0132" keyboardType="phone-pad" />
            <Button title="Use this customer" onPress={saveNew} disabled={!canSaveNew} />
            <View style={{ height: spacing.md }} />
            <Button title="Back to search" variant="ghost" onPress={() => setCreating(false)} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search customers…"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={
          <Pressable onPress={() => setCreating(true)} style={styles.newRow}>
            <Text style={styles.newPlus}>＋</Text>
            <Text style={styles.newText}>New customer</Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => choose(item)}>
            <Card style={styles.row}>
              <Avatar name={item.company || item.name} />
              <View style={{ flex: 1, marginLeft: spacing.md }}>
                <Text style={styles.company}>{item.company || item.name}</Text>
                {item.company ? <Text style={styles.sub}>{item.name}</Text> : null}
                {item.email ? <Text style={styles.sub}>{item.email}</Text> : null}
              </View>
              <Text style={styles.chevron}>›</Text>
            </Card>
          </Pressable>
        )}
        ListEmptyComponent={
          <Text style={styles.noResults}>No matches. Tap “New customer” above.</Text>
        }
      />
    </View>
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
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.primary + '11',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary + '44',
    marginBottom: spacing.md,
  },
  newPlus: { fontSize: 24, color: colors.primary, marginRight: spacing.md, fontWeight: '700' },
  newText: { fontSize: font.h3, color: colors.primary, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  company: { fontSize: font.h3, fontWeight: '700', color: colors.text },
  sub: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 28, color: colors.textMuted, marginLeft: spacing.md },
  formTitle: { fontSize: font.h2, fontWeight: '800', color: colors.text, marginBottom: spacing.lg },
  noResults: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, fontSize: font.body },
});
