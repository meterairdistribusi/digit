// fetch dengan timeout + parsing JSON; tidak pernah menggantung request pelanggan
async function fetchJson(url, opts = {}, timeoutMs = 12000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, data };
}

// Penanda kesehatan sederhana: penyedia yang baru gagal dilewati sementara (circuit breaker)
const COOLDOWN_MS = 2 * 60e3;
const downUntil = new Map();
const health = {
  ok: (key) => (downUntil.get(key) || 0) < Date.now(),
  bad: (key) => downUntil.set(key, Date.now() + COOLDOWN_MS),
  good: (key) => downUntil.delete(key),
  // sehat dulu, yang sedang cooldown tetap dipakai sebagai pilihan terakhir
  order: (keys, prefix) => [...keys.filter((k) => health.ok(prefix + k)), ...keys.filter((k) => !health.ok(prefix + k))],
};

module.exports = { fetchJson, health };
