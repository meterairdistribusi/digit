const crypto = require('crypto');
const { fetchJson } = require('../http');

const secretKey = () => process.env.XENDIT_SECRET_KEY || '';
const base = () => process.env.XENDIT_API_URL || 'https://api.xendit.co';
const headers = () => ({
  'Content-Type': 'application/json',
  Authorization: 'Basic ' + Buffer.from(secretKey() + ':').toString('base64'),
});
const interpret = (s) => (['PAID', 'SETTLED'].includes(s) ? 'paid' : s === 'EXPIRED' ? 'failed' : 'pending');

module.exports = {
  label: 'Xendit',
  enabled: () => Boolean(secretKey()),

  async create({ ref, order, productName, finishUrl }) {
    const { ok, data } = await fetchJson(base() + '/v2/invoices', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        external_id: ref,
        amount: order.amount,
        currency: 'IDR',
        description: `${productName} x${order.qty}`.slice(0, 100),
        invoice_duration: 86400,
        success_redirect_url: finishUrl,
        failure_redirect_url: finishUrl,
      }),
    });
    if (!ok || !data.invoice_url) throw new Error(data.message || JSON.stringify(data));
    return { payUrl: data.invoice_url };
  },

  // Xendit mengirim token callback statis di header x-callback-token
  parseWebhook(req) {
    const expected = process.env.XENDIT_CALLBACK_TOKEN || '';
    const got = String(req.get('x-callback-token') || '');
    const a = Buffer.from(expected);
    const b = Buffer.from(got);
    if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const n = req.body || {};
    return { ref: n.external_id, result: interpret(n.status), amount: Number(n.paid_amount ?? n.amount) };
  },

  async status(ref) {
    const { data } = await fetchJson(`${base()}/v2/invoices?external_id=${encodeURIComponent(ref)}`, {
      headers: headers(),
    });
    const inv = Array.isArray(data) ? data[0] : null;
    if (!inv) return { result: 'pending' };
    return { result: interpret(inv.status), amount: Number(inv.paid_amount ?? inv.amount) };
  },
};
