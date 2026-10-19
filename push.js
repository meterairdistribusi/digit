const { db } = require('./db');
const { fetchJson } = require('./http');

// Notifikasi push ke aplikasi native lewat layanan Expo Push (meneruskan ke FCM Android & APNs iPhone).
// Payload sengaja TIDAK berisi isi produk (akun/kode): hanya judul singkat + ID pesanan; isinya dibuka di dalam aplikasi.
// Token tidak valid/sudah dicabut (DeviceNotRegistered) otomatis dihapus. Kegagalan kirim tidak pernah menggagalkan pesanan.

const URL = () => process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const VALID = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;

function register(userId, token, platform = '') {
  token = String(token || '').trim();
  if (!VALID.test(token)) return false;
  // Token milik perangkat: bila perangkat ganti akun, token berpindah ke akun yang sedang masuk
  db.prepare(
    'INSERT INTO push_tokens (token, user_id, platform) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform'
  ).run(token, userId, String(platform).slice(0, 10));
  return true;
}

const unregister = (userId, token) => db.prepare('DELETE FROM push_tokens WHERE token = ? AND user_id = ?').run(String(token || ''), userId);
const tokensOf = (userId) => db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(userId).map((r) => r.token);

async function toUser(userId, { title, body, data = {} }) {
  if (!userId) return { sent: 0 };
  const tokens = tokensOf(userId);
  if (!tokens.length) return { sent: 0 };
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = 'Bearer ' + process.env.EXPO_ACCESS_TOKEN;
    const { data: res } = await fetchJson(
      URL(),
      { method: 'POST', headers, body: JSON.stringify(tokens.map((to) => ({ to, title, body, data, sound: 'default', channelId: 'orders', priority: 'high' }))) },
      12000
    );
    const tickets = Array.isArray(res?.data) ? res.data : [];
    let sent = 0;
    tickets.forEach((t, i) => {
      if (t.status === 'ok') sent++;
      else if (t.details?.error === 'DeviceNotRegistered') db.prepare('DELETE FROM push_tokens WHERE token = ?').run(tokens[i]);
      else console.error('[push] gagal:', t.message || JSON.stringify(t).slice(0, 150));
    });
    return { sent };
  } catch (e) {
    console.error('[push] gagal mengirim:', e.message);
    return { sent: 0 };
  }
}

module.exports = { register, unregister, tokensOf, toUser, VALID };
