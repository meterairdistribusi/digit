// Kontrak aplikasi native: klien API TypeScript di mobile/src/api.ts dijalankan terhadap backend asli.
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'digit-mob-'));
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const mockgw = require('../sandbox/mock-gateways');

let srv, mock, mod, base;
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timeout'); };

test.before(async () => {
  mod = await import(pathToFileURL(path.join(__dirname, '../mobile/src/api.ts')).href);
  const app = require('../server');
  srv = app.listen(0);
  base = `http://127.0.0.1:${srv.address().port}`;
  mock = await mockgw.start({ appUrl: base });
  Object.assign(process.env, { BASE_URL: base, MIDTRANS_API_URL: mock.url, MIDTRANS_SNAP_URL: mock.url, MIDTRANS_SERVER_KEY: mock.midtransKey });
});
test.after(async () => { srv.close(); await mock.close(); });

test('klien native: alur lengkap daftar → beli → bayar → terima produk → hapus akun', async () => {
  let token = null, expired = 0;
  const api = mod.createClient({ baseUrl: base + '/', getToken: () => token, onUnauthorized: () => expired++ });

  const cfg = await api.config();
  assert.ok(cfg.store_name);
  const legal = await api.legalList();
  assert.deepStrictEqual(legal.map((d) => d.name).sort(), ['privacy', 'refund', 'terms']);
  assert.ok((await api.legal('privacy')).markdown.length > 200);

  // validasi pesan error tampil apa adanya (dalam Bahasa Indonesia)
  await assert.rejects(api.register({ email: 'x', name: 'A', password: 'rahasia123' }), (e) => e.status === 400 && /Email tidak valid/.test(e.message));
  await assert.rejects(api.login('tak@ada.id', 'salah'), (e) => e.status === 401);

  const s = await api.register({ email: 'native@uji.id', name: 'Pengguna Native', phone: '0812', password: 'rahasia123', device: 'iPhone' });
  token = s.token;
  assert.strictEqual((await api.me()).user.email, 'native@uji.id');

  // produk dengan stok lokal
  const store = require('../db');
  const pid = Number(store.db.prepare("INSERT INTO products (name, category, price) VALUES ('Netflix Uji','Streaming',45000)").run().lastInsertRowid);
  store.db.prepare("INSERT INTO stock (product_id, content) VALUES (?, 'u|p')").run(pid);
  store.saveCoupon({ code: 'NATIVE10', type: 'percent', value: 10, minAmount: 0, maxUses: 0, expiresAt: null });

  assert.ok((await api.categories()).includes('Streaming'));
  const list = await api.products('Streaming');
  const p = list.find((x) => x.id === pid);
  assert.ok(p && p.orderable);
  assert.strictEqual((await api.product(pid)).name, 'Netflix Uji');
  assert.deepStrictEqual(await api.checkCoupon(pid, 1, 'native10'), { discount: 4500, total: 40500 });
  await assert.rejects(api.checkCoupon(pid, 1, 'SALAH'), /tidak valid/);

  const { order, pay_url } = await api.createOrder({ productId: pid, qty: 1, coupon: 'NATIVE10' });
  assert.strictEqual(order.amount, 40500);
  assert.match(pay_url, /midtrans/);
  assert.strictEqual(order.status, 'pending');

  await mock.pay('midtrans', `${order.id}-P1`);
  const done = await until(async () => { const o = await api.order(order.id); return o.status === 'paid' && o; });
  assert.deepStrictEqual(done.items, ['u|p']);
  assert.strictEqual((await api.orders())[0].id, order.id);

  // ekspor, ganti password (token baru), hapus akun
  assert.strictEqual(api.exportData && (await api.exportData()).profile.email, 'native@uji.id');
  const ch = await api.changePassword('rahasia123', 'barubaru99');
  assert.strictEqual(expired, 0);
  await assert.rejects(api.me(), (e) => e.status === 401);
  assert.strictEqual(expired, 1, 'onUnauthorized dipanggil saat sesi dicabut');
  token = ch.token;
  await assert.rejects(api.deleteAccount('salah'), (e) => e.status === 401);
  await api.deleteAccount('barubaru99');
  await assert.rejects(api.me(), (e) => e.status === 401);
});

test('klien native: server mati → pesan jaringan yang jelas', async () => {
  const api = mod.createClient({ baseUrl: 'http://127.0.0.1:1', getToken: () => null, timeoutMs: 1500 });
  await assert.rejects(api.products(), (e) => e.status === 0 && /terhubung/.test(e.message));
});

test('util tampilan: format rupiah', () => {
  assert.strictEqual(mod.rupiah(0), 'Rp0');
  assert.strictEqual(mod.rupiah(1500), 'Rp1.500');
  assert.strictEqual(mod.rupiah(1234567), 'Rp1.234.567');
  assert.ok(mod.isOpen('pending') && !mod.isOpen('paid'));
});
