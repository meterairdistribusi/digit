// Uji alur nyata: database sementara, pemasok palsu. Env harus diset sebelum db.js dimuat.
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'digit-'));
const test = require('node:test');
const assert = require('node:assert');
const store = require('../db');
const suppliers = require('../suppliers');
const fulfill = require('../fulfill');
const notify = require('../notify');
const { health } = require('../http');

const fake = (name, impl) => ({ name, label: name, enabled: () => true, idempotent: false, buy: impl });
const use = (t, map) => {
  Object.keys(map).forEach((n) => health.good('sup:' + n)); // circuit breaker dibersihkan antar test
  t.mock.method(suppliers, 'get', (n) => map[n]);
};
const mkProduct = (price = 20000) => store.db.prepare("INSERT INTO products (name, category, price) VALUES ('Uji','T',?)").run(price).lastInsertRowid;
const mkOrder = (productId, extra = {}) => store.createOrder({ productId, qty: 1, name: 'A', contact: '08123456789', backorder: true, ...extra });

test('stok lokal dipakai dulu dan pesanan langsung lunas', async () => {
  const pid = mkProduct();
  store.db.prepare("INSERT INTO stock (product_id, content) VALUES (?, 'akun|pw')").run(pid);
  const o = mkOrder(pid);
  await fulfill.settle(o.id);
  assert.strictEqual(store.getOrder(o.id).status, 'paid');
  assert.deepStrictEqual(store.orderItems(o.id), ['akun|pw']);
});

test('failover: pemasok 1 gagal → pemasok 2 sukses', async (t) => {
  const pid = mkProduct();
  store.addSource(pid, 'a', 'SKU-A', 1);
  store.addSource(pid, 'b', 'SKU-B', 2);
  const calls = [];
  use(t, {
    a: fake('a', async () => (calls.push('a'), { status: 'failed', message: 'stok habis' })),
    b: fake('b', async ({ sku }) => (calls.push('b:' + sku), { status: 'success', content: 'KODE-B' })),
  });
  const o = mkOrder(pid);
  await fulfill.settle(o.id);
  assert.deepStrictEqual(calls, ['a', 'b:SKU-B']);
  assert.strictEqual(store.getOrder(o.id).status, 'paid');
  assert.deepStrictEqual(store.orderItems(o.id), ['KODE-B']);
});

test('failover: pemasok 1 error jaringan (aman diulang) → tetap pindah ke pemasok 2 setelah pending dicek', async (t) => {
  const pid = mkProduct();
  store.addSource(pid, 'a', 'SKU-A', 1);
  store.addSource(pid, 'b', 'SKU-B', 2);
  use(t, {
    a: { ...fake('a', async () => { throw new Error('timeout'); }), idempotent: true },
    b: fake('b', async () => ({ status: 'success', content: 'KODE-B' })),
  });
  const o = mkOrder(pid);
  await fulfill.settle(o.id);
  // pemasok idempotent yang timeout berstatus pending (menunggu dicek ulang), bukan membeli di pemasok lain
  assert.strictEqual(store.getOrder(o.id).status, 'paid_sourcing');
  assert.strictEqual(store.txOf(o.id).length, 1);
});

test('pemasok non-idempotent yang timeout: berhenti, tidak membeli ganda, status tak pasti', async (t) => {
  const pid = mkProduct();
  store.addSource(pid, 'a', 'SKU-A', 1);
  store.addSource(pid, 'b', 'SKU-B', 2);
  let b = 0;
  use(t, {
    a: fake('a', async () => { throw new Error('timeout'); }),
    b: fake('b', async () => (b++, { status: 'success', content: 'X' })),
  });
  const o = mkOrder(pid);
  await fulfill.settle(o.id);
  assert.strictEqual(b, 0);
  assert.strictEqual(store.txOf(o.id)[0].status, 'unknown');
  assert.strictEqual(store.getOrder(o.id).status, 'paid_nostock');
});

