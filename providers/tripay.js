const crypto = require('crypto');
const { fetchJson } = require('../http');

// Tripay (Indonesia): tagihan "closed payment" dengan satu metode bayar (TRIPAY_METHOD, mis. QRIS atau BRIVA).
// Env: TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, TRIPAY_MERCHANT_CODE, TRIPAY_METHOD (bawaan QRIS), TRIPAY_SANDBOX (bawaan aktif).
// Webhook (daftarkan di Merchant → Callback URL): {BASE_URL}/pay/tripay/notify, ditandatangani HMAC-SHA256 badan mentah.
// Tripay tidak punya API refund → refund lewat jalur manual di admin.
// Catatan: ditulis dari pengetahuan umum API Tripay v2 (dokumentasi resmi tidak bisa diakses saat pembuatan), BELUM diuji akun nyata.

const sandbox = () => process.env.TRIPAY_SANDBOX !== 'false'; // aman secara bawaan: sandbox
const base = () => process.env.TRIPAY_API_URL || (sandbox() ? 'https://tripay.co.id/api-sandbox' : 'https://tripay.co.id/api');
const apiKey = () => process.env.TRIPAY_API_KEY || '';
const privateKey = () => process.env.TRIPAY_PRIVATE_KEY || '';
const merchant = () => process.env.TRIPAY_MERCHANT_CODE || '';
const method = () => (process.env.TRIPAY_METHOD || 'QRIS').trim();
const hmac = (text) => crypto.createHmac('sha256', privateKey()).update(text).digest('hex');
const headers = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() });
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const interpret = (s) => (s === 'PAID' ? 'paid' : ['FAILED', 'EXPIRED', 'REFUND'].includes(s) ? 'failed' : 'pending');
const isEmail = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c));
const phoneOf = (c) => { const d = String(c).replace(/\D/g, ''); return !isEmail(c) && d.length >= 9 ? d.replace(/^0/, '62') : ''; };

module.exports = {
  label: 'Tripay',
  verified: false,
  enabled: () => Boolean(apiKey() && privateKey() && merchant()),
  mode: () => (sandbox() ? 'sandbox' : 'production'),
  ack: { success: true }, // Tripay mewajibkan balasan {"success":true}

  async create({ ref, order, productName, finishUrl }) {
    const body = {
      method: method(),
      merchant_ref: ref,
      amount: order.amount,
      customer_name: order.customer_name.slice(0, 60),
      customer_email: isEmail(order.contact) ? order.contact : `${order.id.toLowerCase()}@example.com`,
      ...(phoneOf(order.contact) ? { customer_phone: phoneOf(order.contact) } : {}),
      order_items: [{ sku: String(order.product_id), name: productName.slice(0, 50), price: order.amount, quantity: 1 }],
      return_url: finishUrl,
      expired_time: Math.floor(Date.now() / 1000) + 24 * 3600,
      signature: hmac(merchant() + ref + order.amount),
    };
    const { ok, data } = await fetchJson(base() + '/transaction/create', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    const d = data.data || {};
    if (!ok || !data.success || !(d.checkout_url || d.pay_url)) throw new Error(data.message || JSON.stringify(data).slice(0, 200));
    return { payUrl: d.checkout_url || d.pay_url, extRef: d.reference };
  },

  // Callback: header X-Callback-Signature = HMAC-SHA256(badan mentah, private key). Nominal asli = total_amount − fee_customer.
  parseWebhook(req) {
    if (!privateKey() || !req.rawBody) return null;
    if (!safeEq(hmac(req.rawBody), req.get('x-callback-signature') || '')) return null;
    const n = req.body || {};
    if (req.get('x-callback-event') && req.get('x-callback-event') !== 'payment_status') return { ref: n.merchant_ref, result: 'pending' };
    return { ref: n.merchant_ref, result: interpret(n.status), amount: Number(n.total_amount) - Number(n.fee_customer || 0) };
  },

  async status(ref, attempt) {
    if (!attempt?.ext_ref) return { result: 'pending' };
    const { data } = await fetchJson(`${base()}/transaction/detail?reference=${encodeURIComponent(attempt.ext_ref)}`, { headers: headers() });
    const d = data.data;
    if (!data.success || !d) return { result: 'pending' };
    return { result: interpret(d.status), amount: Number(d.amount) };
  },

  async selfTest() {
    if (!this.enabled()) return { ok: false, message: 'API key, Private key, dan Kode merchant wajib diisi' };
    const { ok, status, data } = await fetchJson(base() + '/merchant/payment-channel', { headers: headers() });
    if (!ok || !data.success) return { ok: false, message: `${status}: ${data.message || JSON.stringify(data).slice(0, 150)}` };
    const ch = (data.data || []).find((c) => c.code === method());
    return ch ? { ok: true, message: `Terhubung, metode ${method()} tersedia` } : { ok: false, message: `Terhubung, tetapi metode "${method()}" tidak tersedia di akun ini` };
  },
};
