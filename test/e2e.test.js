// Uji ujung-ke-ujung: aplikasi nyata + gateway/agregator tiruan (sandbox/mock-gateways.js) + DB sementara.
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'digit-e2e-'));
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert');
const mockgw = require('../sandbox/mock-gateways');

let app, srv, mock, base;
const store = () => require('../db');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(25); } throw new Error('timeout menunggu kondisi'); };

// klien HTTP kecil dengan cookie jar
function client() {
  const jar = {};
  const send = async (method, path, { form, json, headers = {}, token } = {}) => {
    const h = { ...headers };
    if (Object.keys(jar).length) h.cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (token) h.authorization = 'Bearer ' + token;
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (json) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
    const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [kv] = c.split(';'); const i = kv.indexOf('=');
      const val = kv.slice(i + 1);
      if (!val || /expires=thu, 01 jan 1970/i.test(c)) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = val;
    }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, text, data, loc: res.headers.get('location') || '' };
  };
  return { get: (p, o) => send('GET', p, o), post: (p, o) => send('POST', p, o), del: (p, o) => send('DELETE', p, o), jar };
}

test.before(async () => {
  app = require('../server');
  srv = app.listen(0);
  base = `http://127.0.0.1:${srv.address().port}`;
  mock = await mockgw.start({ appUrl: base });
  process.env.BASE_URL = base;
  process.env.MIDTRANS_API_URL = mock.url;
  process.env.MIDTRANS_SNAP_URL = mock.url;
  process.env.XENDIT_API_URL = mock.url;
  process.env.EXPO_PUSH_URL = mock.url + '/push/send';
  process.env.TRIPAY_API_URL = mock.url + '/tripay';
  process.env.IPAYMU_API_URL = mock.url + '/ipaymu';
});
test.after(async () => { srv.close(); await mock.close(); });

const owner = client();
const staff = client();
let tokenA, orderPaid;

test('admin: login salah ditolak, login benar masuk; staf tidak boleh membuka pengaturan', async () => {
  assert.strictEqual((await owner.post('/admin/login', { form: { username: 'admin', password: 'salah' } })).status, 401);
  const ok = await owner.post('/admin/login', { form: { username: 'admin', password: 'admin' } });
  assert.strictEqual(ok.status, 302);
  assert.strictEqual((await owner.get('/admin')).status, 200);
  assert.strictEqual((await client().get('/admin')).status, 302); // tanpa login → dialihkan

  const r = await owner.post('/admin/admins', { form: { username: 'kasir', password: 'kasir12345', role: 'staff' } });
  assert.match(r.loc, /m=/);
  assert.strictEqual((await staff.post('/admin/login', { form: { username: 'kasir', password: 'kasir12345' } })).status, 302);
  assert.strictEqual((await staff.get('/admin')).status, 200);
  for (const p of ['/admin/settings/toko', '/admin/status', '/admin/admins']) assert.strictEqual((await staff.get(p)).status, 403, p);
  assert.strictEqual((await staff.post('/admin/orders/ORD-X/refund', { form: {} })).status, 403);
});

test('pengaturan: kunci API tersimpan terenkripsi, tampil bermasker, menimpa env', async () => {
  const r = await owner.post('/admin/settings/midtrans', { form: { MIDTRANS_SERVER_KEY: mock.midtransKey } });
  assert.match(r.loc, /m=Tersimpan/);
  const raw = store().db.prepare("SELECT value, secret FROM settings WHERE key='MIDTRANS_SERVER_KEY'").get();
  assert.ok(raw.secret && !raw.value.includes(mock.midtransKey), 'kunci tidak boleh tersimpan polos');
  const page = (await owner.get('/admin/settings/midtrans')).text;
  assert.ok(!page.includes(mock.midtransKey) && page.includes('••••'), 'halaman hanya menampilkan 4 karakter terakhir');
  assert.strictEqual(process.env.MIDTRANS_SERVER_KEY, mock.midtransKey);
  // kosong = tidak berubah
  await owner.post('/admin/settings/midtrans', { form: { MIDTRANS_SERVER_KEY: '' } });
  assert.strictEqual(process.env.MIDTRANS_SERVER_KEY, mock.midtransKey);
  // gateway lain + pemasok
  await owner.post('/admin/settings/xendit', { form: { XENDIT_SECRET_KEY: 'xnd_development_abc123', XENDIT_CALLBACK_TOKEN: mock.xenditToken } });
  const agg = [{ name: 'mockagg', label: 'Mock Agg', url: mock.url + '/agg/order', method: 'POST', body: { p: '{{sku}}', t: '{{ref}}', c: '{{customer}}' }, successValues: ['success'], contentPath: 'data.voucher', balance: { url: mock.url + '/agg/balance', method: 'GET', path: 'data.balance' } }];
  await owner.post('/admin/settings/custom', { form: { SUPPLIERS_JSON: JSON.stringify(agg) } });
  assert.match((await owner.post('/admin/settings/custom', { form: { SUPPLIERS_JSON: '{rusak' } })).text, /JSON tidak valid/);
  assert.match((await owner.post('/admin/settings/pembayaran', { form: { PAYMENT_PRIORITY: 'midtrans,ngawur' } })).text, /tidak dikenal/);
  await owner.post('/admin/settings/pembayaran', { form: { PAYMENT_PRIORITY: 'midtrans,xendit' } });
});

test('go-live: produksi terkunci sampai uji sandbox lulus', async () => {
  // Midtrans: belum diuji → tidak bisa ke produksi
  let r = await owner.post('/admin/integrations/midtrans/mode', { form: { mode: 'production' } });
  assert.match(decodeURIComponent(r.loc), /e=.*uji sandbox/i);
  assert.notStrictEqual(process.env.MIDTRANS_IS_PRODUCTION, 'true');
  // Xendit: kunci produksi ditolak sebelum uji
  r = await owner.post('/admin/settings/xendit', { form: { XENDIT_SECRET_KEY: 'xnd_production_zzz' } });
  assert.match(r.text, /ditolak/);
  assert.strictEqual(process.env.XENDIT_SECRET_KEY, 'xnd_development_abc123');
  // Uji koneksi
  for (const id of ['midtrans', 'xendit', 'mockagg']) {
    const t = await owner.post(`/admin/integrations/${id}/test`);
    assert.match(decodeURIComponent(t.loc), /m=.*sukses/, id + ': ' + t.loc);
  }
  assert.ok(store().db.prepare("SELECT 1 FROM integration_checks WHERE integration='midtrans' AND mode='sandbox' AND ok=1").get());
  // Setelah lulus: boleh ke produksi (lalu balik, karena mock)
  r = await owner.post('/admin/integrations/midtrans/mode', { form: { mode: 'production' } });
  assert.match(decodeURIComponent(r.loc), /m=.*PRODUKSI/);
  assert.strictEqual(process.env.MIDTRANS_IS_PRODUCTION, 'true');
  await owner.post('/admin/integrations/midtrans/mode', { form: { mode: 'sandbox' } });
  assert.strictEqual(process.env.MIDTRANS_IS_PRODUCTION, 'false');
  // Kunci salah → uji gagal tercatat
  await owner.post('/admin/settings/midtrans', { form: { MIDTRANS_SERVER_KEY: 'SALAH' } });
  const bad = await owner.post('/admin/integrations/midtrans/test');
  assert.match(decodeURIComponent(bad.loc), /e=.*gagal/);
  await owner.post('/admin/settings/midtrans', { form: { MIDTRANS_SERVER_KEY: mock.midtransKey } });
  assert.match((await owner.get('/admin/status')).text, /Mock Agg/);
});

