const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./db');
const mt = require('./midtrans');
const v = require('./views');

const PROD = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PROD ? '' : 'admin');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD belum diset: login admin dinonaktifkan.');
if (!mt.enabled()) console.warn('Midtrans belum dikonfigurasi: berjalan dalam mode demo.');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});

const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Toko ----------
app.get('/', (req, res) => {
  const c = req.query.c ? String(req.query.c) : null;
  res.send(v.home(store.listProducts(true, c), store.categories(), c));
});

app.get('/product/:id', (req, res) => {
  const p = store.getProduct(Number(req.params.id));
  if (!p || !p.active) return res.status(404).send(v.notFound());
  res.send(v.productPage(p));
});

app.post(
  '/checkout',
  wrap(async (req, res) => {
    const productId = Number(req.body.product_id);
    const qty = Math.min(10, Math.max(1, parseInt(req.body.qty, 10) || 1));
    const name = String(req.body.name || '').trim().slice(0, 60);
    const contact = String(req.body.contact || '').trim().slice(0, 80);
    const p = store.getProduct(productId);
    if (!p || !p.active) return res.status(404).send(v.notFound());
    if (!name || !contact) return res.status(400).send(v.productPage(p, 'Nama dan kontak wajib diisi'));

    let order;
    try {
      order = store.createOrder({ productId, qty, name, contact });
    } catch (e) {
      return res.status(400).send(v.productPage(store.getProduct(productId), e.message));
    }
    const url = `/order/${order.id}?k=${order.access_key}`;
    if (mt.enabled()) {
      try {
        const token = await mt.createSnapToken(order, p.name, baseUrl(req) + url);
        store.db.prepare('UPDATE orders SET snap_token = ? WHERE id = ?').run(token, order.id);
      } catch (e) {
        console.error(e);
        store.markFailed(order.id);
        return res.status(502).send(v.productPage(p, 'Gagal membuat pembayaran, coba lagi.'));
      }
    }
    res.redirect(url);
  })
);

app.get(
  '/order/:id',
  wrap(async (req, res) => {
    let o = store.getOrder(req.params.id);
    if (!o || !safeEq(o.access_key, req.query.k || '')) return res.status(404).send(v.notFound());
    // Sinkronkan status langsung ke Midtrans bila webhook belum masuk
    if (o.status === 'pending' && mt.enabled()) {
      try {
        const n = await mt.fetchStatus(o.id);
        const r = mt.interpret(n);
        if (r === 'paid' && Number(n.gross_amount) === o.amount) store.fulfillOrder(o.id);
        else if (r === 'failed') store.markFailed(o.id);
        o = store.getOrder(o.id);
      } catch (e) {
        console.error('sync status', e.message);
      }
    }
    // paid_nostock bisa terpenuhi otomatis saat stok sudah ditambah
    if (o.status === 'paid_nostock') {
      store.fulfillOrder(o.id);
      o = store.getOrder(o.id);
    }
    const items = o.status === 'paid' ? store.orderItems(o.id) : [];
    res.set('Cache-Control', 'no-store');
    res.send(
      v.orderPage(o, items, {
        midtrans: mt.enabled(),
        clientKey: mt.clientKey(),
        snapBase: mt.snapBase(),
        demo: !mt.enabled() && !PROD,
      })
    );
  })
);

// Mode demo: hanya aktif bila Midtrans belum diset dan bukan production
app.post('/order/:id/simulate', (req, res) => {
  if (mt.enabled() || PROD) return res.status(403).send('Tidak tersedia');
  const o = store.getOrder(req.params.id);
  if (!o || !safeEq(o.access_key, req.query.k || '')) return res.status(404).send(v.notFound());
  store.fulfillOrder(o.id);
  res.redirect(`/order/${o.id}?k=${o.access_key}`);
});

// Webhook Midtrans (set di Dashboard Midtrans > Settings > Payment > Notification URL)
app.post('/midtrans/notify', (req, res) => {
  const n = req.body || {};
  if (!mt.enabled() || !mt.validSignature(n)) return res.status(403).send('invalid signature');
  const o = store.getOrder(n.order_id);
  if (!o) return res.status(404).send('unknown order');
  const r = mt.interpret(n);
  if (r === 'paid') {
    if (Number(n.gross_amount) !== o.amount) return res.status(400).send('amount mismatch');
    store.fulfillOrder(o.id);
  } else if (r === 'failed') store.markFailed(o.id);
  res.send('ok');
});

// ---------- Admin ----------
const cookieOf = (req, name) =>
  (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim().split('='))
    .find(([k]) => k === name)?.[1];
