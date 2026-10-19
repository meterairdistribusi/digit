const express = require('express');
const store = require('./db');
const accounts = require('./accounts');
const payments = require('./payments');
const fulfill = require('./fulfill');
const legal = require('./legal');
const settings = require('./settings');
const push = require('./push');
const { placeOrder, decorate, CheckoutError } = require('./checkout');

// REST API untuk aplikasi pembeli Android/iPhone (dan PWA). Auth: header "Authorization: Bearer <token>".
// Semua respons JSON. Kesalahan: { error: "pesan" } dengan status HTTP yang sesuai.

const r = express.Router();
r.use(express.json({ limit: '50kb' }));
r.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Pembatas laju sederhana per IP+kunci (cegah tebak password / spam daftar)
const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const k = `${name}:${req.ip}`;
  const h = hits.get(k);
  if (!h || Date.now() - h.t > windowMs) hits.set(k, { n: 1, t: Date.now() });
  else if (++h.n > max) return res.status(429).json({ error: 'Terlalu banyak percobaan, coba lagi nanti' });
  next();
};
setInterval(() => { for (const [k, h] of hits) if (Date.now() - h.t > 3600e3) hits.delete(k); }, 600e3).unref();

const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bearer = (req) => (/^Bearer (.+)$/.exec(req.get('authorization') || '') || [])[1];
const auth = (req, res, next) => {
  const u = accounts.sessionSubject('user', bearer(req));
  if (!u) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu' });
  req.user = u;
  req.token = bearer(req);
  next();
};

const publicProduct = (p) => ({
  id: p.id, name: p.name, category: p.category, description: p.description, price: p.price,
  orderable: p.orderable, in_stock: p.available > 0, max_qty: p.maxQty,
});
const publicOrder = (o, req, withItems = false) => ({
  id: o.id, product: o.product_name, qty: o.qty, amount: o.amount, discount: o.discount || 0, coupon: o.coupon_code || null,
  status: o.status, created_at: o.created_at,
  order_url: `${baseUrl(req)}/order/${o.id}?k=${o.access_key}`,
  ...(withItems ? { items: o.status.startsWith('paid') ? store.orderItems(o.id) : [] } : {}),
});

// ---------- Info & dokumen hukum ----------
r.get('/config', (req, res) =>
  res.json({
    store_name: settings.get('STORE_NAME') || 'Toko Digital',
    whatsapp: (settings.get('WHATSAPP_NUMBER') || '').replace(/\D/g, ''),
    payments_enabled: payments.anyEnabled(),
    legal: legal.names().map((n) => ({ name: n, title: legal.doc(n).title, url: `${baseUrl(req)}/legal/${n}` })),
  })
);
r.get('/legal', (req, res) => res.json(legal.names().map((n) => { const d = legal.doc(n); return { name: n, title: d.title, updated: d.updated }; })));
r.get('/legal/:doc', (req, res) => {
  const d = legal.doc(req.params.doc);
  if (!d) return res.status(404).json({ error: 'Dokumen tidak ditemukan' });
  res.json({ name: d.name, title: d.title, updated: d.updated, markdown: d.markdown });
});

