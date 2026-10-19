import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { rupiah } from '../api';
import { useAuth } from '../auth';
import { usePush } from '../push';
import { Badge, Button, Card, ErrorText, Field, H1, Loading, Muted, Screen, useLoad } from '../components/ui';
import type { Nav, RootStackParamList } from '../navigation';
import { createStyles, space, useTheme } from '../theme';

export default function ProductScreen() {
  const s = useS();
  const { colors } = useTheme();
  const { id } = useRoute<RouteProp<RootStackParamList, 'Product'>>().params;
  const nav = useNavigation<Nav>();
  const { api, user } = useAuth();
  const push = usePush();
  const { data: p, error, loading } = useLoad(() => api.product(id), [api, id]);
  const [qty, setQty] = useState(1);
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Jumlah berubah → kupon harus dicek ulang (nilainya bergantung subtotal)
  useEffect(() => { setApplied(null); setCouponMsg(null); }, [qty]);

  if (loading) return <Loading />;
  if (!p) return <Screen><ErrorText>{error ?? 'Produk tidak ditemukan'}</ErrorText></Screen>;

  const subtotal = p.price * qty;
  const total = subtotal - (applied?.discount ?? 0);

  const applyCoupon = async () => {
    if (!code.trim()) return;
    try {
      const r = await api.checkCoupon(p.id, qty, code.trim());
      setApplied({ code: code.trim(), discount: r.discount });
      setCouponMsg(`Kupon dipakai, hemat ${rupiah(r.discount)}`);
    } catch (e) {
      setApplied(null);
      setCouponMsg(e instanceof Error ? e.message : 'Kupon tidak valid');
    }
  };

  const buy = async () => {
    if (!user) return nav.navigate('Login');
    setBusy(true);
    setErr(null);
    try {
      const r = await api.createOrder({ productId: p.id, qty, coupon: applied?.code });
      nav.replace('Order', { id: r.order.id });
      void push.offerOnce();
      if (r.pay_url) await WebBrowser.openBrowserAsync(r.pay_url); // pembayaran di halaman aman milik gateway
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal membuat pesanan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Badge text={p.category} tone="brand" />
      <H1>{p.name}</H1>
      <Text style={s.desc}>{p.description}</Text>
      <Card>
        <View style={s.row}>
          <Text style={s.label}>Harga</Text>
          <Text style={s.value}>{rupiah(p.price)}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Jumlah</Text>
          <View style={s.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel="Kurangi jumlah" onPress={() => setQty(Math.max(1, qty - 1))} style={s.stepBtn}><Text style={s.stepText}>−</Text></Pressable>
            <Text style={s.qty} accessibilityLabel={`Jumlah ${qty}`}>{qty}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Tambah jumlah" onPress={() => setQty(Math.min(p.max_qty || 1, qty + 1))} style={s.stepBtn}><Text style={s.stepText}>+</Text></Pressable>
          </View>
        </View>
        <Field label="Kode kupon (opsional)" value={code} onChangeText={(t) => setCode(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} />
        <Button title="Terapkan kupon" variant="ghost" onPress={applyCoupon} disabled={!code.trim()} />
        {couponMsg ? (applied ? <Text style={{ color: colors.ok, marginTop: 6 }}>{couponMsg}</Text> : <ErrorText>{couponMsg}</ErrorText>) : null}
        <View style={[s.row, { marginTop: space.md }]}>
          <Text style={s.total}>Total</Text>
          <Text style={s.total}>{rupiah(total)}</Text>
        </View>
      </Card>
      <ErrorText>{err}</ErrorText>
      {p.orderable ? (
        <>
          <Button title={user ? 'Beli sekarang' : 'Masuk untuk membeli'} onPress={buy} loading={busy} />
          <Muted>
            Dengan membeli, Anda menyetujui{' '}
            <Text style={s.link} onPress={() => nav.navigate('Legal', { name: 'terms', title: 'Syarat & Ketentuan' })}>Syarat & Ketentuan</Text>,{' '}
            <Text style={s.link} onPress={() => nav.navigate('Legal', { name: 'privacy', title: 'Kebijakan Privasi' })}>Kebijakan Privasi</Text>, dan{' '}
            <Text style={s.link} onPress={() => nav.navigate('Legal', { name: 'refund', title: 'Kebijakan Refund' })}>Kebijakan Refund</Text>.
          </Muted>
        </>
      ) : (
        <Badge text="Stok habis" tone="bad" />
      )}
    </Screen>
  );
}

const useS = createStyles((colors) => ({
  desc: { fontSize: 15, lineHeight: 22, color: colors.fg },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  label: { color: colors.muted, fontSize: 15 },
  value: { fontSize: 16, fontWeight: '700', color: colors.fg },
  total: { fontSize: 18, fontWeight: '800', color: colors.fg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inputBg },
  stepText: { fontSize: 22, color: colors.fg, fontWeight: '600' },
  qty: { fontSize: 18, fontWeight: '700', minWidth: 24, textAlign: 'center', color: colors.fg },
  link: { color: colors.link, textDecorationLine: 'underline' },
}));