test('semua pemasok gagal → paid_nostock, lalu pulih saat stok diisi', async (t) => {
  const pid = mkProduct();
  store.addSource(pid, 'a', 'S', 1);
  use(t, { a: fake('a', async () => ({ status: 'failed', message: 'x' })) });
  const o = mkOrder(pid);
  await fulfill.settle(o.id);
  assert.strictEqual(store.getOrder(o.id).status, 'paid_nostock');
  store.db.prepare("INSERT INTO stock (product_id, content) VALUES (?, 'baru')").run(pid);
  await fulfill.settle(o.id);
  assert.strictEqual(store.getOrder(o.id).status, 'paid');
});

test('kupon: persen, nominal, batas, kedaluwarsa, dan kuota kembali saat gagal', () => {
  const pid = mkProduct(50000);
  store.saveCoupon({ code: 'hemat10', type: 'percent', value: 10, minAmount: 0, maxUses: 1, expiresAt: null });
  const o = mkOrder(pid, { coupon: ' hemat10 ' });
  assert.deepStrictEqual([o.amount, o.discount, o.coupon_code], [45000, 5000, 'HEMAT10']);
  assert.throws(() => mkOrder(pid, { coupon: 'HEMAT10' }), /Kuota/);
  store.markFailed(o.id);
  assert.strictEqual(mkOrder(pid, { coupon: 'HEMAT10' }).amount, 45000);
  store.saveCoupon({ code: 'LAMA', type: 'fixed', value: 5000, minAmount: 0, maxUses: 0, expiresAt: '2000-01-01' });
  assert.throws(() => mkOrder(pid, { coupon: 'LAMA' }), /kedaluwarsa/);
  store.saveCoupon({ code: 'BESAR', type: 'fixed', value: 999999, minAmount: 0, maxUses: 0, expiresAt: null });
  assert.strictEqual(mkOrder(pid, { coupon: 'BESAR' }).amount, 1000); // tidak pernah di bawah batas minimal gateway
  assert.throws(() => mkOrder(pid, { coupon: 'TIDAKADA' }), /tidak valid/);
});

test('pelacakan pesanan: cocok dengan kontak, format nomor HP dinormalisasi', () => {
  const o = mkOrder(mkProduct());
  assert.ok(store.findOrderByContact(o.id.toLowerCase(), '+62 812-3456-789'));
  assert.ok(store.findOrderByContact(o.id, '08123456789'));
  assert.strictEqual(store.findOrderByContact(o.id, '08999999999'), null);
  assert.strictEqual(store.findOrderByContact(o.id, ''), null);
});

test('notifikasi hanya sekali per status & hanya berisi link, bukan isi produk', async (t) => {
  const sent = [];
  process.env.FONNTE_TOKEN = 'x';
  t.mock.method(notify.channels, 'whatsapp', async (to, text) => sent.push(text));
  const pid = mkProduct();
  store.db.prepare("INSERT INTO stock (product_id, content) VALUES (?, 'RAHASIA')").run(pid);
  const o = mkOrder(pid);
  await fulfill.settle(o.id);
  await notify.announce(o.id);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0], /\/order\/ORD-/);
  assert.doesNotMatch(sent[0], /RAHASIA/);
});

test('laporan & daftar pesanan', () => {
  const r = store.salesReport(30);
  assert.ok(r.daily.length && r.byProduct.length);
  const list = store.searchOrders({ status: 'paid', size: 2 });
  assert.ok(list.rows.length <= 2 && list.pages >= 1);
});

test('circuit breaker: pemasok yang baru error dilewati dulu pada pesanan berikutnya', async (t) => {
  const pid = mkProduct();
  store.addSource(pid, 'a', 'SKU-A', 1);
  store.addSource(pid, 'b', 'SKU-B', 2);
  const calls = [];
  use(t, {
    a: { ...fake('a', async () => { calls.push('a'); throw new Error('down'); }), idempotent: true },
    b: fake('b', async () => (calls.push('b'), { status: 'success', content: 'ok' })),
  });
  await fulfill.settle(mkOrder(pid).id); // a error → pending
  await fulfill.settle(mkOrder(pid).id); // a sedang cooldown → b dipakai lebih dulu
  assert.deepStrictEqual(calls, ['a', 'b']);
});
