import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useAuth } from './auth';
import { navigationRef } from './navigation';
import { prefStore } from './storage';

// Notifikasi push (Expo Push → FCM Android / APNs iPhone). Hanya berisi judul singkat + ID pesanan; isi produk tidak pernah dikirim.
// Izin diminta secara kontekstual (setelah pesanan pertama atau lewat saklar di Akun), bukan saat aplikasi dibuka.

const native = Platform.OS !== 'web';
if (native) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type PushStatus = 'unsupported' | 'off' | 'on' | 'denied' | 'error';

type PushState = {
  status: PushStatus;
  busy: boolean;
  message: string | null;
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
  /** cabut token dari server tanpa mengubah pilihan pengguna (dipanggil sebelum keluar akun) */
  release: () => Promise<void>;
  /** tawarkan notifikasi satu kali (mis. setelah pesanan pertama) */
  offerOnce: () => Promise<void>;
};

const Ctx = createContext<PushState | null>(null);
export const usePush = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePush di luar PushProvider');
  return c;
};

const supported = Platform.OS !== 'web' && Device.isDevice;
const ORDER_ID = /^ORD-[A-F0-9]{6,}$/;

async function getToken(): Promise<string> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', { name: 'Pesanan', importance: Notifications.AndroidImportance.HIGH, lightColor: '#5b4bff' });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Project ID EAS belum diatur. Jalankan "eas init" lalu build ulang.');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export function PushProvider({ children }: { children: React.ReactNode }) {
  const { user, api } = useAuth();
  const [status, setStatus] = useState<PushStatus>(supported ? 'off' : 'unsupported');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const token = useRef<string | null>(null);

  // Saat akun masuk dan pengguna pernah mengaktifkan: sinkronkan token (bisa berubah) tanpa memunculkan dialog izin
  useEffect(() => {
    if (!supported || !user) return;
    let cancelled = false;
    (async () => {
      if ((await prefStore.get('push')) !== 'on') return;
      const perm = await Notifications.getPermissionsAsync();
      if (!perm.granted) return void (!cancelled && setStatus('denied'));
      try {
        const t = await getToken();
        await api.registerPush(t, Platform.OS);
        token.current = t;
        if (!cancelled) setStatus('on');
      } catch (e) {
        if (!cancelled) { setStatus('error'); setMessage(e instanceof Error ? e.message : 'Gagal mengaktifkan notifikasi'); }
      }
    })();
    return () => { cancelled = true; };
  }, [user, api]);

  const enable = useCallback(async () => {
    if (!supported) { setMessage('Notifikasi hanya tersedia di perangkat sungguhan.'); return false; }
    setBusy(true); setMessage(null);
    try {
      let perm = await Notifications.getPermissionsAsync();
      if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) { setStatus('denied'); await prefStore.set('push', 'off'); return false; }
      const t = await getToken();
      await api.registerPush(t, Platform.OS);
      token.current = t;
      await prefStore.set('push', 'on');
      setStatus('on');
      return true;
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Gagal mengaktifkan notifikasi');
      return false;
    } finally {
      setBusy(false);
    }
  }, [api]);

  const release = useCallback(async () => {
    const t = token.current;
    token.current = null;
    if (t) { try { await api.unregisterPush(t); } catch { /* sesi mungkin sudah tidak valid */ } }
  }, [api]);

  const disable = useCallback(async () => {
    setBusy(true);
    await release();
    await prefStore.set('push', 'off');
    setStatus('off');
    setMessage(null);
    setBusy(false);
  }, [release]);

  const offerOnce = useCallback(async () => {
    if (!supported || status === 'on' || status === 'denied') return;
    if (await prefStore.get('push')) return; // sudah pernah ditawarkan / dipilih
    await prefStore.set('push', 'off');
    Alert.alert('Kabari saya?', 'Aktifkan notifikasi agar Anda langsung tahu saat pembayaran diterima dan produk siap.', [
      { text: 'Nanti saja', style: 'cancel' },
      { text: 'Aktifkan', onPress: () => void enable() },
    ]);
  }, [status, enable]);

  const value = useMemo(() => ({ status, busy, message, enable, disable, release, offerOnce }), [status, busy, message, enable, disable, release, offerOnce]);
  return (
    <Ctx.Provider value={value}>
      {native ? <TapHandler /> : null}
      {children}
    </Ctx.Provider>
  );
}

/** Ketuk notifikasi → buka pesanan (juga saat aplikasi dibuka dari keadaan mati). Hanya dirender di native: API ini tidak ada di web. */
function TapHandler() {
  const { user } = useAuth();
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!last || !user) return;
    const id = last.notification.request.identifier;
    const orderId = last.notification.request.content.data?.orderId;
    if (handled.current === id || typeof orderId !== 'string' || !ORDER_ID.test(orderId)) return; // hanya ID pesanan yang bentuknya valid
    const go = () => { handled.current = id; navigationRef.navigate('Order', { id: orderId }); };
    if (navigationRef.isReady()) go();
    else { const t = setInterval(() => { if (navigationRef.isReady()) { clearInterval(t); go(); } }, 200); return () => clearInterval(t); }
  }, [last, user]);
  return null;
}
