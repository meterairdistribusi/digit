const { fetchJson } = require('../http');

// Reloadly Gift Cards (luar negeri): beli kode gift card/voucher via API OAuth2.
// SKU di admin ditulis `productId:unitPrice:KODENEGARA`, mis. `5:10:US`.
// Env: RELOADLY_CLIENT_ID, RELOADLY_CLIENT_SECRET, RELOADLY_SANDBOX=true untuk uji.
// Penerima email: bila kontak pembeli bukan email, dipakai RELOADLY_FALLBACK_EMAIL.
// Catatan: ditulis dari dokumentasi publik, belum diuji dengan akun nyata. Uji di sandbox dulu.

const sandbox = () => process.env.RELOADLY_SANDBOX === 'true';
const host = () => (sandbox() ? 'https://giftcards-sandbox.reloadly.com' : 'https://giftcards.reloadly.com');
const ACCEPT = 'application/com.reloadly.giftcards-v1+json';
const id = () => process.env.RELOADLY_CLIENT_ID || '';
const secret = () => process.env.RELOADLY_CLIENT_SECRET || '';

let cache = null;
async function token() {
  if (cache && cache.exp > Date.now()) return cache.value;
  const { data } = await fetchJson(
    'https://auth.reloadly.com/oauth/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: id(), client_secret: secret(), grant_type: 'client_credentials', audience: host() }),
    },
    15000
  );
  if (!data.access_token) throw new Error('Reloadly: gagal login');
  cache = { value: data.access_token, exp: Date.now() + ((data.expires_in || 3600) - 120) * 1000 };
  return cache.value;
}
const api = async (path, opts = {}) =>
  fetchJson(host() + path, { ...opts, headers: { Accept: ACCEPT, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()), ...opts.headers } }, 25000);

async function cards(transactionId) {
  const { data } = await api(`/orders/transactions/${transactionId}/cards`);
  const list = Array.isArray(data) ? data : [];
  return list.map((c) => [c.cardNumber, c.pinCode].filter(Boolean).join(' | ')).filter(Boolean).join('\n');
}

module.exports = {
  name: 'reloadly',
  label: 'Reloadly (gift card)',
  region: 'INT',
  verified: false,
  enabled: () => Boolean(id() && secret()),
  idempotent: true, // pending dicek ulang lewat transactionId yang disimpan di pesan transaksi ("tid:123")

  async buy({ sku, ref, customer }) {
    const [productId, unitPrice, countryCode] = String(sku).split(':');
    const email = String(customer).includes('@') ? customer : process.env.RELOADLY_FALLBACK_EMAIL;
    const { data } = await api('/orders', {
      method: 'POST',
      body: JSON.stringify({
        productId: Number(productId),
        countryCode,
        quantity: 1,
        unitPrice: Number(unitPrice),
        customIdentifier: ref,
        preOrder: false,
        senderName: process.env.STORE_NAME || 'Toko Digital',
        recipientEmail: email,
      }),
    });
    return this.fromOrder(data);
  },

  async fromOrder(data) {
    const status = String(data.status || '').toUpperCase();
    if (status === 'SUCCESSFUL' && data.transactionId) {
      const content = await cards(data.transactionId);
      return content
        ? { status: 'success', content, message: 'tid:' + data.transactionId }
        : { status: 'pending', message: 'tid:' + data.transactionId }; // kartu belum siap, cek lagi
    }
    if (status === 'PROCESSING' || status === 'PENDING') return { status: 'pending', message: 'tid:' + (data.transactionId || '') };
    return { status: 'failed', message: data.message || data.errorCode || 'Reloadly gagal' };
  },

  // Cek ulang: pakai transactionId yang tersimpan; tanpa itu tidak ada yang bisa ditanya
  async check({ prev }) {
    const tid = /tid:(\d+)/.exec(prev || '')?.[1];
    // Tanpa transactionId (mis. timeout saat order) tidak bisa dipastikan apakah order terjadi: serahkan ke admin
    if (!tid) return { status: 'unknown', message: 'Order Reloadly tak terkonfirmasi, periksa dashboard' };
    const { data } = await api(`/orders/transactions/${tid}`);
    return this.fromOrder({ ...data, transactionId: data.transactionId || tid });
  },

  async balance() {
    const { data } = await fetchJson(host() + '/accounts/balance', { headers: { Accept: ACCEPT, Authorization: 'Bearer ' + (await token()) } }, 15000);
    return data.balance != null ? `${data.balance} ${data.currencyCode || ''}`.trim() : undefined;
  },
};
