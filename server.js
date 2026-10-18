const express = require('express');
const crypto = require('crypto');
const path = require('path');
const store = require('./db');
const payments = require('./payments');
const suppliers = require('./suppliers');
const fulfill = require('./fulfill');
const v = require('./views');

const PROD = process.env.NODE_ENV === 'production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (PROD ? '' : 'admin');
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD belum diset: login admin dinonaktifkan.');
if (!payments.anyEnabled()) console.warn('Belum ada gateway pembayaran aktif: berjalan dalam mode demo.');

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

// Produk bisa dibeli bila ada stok lokal ATAU ada pemasok cadangan yang aktif
const decorate = (p) => {
  const viaSupplier = store.listSources(p.id).some((s) => suppliers.get(s.supplier)?.enabled());
  p.viaSupplier = viaSupplier;
  p.orderable = p.available > 0 || viaSupplier;
  p.maxQty = viaSupplier ? 10 : Math.min(p.available, 10);
  return p;
};

// ---------- Toko ----------
app.get('/', (req, res) => {
  const c = req.query.c ? String(req.query.c) : null;
  res.send(v.home(store.listProducts(true, c).map(decorate), store.categories(), c));
});

app.get('/product/:id', (req, res) => {
  const p = store.getProduct(Number(req.params.id));
  if (!p || !p.active) return res.status(404).send(v.notFound());
  res.send(v.productPage(decorate(p)));
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
    decorate(p);
    const fail = (status, msg) => res.status(status).send(v.productPage(decorate(store.getProduct(productId)), msg));
    if (!name || !contact) return fail(400, 'Nama dan kontak wajib diisi');
    if (PROD && !payments.anyEnabled()) return fail(503, 'Pembayaran belum tersedia');

    let order;
    try {
      order = store.createOrder({ productId, qty, name, contact, backorder: p.viaSupplier });
    } catch (e) {
      return fail(400, e.message);
    }
    if (payments.anyEnabled()) {
      try {
        await payments.createAttempt(order, p.name, baseUrl(req));
      } catch (e) {
        console.error(e.message);
        store.markFailed(order.id);
        return fail(502, 'Semua metode pembayaran sedang gangguan, coba lagi sebentar lagi.');
      }
    }
    res.redirect(`/order/${order.id}?k=${order.access_key}`);
  })
);

const ownOrder = (req) => {
  const o = store.getOrder(req.params.id);
  return o && safeEq(o.access_key, req.query.k || '') ? o : null;
};

app.get(
  '/order/:id',
  wrap(async (req, res) => {
    let o = ownOrder(req);
    if (!o) return res.status(404).send(v.notFound());
    if (o.status === 'pending') await fulfill.syncPayments(o.id); // jaga-jaga webhook terlambat
    fulfill.retryLocal(o);
    o = store.getOrder(o.id);
    const items = o.status.startsWith('paid') ? store.orderItems(o.id) : [];
    const labels = Object.fromEntries(Object.entries(payments.providers).map(([k, p]) => [k, p.label]));
    res.set('Cache-Control', 'no-store');
    res.send(
      v.orderPage(o, items, {
        attempts: store.attemptsOf(o.id),
        labels,
        canSwitch: payments.anyEnabled(),
        demo: !payments.anyEnabled() && !PROD,
        error: req.query.e,
      })
    );
  })
);

// Pembeli minta tagihan baru / pindah metode: coba gateway lain dulu, jatuh ke yang sama bila hanya satu
app.post(
  '/order/:id/pay',
  wrap(async (req, res) => {
    const o = ownOrder(req);
    if (!o || o.status !== 'pending') return res.status(404).send(v.notFound());
    const last = store.attemptsOf(o.id).at(-1);
    const back = `/order/${o.id}?k=${o.access_key}`;
    const others = payments.enabledNames().filter((n) => n !== last?.provider);
    try {
      await payments.createAttempt(o, o.product_name, baseUrl(req), others.length ? [last?.provider] : []);
      res.redirect(back);
    } catch (e) {
      console.error(e.message);
      res.redirect(back + '&e=' + encodeURIComponent('Semua metode pembayaran sedang gangguan, coba lagi nanti.'));
    }
  })
);

// Mode demo: hanya aktif bila belum ada gateway dan bukan production
app.post(
  '/order/:id/simulate',
  wrap(async (req, res) => {
    if (payments.anyEnabled() || PROD) return res.status(403).send('Tidak tersedia');
    const o = ownOrder(req);
    if (!o) return res.status(404).send(v.notFound());
    await fulfill.settle(o.id);
    res.redirect(`/order/${o.id}?k=${o.access_key}`);
  })
);

