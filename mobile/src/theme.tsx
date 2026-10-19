import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextStyle, useColorScheme, ViewStyle } from 'react-native';
import { prefStore } from './storage';

export const palettes = {
  light: {
    bg: '#f6f7fb', card: '#ffffff', fg: '#161a2b', muted: '#667085', line: '#e3e6ef',
    brand: '#5b4bff', link: '#5b4bff', inputBg: '#f4f5fa', ok: '#0a8f54', warn: '#b7791f', bad: '#c53030', white: '#ffffff',
  },
  dark: {
    bg: '#0f1220', card: '#181c30', fg: '#eceefa', muted: '#9aa0bd', line: '#2a2f4a',
    brand: '#6d5cff', link: '#a79dff', inputBg: '#222744', ok: '#3ddc97', warn: '#f0b64a', bad: '#ef5350', white: '#ffffff',
  },
};
export type Colors = typeof palettes.light;
export type ThemePref = 'system' | 'light' | 'dark';

export const radius = 14;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

type ThemeState = { colors: Colors; scheme: 'light' | 'dark'; pref: ThemePref; setPref: (p: ThemePref) => void };
const Ctx = createContext<ThemeState>({ colors: palettes.light, scheme: 'light', pref: 'system', setPref: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');
  useEffect(() => {
    void prefStore.get('theme').then((v) => v && (v === 'light' || v === 'dark' || v === 'system') && setPrefState(v));
  }, []);
  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    void prefStore.set('theme', p);
  }, []);
  const scheme: 'light' | 'dark' = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
  const value = useMemo(() => ({ colors: palettes[scheme], scheme, pref, setPref }), [scheme, pref, setPref]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Gaya yang bergantung tema: `const useS = createStyles((c) => ({...}))` lalu `const s = useS()` di komponen. */
type AnyStyle = ViewStyle & TextStyle;
export function createStyles<K extends string>(fn: (c: Colors) => Record<K, ViewStyle | TextStyle>) {
  return (): Record<K, AnyStyle> => {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(fn(colors) as Record<K, AnyStyle>), [colors]);
  };
}
