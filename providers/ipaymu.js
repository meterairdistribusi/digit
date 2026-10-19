const crypto = require('crypto');
const { fetchJson } = require('../http');

// iPaymu (Indonesia): halaman bayar (redirect payment), pembeli memilih metode di halaman iPaymu.
// Env: IPAYMU_VA, IPAYMU_API_KEY, IPAYMU_SANDBOX (bawaan aktif). Webhook: {BASE_URL}/pay/ipaymu/notify (dikirim otomatis lewat notifyUrl).
// Notifikasi iPaymu TIDAK ditandatangani, jadi tiap notifikasi diverifikasi ulang dengan memanggil API cek transaksi.
// iPaymu tidak punya API refund yang kami pakai → refund lewat jalur manual di admin. Status tidak bisa ditanya ulang
// dari sisi kami (hanya lewat ID transaksi dari webhook), jadi pembayaran bergantung pada webhook.
// Catatan: ditulis dari pengetahuan umum API iPaymu v2 (dokumentasi resmi tidak bisa diakses saat pembuatan), BELUM diuji akun nyata.

const sandbox = () => process.env.IPAYMU_SANDBOX !== 'false'; // aman secara bawaan: sandbox
const base = () => process.env.IPAYMU_API_URL || (sandbox() ? 'https://sandbox.ipaymu.com/api/v2' : 'https://my.ipaymu.com/api/v2');
const va = () => process.env.IPAYMU_VA || '';
const key = () => process.env.IPAYMU_API_KEY || '';

// timestamp YYYYMMDDhhmmss (WIB)
const stamp = () => new Date(Date.now() + 7 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);

// Tanda tangan: HMAC-SHA256( "METODE:VA:sha256(body):APIKEY", APIKEY )
async function call(method, path, payload) {
  const body = JSON.stringify(payload);
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex').toLowerCase();
  const signature = crypto.createHmac('sha256', key()).update(`${method.toUpperCase()}:${va()}:${bodyHash}:${key()}`).digest('hex');
  return fetchJson(base() + path, { method, headers: { 'Content-Type': 'application/json', va: va(), signature, timestamp: stamp() }, body });
}

// Status transaksi iPaymu: 1 & 6 = berhasil; 0/4 = menunggu; -2, 2, 3, 5 = gagal/kedaluwarsa/batal/refund
const interpret = (s) => (s === 1 || s === 6 ? 'paid' : [-2, 2, 3, 5].includes(s) ? 'failed' : 'pending');

module.exports = {
  label: 'iPaymu',
  verified: false,
  enabled: () => Boolean(va() && key()),
  mode: () => (sandbox() ? 'sandbox' : 'production'),

  async create({ ref, order, productName, finishUrl }) {
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(order.contact) ? order.contact : '';
    const { ok, data } = await call('POST', '/payment', {
      product: [productName.slice(0, 80)],
      qty: [1],
      price: [order.amount],
      returnUrl: finishUrl,
      cancelUrl: finishUrl,
      notifyUrl: `${baseUrl}/pay/ipaymu/notify`,
      referenceId: ref,
      buyerName: order.customer_name.slice(0, 60),
      ...(email ? { buyerEmail: email } : {}),
    });
    const url = data.Data?.Url;
    if (!ok || !data.Success || !url) throw new Error(data.Message || JSON.stringify(data).slice(0, 200));
    return { payUrl: url, extRef: data.Data?.SessionID };
  },

  // Notifikasi (form atau JSON): trx_id, reference_id, status, ... → diverifikasi lewat API cek transaksi (tidak boleh percaya isi notifikasi)
  async parseWebhook(req) {
    const n = req.body || {};
    const trx = String(n.trx_id || n.transaction_id || '').trim();
    const ref = String(n.reference_id || '').trim();
    if (!trx || !ref || !va() || !key()) return null;
    const { ok, data } = await call('POST', '/transaction', { transactionId: Number(trx) || trx });
    if (!ok || !data.Success || !data.Data) throw new Error(data.Message || 'cek transaksi gagal');
    const d = data.Data;
    if (String(d.ReferenceId) !== ref) return null; // notifikasi palsu / tidak cocok dengan transaksi sebenarnya
    const amount = Number(d.Amount ?? d.SubTotal ?? d.Total ?? n.amount);
    return { ref, result: interpret(Number(d.Status)), amount };
  },

  // Tidak bisa ditanya ulang dari ref kami; andalkan webhook
  async status() {
    return { result: 'pending' };
  },

  async selfTest() {
    if (!this.enabled()) return { ok: false, message: 'VA dan API key wajib diisi' };
    const { ok, status, data } = await call('POST', '/balance', { account: va() });
    if (ok && data.Success) return { ok: true, message: 'Terhubung (saldo terbaca)' };
    return { ok: false, message: `${status}: ${data.Message || JSON.stringify(data).slice(0, 150)}` };
  },
};
