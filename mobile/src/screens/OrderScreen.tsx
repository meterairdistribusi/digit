import React, { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { STATUS_LABEL, STATUS_TONE, isOpen, rupiah } from '../api';
import { useAuth } from '../auth';
import { Badge, Button, Card, ErrorText, H1, H2, Loading, Muted, Screen, useLoad } from '../components/ui';
import type { RootStackParamList } from '../navigation';
import { colors, space } from '../theme';

export default function OrderScreen() {
  const { id } = useRoute<RouteProp<RootStackParamList, 'Order'>>().params;
  const { api } = useAuth();
  const { data: o, error, loading, reload } = useLoad(() => api.order(id), [api, id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const open = o ? isOpen(o.status) : false;

  // Pantau status selagi belum final (pembayaran masuk, pemasok memproses)
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => void reloadRef.current(), 5000);
    return () => clearInterval(t);
  }, [open]);

  if (loading && !o) return <Loading />;
  if (!o) return <Screen><ErrorText>{error ?? 'Pesanan tidak ditemukan'}</ErrorText></Screen>;

  const pay = async (url: string) => {
    await WebBrowser.openBrowserAsync(url);
    await reload(); // kembali dari halaman bayar → perbarui status
  };
  const payNew = async () => {
    setBusy(true); setMsg(null);
    try { await pay((await api.newPayment(o.id)).pay_url); } catch (e) { setMsg(e instanceof Error ? e.message : 'Gagal'); } finally { setBusy(false); }
  };
  const copy = async (text: string, i: number) => {
    await Clipboard.setStringAsync(text);
    setCopied(i);
    setTimeout(() => setCopied((c) => (c === i ? null : c)), 2000);
  };

  return (
    <Screen onRefresh={reload}>
      <H1>{o.id}</H1>
      <Card>
        <Text style={s.prod}>{o.product} × {o.qty}</Text>
        <Text style={s.amount}>{rupiah(o.amount)}</Text>
        {o.discount ? <Muted>Kupon {o.coupon}: hemat {rupiah(o.discount)}</Muted> : null}
        <View style={{ marginTop: space.sm }}><Badge text={STATUS_LABEL[o.status]} tone={STATUS_TONE[o.status]} /></View>
      </Card>

      {o.status === 'pending' ? (
        <>
          {o.pay_url ? (
            <>
              <Button title="Bayar sekarang" onPress={() => pay(o.pay_url as string)} />
              <Button title="Ada kendala? Coba metode lain" variant="ghost" onPress={payNew} loading={busy} />
            </>
          ) : (
            <>
              <Muted>Tagihan belum tersedia atau sudah kedaluwarsa.</Muted>
              <Button title="Buat tagihan baru" onPress={payNew} loading={busy} />
              <Button title="Buka halaman pesanan (mode demo)" variant="ghost" onPress={() => Linking.openURL(o.order_url)} />
            </>
          )}
          <Muted>Halaman ini memperbarui status otomatis setelah pembayaran diterima.</Muted>
        </>
      ) : null}
      {o.status === 'paid_sourcing' ? <Muted>Pembayaran diterima. Produk sedang disiapkan, mohon tunggu sebentar.</Muted> : null}
      {o.status === 'paid_nostock' ? <Muted>Pembayaran diterima, stok sedang diisi ulang. Produk akan muncul di sini. Hubungi penjual bila terlalu lama.</Muted> : null}
      {o.status === 'refunded' ? <Muted>Dana pesanan ini sudah dikembalikan ke metode pembayaran Anda (1–14 hari kerja tergantung bank/e-wallet).</Muted> : null}
      {o.status === 'failed' ? <Muted>Pesanan kedaluwarsa atau gagal. Silakan buat pesanan baru.</Muted> : null}
      <ErrorText>{msg}</ErrorText>

      {o.items && o.items.length ? (
        <>
          <H2>Produk Anda</H2>
          {o.items.map((it, i) => (
            <Card key={i} style={{ gap: 8 }}>
              <Text selectable style={s.secret}>{it}</Text>
              <Button title={copied === i ? 'Tersalin ✓' : 'Salin'} variant="ghost" onPress={() => copy(it, i)} />
            </Card>
          ))}
          <Muted>Simpan baik-baik. Produk tetap bisa dibuka lagi dari tab Pesanan.</Muted>
        </>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  prod: { fontSize: 16, color: colors.fg, fontWeight: '600' },
  amount: { fontSize: 24, fontWeight: '800', color: colors.fg, marginTop: 4 },
  secret: { fontFamily: 'Courier', fontSize: 15, color: colors.fg, backgroundColor: '#f4f5fa', padding: 12, borderRadius: 10 },
});
