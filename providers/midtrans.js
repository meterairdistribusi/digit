const crypto = require('crypto');
const { fetchJson } = require('../http');

const serverKey = () => process.env.MIDTRANS_SERVER_KEY || '';
const isProd = () => process.env.MIDTRANS_IS_PRODUCTION === 'true';
const snapBase = () => process.env.MIDTRANS_SNAP_URL || (isProd() ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com');
const apiBase = () => process.env.MIDTRANS_API_URL || (isProd() ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com');
const headers = () => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  Authorization: 'Basic ' + Buffer.from(serverKey() + ':').toString('base64'),
});

function interpret(n) {
  const s = n.transaction_status;
  if (s === 'settlement' || (s === 'capture' && n.fraud_status === 'accept')) return 'paid';
  if (['deny', 'cancel', 'expire', 'failure'].includes(s)) return 'failed';
  return 'pending';
}

function validSignature(n) {
  const expected = crypto
    .createHash('sha512')
    .update(String(n.order_id) + String(n.status_code) + String(n.gross_amount) + serverKey())
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(n.signature_key || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const fail = (m) => ({ ok: false, message: m });

module.exports = {
  label: 'Midtrans',
  enabled: () => Boolean(serverKey()),
  mode: () => (isProd() ? 'production' : 'sandbox'),

  // Uji koneksi. Sandbox: buat tagihan uji Rp10.000 (sekalian menguji pembuatan tagihan). Produksi: hanya baca, tanpa tagihan.
  async selfTest() {
    if (!serverKey()) return fail('Server key belum diisi');
    if (!isProd()) {
      const { ok, data } = await fetchJson(snapBase() + '/snap/v1/transactions', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ transaction_details: { order_id: 'TEST-' + Date.now(), gross_amount: 10000 } }),
      });
      return ok && data.redirect_url ? { ok: true, message: 'Tagihan uji sandbox berhasil dibuat' } : fail(JSON.stringify(data.error_messages || data).slice(0, 200));
    }
    const { data } = await fetchJson(`${apiBase()}/v2/TEST-NOT-EXIST/status`, { headers: headers() });
    return String(data.status_code) === '404' ? { ok: true, message: 'Kunci produksi valid (baca saja)' } : fail(String(data.status_message || JSON.stringify(data)).slice(0, 200));
  },

  // Refund langsung lewat Core API. Metode yang tidak mendukung refund API (mis. VA bank) ditolak Midtrans → status failed → admin refund manual.
  async refund({ ref, amount, reason, refundKey }) {
    const { data } = await fetchJson(`${apiBase()}/v2/${encodeURIComponent(ref)}/refund`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ refund_key: refundKey, amount, reason: String(reason).slice(0, 100) }),
    });
    const code = String(data.status_code);
    if (code === '200') return { status: 'succeeded', providerRef: String(data.refund_chargeback_id ?? data.refund_key ?? refundKey), message: data.status_message };
    return { status: 'failed', message: `${code}: ${data.status_message || JSON.stringify(data).slice(0, 150)}` };
  },

  async create({ ref, order, productName, finishUrl }) {
    const { ok, data } = await fetchJson(snapBase() + '/snap/v1/transactions', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        transaction_details: { order_id: ref, gross_amount: order.amount },
        item_details: [{ id: String(order.product_id), price: order.amount, quantity: 1, name: productName.slice(0, 50) }],
        customer_details: { first_name: order.customer_name.slice(0, 50) },
        callbacks: { finish: finishUrl },
      }),
    });
    if (!ok || !data.redirect_url) throw new Error(JSON.stringify(data.error_messages || data));
    return { payUrl: data.redirect_url };
  },

  // Webhook → { ref, result, amount } atau null bila signature tidak valid
  parseWebhook(req) {
    const n = req.body || {};
    if (!serverKey() || !validSignature(n)) return null;
    return { ref: n.order_id, result: interpret(n), amount: Number(n.gross_amount) };
  },

  async status(ref) {
    const { data } = await fetchJson(`${apiBase()}/v2/${encodeURIComponent(ref)}/status`, { headers: headers() });
    if (String(data.status_code) === '404') return { result: 'pending' }; // belum dibayar/belum dibuka
    return { result: interpret(data), amount: Number(data.gross_amount) };
  },
};