// Webhook per gateway. Daftarkan di dashboard: https://<domain>/pay/<midtrans|xendit>/notify
const notify = (name) => (req, res) => {
  const n = payments.providers[name].parseWebhook(req);
  if (!n) return res.status(403).send('invalid signature');
  const r = fulfill.onPayment(n.ref, n.result, n.amount);
  res.status(r === 'mismatch' ? 400 : 200).send(r === 'unknown' ? 'ignored' : r);
};
for (const name of Object.keys(payments.providers)) app.post(`/pay/${name}/notify`, notify(name));
app.post('/midtrans/notify', notify('midtrans')); // alias lama

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
    .prepare(
      `SELECT o.*, p.name AS product_name,
        COALESCE((SELECT provider FROM payment_attempts a WHERE a.order_id = o.id AND a.status IN ('paid','paid_duplicate') ORDER BY a.rowid LIMIT 1),
                 (SELECT provider FROM payment_attempts a WHERE a.order_id = o.id ORDER BY a.rowid DESC LIMIT 1)) AS gateway,
        (SELECT COUNT(*) FROM payment_attempts a WHERE a.order_id = o.id AND a.status = 'paid_duplicate') AS dup,
        (SELECT COUNT(*) FROM supplier_tx t WHERE t.order_id = o.id AND t.status = 'unknown') AS unknown_tx
       FROM orders o JOIN products p ON p.id = o.product_id ORDER BY o.created_at DESC, o.rowid DESC LIMIT 200`
    )
    .all();
  const s = store.db
    .prepare("SELECT COUNT(*) orders, SUM(status LIKE 'paid%') paid, COALESCE(SUM(CASE WHEN status LIKE 'paid%' THEN amount END),0) revenue FROM orders")
    .get();
  res.send(v.adminOrders(orders, { orders: s.orders, paid: s.paid || 0, revenue: s.revenue }));
});

app.post('/admin/orders/:id/fulfill', (req, res) => {
  fulfill.settle(req.params.id).catch((e) => console.error('[settle]', e));
  res.redirect('/admin');
});

app.get(
  '/admin/status',
  wrap(async (req, res) => {
    const gateways = payments.priority().map((n) => ({ label: payments.providers[n].label, enabled: payments.providers[n].enabled() }));
    const list = await Promise.all(
      Object.values(suppliers.adapters()).map(async (a) => {
        const row = { name: a.name, label: a.label, enabled: a.enabled(), hasCatalog: Boolean(a.catalog) };
        if (row.enabled && a.balance) {
          try {
            row.balance = await a.balance();
          } catch (e) {
            row.balance = 'error: ' + e.message;
          }
        }
        return row;
      })
    );
    res.send(v.adminStatus({ gateways, suppliers: list }));
  })
);

app.get(
  '/admin/suppliers/:name/catalog',
  wrap(async (req, res) => {
    const a = suppliers.get(req.params.name);
    if (!a || !a.enabled() || !a.catalog) return res.status(404).send(v.notFound());
    const q = String(req.query.q || '').toLowerCase();
    const rows = (await a.catalog()).filter((r) => !q || `${r.sku} ${r.name}`.toLowerCase().includes(q)).slice(0, 200);
    res.send(v.adminCatalog(a.label, rows, req.query.q || ''));
  })
);

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
  res.send(v.adminProduct(p, stock, store.listSources(p.id), Object.keys(suppliers.adapters())));
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

app.post('/admin/products/:id/sources', (req, res) => {
  const id = Number(req.params.id);
  const supplier = String(req.body.supplier || '');
  const sku = String(req.body.sku || '').trim().slice(0, 100);
  if (suppliers.get(supplier) && sku) store.addSource(id, supplier, sku, Math.max(1, parseInt(req.body.priority, 10) || 1));
  res.redirect('/admin/products/' + id);
});

app.post('/admin/sources/:id/delete', (req, res) => {
  const s = store.db.prepare('SELECT product_id FROM product_sources WHERE id = ?').get(Number(req.params.id));
  store.deleteSource(Number(req.params.id));
  res.redirect(s ? '/admin/products/' + s.product_id : '/admin/products');
});

app.get('/healthz', (req, res) => res.send('ok'));
app.use((req, res) => res.status(404).send(v.notFound()));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Terjadi kesalahan server');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Toko berjalan di http://localhost:${port}`);
  fulfill.startWorker();
});
