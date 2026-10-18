const { fetchJson } = require('../http');

// Adapter untuk agregator lain yang punya API HTTP/JSON sinkron, dikonfigurasi lewat env SUPPLIERS_JSON, mis.:
// [{"name":"agregatorku","url":"https://api.contoh.com/order","method":"POST",
//   "headers":{"Authorization":"Bearer ${AGREGATORKU_TOKEN}"},
//   "body":{"product":"{{sku}}","trx_id":"{{ref}}","target":"{{customer}}"},
//   "successPath":"status","successValues":["success","ok"],
//   "contentPath":"data.voucher","messagePath":"message"}]
// Placeholder: {{sku}} {{ref}} {{customer}} di body/url, dan ${NAMA_ENV} di mana saja (agar rahasia tetap di env).

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

function load() {
  try {
    const list = JSON.parse(process.env.SUPPLIERS_JSON || '[]');
    return Array.isArray(list) ? list.filter((c) => c && c.name && c.url) : [];
  } catch (e) {
    console.error('[suppliers] SUPPLIERS_JSON tidak valid:', e.message);
    return [];
  }
}

const fromConfig = (c) => ({
  name: c.name,
  label: c.label || c.name,
  enabled: () => true,
  idempotent: false, // respons sinkron: dianggap sukses/gagal, tidak diulang agar tidak membeli dua kali

  async buy({ sku, ref, customer }) {
    const vars = { sku, ref, customer };
    const method = (c.method || 'POST').toUpperCase();
    const { data } = await fetchJson(
      fill(c.url, vars),
      {
        method,
        headers: { 'Content-Type': 'application/json', ...fill(c.headers || {}, vars) },
        ...(method === 'GET' ? {} : { body: JSON.stringify(fill(c.body || {}, vars)) }),
      },
      c.timeoutMs || 20000
    );
    const ok = (c.successValues || ['success']).map((x) => String(x).toLowerCase()).includes(String(get(data, c.successPath || 'status')).toLowerCase());
    const content = get(data, c.contentPath || 'data');
    const message = get(data, c.messagePath || 'message');
    if (ok && content) return { status: 'success', content: typeof content === 'string' ? content : JSON.stringify(content), message };
    return { status: 'failed', message: message || 'Respons pemasok tidak sukses' };
  },
});

module.exports = { loadGeneric: () => load().map(fromConfig) };