// ---------- Akun ----------
r.post('/auth/register', limit('reg', 10, 3600e3), (req, res) => {
  const b = req.body || {};
  try {
    const id = accounts.registerUser({ email: b.email, name: b.name, phone: b.phone, password: b.password, acceptTerms: b.accept_terms === true });
    res.status(201).json({ token: accounts.createSession('user', id, b.device), user: store.db.prepare('SELECT id, email, name, phone FROM users WHERE id = ?').get(id) });
  } catch (e) {
    if (e instanceof accounts.UserError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

r.post('/auth/login', limit('login', 15, 15 * 60e3), (req, res) => {
  const b = req.body || {};
  const u = accounts.authUser(b.email, b.password);
  if (!u) return res.status(401).json({ error: 'Email atau password salah' });
  res.json({ token: accounts.createSession('user', u.id, b.device), user: { id: u.id, email: u.email, name: u.name, phone: u.phone } });
});

r.post('/auth/logout', auth, (req, res) => {
  accounts.revokeSession(req.token);
  res.json({ ok: true });
});

r.get('/me', auth, (req, res) => res.json({ user: req.user }));

r.post('/me/password', auth, limit('pw', 10, 15 * 60e3), (req, res) => {
  try {
    accounts.changePassword('user', req.user.id, req.body?.old_password, req.body?.new_password);
    res.json({ token: accounts.createSession('user', req.user.id, 'ganti-password') }); // sesi lama dicabut; beri token baru
  } catch (e) {
    if (e instanceof accounts.UserError) return res.status(400).json({ error: e.message });
    throw e;
  }
});

// Notifikasi push: daftarkan/cabut token perangkat milik akun yang sedang masuk
r.put('/me/push-token', auth, limit('push', 30, 3600e3), (req, res) => {
  if (!push.register(req.user.id, req.body?.token, req.body?.platform)) return res.status(400).json({ error: 'Token push tidak valid' });
  res.json({ ok: true });
});
r.delete('/me/push-token', auth, (req, res) => {
  push.unregister(req.user.id, req.body?.token);
  res.json({ ok: true });
});

r.get('/me/export', auth, (req, res) => res.json(accounts.exportUser(req.user.id)));

// Hapus akun: wajib konfirmasi password (syarat Apple/Google: hapus akun harus bisa dari dalam aplikasi)
r.delete('/me', auth, limit('del', 5, 15 * 60e3), (req, res) => {
  const u = accounts.authUser(req.user.email, req.body?.password);
  if (!u || u.id !== req.user.id) return res.status(401).json({ error: 'Password salah' });
  accounts.deleteUser(req.user.id);
  res.json({ ok: true });
});

// ---------- Katalog ----------
r.get('/categories', (req, res) => res.json(store.categories()));
r.get('/products', (req, res) => res.json(store.listProducts(true, req.query.category ? String(req.query.category) : null).map(decorate).map(publicProduct)));
r.get('/products/:id', (req, res) => {
  const p = store.getProduct(Number(req.params.id));
  if (!p || !p.active) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  res.json(publicProduct(decorate(p)));
});

r.post('/coupons/check', (req, res) => {
  const p = store.getProduct(Number(req.body?.product_id));
  if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  const qty = Math.min(10, Math.max(1, parseInt(req.body?.qty, 10) || 1));
  try {
    const c = store.applyCoupon(String(req.body?.code || ''), p.price * qty);
    res.json({ discount: c.discount, total: p.price * qty - c.discount });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Pesanan ----------
r.post('/orders', auth, limit('order', 30, 3600e3), wrap(async (req, res) => {
  const b = req.body || {};
  try {
    const { order, attempt } = await placeOrder({
      productId: b.product_id, qty: b.qty, coupon: b.coupon, userId: req.user.id, baseUrl: baseUrl(req),
      name: req.user.name, contact: b.contact || req.user.phone || req.user.email,
    });
    res.status(201).json({ order: publicOrder(store.getOrder(order.id), req), pay_url: attempt?.pay_url || null, demo: !payments.anyEnabled() });
  } catch (e) {
    if (e instanceof CheckoutError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

r.get('/orders', auth, (req, res) => res.json(store.ordersOfUser(req.user.id).map((o) => publicOrder(o, req))));

const mine = (req, res) => {
  const o = store.getOrder(String(req.params.id));
  if (!o || o.user_id !== req.user.id) return void res.status(404).json({ error: 'Pesanan tidak ditemukan' });
  return o;
};

r.get('/orders/:id', auth, wrap(async (req, res) => {
  let o = mine(req, res);
  if (!o) return;
  if (o.status === 'pending') await fulfill.syncPayments(o.id); // jaga-jaga webhook terlambat
  fulfill.retryLocal(o);
  o = store.getOrder(o.id);
  const live = [...store.attemptsOf(o.id)].reverse().find((a) => a.status === 'pending');
  res.json({ ...publicOrder(o, req, true), pay_url: o.status === 'pending' ? live?.pay_url || null : null });
}));

// Buat tagihan baru / pindah metode pembayaran
r.post('/orders/:id/pay', auth, wrap(async (req, res) => {
  const o = mine(req, res);
  if (!o) return;
  if (o.status !== 'pending') return res.status(409).json({ error: 'Pesanan ini tidak menunggu pembayaran' });
  const last = store.attemptsOf(o.id).at(-1);
  const others = payments.enabledNames().filter((n) => n !== last?.provider);
  try {
    const a = await payments.createAttempt(o, o.product_name, baseUrl(req), others.length ? [last?.provider] : []);
    res.json({ pay_url: a.pay_url });
  } catch (e) {
    res.status(502).json({ error: 'Semua metode pembayaran sedang gangguan, coba lagi nanti.' });
  }
}));

r.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));
r.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid' });
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server' });
});

module.exports = r;
