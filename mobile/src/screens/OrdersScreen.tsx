import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { STATUS_LABEL, STATUS_TONE, rupiah } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Empty, ErrorText, Loading, useLoad } from '../components/ui';
import type { Nav } from '../navigation';
import { colors, radius, space } from '../theme';

export default function OrdersScreen() {
  const { api, user, ready } = useAuth();
  const nav = useNavigation<Nav>();
  const { data, error, loading, reload } = useLoad(() => (user ? api.orders() : Promise.resolve([])), [api, user]);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { if (user) void reload(); }, [user, reload]));

  if (!ready) return <Loading />;
  if (!user)
    return (
      <View style={s.center}>
        <Empty title="Masuk untuk melihat pesanan" hint="Riwayat pesanan dan produk yang sudah dibeli ada di sini." />
        <View style={{ width: '100%', gap: 10 }}>
          <Button title="Masuk" onPress={() => nav.navigate('Login')} />
          <Button title="Buat akun" variant="ghost" onPress={() => nav.navigate('Register')} />
        </View>
      </View>
    );
  if (loading && !data) return <Loading />;
  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.lg, gap: space.md, flexGrow: 1 }}
      data={data ?? []}
      keyExtractor={(o) => o.id}
      ListHeaderComponent={<ErrorText>{error}</ErrorText>}
      ListEmptyComponent={<Empty title="Belum ada pesanan" hint="Pesanan Anda akan muncul di sini." />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await reload(); setRefreshing(false); }} />}
      renderItem={({ item: o }) => (
        <Pressable onPress={() => nav.navigate('Order', { id: o.id })} accessibilityRole="button" style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}>
          <Text style={s.name}>{o.product} × {o.qty}</Text>
          <Text style={s.meta}>{o.id} · {o.created_at}</Text>
          <View style={s.row}>
            <Text style={s.price}>{rupiah(o.amount)}</Text>
            <Badge text={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} />
          </View>
        </Pressable>
      )}
    />
  );
}

const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: space.lg },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: 4 },
  name: { fontSize: 16, fontWeight: '700', color: colors.fg },
  meta: { fontSize: 12, color: colors.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  price: { fontSize: 17, fontWeight: '800', color: colors.fg },
});