test('dokumen hukum: halaman, API, dan data penjual', async () => {
  const c = client();
  for (const d of ['privacy', 'terms', 'refund']) {
    const r = await c.get('/legal/' + d);
    assert.strictEqual(r.status, 200);
    assert.match(r.text, /<h2>1\./);
  }
  assert.strictEqual((await c.get('/legal/ngawur')).status, 404);
  assert.match((await c.get('/legal/privacy')).text, /isi di Pengaturan/);
  await owner.post('/admin/settings/legal', { form: { LEGAL_COMPANY: 'PT Uji Coba', LEGAL_EMAIL: 'privasi@uji.id', LEGAL_ADDRESS: 'Jakarta' } });
  const p = (await c.get('/legal/privacy')).text;
  assert.ok(p.includes('PT Uji Coba') && p.includes('privasi@uji.id') && !p.includes('isi di Pengaturan'));
  const api = await c.get('/api/v1/legal/privacy');
  assert.ok(api.data.markdown.includes('UU PDP') || api.data.markdown.includes('Pelindungan Data Pribadi'));
  assert.strictEqual((await c.get('/api/v1/legal')).data.length, 3);
  assert.ok((await c.get('/')).text.includes('/legal/privacy'));
  // teks kustom + XSS di-escape
  await owner.post('/admin/settings/legal', { form: { LEGAL_TERMS: '## Judul\n<script>alert(1)</script>' } });
  const t = (await c.get('/legal/terms')).text;
  assert.ok(!t.includes('<script>alert') && t.includes('&lt;script&gt;'));
});

test('PWA (Android & iPhone): manifest, service worker, ikon, tag iOS', async () => {
  const c = client();
  const m = await c.get('/manifest.webmanifest');
  assert.strictEqual(JSON.parse(m.text).display, 'standalone');
  assert.strictEqual((await c.get('/sw.js')).status, 200);
  assert.strictEqual((await c.get('/icon-192.png')).status, 200);
  assert.match((await c.get('/')).text, /apple-touch-icon[\s\S]*apple-mobile-web-app-capable/);
});

test('API pembeli: daftar, masuk, validasi, akses terbatas', async () => {
  const c = client();
  const reg = (o) => c.post('/api/v1/auth/register', { json: { email: 'budi@uji.id', name: 'Budi', password: 'rahasia123', accept_terms: true, device: 'iPhone', ...o } });
  assert.strictEqual((await reg({ accept_terms: false })).status, 400);
  assert.strictEqual((await reg({ password: '123' })).status, 400);
  assert.strictEqual((await reg({ email: 'bukan-email' })).status, 400);
  const ok = await reg({});
  assert.strictEqual(ok.status, 201);
  assert.ok(ok.data.token && ok.data.user.email === 'budi@uji.id' && !('pass_hash' in ok.data.user));
  assert.strictEqual((await reg({})).status, 400); // email dobel
  assert.strictEqual((await c.post('/api/v1/auth/login', { json: { email: 'budi@uji.id', password: 'salah' } })).status, 401);
  const login = await c.post('/api/v1/auth/login', { json: { email: 'BUDI@uji.id', password: 'rahasia123', device: 'Pixel' } });
  tokenA = login.data.token;
  assert.strictEqual((await c.get('/api/v1/me', { token: tokenA })).data.user.name, 'Budi');
  assert.strictEqual((await c.get('/api/v1/me')).status, 401);
  assert.strictEqual((await c.get('/api/v1/me', { token: 'palsu' })).status, 401);
  assert.strictEqual((await c.get('/api/v1/orders')).status, 401);
  assert.strictEqual((await c.post('/api/v1/orders', { json: { product_id: 1 } })).status, 401);
  assert.strictEqual((await c.post('/api/v1/auth/login', { headers: { 'content-type': 'application/json' }, json: undefined })).status === 401, true);
  assert.strictEqual((await c.get('/api/v1/tidakada')).status, 404);
});

