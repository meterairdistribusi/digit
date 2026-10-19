import React, { useState } from 'react';
import { Alert, Modal, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APP_VERSION } from '../config';
import { useAuth } from '../auth';
import { Button, Card, ErrorText, Field, H1, H2, Muted, Screen, useLoad } from '../components/ui';
import type { Nav } from '../navigation';
import { colors, space } from '../theme';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Terjadi kesalahan');

export default function AccountScreen() {
  const nav = useNavigation<Nav>();
  const { user, api, logout, replaceToken, clearLocal } = useAuth();
  const cfg = useLoad(() => api.config(), [api]);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delErr, setDelErr] = useState<string | null>(null);

  const legal = (name: string, title: string) => nav.navigate('Legal', { name, title });
  const legalCard = (
    <Card style={{ gap: 4 }}>
      <H2>Informasi</H2>
      <Button title="Syarat & Ketentuan" variant="ghost" onPress={() => legal('terms', 'Syarat & Ketentuan')} />
      <Button title="Kebijakan Privasi" variant="ghost" onPress={() => legal('privacy', 'Kebijakan Privasi')} />
      <Button title="Kebijakan Refund" variant="ghost" onPress={() => legal('refund', 'Kebijakan Refund')} />
    </Card>
  );

  if (!user)
    return (
      <Screen>
        <H1>Akun</H1>
        <Muted>Masuk untuk membeli, melihat pesanan, dan menyimpan produk Anda.</Muted>
        <Button title="Masuk" onPress={() => nav.navigate('Login')} />
        <Button title="Buat akun" variant="ghost" onPress={() => nav.navigate('Register')} />
        {legalCard}
        <Muted>Versi {APP_VERSION}</Muted>
      </Screen>
    );

  const changePassword = async () => {
    setBusy('pw'); setPwMsg(null);
    try {
      const r = await api.changePassword(oldPw, newPw);
      await replaceToken(r.token); // sesi lama dicabut server; simpan token baru
      setOldPw(''); setNewPw('');
      setPwMsg({ ok: true, text: 'Password diganti' });
    } catch (e) { setPwMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(null); }
  };

  const exportData = async () => {
    setBusy('export');
    try { await Share.share({ title: 'Data saya', message: JSON.stringify(await api.exportData(), null, 2) }); }
    catch (e) { Alert.alert('Gagal', errMsg(e)); } finally { setBusy(null); }
  };

  const confirmLogout = () => Alert.alert('Keluar?', 'Anda perlu masuk lagi untuk membeli.', [{ text: 'Batal', style: 'cancel' }, { text: 'Keluar', onPress: () => void logout() }]);

  const deleteAccount = async () => {
    setBusy('del'); setDelErr(null);
    try {
      await api.deleteAccount(delPw);
      setDelOpen(false); setDelPw('');
      await clearLocal();
      Alert.alert('Akun dihapus', 'Akun Anda telah dihapus. Riwayat transaksi tetap disimpan tanpa tautan ke akun sesuai kewajiban pencatatan keuangan.');
    } catch (e) { setDelErr(errMsg(e)); } finally { setBusy(null); }
  };

  return (
    <Screen>
      <H1>Halo, {user.name}</H1>
      <Muted>{user.email}{user.phone ? ` · ${user.phone}` : ''}</Muted>

      <Card>
        <H2>Ganti password</H2>
        <Field label="Password lama" value={oldPw} onChangeText={setOldPw} secureTextEntry autoComplete="current-password" />
        <Field label="Password baru (min. 8 karakter)" value={newPw} onChangeText={setNewPw} secureTextEntry autoComplete="new-password" />
        {pwMsg ? (pwMsg.ok ? <Text style={{ color: colors.ok, marginBottom: 8 }}>{pwMsg.text}</Text> : <ErrorText>{pwMsg.text}</ErrorText>) : null}
        <Button title="Ganti password" onPress={changePassword} loading={busy === 'pw'} disabled={!oldPw || newPw.length < 8} />
      </Card>

      {legalCard}

      <Card style={{ gap: 10 }}>
        <H2>Data & privasi</H2>
        <Button title="Unduh data saya" variant="ghost" onPress={exportData} loading={busy === 'export'} />
        <Button title="Hapus akun" variant="danger" onPress={() => { setDelErr(null); setDelOpen(true); }} />
      </Card>

      {cfg.data?.whatsapp ? <Muted>Butuh bantuan? WhatsApp +{cfg.data.whatsapp}</Muted> : null}
      <Button title="Keluar" variant="ghost" onPress={confirmLogout} />
      <Muted>Versi {APP_VERSION}</Muted>

      <Modal visible={delOpen} transparent animationType="fade" onRequestClose={() => setDelOpen(false)}>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <H2>Hapus akun secara permanen?</H2>
            <Muted>Profil dan akses akun dihapus dan tidak bisa dipulihkan. Riwayat transaksi tetap disimpan tanpa tautan ke akun (kewajiban pencatatan keuangan).</Muted>
            <Field label="Konfirmasi dengan password" value={delPw} onChangeText={setDelPw} secureTextEntry autoComplete="current-password" />
            <ErrorText>{delErr}</ErrorText>
            <Button title="Ya, hapus akun saya" variant="danger" onPress={deleteAccount} loading={busy === 'del'} disabled={!delPw} />
            <Button title="Batal" variant="ghost" onPress={() => setDelOpen(false)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: space.lg },
  sheet: { backgroundColor: colors.card, borderRadius: 16, padding: space.lg, gap: 10 },
});
