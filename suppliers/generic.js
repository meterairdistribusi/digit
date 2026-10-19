const crypto = require('crypto');
const { fetchJson } = require('../http');

// Adapter untuk agregator mana pun yang punya API HTTP, dikonfigurasi lewat env SUPPLIERS_JSON (atau preset, lihat presets.js).
// Fitur: GET/POST, body JSON atau form, tanda tangan (md5/sha1/sha256/hmac), token OAuth (di-cache),
// cek status async (`check`), dan saldo (`balance`). Contoh lengkap ada di README.
//
// Placeholder di url/headers/body/query: {{sku}} {{ref}} {{customer}} {{signature}} {{token}} {{prev}}
// dan ${NAMA_ENV} di mana saja (rahasia tetap di env, tidak di JSON).

const get = (obj, path) => String(path || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);
const fillEnv = (s) => String(s).replace(/\$\{(\w+)\}/g, (_, n) => process.env[n] || '');
const fill = (v, vars) =>
  typeof v === 'string'
    ? fillEnv(v).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
    : Array.isArray(v)
    ? v.map((x) => fill(x, vars))
    : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars)]))
    : v;

function digest(sign, vars) {
  const text = fill(sign.template, vars);
  const algo = sign.algo || 'md5';
  return sign.hmacKey
    ? crypto.createHmac(algo, fillEnv(sign.hmacKey)).update(text).digest(sign.encoding || 'hex')
    : crypto.createHash(algo).update(text).digest(sign.encoding || 'hex');
}

// Satu request HTTP dari potongan konfigurasi {url, method, headers, query, body, bodyType}
async function call(part, vars, timeoutMs) {
  const method = (part.method || 'POST').toUpperCase();
  let url = fill(part.url, vars);
  if (part.query) {
    const qs = new URLSearchParams(fill(part.query, vars)).toString();
    url += (url.includes('?') ? '&' : '?') + qs;
  }
  const headers = { ...fill(part.headers || {}, vars) };
  let body;
  if (method !== 'GET' && part.body) {
    const b = fill(part.body, vars);
    if (part.bodyType === 'form') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
      body = new URLSearchParams(b).toString();
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(b);
    }
  }
  return fetchJson(url, { method, headers, ...(body ? { body } : {}) }, timeoutMs);
}

function load() {
  try {
    const list = JSON.parse(process.env.SUPPLIERS_JSON || '[]');
    return Array.isArray(list) ? list.filter((c) => c && c.name && c.url) : [];
  } catch (e) {
    console.error('[suppliers] SUPPLIERS_JSON tidak valid:', e.message);
    return [];
  }
}

// Interpretasi respons: success | pending | failed
function interpret(c, data) {
  const norm = (a) => (a || []).map((x) => String(x).toLowerCase());
  const st = String(get(data, c.successPath || 'status')).toLowerCase();
  const content = get(data, c.contentPath || 'data');
  const message = get(data, c.messagePath || 'message');
  if (norm(c.successValues || ['success']).includes(st)) {
    if (content) return { status: 'success', content: typeof content === 'string' ? content : JSON.stringify(content), message };
    return { status: 'failed', message: message || 'Sukses tetapi tanpa isi produk' };
  }
  if (norm(c.pendingValues).includes(st)) return { status: 'pending', message };
  return { status: 'failed', message: message || 'Respons pemasok tidak sukses' };
}

const fromConfig = (c) => {
  const timeout = c.timeoutMs || 20000;
  let tokenCache = null;

  async function token() {
    if (!c.auth) return '';
    if (tokenCache && tokenCache.exp > Date.now()) return tokenCache.value;
    const { data } = await call(c.auth, {}, timeout);
    const value = get(data, c.auth.tokenPath || 'access_token');
    if (!value) throw new Error('Gagal mengambil token pemasok');
    tokenCache = { value, exp: Date.now() + (Number(get(data, c.auth.ttlPath || 'expires_in')) || 3000) * 1000 - 60000 };
    return value;
  }

  const varsFor = async (args) => {
    const vars = { sku: args.sku, ref: args.ref, customer: args.customer, prev: args.prev || '', token: await token() };
    if (c.sign) vars.signature = digest(c.sign, vars);
    return vars;
  };

  const adapter = {
    name: c.name,
    label: c.label || c.name,
    region: c.region || '',
    verified: c.verified !== false,
    enabled: () => !c.requireEnv || c.requireEnv.every((n) => process.env[n]),
    // Dengan `check`, status bisa ditanyakan ulang memakai ref yang sama, jadi aman untuk pesanan pending.
    // Tanpa itu, respons dianggap final dan tidak diulang agar tidak membeli dua kali.
    idempotent: Boolean(c.check),

    async buy(args) {
      const vars = await varsFor(args);
      const { data } = await call(c, vars, timeout);
      return interpret(c, data);
    },
  };

  if (c.check) {
    adapter.check = async (args) => {
      const vars = await varsFor(args);
      const { data } = await call({ ...c, ...c.check }, vars, timeout);
      return interpret({ ...c, ...c.check }, data);
    };
  }
  if (c.balance) {
    adapter.selfTest = async () => {
      const b = await adapter.balance();
      return b === undefined || b === '' ? { ok: false, message: 'Saldo tidak terbaca (cek kunci)' } : { ok: true, message: 'Terhubung, saldo ' + b };
    };
    adapter.balance = async () => {
      const vars = await varsFor({ sku: '', ref: 'balance', customer: '' });
      const { data } = await call(c.balance, vars, timeout);
      return get(data, c.balance.path || 'balance');
    };
  }
  return adapter;
};

module.exports = { loadGeneric: () => load().map(fromConfig), fromConfig, interpret, digest, fill };
