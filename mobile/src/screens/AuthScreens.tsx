import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../auth';
import { Button, ErrorText, Field, H1, Muted, Screen } from '../components/ui';
import type { Nav } from '../navigation';
import { createStyles, useTheme } from '../theme';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Terjadi kesalahan');

export function LoginScreen() {
  const nav = useNavigation<Nav>();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await login(email, password); nav.goBack(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <H1>Masuk</H1>
      <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      <ErrorText>{err}</ErrorText>
      <Button title="Masuk" onPress={submit} loading={busy} disabled={!email || !password} />
      <Button title="Belum punya akun? Daftar" variant="ghost" onPress={() => nav.replace('Register')} />
    </Screen>
  );
}

export function RegisterScreen() {
  const s = useS();
  const { colors } = useTheme();
  const nav = useNavigation<Nav>();
  const { register } = useAuth();
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '' });
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await register(f); nav.goBack(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <H1>Buat akun</H1>
      <Field label="Nama" value={f.name} onChangeText={set('name')} autoComplete="name" textContentType="name" />
      <Field label="Email" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" />
      <Field label="WhatsApp (opsional)" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />
      <Field label="Password (min. 8 karakter)" value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <View style={s.consent}>
        <Switch value={agree} onValueChange={setAgree} trackColor={{ true: colors.brand }} accessibilityLabel="Setuju syarat dan privasi" />
        <Text style={s.consentText}>
          Saya menyetujui{' '}
          <Text style={s.link} onPress={() => nav.navigate('Legal', { name: 'terms', title: 'Syarat & Ketentuan' })}>Syarat & Ketentuan</Text> dan{' '}
          <Text style={s.link} onPress={() => nav.navigate('Legal', { name: 'privacy', title: 'Kebijakan Privasi' })}>Kebijakan Privasi</Text>.
        </Text>
      </View>
      <ErrorText>{err}</ErrorText>
      <Button title="Daftar" onPress={submit} loading={busy} disabled={!agree || !f.name || !f.email || !f.password} />
      <Button title="Sudah punya akun? Masuk" variant="ghost" onPress={() => nav.replace('Login')} />
      <Muted>Data Anda dilindungi sesuai UU PDP. Anda dapat menghapus akun kapan saja dari menu Akun.</Muted>
    </Screen>
  );
}

const useS = createStyles((colors) => ({
  consent: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  consentText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.fg },
  link: { color: colors.link, textDecorationLine: 'underline' },
}));