test('API: beli → bayar (webhook Midtrans) → produk terkirim; milik akun lain tak bisa dibaca', async () => {
  const c = client();
  const pid = store().db.prepare("INSERT INTO products (name, category, price) VALUES ('Akun Uji','Uji',20000)").run().lastInsertRowid;
  await owner.post(`/admin/products/${pid}/stock`, { form: { items: 'user1|pw1\nuser2|pw2' } });
  const list = await c.get('/api/v1/products');
  const p = list.data.find((x) => x.id === Number(pid));
  assert.ok(p && p.orderable && !('available' in p));

  const o = await c.post('/api/v1/orders', { token: tokenA, json: { product_id: Number(pid), qty: 1 } });
  assert.strictEqual(o.status, 201, o.text);
  assert.match(o.data.pay_url, /\/mock\/pay\/midtrans\//);
  assert.strictEqual(o.data.order.status, 'pending');
  const id = o.data.order.id;
  assert.strictEqual((await c.get('/api/v1/orders/' + id, { token: tokenA })).data.items.length, 0);

  await mock.pay('midtrans', `${id}-P1`);
  const done = await until(async () => { const r = await c.get('/api/v1/orders/' + id, { token: tokenA }); return r.data.status === 'paid' && r.data; });
  assert.deepStrictEqual(done.items, ['user1|pw1']);
  orderPaid = id;

  assert.strictEqual((await c.get('/api/v1/orders', { token: tokenA })).data[0].id, id);
  const other = (await c.post('/api/v1/auth/register', { json: { email: 'lain@uji.id', name: 'Lain', password: 'rahasia123', accept_terms: true } })).data.token;
  assert.strictEqual((await c.get('/api/v1/orders/' + id, { token: other })).status, 404);
  assert.strictEqual((await c.get('/api/v1/orders', { token: other })).data.length, 0);
});

test('failover pembayaran: Midtrans gangguan → tagihan dibuat di Xendit', async () => {
  const c = client();
  const pid = store().db.prepare('SELECT id FROM products WHERE name = ?').get('Akun Uji').id;
  await owner.post(`/admin/products/${pid}/stock`, { form: { items: 'user3|pw3' } });
  mock.state.fail.midtrans = true;
  try {
    const o = await c.post('/api/v1/orders', { token: tokenA, json: { product_id: pid } });
    assert.strictEqual(o.status, 201);
    assert.match(o.data.pay_url, /\/mock\/pay\/xendit\//);
  } finally { mock.state.fail.midtrans = false; require('../http').health.good('pay:midtrans'); } // circuit breaker dibersihkan
});

test('pembayaran ganda → refund otomatis lewat gateway, tepat sekali', async () => {
  const c = client();
  const pid = store().db.prepare('SELECT id FROM products WHERE name = ?').get('Akun Uji').id;
  await owner.post(`/admin/products/${pid}/stock`, { form: { items: 'user4|pw4' } });
  const o = await c.post('/api/v1/orders', { token: tokenA, json: { product_id: pid } });
  const id = o.data.order.id;
  const second = await c.post(`/api/v1/orders/${id}/pay`, { token: tokenA });
  assert.match(second.data.pay_url, /xendit/);
  await mock.pay('midtrans', `${id}-P1`);
  await until(async () => store().getOrder(id).status === 'paid');
  await mock.pay('xendit', `${id}-P2`); // bayar lagi di tagihan kedua
  const rf = await until(() => store().db.prepare("SELECT * FROM refunds WHERE order_id = ? AND status = 'succeeded'").get(id));
  assert.strictEqual(rf.provider, 'xendit');
  assert.strictEqual(rf.attempt_ref, `${id}-P2`);
  assert.strictEqual(mock.state.refunds.filter((r) => r.provider === 'xendit' && r.reason === 'DUPLICATE').length >= 1, true);
  const before = mock.state.refunds.length;
  await mock.pay('xendit', `${id}-P2`); // webhook diulang
  await sleep(150);
  assert.strictEqual(mock.state.refunds.length, before, 'webhook ulang tidak boleh refund lagi');
  assert.strictEqual(store().getOrder(id).status, 'paid', 'pesanan utama tetap lunas & terkirim');
});

test('refund: stok tak ada → refund via gateway; produk terkirim → ditolak; gagal → bisa manual', async () => {
  const c = client();
  // produk dengan sumber pemasok yang sudah kosong → paid_nostock
  const pid = Number(store().db.prepare("INSERT INTO products (name, category, price) VALUES ('Voucher Kosong','Uji',30000)").run().lastInsertRowid);
  await owner.post(`/admin/products/${pid}/sources`, { form: { supplier: 'mockagg', sku: 'SKU1', priority: 1 } });
  mock.state.stock.length = 0;
  const o = await c.post('/api/v1/orders', { token: tokenA, json: { product_id: pid } });
  const id = o.data.order.id;
  await mock.pay('midtrans', `${id}-P1`);
  await until(async () => store().getOrder(id).status === 'paid_nostock');

  // Produk terkirim tidak boleh direfund otomatis
  const deny = await owner.post(`/admin/orders/${orderPaid}/refund`, { form: { reason: 'coba', attempt: `${orderPaid}-P1` } });
  assert.match(decodeURIComponent(deny.loc), /e=.*terkirim/i);

  // Refund gagal di gateway → status failed, pesanan tetap
  mock.state.refundFail = true;
  const f = await owner.post(`/admin/orders/${id}/refund`, { form: { reason: 'Stok tidak tersedia', attempt: `${id}-P1` } });
  assert.match(decodeURIComponent(f.loc), /e=.*ditolak/i);
  assert.strictEqual(store().getOrder(id).status, 'paid_nostock');
  assert.strictEqual(store().db.prepare("SELECT status FROM refunds WHERE order_id = ?").get(id).status, 'failed');

  // Gateway pulih → coba lagi (otomatis)
  mock.state.refundFail = false;
  const ok = await owner.post(`/admin/orders/${id}/refund`, { form: { reason: 'Stok tidak tersedia', attempt: `${id}-P1` } });
  assert.match(decodeURIComponent(ok.loc), /m=/);
  assert.strictEqual(store().getOrder(id).status, 'refunded');
  assert.strictEqual(store().db.prepare("SELECT COUNT(*) c FROM refunds WHERE order_id = ? AND status='succeeded'").get(id).c, 1);
  // Tidak bisa dua kali
  const again = await owner.post(`/admin/orders/${id}/refund`, { form: { reason: 'lagi', attempt: `${id}-P1` } });
  assert.match(decodeURIComponent(again.loc), /e=/);
  assert.strictEqual(mock.state.refunds.filter((r) => r.ref === `${id}-P1`).length, 1);
  assert.match((await owner.get('/admin/orders/' + id)).text, /Refund/);

  // Refund manual (uang dikembalikan di dashboard gateway)
  const o2 = await c.post('/api/v1/orders', { token: tokenA, json: { product_id: pid } });
  const id2 = o2.data.order.id;
  await mock.pay('midtrans', `${id2}-P1`);
  await until(async () => store().getOrder(id2).status === 'paid_nostock');
  const man = await owner.post(`/admin/orders/${id2}/refund`, { form: { reason: 'via dashboard', attempt: `${id2}-P1`, manual: '1' } });
  assert.match(decodeURIComponent(man.loc), /m=/);
  assert.strictEqual(store().db.prepare("SELECT provider_ref FROM refunds WHERE order_id = ?").get(id2).provider_ref, 'manual');
  assert.strictEqual(mock.state.refunds.filter((r) => r.ref === `${id2}-P1`).length, 0, 'refund manual tidak memanggil gateway');
});

test('akun: ganti password mencabut sesi lama, ekspor data, hapus akun', async () => {
  const c = client();
  const reg = await c.post('/api/v1/auth/register', { json: { email: 'ani@uji.id', name: 'Ani', password: 'rahasia123', accept_terms: true } });
  const t1 = reg.data.token;
  const ch = await c.post('/api/v1/me/password', { token: t1, json: { old_password: 'rahasia123', new_password: 'barubaru99' } });
  assert.strictEqual(ch.status, 200);
  assert.strictEqual((await c.get('/api/v1/me', { token: t1 })).status, 401, 'sesi lama dicabut');
  const t2 = ch.data.token;
  assert.strictEqual((await c.post('/api/v1/me/password', { token: t2, json: { old_password: 'salah', new_password: 'xxxxxxxx1' } })).status, 400);
  const ex = await c.get('/api/v1/me/export', { token: t2 });
  assert.strictEqual(ex.data.profile.email, 'ani@uji.id');
  assert.ok(!JSON.stringify(ex.data).includes('pass_hash'));
  assert.strictEqual((await c.del('/api/v1/me', { token: t2, json: { password: 'salah' } })).status, 401);
  assert.strictEqual((await c.del('/api/v1/me', { token: t2, json: { password: 'barubaru99' } })).status, 200);
  assert.strictEqual((await c.get('/api/v1/me', { token: t2 })).status, 401);
  assert.strictEqual((await c.post('/api/v1/auth/login', { json: { email: 'ani@uji.id', password: 'barubaru99' } })).status, 401);
  assert.strictEqual(store().db.prepare("SELECT COUNT(*) c FROM users WHERE email='ani@uji.id'").get().c, 0);
});

test('akun web: daftar → pesanan terhubung ke akun → hapus akun mempertahankan transaksi tanpa tautan', async () => {
  const c = client();
  assert.strictEqual((await c.get('/account')).status, 302);
  assert.match((await c.post('/register', { form: { name: 'Cici', email: 'cici@uji.id', password: 'rahasia123' } })).text, /menyetujui/);
  const r = await c.post('/register', { form: { name: 'Cici', email: 'cici@uji.id', password: 'rahasia123', accept: '1' } });
  assert.strictEqual(r.status, 302);
  assert.ok(c.jar.usr);
  const pid = store().db.prepare('SELECT id FROM products WHERE name = ?').get('Akun Uji').id;
  await owner.post(`/admin/products/${pid}/stock`, { form: { items: 'user5|pw5' } });
  const co = await c.post('/checkout', { form: { product_id: pid, name: 'Cici', contact: 'cici@uji.id', qty: 1 } });
  const id = /order\/(ORD-[A-F0-9]+)/.exec(co.loc)[1];
  assert.ok(store().getOrder(id).user_id);
  assert.match((await c.get('/account')).text, new RegExp('Akun Uji'));
  assert.strictEqual((await c.post('/account/delete', { form: { password: 'salah' } })).status, 401);
  assert.strictEqual((await c.post('/account/delete', { form: { password: 'rahasia123' } })).status, 302);
  assert.strictEqual(store().getOrder(id).user_id, null);
  assert.ok(store().getOrder(id), 'riwayat transaksi tetap ada');
  assert.strictEqual((await c.get('/account')).status, 302);
});

test('keamanan sesi: cookie admin tidak bisa dipakai sebagai sesi pembeli & sebaliknya; logout mencabut', async () => {
  const c = client();
  c.jar.usr = owner.jar.adm; // token admin dipakai di cookie pembeli
  assert.strictEqual((await c.get('/account')).status, 302);
  const d = client();
  d.jar.adm = (await client().post('/api/v1/auth/login', { json: { email: 'budi@uji.id', password: 'rahasia123' } })).data.token;
  assert.strictEqual((await d.get('/admin')).status, 302);
  const tmp = client();
  await tmp.post('/admin/login', { form: { username: 'kasir', password: 'kasir12345' } });
  const cookie = tmp.jar.adm;
  await tmp.post('/admin/logout');
  const reuse = client(); reuse.jar.adm = cookie;
  assert.strictEqual((await reuse.get('/admin')).status, 302, 'token lama tidak berlaku setelah logout');
});

test('push: daftar token, terkirim saat pesanan siap & refund, tanpa isi produk, token mati dibersihkan', async () => {
  const c = client();
  const reg = (email) => c.post('/api/v1/auth/register', { json: { email, name: 'Pu', password: 'rahasia123', accept_terms: true } }).then((r) => r.data.token);
  const t1 = await reg('push1@uji.id');
  const GOOD = 'ExponentPushToken[abcdEFGH12345678]';
  const DEAD = 'ExponentPushToken[DeadToken12345678]';

  // validasi & autentikasi
  assert.strictEqual((await c.post('/api/v1/auth/login', { json: {} })).status, 401);
  const put = (token, body) => fetch(base + '/api/v1/me/push-token', { method: 'PUT', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  assert.strictEqual((await put(null, { token: GOOD })).status, 401);
  assert.strictEqual((await put(t1, { token: 'sembarang' })).status, 400);
  assert.strictEqual((await put(t1, { token: GOOD, platform: 'ios' })).status, 200);
  assert.strictEqual((await put(t1, { token: DEAD, platform: 'android' })).status, 200);

  // pesanan lunas → push ke semua perangkat akun, isi produk tidak ikut
  const pid = store().db.prepare("INSERT INTO products (name, category, price) VALUES ('Push Produk','Uji',15000)").run().lastInsertRowid;
  await owner.post(`/admin/products/${pid}/stock`, { form: { items: 'RAHASIA-PUSH|pw' } });
  mock.state.pushes.length = 0;
  const o = await c.post('/api/v1/orders', { token: t1, json: { product_id: Number(pid) } });
  const id = o.data.order.id;
  await mock.pay(o.data.pay_url.includes('xendit') ? 'xendit' : 'midtrans', `${id}-P1`);
  await until(() => mock.state.pushes.length >= 2);
  assert.deepStrictEqual(mock.state.pushes.map((m) => m.to).sort(), [DEAD, GOOD].sort());
  const m = mock.state.pushes.find((x) => x.to === GOOD);
  assert.match(m.title, /siap/i);
  assert.strictEqual(m.data.orderId, id);
  assert.ok(!JSON.stringify(mock.state.pushes).includes('RAHASIA-PUSH'), 'isi produk tidak boleh ada di payload push');
  assert.deepStrictEqual(store().db.prepare('SELECT token FROM push_tokens WHERE user_id = (SELECT user_id FROM orders WHERE id = ?)').all(id).map((r) => r.token), [GOOD], 'token DeviceNotRegistered dihapus');

  // tidak terkirim dua kali untuk status yang sama
  const n = mock.state.pushes.length;
  await require('../notify').announce(id);
  assert.strictEqual(mock.state.pushes.length, n);

  // pindah akun di perangkat yang sama → token berpindah; akun lama tak lagi menerima
  const t2 = await reg('push2@uji.id');
  assert.strictEqual((await put(t2, { token: GOOD })).status, 200);
  const u2 = (await c.get('/api/v1/me', { token: t2 })).data.user.id;
  assert.strictEqual(store().db.prepare('SELECT user_id FROM push_tokens WHERE token = ?').get(GOOD).user_id, u2, 'token pindah ke akun yang sedang masuk');

  // cabut token (logout) hanya bisa oleh pemiliknya
  const del = (token, body) => fetch(base + '/api/v1/me/push-token', { method: 'DELETE', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  await del(t1, { token: GOOD }); // bukan pemilik → tidak berefek
  assert.ok(store().db.prepare('SELECT 1 FROM push_tokens WHERE token = ?').get(GOOD));
  await del(t2, { token: GOOD });
  assert.ok(!store().db.prepare('SELECT 1 FROM push_tokens WHERE token = ?').get(GOOD));

  // hapus akun membersihkan token
  await put(t2, { token: GOOD });
  await c.del('/api/v1/me', { token: t2, json: { password: 'rahasia123' } });
  assert.ok(!store().db.prepare('SELECT 1 FROM push_tokens WHERE token = ?').get(GOOD));
});

// ---------- Tampilan baru: gambar, promo, dasbor, stok, etalase ----------
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString('base64');
const form = (o) => ({ name: 'Produk Gambar', category: 'Uji', price: '20000', description: 'd', active: '1', ...o });

test('unggah gambar produk: valid diterima & disajikan aman; berkas berbahaya/oversize/URL jahat ditolak', async () => {
  const c = client();
  const ok = await owner.post('/admin/products', { form: form({ image_data: PNG, compare_at: '30000', badge: 'Promo', featured: '1' }) });
  assert.strictEqual(ok.status, 302);
  const id = Number(/products\/(\d+)/.exec(ok.loc)[1]);
  const p = store().getProduct(id);
  assert.match(p.image, /^\/uploads\/[a-f0-9]{20}\.png$/);
  const res = await fetch(base + p.image);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('cache-control'), /immutable/);

  // HTML yang menyamar sebagai PNG
  const html = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script>'.padEnd(64, ' ')).toString('base64');
  const bad = await owner.post('/admin/products', { form: form({ name: 'Palsu', image_data: html }) });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.text, /bukan gambar/);
  assert.ok(!store().db.prepare("SELECT 1 FROM products WHERE name = 'Palsu'").get(), 'produk tidak boleh dibuat bila gambar ditolak');
  // SVG & tipe lain ditolak (bisa memuat skrip)
  assert.strictEqual((await owner.post('/admin/products', { form: form({ name: 'Svg', image_data: 'data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') }) })).status, 400);
  // terlalu besar
  const big = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(800 * 1024)]).toString('base64');
  const huge = await owner.post('/admin/products', { form: form({ name: 'Besar', image_data: big }) });
  assert.strictEqual(huge.status, 400); assert.match(huge.text, /terlalu besar/);
  const monster = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1300 * 1024)]).toString('base64');
  assert.strictEqual((await owner.post('/admin/products', { form: form({ name: 'Raksasa', image_data: monster }) })).status, 413);
  assert.strictEqual((await client().post('/track', { form: { id: 'x', contact: 'y'.repeat(150 * 1024) } })).status, 413, 'form publik tetap dibatasi 100kb');
  // unggahan realistis (~250 KB hasil kompres browser) harus lolos
  const real = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(250 * 1024, 7)]).toString('base64');
  assert.strictEqual((await owner.post('/admin/products', { form: form({ name: 'Realistis', image_data: real }) })).status, 302);
  // URL: hanya https
  for (const u of ['javascript:alert(1)', 'http://x.test/a.png', 'data:text/html,hi', '//x.test/a.png']) {
    assert.strictEqual((await owner.post('/admin/products', { form: form({ name: 'U' + u.length, image_url: u }) })).status, 400, u);
  }
  assert.strictEqual((await owner.post(`/admin/products/${id}`, { form: form({ image_url: 'https://cdn.contoh.id/a.jpg' }) })).status, 302);
  assert.strictEqual(store().getProduct(id).image, 'https://cdn.contoh.id/a.jpg');
  // hapus gambar → sampul otomatis
  await owner.post(`/admin/products/${id}`, { form: form({ image_remove: '1', image_url: '' }) });
  assert.strictEqual(store().getProduct(id).image, null);
  // staf boleh mengelola produk; anonim tidak
  assert.strictEqual((await client().post('/admin/products', { form: form({ name: 'Anon' }) })).status, 302);
  assert.ok(!store().db.prepare("SELECT 1 FROM products WHERE name = 'Anon'").get());
  // path traversal pada /uploads
  assert.strictEqual((await c.get('/uploads/..%2f..%2fshop.db')).status, 404);
  assert.strictEqual((await c.get('/uploads/.secret')).status, 404);
});

