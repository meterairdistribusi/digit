import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Token sesi disimpan di Keychain (iOS) / Keystore (Android). Di web (hanya untuk pratinjau) memakai localStorage.
const KEY = 'session-token';
const web = Platform.OS === 'web';

export const tokenStore = {
  async get(): Promise<string | null> {
    try {
      return web ? globalThis.localStorage?.getItem(KEY) ?? null : await SecureStore.getItemAsync(KEY);
    } catch {
      return null;
    }
  },
  async set(token: string): Promise<void> {
    if (web) globalThis.localStorage?.setItem(KEY, token);
    else await SecureStore.setItemAsync(KEY, token);
  },
  async clear(): Promise<void> {
    try {
      if (web) globalThis.localStorage?.removeItem(KEY);
      else await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* abaikan */
    }
  },
};

// Preferensi kecil non-rahasia (tema, notifikasi). Pakai penyimpanan yang sama agar tidak menambah dependensi.
const prefKey = (k: string) => 'pref-' + k;
export const prefStore = {
  async get(k: string): Promise<string | null> {
    try {
      return web ? globalThis.localStorage?.getItem(prefKey(k)) ?? null : await SecureStore.getItemAsync(prefKey(k));
    } catch {
      return null;
    }
  },
  async set(k: string, v: string): Promise<void> {
    try {
      if (web) globalThis.localStorage?.setItem(prefKey(k), v);
      else await SecureStore.setItemAsync(prefKey(k), v);
    } catch {
      /* abaikan */
    }
  },
};
