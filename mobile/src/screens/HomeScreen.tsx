import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Product, rupiah } from '../api';
import { useAuth } from '../auth';
import { Badge, Empty, ErrorText, Field, H1, Loading, Muted, useLoad } from '../components/ui';
import type { Nav } from '../navigation';
import { colors, radius, space } from '../theme';

export default function HomeScreen() {
  const { api } = useAuth();
  const nav = useNavigation<Nav>();
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const cfg = useLoad(() => api.config(), [api]);
  const cats = useLoad(() => api.categories(), [api]);
  const prods = useLoad(() => api.products(cat ?? undefined), [api, cat]);
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (prods.data ?? []).filter((p) => !t || `${p.name} ${p.description}`.toLowerCase().includes(t));
  }, [prods.data, q]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([prods.reload(), cats.reload(), cfg.reload()]);
    setRefreshing(false);
  };

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <H1>{cfg.data?.store_name ?? 'Toko Digital'}</H1>
      <Muted>Produk digital premium, dikirim otomatis setelah pembayaran.</Muted>
      <Field label="Cari produk" value={q} onChangeText={setQ} placeholder="Netflix, Canva, ChatGPT…" returnKeyType="search" autoCorrect={false} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {[null, ...(cats.data ?? [])].map((c) => (
          <Pressable key={c ?? 'all'} onPress={() => setCat(c)} accessibilityRole="button" accessibilityState={{ selected: cat === c }}
            style={[s.chip, cat === c && s.chipOn]}>
            <Text style={[s.chipText, cat === c && { color: colors.white }]}>{c ?? 'Semua'}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ErrorText>{prods.error}</ErrorText>
    </View>
  );

  if (prods.loading && !prods.data) return <View style={{ flex: 1, backgroundColor: colors.bg }}><Loading /></View>;
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      data={shown}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={header}
      ListEmptyComponent={prods.error ? undefined : <Empty title="Produk tidak ditemukan" hint="Coba kata kunci atau kategori lain." />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <ProductCard p={item} onPress={() => nav.navigate('Product', { id: item.id, name: item.name })} />}
    />
  );
}

function ProductCard({ p, onPress }: { p: Product; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${p.name}, ${rupiah(p.price)}`} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}>
      <Badge text={p.category} tone="brand" />
      <Text style={s.name}>{p.name}</Text>
      <Text style={s.desc} numberOfLines={2}>{p.description}</Text>
      <View style={s.row}>
        <Text style={s.price}>{rupiah(p.price)}</Text>
        <Badge text={p.orderable ? 'Tersedia' : 'Habis'} tone={p.orderable ? 'ok' : 'bad'} />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.fg, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: 6 },
  name: { fontSize: 17, fontWeight: '700', color: colors.fg },
  desc: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  price: { fontSize: 18, fontWeight: '800', color: colors.fg },
});
