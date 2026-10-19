import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Api, ApiError, Session, User, createClient } from './api';
import { API_URL } from './config';
import { tokenStore } from './storage';

type AuthState = {
  ready: boolean;
  user: User | null;
  api: Api;
  login: (email: string, password: string) => Promise<void>;
  register: (v: { name: string; email: string; phone?: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  /** dipakai setelah ganti password: simpan token baru */
  replaceToken: (token: string) => Promise<void>;
  clearLocal: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth di luar AuthProvider');
  return c;
};

const device = `${Platform.OS}`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const token = useRef<string | null>(null);

  const clearLocal = useCallback(async () => {
    token.current = null;
    setUser(null);
    await tokenStore.clear();
  }, []);

  const api = useMemo(
    () => createClient({ baseUrl: API_URL, getToken: () => token.current, onUnauthorized: () => void clearLocal() }),
    [clearLocal]
  );

  // Pulihkan sesi saat aplikasi dibuka. Hanya 401 yang menghapus sesi; gangguan jaringan tidak mengeluarkan pengguna.
  useEffect(() => {
    (async () => {
      const t = await tokenStore.get();
      if (t) {
        token.current = t;
        try {
          setUser((await api.me()).user);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status === 401) await clearLocal();
        }
      }
      setReady(true);
    })();
  }, [api, clearLocal]);

  const accept = async (s: Session) => {
    token.current = s.token;
    await tokenStore.set(s.token);
    setUser(s.user);
  };

  const value: AuthState = {
    ready, user, api, clearLocal,
    login: async (email, password) => accept(await api.login(email.trim(), password, device)),
    register: async (v) => accept(await api.register({ ...v, email: v.email.trim(), device })),
    logout: async () => {
      try {
        await api.logout();
      } catch {
        /* tetap keluar secara lokal */
      }
      await clearLocal();
    },
    replaceToken: async (t) => {
      token.current = t;
      await tokenStore.set(t);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
