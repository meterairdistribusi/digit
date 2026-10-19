import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput,
  TextInputProps, View, ViewStyle,
} from 'react-native';
import { colors, radius, space } from '../theme';

export function Screen({ children, onRefresh, refreshing, scroll = true }: {
  children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; scroll?: boolean;
}) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={s.screen}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={s.screen}>{children}</View>
  );
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {body}
    </KeyboardAvoidingView>
  );
}

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) => <View style={[s.card, style]}>{children}</View>;
export const H1 = ({ children }: { children: React.ReactNode }) => <Text style={s.h1} accessibilityRole="header">{children}</Text>;
export const H2 = ({ children }: { children: React.ReactNode }) => <Text style={s.h2} accessibilityRole="header">{children}</Text>;
export const Muted = ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={[s.muted, style]}>{children}</Text>;
export const ErrorText = ({ children }: { children?: string | null }) => (children ? <Text style={s.err} accessibilityRole="alert">{children}</Text> : null);

export function Button({ title, onPress, variant = 'primary', loading, disabled }: {
  title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean; disabled?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, variant === 'ghost' && s.btnGhost, variant === 'danger' && s.btnDanger, off && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {loading ? <ActivityIndicator color={variant === 'ghost' ? colors.brand : colors.white} /> : (
        <Text style={[s.btnText, variant === 'ghost' && { color: colors.brand }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor="#98a2b3" style={[s.input, !!error && { borderColor: colors.bad }]} {...props} />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

export function Badge({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'bad' | 'brand' }) {
  const c = tone === 'ok' ? colors.ok : tone === 'warn' ? colors.warn : tone === 'bad' ? colors.bad : colors.brand;
  return <Text style={[s.badge, { color: c, borderColor: c }]}>{text}</Text>;
}

export const Loading = () => <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} size="large" />;

export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <View style={{ alignItems: 'center', padding: space.xl }}>
    <Text style={s.h2}>{title}</Text>
    {hint ? <Muted style={{ textAlign: 'center', marginTop: 6 }}>{hint}</Muted> : null}
  </View>
);

/** Muat data async dengan state loading/error + reload manual. Hasil lama yang terlambat diabaikan. */
export function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fn();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : 'Terjadi kesalahan');
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { setLoading(true); void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

const s = StyleSheet.create({
  screen: { padding: space.lg, paddingBottom: 48, gap: space.md },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space.lg },
  h1: { fontSize: 26, fontWeight: '800', color: colors.fg },
  h2: { fontSize: 18, fontWeight: '700', color: colors.fg },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  err: { color: colors.bad, fontSize: 14, marginTop: 4 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: '#f4f5fa', borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 9, fontSize: 16, color: colors.fg },
  btn: { backgroundColor: colors.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.brand },
  btnDanger: { backgroundColor: colors.bad },
  btnText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  badge: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
});
