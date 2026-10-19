import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useNavigation } from '@react-navigation/native';
import { Product } from '../api';
import { useAuth } from '../auth';
import { ProductCard } from '../components/ProductCard';
import { Empty, ErrorText, Field, Loading, useLoad } from '../components/ui';
import type { Nav } from '../navigation';
import { createStyles, space, useTheme } from '../theme';

const useS = createStyles((colors) => ({
  hero: { backgroundColor: colors.brand, borderRadius: 22, padding: space.lg + 4, gap: 8, overflow: 'hidden' },
  heroBlob: { position: 'absolute', right: -50, top: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(255,255,255,0.12)' },
  eyebrow: { alignSelf: 'flex-start', color: '#fff', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 99, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
  heroTitle: { color: '#fff', fontSize: 24, fontWeight: '800', lineHeight: 29 },
  heroText: { color: 'rgba(255,255,255,0.92)', fontSize: 14, lineHeight: 20 },
  code: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.75)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, marginTop: 4 },
  codeText: { color: '#fff', fontWeight: '800', letterSpacing: 1.2, fontSize: 16 },
  copy: { backgroundColor: '#fff', color: '#3b2fd1', fontWeight: '700', fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  sectionTitle: { color: colors.fg, fontSize: 19, fontWeight: '800' },
  chip: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.fg, fontWeight: '600' },
  trust: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trustItem: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  trustText: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
}));

export default function HomeScreen() {
  const { api } = useAuth();
  const nav = useNavigation<Nav>();
  const s = useS();
  const { colors } = useTheme();
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState(false);
  const cfg = useLoad(() => api.config(), [api]);
  const cats = useLoad(() => api.categories(), [api]);
  const prods = useLoad(() => api.products(cat ?? undefined), [api, cat]);
  const [refreshing, setRefreshing] = useState(false);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (prods.data ?? []).filter((p) => !t || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(t));
  }, [prods.data, q]);
  const promo = useMemo(() => shown.filter((p) => p.orderable && (p.discount_percent || p.featured || p.badge)).slice(0, 8), [shown]);
  const filtering = Boolean(q.trim() || cat);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([prods.reload(), cats.reload(), cfg.reload()]);
    setRefreshing(false);
  };
  const open = (p: Product) => nav.navigate('Product', { id: p.id, name: p.name });
  const b = cfg.data?.banner;

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      {!filtering && b ? (
        <View style={s.hero}>
          <View style={s.heroBlob} />
          <Text style={s.eyebrow}>⚡ Kirim otomatis 24 jam</Text>
          <Text style={s.heroTitle}>{b.title}</Text>
          <Text style={s.heroText}>{b.text}</Text>
          {b.code ? (
            <Pressable style={s.code} accessibilityRole="button" accessibilityLabel={`Salin kode promo ${b.code}`}
              onPress={async () => { await Clipboard.setStringAsync(b.code); setCopied(true); setTimeout(() => setCopied(false), 1800); }}>
              <Text style={s.codeText}>{b.code}</Text>
              <Text style={s.copy}>{copied ? 'Tersalin ✓' : 'Salin'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Field label="Cari produk" value={q} onChangeText={setQ} placeholder="Netflix, Canva, ChatGPT…" returnKeyType="search" autoCorrect={false} />
      {!filtering && promo.length ? (
        <View style={{ gap: 10 }}>
          <Text style={s.sectionTitle}>🔥 Promo spesial</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {promo.map((p) => <ProductCard key={p.id} p={p} width={190} onPress={() => open(p)} />)}
          </ScrollView>
        </View>
      ) : null}
      <Text style={s.sectionTitle}>Semua produk</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {[null, ...(cats.data ?? [])].map((c) => (
          <Pressable key={c ?? 'all'} onPress={() => setCat(c)} accessibilityRole="button" accessibilityState={{ selected: cat === c }} style={[s.chip, cat === c && s.chipOn]}>
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
      columnWrapperStyle={{ gap: space.md }}
      numColumns={2}
      data={shown}
      keyExtractor={(p) => String(p.id)}
      ListHeaderComponent={header}
      ListEmptyComponent={prods.error ? undefined : <Empty title="Produk tidak ditemukan" hint="Coba kata kunci atau kategori lain." />}
      ListFooterComponent={
        !filtering ? (
          <View style={[s.trust, { marginTop: space.md }]}>
            {['⚡ Kirim otomatis', '🔒 Pembayaran aman', '↩ Refund jika gagal'].map((t) => <View key={t} style={s.trustItem}><Text style={s.trustText}>{t}</Text></View>)}
          </View>
        ) : undefined
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <ProductCard p={item} onPress={() => open(item)} />}
    />
  );
}