const adminToken = () => crypto.createHmac('sha256', SECRET).update('admin').digest('hex');
const requireAdmin = (req, res, next) =>
  ADMIN_PASSWORD && safeEq(cookieOf(req, 'adm') || '', adminToken()) ? next() : res.redirect('/admin/login');

const attempts = new Map(); // ip -> {n, t}
app.get('/admin/login', (req, res) => res.send(v.adminLogin()));
app.post('/admin/login', (req, res) => {
  const a = attempts.get(req.ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60e3) (a.n = 0), (a.t = Date.now());
  if (a.n >= 5) return res.status(429).send(v.adminLogin('Terlalu banyak percobaan, coba lagi nanti'));
  if (!ADMIN_PASSWORD || !safeEq(req.body.password || '', ADMIN_PASSWORD)) {
    attempts.set(req.ip, { n: a.n + 1, t: a.t });
    return res.status(401).send(v.adminLogin('Password salah'));
  }
  attempts.delete(req.ip);
  res.cookie('adm', adminToken(), { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 12 * 3600e3 });
  res.redirect('/admin');
});
app.post('/admin/logout', (req, res) => {
  res.clearCookie('adm');
  res.redirect('/admin/login');
});

app.use('/admin', requireAdmin);

app.get('/admin', (req, res) => {
  const orders = store.db
    .prepare('SELECT o.*, p.name AS product_name FROM orders o JOIN products p ON p.id = o.product_id ORDER BY o.created_at DESC, o.rowid DESC LIMIT 200')
    .all();
  const s = store.db
    .prepare("SELECT COUNT(*) orders, SUM(status IN ('paid','paid_nostock')) paid, COALESCE(SUM(CASE WHEN status IN ('paid','paid_nostock') THEN amount END),0) revenue FROM orders")
    .get();
  res.send(v.adminOrders(orders, { orders: s.orders, paid: s.paid || 0, revenue: s.revenue }));
});

app.post('/admin/orders/:id/fulfill', (req, res) => {
  store.fulfillOrder(req.params.id);
  res.redirect('/admin');
});

app.get('/admin/products', (req, res) => res.send(v.adminProducts(store.listProducts(false))));

const productFields = (b) => ({
  name: String(b.name || '').trim().slice(0, 80),
  category: String(b.category || 'Lainnya').trim().slice(0, 40) || 'Lainnya',
  price: Math.max(1000, parseInt(b.price, 10) || 0),
  description: String(b.description || '').trim().slice(0, 500),
});

app.post('/admin/products', (req, res) => {
  const f = productFields(req.body);
  if (!f.name) return res.redirect('/admin/products');
  const r = store.db
    .prepare('INSERT INTO products (name, category, description, price) VALUES (?,?,?,?)')
    .run(f.name, f.category, f.description, f.price);
  res.redirect('/admin/products/' + r.lastInsertRowid);
});

app.get('/admin/products/:id', (req, res) => {
  const p = store.getProduct(Number(req.params.id));
  if (!p) return res.status(404).send(v.notFound());
  const stock = store.db.prepare('SELECT * FROM stock WHERE product_id = ? ORDER BY id DESC').all(p.id);
  res.send(v.adminProduct(p, stock));
});

app.post('/admin/products/:id', (req, res) => {
  const f = productFields(req.body);
  store.db
    .prepare('UPDATE products SET name=?, category=?, description=?, price=?, active=? WHERE id=?')
    .run(f.name, f.category, f.description, f.price, req.body.active ? 1 : 0, Number(req.params.id));
  res.redirect('/admin/products/' + Number(req.params.id));
});

app.post('/admin/products/:id/stock', (req, res) => {
  const id = Number(req.params.id);
  const lines = String(req.body.items || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const ins = store.db.prepare('INSERT INTO stock (product_id, content) VALUES (?, ?)');
  store.db.transaction(() => lines.forEach((l) => ins.run(id, l)))();
  res.redirect('/admin/products/' + id);
});

app.post('/admin/stock/:id/delete', (req, res) => {
  const s = store.db.prepare('SELECT product_id FROM stock WHERE id = ?').get(Number(req.params.id));
  store.db.prepare('DELETE FROM stock WHERE id = ? AND order_id IS NULL').run(Number(req.params.id));
  res.redirect(s ? '/admin/products/' + s.product_id : '/admin/products');
});

app.get('/healthz', (req, res) => res.send('ok'));
app.use((req, res) => res.status(404).send(v.notFound()));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Terjadi kesalahan server');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Toko berjalan di http://localhost:${port}`));
