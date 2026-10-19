// Menjalankan toko dengan DATA CONTOH lengkap (pesanan, refund, kupon, laporan, integrasi teruji) di database sementara,
// supaya admin bisa dilihat/dicoba tanpa kunci API apa pun:   npm run demo   →  http://localhost:3000/admin  (admin / admin)
// Semua gateway & pemasok memakai tiruan lokal (sandbox/mock-gateways.js). Tidak ada uang/akun sungguhan yang tersentuh.
const os = require('os'), path = require('path'), fs = require('fs'), crypto = require('crypto');
process.env.DATA_DIR = process.env.DEMO_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'digit-demo-'));
process.env.NODE_ENV = 'development';
process.env.STORE_NAME = 'Toko Digital Demo';
const port = Number(process.env.PORT || 3000);
process.env.BASE_URL = `http://localhost:${port}`;

(async () => {
  const mockgw = require('./mock-gateways');
  const mock = await mockgw.start({ appUrl: process.env.BASE_URL });
  Object.assign(process.env, { MIDTRANS_API_URL: mock.url, MIDTRANS_SNAP_URL: mock.url, XENDIT_API_URL: mock.url, EXPO_PUSH_URL: mock.url + '/push/send' });

  const app = require('../server');
  const store = require('../db');
  const settings = require('../settings');
  const accounts = require('../accounts');
  const integrations = require('../integrations');
  const db = store.db;

  // ----- Pengaturan: kunci sandbox tiruan + data penjual -----
  const set = (k, v) => settings.set(k, v, 'demo');
  set('MIDTRANS_SERVER_KEY', mock.midtransKey);
  set('XENDIT_SECRET_KEY', 'xnd_development_demo0000');
  set('XENDIT_CALLBACK_TOKEN', mock.xenditToken);
  set('PAYMENT_PRIORITY', 'midtrans,xendit');
  set('LEGAL_COMPANY', 'Toko Digital Demo (contoh)');
  set('LEGAL_EMAIL', 'halo@tokodemo.id');
  set('LEGAL_ADDRESS', 'Jakarta, Indonesia');
  set('WHATSAPP_NUMBER', '6281200000000');
  set('BANNER_TITLE', 'Diskon spesial hingga 40% untuk produk pilihan');
  set('BANNER_TEXT', 'Netflix, Canva, ChatGPT dan lainnya. Bayar mudah lewat QRIS atau e-wallet, produk langsung dikirim otomatis.');
  set('BANNER_CODE', 'HEMAT10');
  set('SUPPLIERS_JSON', JSON.stringify([{ name: 'agregator-demo', label: 'Agregator Demo (tiruan)', url: mock.url + '/agg/order', method: 'POST', body: { p: '{{sku}}', t: '{{ref}}', c: '{{customer}}' }, successValues: ['success'], contentPath: 'data.voucher', balance: { url: mock.url + '/agg/balance', method: 'GET', path: 'data.balance' } }]));
  accounts.createAdmin('kasir', 'kasir12345', 'staff');
  for (const id of ['midtrans', 'xendit', 'agregator-demo']) await integrations.test(id, 'demo');

  // ----- Produk & stok -----
  const add = (name, cat, desc, price) => Number(db.prepare('INSERT INTO products (name, category, description, price) VALUES (?,?,?,?)').run(name, cat, desc, price).lastInsertRowid);
  const spotify = add('Spotify Premium 1 Bulan', 'Musik', 'Spotify Premium individual, tanpa iklan, unduh offline.', 20000);
  const disney = add('Disney+ Hotstar 1 Bulan', 'Streaming', 'Akses Disney+ Hotstar selama 1 bulan.', 18000);
  const prods = db.prepare('SELECT id, name, price FROM products ORDER BY id').all();
  const stockOf = (pid, n) => { for (let i = 0; i < n; i++) db.prepare('INSERT INTO stock (product_id, content) VALUES (?,?)').run(pid, `akun${pid}_${i}@mail.com|Pw${crypto.randomBytes(3).toString('hex')}`); };
  prods.forEach((p) => stockOf(p.id, p.id % 3 === 0 ? 0 : 6 + (p.id % 4)));
  db.prepare('INSERT INTO product_sources (product_id, supplier, sku, priority) VALUES (?,?,?,?)').run(prods[0].id, 'agregator-demo', 'NFX-1M', 1);
  db.prepare('INSERT INTO product_sources (product_id, supplier, sku, priority) VALUES (?,?,?,?)').run(prods[0].id, 'digiflazz', 'netflix1m', 2);

  // ----- Kupon -----
  store.saveCoupon({ code: 'HEMAT10', type: 'percent', value: 10, minAmount: 20000, maxUses: 100, expiresAt: null });
  store.saveCoupon({ code: 'DISKON5K', type: 'fixed', value: 5000, minAmount: 30000, maxUses: 50, expiresAt: '2027-12-31' });
  store.saveCoupon({ code: 'LEBARAN', type: 'percent', value: 15, minAmount: 0, maxUses: 0, expiresAt: '2026-04-30' });
  db.prepare("UPDATE coupons SET used = 37 WHERE code = 'HEMAT10'").run();

  // ----- Akun pembeli -----
  const users = ['Budi Santoso', 'Siti Rahma', 'Andi Wijaya', 'Dewi Lestari', 'Rizky Pratama'].map((n, i) => {
    const id = accounts.registerUser({ email: `${n.split(' ')[0].toLowerCase()}@contoh.id`, name: n, phone: `0812000000${i}`, password: 'rahasia123', acceptTerms: true });
    return { id, name: n, contact: `0812000000${i}` };
  });

  // ----- Riwayat pesanan 14 hari -----
  let seq = 0;
  const pick = (a) => a[(seq * 7 + a.length) % a.length];
  const ts = (daysAgo, h) => new Date(Date.now() - daysAgo * 864e5 - h * 36e5).toISOString().replace('T', ' ').slice(0, 19);
  const mkOrder = ({ status, daysAgo = 0, hour = 1, prod = pick(prods), qty = 1, user = pick(users), coupon = null, gateway = pick(['midtrans', 'midtrans', 'xendit']), payStatus }) => {
    seq++;
    const id = 'ORD-' + crypto.createHash('md5').update('demo' + seq).digest('hex').slice(0, 10).toUpperCase();
    const gross = prod.price * qty;
    const discount = coupon === 'HEMAT10' ? Math.floor(gross * 0.1) : coupon === 'DISKON5K' ? 5000 : 0;
    const paid = status.startsWith('paid') || status === 'refunded';
    db.prepare('INSERT INTO orders (id, product_id, qty, amount, customer_name, contact, status, access_key, created_at, paid_at, discount, coupon_code, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, prod.id, qty, gross - discount, user.name, user.contact, status, crypto.randomBytes(8).toString('hex'), ts(daysAgo, hour), paid ? ts(daysAgo, hour - 0.1) : null, discount, coupon, user.id);
    db.prepare('INSERT INTO payment_attempts (ref, order_id, provider, pay_url, status) VALUES (?,?,?,?,?)')
      .run(`${id}-P1`, id, gateway, '#', payStatus || (paid ? 'paid' : status === 'failed' ? 'failed' : 'pending'));
    if (status === 'paid') for (let i = 0; i < qty; i++) db.prepare('INSERT INTO stock (product_id, content, order_id) VALUES (?,?,?)').run(prod.id, `terkirim${seq}_${i}@mail.com|Pw${seq}x`, id);
    return id;
  };
  for (let d = 13; d >= 1; d--) for (let k = 0; k < 2 + (d % 4); k++) mkOrder({ status: 'paid', daysAgo: d, hour: 2 + k * 3, qty: 1 + ((d + k) % 3 === 0 ? 1 : 0), coupon: (d + k) % 5 === 0 ? 'HEMAT10' : null });
  mkOrder({ status: 'paid', daysAgo: 0, hour: 3, prod: prods[0], coupon: 'DISKON5K' });
  mkOrder({ status: 'pending', daysAgo: 0, hour: 0.2, prod: spotify ? prods.find((p) => p.id === spotify) : prods[0] });
  mkOrder({ status: 'pending', daysAgo: 0, hour: 0.5, prod: prods.find((p) => p.id === disney), gateway: 'xendit' });
  mkOrder({ status: 'failed', daysAgo: 1, hour: 5 });
  const nostock = mkOrder({ status: 'paid_nostock', daysAgo: 0, hour: 2, prod: prods[2], gateway: 'midtrans' });
  const sourcing = mkOrder({ status: 'paid_sourcing', daysAgo: 0, hour: 0.3, prod: prods[0], gateway: 'xendit' });
  db.prepare("INSERT INTO supplier_tx (ref, order_id, supplier, sku, status, message) VALUES (?,?,?,?,?,?)").run(`${sourcing}-S1`, sourcing, 'agregator-demo', 'NFX-1M', 'pending', 'diproses pemasok');
  db.prepare("INSERT INTO supplier_tx (ref, order_id, supplier, sku, status, message) VALUES (?,?,?,?,?,?)").run(`${nostock}-S1`, nostock, 'agregator-demo', 'X', 'failed', 'stok habis');

  // refund: sukses (stok tak ada), pembayaran ganda direfund otomatis, dan satu yang gagal di gateway
  const refunded = mkOrder({ status: 'refunded', daysAgo: 2, hour: 4, prod: prods[2] });
  db.prepare("INSERT INTO refunds (order_id, attempt_ref, provider, amount, reason, status, provider_ref, message, requested_by) VALUES (?,?,?,?,?,'succeeded',?,?,?)")
    .run(refunded, `${refunded}-P1`, 'midtrans', prods[2].price, 'Stok tidak tersedia', 'rf-1042', 'Success, refund request is approved', 'admin');
  const dup = mkOrder({ status: 'paid', daysAgo: 1, hour: 6, prod: prods[1] });
  db.prepare("INSERT INTO payment_attempts (ref, order_id, provider, pay_url, status) VALUES (?,?,?,?,?)").run(`${dup}-P2`, dup, 'xendit', '#', 'paid_duplicate');
  db.prepare("INSERT INTO refunds (order_id, attempt_ref, provider, amount, reason, status, provider_ref, message, requested_by) VALUES (?,?,?,?,?,'succeeded',?,?,?)")
    .run(dup, `${dup}-P2`, 'xendit', prods[1].price, 'Pembayaran ganda', 'rfd-77', 'SUCCEEDED', 'sistem');
  const failedRefund = mkOrder({ status: 'paid_nostock', daysAgo: 0, hour: 5, prod: prods[2], gateway: 'midtrans' });
  db.prepare("INSERT INTO refunds (order_id, attempt_ref, provider, amount, reason, status, message, requested_by) VALUES (?,?,?,?,?,'failed',?,?)")
    .run(failedRefund, `${failedRefund}-P1`, 'midtrans', prods[2].price, 'Stok tidak tersedia', '412: Transaction status cannot be updated (VA bank tidak mendukung refund API)', 'admin');
  const unknown = mkOrder({ status: 'paid_nostock', daysAgo: 0, hour: 1.2, prod: prods[0], gateway: 'xendit' });
  db.prepare("INSERT INTO supplier_tx (ref, order_id, supplier, sku, status, message) VALUES (?,?,?,?,?,?)").run(`${unknown}-S1`, unknown, 'digiflazz', 'netflix1m', 'unknown', 'timeout');
  db.prepare("INSERT INTO supplier_tx (ref, order_id, supplier, sku, status) VALUES (?,?,?,?,?)").run(`${dup}-S0`, dup, 'agregator-demo', 'NFX-1M', 'success');
  for (let i = 0; i < 9; i++) db.prepare("INSERT INTO supplier_tx (ref, order_id, supplier, sku, status) VALUES (?,?,?,?,?)").run(`demo-ok-${i}`, dup, 'agregator-demo', 'NFX-1M', i < 7 ? 'success' : 'failed');

  const server = app.listen(port, () => {
    console.log(`\nDemo siap: ${process.env.BASE_URL}\n  Admin  : /admin  (Pemilik: admin / admin · Staf: kasir / kasir12345)\n  Pembeli: /  (akun contoh: budi@contoh.id / rahasia123)\nData: ${process.env.DATA_DIR}`);
    require('../fulfill').startWorker();
  });
  module.exports = { server, mock };
})();