test('promo: harga coret, diskon %, label, unggulan tampil di toko & API; input tak valid dibersihkan', async () => {
  const c = client();
  const mk = async (o) => Number(/products\/(\d+)/.exec((await owner.post('/admin/products', { form: form(o) })).loc)[1]);
  const promo = await mk({ name: 'Promo Besar', price: '15000', compare_at: '25000', badge: 'Terlaris', featured: '1' });
  const noPromo = await mk({ name: 'Tanpa Promo', price: '15000', compare_at: '9000', badge: '<img src=x onerror=alert(1)>' }); // coret < jual & label tak dikenal
  const pa = store().getProduct(promo), pb = store().getProduct(noPromo);
  assert.deepStrictEqual([pa.compare_at, pa.badge, pa.featured], [25000, 'Terlaris', 1]);
  assert.deepStrictEqual([pb.compare_at, pb.badge], [null, ''], 'harga coret ≤ harga jual & label di luar daftar ditolak');
  await owner.post(`/admin/products/${promo}/stock`, { form: { items: 'a|b\nc|d' } });
  await owner.post(`/admin/products/${noPromo}/stock`, { form: { items: 'a|b' } });
  const api = (await c.get('/api/v1/products')).data;
  const ap = api.find((x) => x.id === promo), bp = api.find((x) => x.id === noPromo);
  assert.deepStrictEqual([ap.compare_at, ap.discount_percent, ap.badge, ap.featured], [25000, 40, 'Terlaris', true]);
  assert.deepStrictEqual([bp.compare_at, bp.discount_percent], [null, 0]);
  assert.ok(ap.cover.c1 && ap.cover.title === 'Promo' && 'image' in ap);
  assert.ok(api.findIndex((x) => x.id === promo) < api.findIndex((x) => x.id === noPromo), 'unggulan tampil lebih dulu');
  const home = (await c.get('/')).text;
  assert.match(home, /-40%/); assert.match(home, /Rp25\.000/); assert.match(home, /tag-label">Terlaris/);
  assert.ok(home.includes(`/img/p/${promo}.svg`));
  const page = (await c.get('/product/' + promo)).text;
  assert.match(page, /Hemat 40%/); assert.match(page, /id="buy"/); assert.match(page, /data-price="15000"/);
});

test('sampul otomatis: SVG aman, nama berbahaya di-escape; nama produk berbahaya tak menjadi XSS di toko/admin', async () => {
  const c = client();
  const evil = '<script>alert(1)</script>"\'';
  const id = Number(/products\/(\d+)/.exec((await owner.post('/admin/products', { form: form({ name: evil, category: '<b>x</b>', description: '<img src=x onerror=alert(1)>' }) })).loc)[1]);
  await owner.post(`/admin/products/${id}/stock`, { form: { items: 'x|y' } });
  const svgRes = await fetch(base + `/img/p/${id}.svg`);
  assert.strictEqual(svgRes.headers.get('content-type').split(';')[0], 'image/svg+xml');
  assert.match(svgRes.headers.get('content-security-policy'), /default-src 'none'/);
  const svg = await svgRes.text();
  assert.ok(!svg.includes('<script>') && svg.includes('&lt;script&gt;'));
  assert.strictEqual((await fetch(base + '/img/p/99999.svg')).status, 404);
  for (const [who, path] of [[c, '/'], [c, '/product/' + id], [owner, '/admin/products'], [owner, '/admin/stock'], [owner, '/admin/products/' + id], [owner, '/admin']]) {
    const t = (await who.get(path)).text;
    assert.ok(!t.includes('<script>alert(1)') && !t.includes('<img src=x onerror') && !t.includes('<b>x</b>'), 'XSS di ' + path);
  }
});

test('dasbor, stok, dan pesanan admin: tampil, menghitung, dan hak akses', async () => {
  const dash = await owner.get('/admin');
  assert.strictEqual(dash.status, 200);
  assert.match(dash.text, /Pendapatan per hari/); assert.match(dash.text, /Perlu perhatian/); assert.match(dash.text, /<svg class="chart"/);
  assert.match(dash.text, /Dasbor/); assert.match(dash.text, /nav-item active/);
  assert.strictEqual((await owner.get('/admin?days=7')).status, 200);
  assert.strictEqual((await owner.get('/admin?days=abc')).status, 200);
  assert.strictEqual((await staff.get('/admin')).status, 200);
  assert.ok(!(await staff.get('/admin')).text.includes('/admin/settings'), 'menu Pengaturan disembunyikan untuk Staf');
  assert.ok((await owner.get('/admin')).text.includes('/admin/settings'));
  assert.strictEqual((await client().get('/admin')).status, 302);

  const d = store().dashboard(30);
  assert.strictEqual(d.daily.length, 30);
  assert.ok(d.cur.orders >= 1 && d.cur.revenue > 0, 'ada pesanan lunas dari tes sebelumnya');
  assert.strictEqual(d.cur.revenue, store().db.prepare("SELECT SUM(amount) s FROM orders WHERE status LIKE 'paid%' AND date(created_at) >= date('now','-29 days')").get().s);

  // stok
  const st = await owner.get('/admin/stock');
  assert.strictEqual(st.status, 200); assert.match(st.text, /Stok produk/);
  const pid = store().db.prepare("SELECT id FROM products WHERE name = 'Akun Uji'").get().id;
  const before = store().stockOverview().find((p) => p.id === pid).available;
  const add = await owner.post(`/admin/products/${pid}/stock?back=stock`, { form: { items: 'q1|p\nq2|p\n\n  \nq3|p' } });
  assert.match(add.loc, /^\/admin\/stock\?m=/);
  assert.strictEqual(store().stockOverview().find((p) => p.id === pid).available, before + 3, 'baris kosong diabaikan');
  for (const f of ['low', 'habis', 'via']) assert.strictEqual((await owner.get('/admin/stock?filter=' + f)).status, 200);

  // pesanan: filter, flag, halaman, pencarian; XSS di kueri
  for (const q of ['?status=paid', '?status=paid_nostock', '?flag=refund_failed', '?flag=dup', '?flag=unknown', '?flag=ngawur', '?page=999', '?q=%27%20OR%201%3D1--', '?q=%3Cscript%3E']) {
    const r = await owner.get('/admin/orders' + q);
    assert.strictEqual(r.status, 200, q);
    assert.ok(!r.text.includes('<script>alert') && !r.text.includes("<script>'"), q);
  }
  const lowN = store().db.prepare("SELECT COUNT(*) c FROM orders").get().c;
  assert.match((await owner.get('/admin/orders')).text, new RegExp(`${lowN} pesanan`));
});

test('etalase: pencarian, kategori, produk habis tanpa tombol beli, kupon langsung', async () => {
  const c = client();
  const sold = Number(/products\/(\d+)/.exec((await owner.post('/admin/products', { form: form({ name: 'Barang Habis XYZ', category: 'Uji' }) })).loc)[1]);
  const ready = Number(/products\/(\d+)/.exec((await owner.post('/admin/products', { form: form({ name: 'Barang Siap XYZ', category: 'Uji', price: '12000' }) })).loc)[1]);
  await owner.post(`/admin/products/${ready}/stock`, { form: { items: 'k|l' } });
  const q = (await c.get('/?q=xyz')).text;
  assert.ok(q.includes('Barang Siap XYZ') && q.includes('Barang Habis XYZ'));
  assert.ok(!q.includes('Netflix Premium'), 'pencarian menyaring');
  assert.match((await c.get('/?q=tidakadaproduknya')).text, /Produk tidak ditemukan/);
  assert.match((await c.get('/?c=Uji')).text, /Barang Siap XYZ/);
  const soldPage = (await c.get('/product/' + sold)).text;
  assert.ok(!soldPage.includes('id="buy"') && /sedang habis/i.test(soldPage));
  const readyPage = (await c.get('/product/' + ready)).text;
  assert.ok(readyPage.includes('id="buy"') && readyPage.includes('sticky-buy'));
  // checkout tamu dari halaman produk dengan kupon, lalu masuk ke halaman pesanan dengan langkah progres
  store().saveCoupon({ code: 'TOKO20', type: 'percent', value: 20, minAmount: 0, maxUses: 0, expiresAt: null });
  assert.deepStrictEqual((await c.get(`/coupon/check?product_id=${ready}&qty=1&code=toko20`)).data, { ok: true, discount: 2400, total: 9600 });
  const co = await c.post('/checkout', { form: { product_id: ready, name: 'Tamu', contact: 'tamu@uji.id', qty: 1, coupon: 'TOKO20' } });
  assert.strictEqual(co.status, 302);
  const page = (await c.get(co.loc.replace(base, ''))).text;
  assert.match(page, /class="stepper"/); assert.match(page, /Rp9\.600/); assert.match(page, /Kupon TOKO20/);
  // produk tak aktif tidak tampil & tidak bisa dibeli
  await owner.post(`/admin/products/${ready}/toggle`);
  assert.strictEqual((await c.get('/product/' + ready)).status, 404);
  assert.ok(!(await c.get('/')).text.includes('Barang Siap XYZ'));
});

// ---------- Gateway tambahan: Tripay & iPaymu ----------
const withPriority = async (order, fn) => {
  const settings = require('../settings'), { health } = require('../http');
  settings.set('PAYMENT_PRIORITY', order, 'uji');
  try { await fn(); } finally { settings.set('PAYMENT_PRIORITY', '', 'uji'); for (const n of ['tripay', 'ipaymu', 'midtrans', 'xendit']) health.good('pay:' + n); mock.state.fail.tripay = mock.state.fail.ipaymu = false; }
};
const buyVia = async (c, token, productName) => {
  const pid = store().db.prepare('SELECT id FROM products WHERE name = ?').get(productName).id;
  await owner.post(`/admin/products/${pid}/stock`, { form: { items: 'gw1|a\ngw2|b\ngw3|c' } });
  const o = await c.post('/api/v1/orders', { token, json: { product_id: pid } });
  assert.strictEqual(o.status, 201, o.text);
  return o.data;
};

test('Tripay: tagihan, webhook bertanda tangan, biaya pelanggan, tanda tangan palsu, nominal salah, polling status', async () => {
  const c = client();
  const settings = require('../settings');
  for (const [k, v] of Object.entries({ TRIPAY_API_KEY: mock.tripay.apiKey, TRIPAY_PRIVATE_KEY: mock.tripay.privateKey, TRIPAY_MERCHANT_CODE: mock.tripay.merchant })) settings.set(k, v, 'uji');
  await withPriority('tripay,midtrans,xendit', async () => {
    // uji koneksi: kunci benar lulus, kunci salah gagal dengan pesan jelas
    const integ = require('../integrations');
    assert.strictEqual((await integ.test('tripay', 'uji')).ok, true);
    settings.set('TRIPAY_API_KEY', 'salah', 'uji');
    const bad = await integ.test('tripay', 'uji'); assert.strictEqual(bad.ok, false); assert.match(bad.detail, /401/);
    settings.set('TRIPAY_API_KEY', mock.tripay.apiKey, 'uji');

    const d = await buyVia(c, tokenA, 'Akun Uji');
    assert.match(d.pay_url, /\/mock\/pay\/tripay\//);
    const id = d.order.id, ref = `${id}-P1`;
    const att = store().getAttempt(ref);
    assert.strictEqual(att.provider, 'tripay'); assert.match(att.ext_ref, /^T\d+$/, 'reference Tripay tersimpan');

    // tanda tangan palsu ditolak, pesanan tetap menunggu
    assert.strictEqual((await mock.pay('tripay', ref, { badSignature: true })).status, 403);
    assert.strictEqual(store().getOrder(id).status, 'pending');
    // tanpa tanda tangan sama sekali
    assert.strictEqual((await fetch(base + '/pay/tripay/notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ merchant_ref: ref, status: 'PAID', total_amount: 20000 }) })).status, 403);
    assert.strictEqual(store().getOrder(id).status, 'pending');

    // pembayaran sah dengan biaya yang dibebankan ke pelanggan (total_amount − fee_customer = nominal pesanan)
    const r = await mock.pay('tripay', ref, { feeCustomer: 750 });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(await r.json(), { success: true }, 'Tripay mewajibkan balasan {"success":true}');
    const done = await until(async () => { const x = await c.get('/api/v1/orders/' + id, { token: tokenA }); return x.data.status === 'paid' && x.data; });
    assert.strictEqual(done.items.length, 1);
    await mock.pay('tripay', ref, { feeCustomer: 750 }); // webhook diulang
    assert.strictEqual(store().allocatedCount(id), 1, 'tidak mengalokasi ganda');

    // nominal tidak cocok → ditolak
    const d2 = await buyVia(c, tokenA, 'Akun Uji');
    assert.strictEqual((await mock.pay('tripay', `${d2.order.id}-P1`, { amount: 1 })).status, 400);
    assert.strictEqual(store().getOrder(d2.order.id).status, 'pending');

    // webhook hilang → halaman pesanan menanyakan status ke Tripay
    const d3 = await buyVia(c, tokenA, 'Akun Uji');
    mock.state.tripay.get(`${d3.order.id}-P1`).status = 'PAID';
    const polled = await c.get('/api/v1/orders/' + d3.order.id, { token: tokenA });
    assert.strictEqual(polled.data.status, 'paid', 'polling status Tripay');
  });
});

test('Tripay: gangguan → failover ke gateway berikutnya; pembayaran ganda → refund API tidak tersedia, jalur manual', async () => {
  const c = client();
  await withPriority('tripay,midtrans,xendit', async () => {
    mock.state.fail.tripay = true;
    const f = await buyVia(c, tokenA, 'Akun Uji');
    assert.match(f.pay_url, /midtrans/, 'pindah ke Midtrans saat Tripay gangguan');
    mock.state.fail.tripay = false; require('../http').health.good('pay:tripay');

    // pembayaran ganda: tagihan pertama Midtrans (P2) dibayar dulu, lalu tagihan Tripay (P1) dibayar lagi
    const e = await buyVia(c, tokenA, 'Akun Uji'); const eid = e.order.id;
    await c.post(`/api/v1/orders/${eid}/pay`, { token: tokenA }); // P2 = midtrans
    await mock.pay('midtrans', `${eid}-P2`); await until(async () => store().getOrder(eid).status === 'paid');
    await mock.pay('tripay', `${eid}-P1`);   // bayar ganda lewat Tripay
    const rf2 = await until(() => store().db.prepare("SELECT * FROM refunds WHERE order_id = ?").get(eid));
    assert.strictEqual(rf2.status, 'failed'); assert.match(rf2.message, /tidak mendukung/i);
    // admin bisa mencatat refund manual
    const man = await owner.post(`/admin/orders/${eid}/refund`, { form: { reason: 'via dashboard Tripay', attempt: `${eid}-P1`, manual: '1' } });
    assert.match(decodeURIComponent(man.loc), /m=/);
    assert.strictEqual(store().db.prepare("SELECT status FROM refunds WHERE order_id = ? AND attempt_ref = ? ORDER BY id DESC").get(eid, `${eid}-P1`).status, 'succeeded');
  });
});

test('iPaymu: tanda tangan request, tagihan, notifikasi diverifikasi lewat API, notifikasi palsu ditolak', async () => {
  const c = client();
  const settings = require('../settings');
  settings.set('IPAYMU_VA', mock.ipaymu.va, 'uji'); settings.set('IPAYMU_API_KEY', mock.ipaymu.key, 'uji');
  await withPriority('ipaymu,midtrans,xendit', async () => {
    const integ = require('../integrations');
    assert.strictEqual((await integ.test('ipaymu', 'uji')).ok, true, 'uji koneksi (tanda tangan diterima server tiruan)');
    settings.set('IPAYMU_API_KEY', 'kunci-salah', 'uji');
    const bad = await integ.test('ipaymu', 'uji'); assert.strictEqual(bad.ok, false); assert.match(bad.detail, /401/);
    settings.set('IPAYMU_API_KEY', mock.ipaymu.key, 'uji');

    const d = await buyVia(c, tokenA, 'Akun Uji'); const id = d.order.id, ref = `${id}-P1`;
    assert.match(d.pay_url, /\/mock\/pay\/ipaymu\//); assert.strictEqual(store().getAttempt(ref).provider, 'ipaymu');

    // notifikasi palsu: transaksi tak dikenal → verifikasi API gagal → 502 (gateway akan kirim ulang), pesanan tetap menunggu
    assert.strictEqual((await mock.forge({ trx_id: '999999', reference_id: ref, status: 'berhasil', status_code: '1' })).status, 502);
    assert.strictEqual(store().getOrder(id).status, 'pending');
    // transaksi nyata milik pesanan lain tetapi reference_id dipalsukan → ditolak
    const other = await buyVia(c, tokenA, 'Akun Uji'); const otherTrx = mock.state.ipaymu.get(`${other.order.id}-P1`).trx;
    assert.strictEqual((await mock.forge({ trx_id: String(otherTrx), reference_id: ref, status: 'berhasil', status_code: '1' })).status, 403);
    assert.strictEqual(store().getOrder(id).status, 'pending');
    // notifikasi "berhasil" untuk transaksi yang belum dibayar di gateway → tetap menunggu (isi notifikasi tidak dipercaya)
    assert.strictEqual((await mock.forge({ trx_id: String(mock.state.ipaymu.get(ref).trx), reference_id: ref, status: 'berhasil', status_code: '1' })).status, 200);
    assert.strictEqual(store().getOrder(id).status, 'pending', 'status ditentukan API gateway, bukan isi notifikasi');

    // pembayaran sah
    assert.strictEqual((await mock.pay('ipaymu', ref)).status, 200);
    const done = await until(async () => { const x = await c.get('/api/v1/orders/' + id, { token: tokenA }); return x.data.status === 'paid' && x.data; });
    assert.strictEqual(done.items.length, 1);

    // nominal tidak cocok dengan pesanan
    const m = await buyVia(c, tokenA, 'Akun Uji'); const mref = `${m.order.id}-P1`;
    mock.state.ipaymu.get(mref).amount = 1;
    assert.strictEqual((await mock.pay('ipaymu', mref)).status, 400);
    assert.strictEqual(store().getOrder(m.order.id).status, 'pending');
  });
});

test('iPaymu: gangguan → failover; Tripay & iPaymu di Pengaturan/Integrasi (kunci bermasker, gerbang produksi)', async () => {
  const c = client();
  await withPriority('ipaymu,midtrans', async () => {
    mock.state.fail.ipaymu = true;
    assert.match((await buyVia(c, tokenA, 'Akun Uji')).pay_url, /midtrans/, 'failover ke Midtrans');
  });
  // pengaturan lewat UI: kunci tersimpan terenkripsi & bermasker
  for (const g of ['tripay', 'ipaymu']) assert.strictEqual((await owner.get('/admin/settings/' + g)).status, 200);
  await owner.post('/admin/settings/tripay', { form: { TRIPAY_API_KEY: 'RAHASIA-TRIPAY-9999', TRIPAY_PRIVATE_KEY: mock.tripay.privateKey, TRIPAY_MERCHANT_CODE: mock.tripay.merchant, TRIPAY_METHOD: 'BRIVA' } });
  const page = (await owner.get('/admin/settings/tripay')).text;
  assert.ok(!page.includes('RAHASIA-TRIPAY-9999') && page.includes('••••9999'));
  assert.ok(!store().db.prepare("SELECT value FROM settings WHERE key='TRIPAY_API_KEY'").get().value.includes('RAHASIA'));
  assert.strictEqual(process.env.TRIPAY_METHOD, 'BRIVA');
  await owner.post('/admin/settings/tripay', { form: { TRIPAY_API_KEY: mock.tripay.apiKey, TRIPAY_METHOD: 'QRIS' } });
  // integrasi: tampil dengan peringatan "belum diuji", mode produksi terkunci sebelum uji sandbox
  const integ = (await owner.get('/admin/status')).text;
  assert.ok(integ.includes('Tripay') && integ.includes('iPaymu') && /format API belum diuji/.test(integ));
  store().db.prepare("DELETE FROM integration_checks WHERE integration IN ('tripay','ipaymu')").run();
  for (const id of ['tripay', 'ipaymu']) {
    const r = await owner.post(`/admin/integrations/${id}/mode`, { form: { mode: 'production' } });
    assert.match(decodeURIComponent(r.loc), /e=.*uji sandbox/i, id);
    assert.notStrictEqual(process.env[id === 'tripay' ? 'TRIPAY_SANDBOX' : 'IPAYMU_SANDBOX'], 'false');
    const t = await owner.post(`/admin/integrations/${id}/test`); assert.match(decodeURIComponent(t.loc), /m=.*sukses/, id + ' ' + t.loc);
    assert.match(decodeURIComponent((await owner.post(`/admin/integrations/${id}/mode`, { form: { mode: 'production' } })).loc), /m=.*PRODUKSI/, id);
    await owner.post(`/admin/integrations/${id}/mode`, { form: { mode: 'sandbox' } });
  }
});
