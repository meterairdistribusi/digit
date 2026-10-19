import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput,
  TextInputProps, View, ViewStyle,
} from 'react-native';
import { createStyles, radius, space, useTheme } from '../theme';

const useS = createStyles((colors) => ({
  screen: { padding: space.lg, paddingBottom: 48, gap: space.md },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.line, padding: space.lg },
  h1: { fontSize: 26, fontWeight: '800', color: colors.fg },
  h2: { fontSize: 18, fontWeight: '700', color: colors.fg },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  err: { color: colors.bad, fontSize: 14, marginTop: 4 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 9, fontSize: 16, color: colors.fg },
  btn: { backgroundColor: colors.brand, borderRadius: 12, paddingVertical: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.link },
  btnDanger: { backgroundColor: colors.bad },
  btnText: { color: colors.white, fontWeight: '700', fontSize: 16 },
  badge: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
}));

export function Screen({ children, onRefresh, refreshing, scroll = true }: {
  children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; scroll?: boolean;
}) {
  const s = useS();
  const { colors } = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={s.screen}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} /> : undefined}
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

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const s = useS();
  return <View style={[s.card, style]}>{children}</View>;
}
export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={useS().h1} accessibilityRole="header">{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={useS().h2} accessibilityRole="header">{children}</Text>;
}
export function Muted({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[useS().muted, style]}>{children}</Text>;
}
export function ErrorText({ children }: { children?: string | null }) {
  const s = useS();
  return children ? <Text style={s.err} accessibilityRole="alert">{children}</Text> : null;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled }: {
  title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean; disabled?: boolean;
}) {
  const s = useS();
  const { colors } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.btn, variant === 'ghost' && s.btnGhost, variant === 'danger' && s.btnDanger, off && { opacity: 0.5 }, pressed && { opacity: 0.8 }]}
    >
      {loading ? <ActivityIndicator color={variant === 'ghost' ? colors.link : colors.white} /> : (
        <Text style={[s.btnText, variant === 'ghost' && { color: colors.link }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  const s = useS();
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={[s.input, !!error && { borderColor: colors.bad }]} {...props} />
      <ErrorText>{error}</ErrorText>
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', borderRadius: 12, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ selected: o.value === value }}
          style={{ flex: 1, paddingVertical: 11, alignItems: 'center', backgroundColor: o.value === value ? colors.brand : colors.card }}>
          <Text style={{ fontWeight: '700', color: o.value === value ? colors.white : colors.fg }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Badge({ text, tone }: { text: string; tone: 'ok' | 'warn' | 'bad' | 'brand' }) {
  const s = useS();
  const { colors } = useTheme();
  const c = tone === 'ok' ? colors.ok : tone === 'warn' ? colors.warn : tone === 'bad' ? colors.bad : colors.link;
  return <Text style={[s.badge, { color: c, borderColor: c }]}>{text}</Text>;
}

export function Loading() {
  const { colors } = useTheme();
  return <ActivityIndicator style={{ marginTop: 48 }} color={colors.brand} size="large" />;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  const s = useS();
  return (
    <View style={{ alignItems: 'center', padding: space.xl }}>
      <Text style={s.h2}>{title}</Text>
      {hint ? <Muted style={{ textAlign: 'center', marginTop: 6 }}>{hint}</Muted> : null}
    </View>
  );
}

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
