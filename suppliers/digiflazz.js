const crypto = require('crypto');
const { fetchJson } = require('../http');

const BASE = 'https://api.digiflazz.com/v1';
const user = () => process.env.DIGIFLAZZ_USERNAME || '';
const key = () => process.env.DIGIFLAZZ_API_KEY || '';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const post = (path, body) =>
  fetchJson(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000);

module.exports = {
  name: 'digiflazz',
  label: 'Digiflazz',
  enabled: () => Boolean(user() && key()),
  idempotent: true, // ref_id yang sama mengembalikan status transaksi yang sama, aman untuk dicek ulang

  async buy({ sku, ref, customer }) {
    const { data } = await post('/transaction', {
      username: user(),
      buyer_sku_code: sku,
      customer_no: customer,
      ref_id: ref,
      sign: md5(user() + key() + ref),
      ...(process.env.DIGIFLAZZ_TESTING === 'true' ? { testing: true } : {}),
    });
    const d = data.data || {};
    const st = String(d.status || '').toLowerCase();
    const content = [d.sn, d.serial_number].find(Boolean) || '';
    if (st === 'sukses') return { status: 'success', content: content || 'Berhasil (hubungi admin untuk detail)', message: d.message };
    if (st === 'pending') return { status: 'pending', message: d.message };
    return { status: 'failed', message: d.message || JSON.stringify(data).slice(0, 200) };
  },

  async balance() {
    const { data } = await post('/cek-saldo', { cmd: 'deposit', username: user(), sign: md5(user() + key() + 'depo') });
    return data.data?.deposit;
  },

  async catalog() {
    const { data } = await post('/price-list', { cmd: 'prepaid', username: user(), sign: md5(user() + key() + 'pricelist') });
    return (Array.isArray(data.data) ? data.data : []).map((p) => ({
      sku: p.buyer_sku_code,
      name: `${p.brand} · ${p.product_name}`,
      price: p.price,
      available: p.buyer_product_status && p.seller_product_status,
    }));
  },
};
