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
