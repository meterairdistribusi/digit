const express = require('express');
const path = require('path');
const store = require('./db');
const settings = require('./settings');
settings.apply(); // nilai dari admin menimpa env sebelum modul lain membaca konfigurasi
const accounts = require('./accounts');
const payments = require('./payments');
const suppliers = require('./suppliers');
const integrations = require('./integrations');
const refunds = require('./refunds');
const legal = require('./legal');
const fulfill = require('./fulfill');
const api = require('./api');
const { placeOrder, decorate, CheckoutError } = require('./checkout');
const v = require('./views');
const v2 = require('./views2');

const PROD = process.env.NODE_ENV === 'production';
if (accounts.bootstrapAdmin()) console.log('Admin pertama dibuat: username "admin" (password dari ADMIN_PASSWORD). Segera ganti di menu Admin.');
if (!store.db.prepare('SELECT 1 x FROM admins WHERE active = 1').get()) console.warn('Belum ada akun admin aktif: isi ADMIN_PASSWORD lalu restart.');
if (!payments.anyEnabled()) console.warn('Belum ada gateway pembayaran aktif: berjalan dalam mode demo.');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
// API mobile punya parser JSON sendiri (agar JSON rusak dijawab sebagai JSON), jadi dipasang sebelum parser global
app.use('/api/v1', api);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.set({ 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  next();
});

const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
const crypto = require('crypto');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cookieOf = (req, name) =>
  (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim().split('='))
    .find(([k]) => k === name)?.[1];
const userOf = (req) => (req._user !== undefined ? req._user : (req._user = accounts.sessionSubject('user', cookieOf(req, 'usr'))));
const safeNext = (n) => (/^\/(?!\/)[\w\-./?=&%]*$/.test(String(n || '')) ? n : '/account');

// Pembatas laju per kunci (IP + nama), untuk form login
const tries = new Map();
const blocked = (key, max = 5, windowMs = 15 * 60e3) => {
  const a = tries.get(key);
  return a && Date.now() - a.t <= windowMs && a.n >= max;
};
const fail = (key, windowMs = 15 * 60e3) => {
  const a = tries.get(key);
  tries.set(key, !a || Date.now() - a.t > windowMs ? { n: 1, t: Date.now() } : { n: a.n + 1, t: a.t });
};
setInterval(() => { for (const [k, a] of tries) if (Date.now() - a.t > 3600e3) tries.delete(k); }, 600e3).unref();

// ---------- Dokumen hukum ----------
app.get('/legal/:doc', (req, res) => {
  const d = legal.doc(req.params.doc);
  if (!d) return res.status(404).send(v.notFound());
  res.send(v2.legalPage(d));
});

// ---------- Toko ----------
app.get('/', (req, res) => {
  const c = req.query.c ? String(req.query.c) : null;
  res.send(v.home(store.listProducts(true, c).map(decorate), store.categories(), c));
});

app.get('/product/:id', (req, res) => {
  const p = store.getProduct(Number(req.params.id));
  if (!p || !p.active) return res.status(404).send(v.notFound());
  res.send(v.productPage(decorate(p), undefined, userOf(req)));
});

app.post(
  '/checkout',
  wrap(async (req, res) => {
    const productId = Number(req.body.product_id);
    try {
      const { order } = await placeOrder({ ...req.body, productId, userId: userOf(req)?.id ?? null, baseUrl: baseUrl(req) });
      res.redirect(`/order/${order.id}?k=${order.access_key}`);
    } catch (e) {
      if (!(e instanceof CheckoutError)) throw e;
      const p = store.getProduct(productId);
      if (!p || !p.active) return res.status(404).send(v.notFound());
      res.status(e.status).send(v.productPage(decorate(p), e.message, userOf(req)));
    }
  })
);

// Lacak pesanan tanpa akun: ID + kontak saat checkout. Dibatasi per IP agar ID tidak bisa ditebak.
app.get('/track', (req, res) => res.send(v.track()));
app.post('/track', (req, res) => {
  const key = 'track:' + req.ip;
  if (blocked(key, 10)) return res.status(429).send(v.track('Terlalu banyak percobaan, coba lagi nanti'));
  const o = store.findOrderByContact(req.body.id, req.body.contact);
  if (!o) {
    fail(key);
    return res.status(404).send(v.track('Pesanan tidak ditemukan. Periksa ID dan kontak yang dipakai saat checkout.'));
  }
  res.redirect(`/order/${o.id}?k=${o.access_key}`);
});

app.get('/coupon/check', (req, res) => {
  const p = store.getProduct(Number(req.query.product_id));
  const qty = Math.min(10, Math.max(1, parseInt(req.query.qty, 10) || 1));
  if (!p) return res.status(404).json({ ok: false });
  try {
    const c = store.applyCoupon(String(req.query.code || ''), p.price * qty);
    res.json({ ok: true, discount: c.discount, total: p.price * qty - c.discount });
  } catch (e) {
    res.json({ ok: false, message: e.message });
  }
});

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

// ---------- Akun pembeli (web) ----------
const setUserCookie = (res, token) =>
  res.cookie('usr', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 24 * 3600e3 });
const needUser = (req, res, next) => (userOf(req) ? next() : res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)));

app.get('/login', (req, res) => res.send(v2.userLogin(null, req.query.next)));
app.post('/login', (req, res) => {
  const key = 'ulogin:' + req.ip + ':' + String(req.body.email || '').toLowerCase();
  if (blocked(key)) return res.status(429).send(v2.userLogin('Terlalu banyak percobaan, coba lagi nanti'));
  const u = accounts.authUser(req.body.email, req.body.password);
  if (!u) {
    fail(key);
    return res.status(401).send(v2.userLogin('Email atau password salah', req.body.next));
  }
  tries.delete(key);
  setUserCookie(res, accounts.createSession('user', u.id, 'web'));
  res.redirect(safeNext(req.body.next));
});
app.get('/register', (req, res) => res.send(v2.userRegister()));
app.post('/register', (req, res) => {
  const key = 'ureg:' + req.ip;
  if (blocked(key, 10, 3600e3)) return res.status(429).send(v2.userRegister('Terlalu banyak percobaan, coba lagi nanti'));
  try {
    const id = accounts.registerUser({ ...req.body, acceptTerms: Boolean(req.body.accept) });
    fail(key, 3600e3);
    setUserCookie(res, accounts.createSession('user', id, 'web'));
    res.redirect('/account');
  } catch (e) {
    if (!(e instanceof accounts.UserError)) throw e;
    res.status(400).send(v2.userRegister(e.message, req.body));
  }
});
app.post('/logout', (req, res) => {
  accounts.revokeSession(cookieOf(req, 'usr'));
  res.clearCookie('usr');
  res.redirect('/');
});
app.get('/account', needUser, (req, res) => {
  const u = userOf(req);
  res.send(v2.account(u, store.ordersOfUser(u.id), req.query.m));
});
app.post('/account/password', needUser, (req, res) => {
  const u = userOf(req);
  try {
    accounts.changePassword('user', u.id, req.body.old_password, req.body.new_password);
    setUserCookie(res, accounts.createSession('user', u.id, 'web'));
    res.redirect('/account?m=' + encodeURIComponent('Password diganti'));
  } catch (e) {
    if (!(e instanceof accounts.UserError)) throw e;
    res.status(400).send(v2.account(u, store.ordersOfUser(u.id), e.message));
  }
});
app.get('/account/export', needUser, (req, res) => {
  res.set({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="data-saya.json"' });
  res.send(JSON.stringify(accounts.exportUser(userOf(req).id), null, 2));
});
app.post('/account/delete', needUser, (req, res) => {
  const u = userOf(req);
  const ok = accounts.authUser(u.email, req.body.password);
  if (!ok || ok.id !== u.id) return res.status(401).send(v2.account(u, store.ordersOfUser(u.id), 'Password salah, akun tidak dihapus'));
  accounts.deleteUser(u.id);
  res.clearCookie('usr');
  res.redirect('/');
});

// ---------- Admin: autentikasi ----------
const requireAdmin = (req, res, next) => {
  const a = accounts.sessionSubject('admin', cookieOf(req, 'adm'));
  if (!a) return res.redirect('/admin/login');
  req.admin = a;
  next();
};
// Hanya Pemilik: pengaturan kunci API, integrasi, akun admin, refund
const requireOwner = (req, res, next) =>
  req.admin.role === 'owner' ? next() : res.status(403).send(v.layout('Akses ditolak', '<div class="panel"><h1>Akses ditolak</h1><p>Hanya Pemilik yang dapat membuka halaman ini.</p></div>', { admin: true }));

app.get('/admin/login', (req, res) => res.send(v.adminLogin()));
app.post('/admin/login', (req, res) => {
  const username = String(req.body.username || '').toLowerCase();
  const key = 'alogin:' + req.ip + ':' + username;
  if (blocked(key)) return res.status(429).send(v.adminLogin('Terlalu banyak percobaan, coba lagi nanti'));
  const a = accounts.authAdmin(username, req.body.password);
  if (!a) {
    fail(key);
    return res.status(401).send(v.adminLogin('Username atau password salah'));
  }
  tries.delete(key);
  res.cookie('adm', accounts.createSession('admin', a.id, 'web'), { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 12 * 3600e3 });
  res.redirect('/admin');
});
app.post('/admin/logout', (req, res) => {
  accounts.revokeSession(cookieOf(req, 'adm'));
  res.clearCookie('adm');
  res.redirect('/admin/login');
});

app.use('/admin', requireAdmin);

// ---------- Admin: pesanan ----------
app.get('/admin', (req, res) => {
  const f = { status: String(req.query.status || ''), q: String(req.query.q || '').trim().slice(0, 60), page: parseInt(req.query.page, 10) || 1 };
  res.send(v.adminOrders(store.searchOrders(f), store.orderStats(), f));
});

app.post('/admin/orders/:id/fulfill', (req, res) => {
  fulfill.settle(req.params.id).catch((e) => console.error('[settle]', e));
  res.redirect('/admin');
});

app.get('/admin/orders/:id', (req, res) => {
  const o = store.getOrder(req.params.id);
  if (!o) return res.status(404).send(v.notFound());
  const d = { attempts: store.attemptsOf(o.id), tx: store.txOf(o.id), refunds: refunds.listFor(o.id), plan: null, planError: '' };
  try {
    const p = refunds.plan(o.id);
    d.plan = { ref: p.a.ref, provider: p.a.provider };
  } catch (e) {
    d.planError = e.message;
  }
  res.send(v2.orderDetail(o, d, { msg: req.query.m, error: req.query.e, isOwner: req.admin.role === 'owner' }));
});

app.post(
  '/admin/orders/:id/refund',
  requireOwner,
  wrap(async (req, res) => {
    const back = '/admin/orders/' + encodeURIComponent(req.params.id);
    try {
      const r = await refunds.requestRefund(req.params.id, {
        reason: String(req.body.reason || '').slice(0, 100),
        attemptRef: String(req.body.attempt || '') || undefined,
        manual: req.body.manual === '1',
        by: req.admin.username,
      });
      const m = r.status === 'succeeded' ? 'Refund berhasil dicatat/diproses' : r.status === 'pending' ? 'Refund diproses gateway, cek statusnya' : 'Refund ditolak gateway: ' + r.message + '. Anda bisa refund manual lewat dashboard gateway lalu tandai.';
      res.redirect(back + (r.status === 'failed' ? '?e=' : '?m=') + encodeURIComponent(m));
    } catch (e) {
      if (!(e instanceof refunds.RefundError)) throw e;
      res.redirect(back + '?e=' + encodeURIComponent(e.message));
    }
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
  res.send(v.adminProduct(p, stock, store.listSources(p.id), Object.values(suppliers.adapters()).filter((a) => a.enabled()).map((a) => a.name)));
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

// ---------- Admin: laporan & kupon ----------
const reportDays = (req) => [7, 30, 90, 365].find((d) => d === parseInt(req.query.days, 10)) || 30;
app.get('/admin/reports', (req, res) => {
  const days = reportDays(req);
  res.send(v.adminReports(store.salesReport(days), days));
});
app.get('/admin/reports.csv', (req, res) => {
  const r = store.salesReport(reportDays(req));
  const csv = ['tanggal,pesanan,pendapatan,diskon', ...r.daily.map((d) => [d.day, d.orders, d.revenue, d.discount].join(','))].join('\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="penjualan.csv"' }).send(csv);
});

app.get('/admin/coupons', (req, res) => res.send(v.adminCoupons(store.listCoupons(), req.query.e)));
app.post('/admin/coupons', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
  const type = req.body.type === 'fixed' ? 'fixed' : 'percent';
  const value = parseInt(req.body.value, 10) || 0;
  if (!code || value < 1 || (type === 'percent' && value > 100)) return res.redirect('/admin/coupons?e=' + encodeURIComponent('Kode/nilai kupon tidak valid'));
  store.saveCoupon({
    code, type, value,
    minAmount: Math.max(0, parseInt(req.body.min_amount, 10) || 0),
    maxUses: Math.max(0, parseInt(req.body.max_uses, 10) || 0),
    expiresAt: /^\d{4}-\d{2}-\d{2}$/.test(req.body.expires_at || '') ? req.body.expires_at : null,
  });
  res.redirect('/admin/coupons');
});
app.post('/admin/coupons/:code/toggle', (req, res) => {
  store.toggleCoupon(req.params.code);
  res.redirect('/admin/coupons');
});

// ---------- Admin: integrasi (Pemilik) ----------
const msgq = (m, e) => (e ? '?e=' : '?m=') + encodeURIComponent(m || e);

app.get(
  '/admin/status',
  requireOwner,
  wrap(async (req, res) => {
    const items = integrations.list();
    const balances = {};
    await Promise.all(
      items.filter((i) => i.kind === 'supplier' && i.enabled).map(async (i) => {
        const a = suppliers.get(i.id);
        if (!a?.balance) return;
        try {
          balances[i.id] = await a.balance();
        } catch (e) {
          balances[i.id] = 'error: ' + e.message;
        }
      })
    );
    res.send(v2.integrationsPage(items, { msg: req.query.m, error: req.query.e, balances }));
  })
);

app.post(
  '/admin/integrations/:id/test',
  requireOwner,
  wrap(async (req, res) => {
    try {
      const r = await integrations.test(req.params.id, req.admin.username);
      res.redirect('/admin/status' + (r.ok ? msgq(`${req.params.id}: uji ${r.mode} sukses — ${r.detail}`) : msgq(`${req.params.id}: uji gagal — ${r.detail}`, true)));
    } catch (e) {
      res.redirect('/admin/status' + msgq(e.message, true));
    }
  })
);

app.post('/admin/integrations/:id/attest', requireOwner, (req, res) => {
  try {
    integrations.attest(req.params.id, req.body.note, req.admin.username);
    res.redirect('/admin/status' + msgq('Uji manual dicatat'));
  } catch (e) {
    res.redirect('/admin/status' + msgq(e.message, true));
  }
});

app.post('/admin/integrations/:id/mode', requireOwner, (req, res) => {
  try {
    integrations.setMode(req.params.id, req.body.mode === 'production' ? 'production' : 'sandbox', req.admin.username);
    res.redirect('/admin/status' + msgq(`${req.params.id} sekarang mode ${req.body.mode === 'production' ? 'PRODUKSI' : 'sandbox'}. Pastikan kunci API sesuai mode.`));
  } catch (e) {
    res.redirect('/admin/status' + msgq(e.message, true));
  }
});

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

// ---------- Admin: pengaturan / kunci API (Pemilik) ----------
const settingsView = (req, res, group, extra = {}) =>
  res.send(v2.settingsPage(settings.GROUPS, group, settings.view(group), { missingLegal: legal.missingSellerInfo(), ...extra }));

app.get('/admin/settings', requireOwner, (req, res) => res.redirect('/admin/settings/toko'));
app.get('/admin/settings/:group', requireOwner, (req, res) => {
  if (!settings.GROUPS.some((g) => g.id === req.params.group)) return res.status(404).send(v.notFound());
  settingsView(req, res, req.params.group, { msg: req.query.m });
});
app.post('/admin/settings/:group', requireOwner, (req, res) => {
  const g = settings.GROUPS.find((x) => x.id === req.params.group);
  if (!g) return res.status(404).send(v.notFound());
  const incoming = {};
  for (const f of g.fields.filter((x) => !x.hidden)) {
    if (f.secret) {
      if (req.body['clear_' + f.key]) incoming[f.key] = '';
      else if (String(req.body[f.key] || '').trim()) incoming[f.key] = req.body[f.key];
    } else if (f.key in req.body) incoming[f.key] = req.body[f.key];
  }
  try {
    integrations.guardKeys(g.id, incoming);
    if (incoming.SUPPLIERS_JSON) JSON.parse(incoming.SUPPLIERS_JSON);
    if (incoming.PAYMENT_PRIORITY && !incoming.PAYMENT_PRIORITY.split(',').every((n) => payments.providers[n.trim()])) throw new Error('Nama gateway tidak dikenal. Pilihan: ' + Object.keys(payments.providers).join(', '));
    for (const [k, val] of Object.entries(incoming)) settings.set(k, val, req.admin.username);
    res.redirect('/admin/settings/' + g.id + '?m=' + encodeURIComponent('Tersimpan'));
  } catch (e) {
    settingsView(req, res, g.id, { error: e instanceof SyntaxError ? 'JSON tidak valid: ' + e.message : e.message });
  }
});

// ---------- Admin: akun admin (Pemilik) ----------
const adminsView = (req, res, extra = {}) => res.send(v2.adminsPage(accounts.listAdmins(), req.admin, extra));
const guard = (req, res, fn, ok) => {
  try {
    fn();
    res.redirect('/admin/admins' + msgq(ok));
  } catch (e) {
    if (!(e instanceof accounts.UserError)) throw e;
    adminsView(req, res, { error: e.message });
  }
};
app.get('/admin/admins', requireOwner, (req, res) => adminsView(req, res, { msg: req.query.m }));
app.post('/admin/admins', requireOwner, (req, res) => guard(req, res, () => accounts.createAdmin(req.body.username, req.body.password, req.body.role), 'Admin ditambahkan'));
app.post('/admin/admins/:id/toggle', requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const a = accounts.listAdmins().find((x) => x.id === id);
  if (a && id === req.admin.id) return adminsView(req, res, { error: 'Tidak bisa menonaktifkan akun sendiri' });
  guard(req, res, () => a && accounts.setAdminActive(id, !a.active), 'Status admin diubah');
});
app.post('/admin/admins/:id/password', requireOwner, (req, res) => guard(req, res, () => accounts.resetAdminPassword(Number(req.params.id), req.body.password), 'Password direset (sesi admin tersebut dicabut)'));
// Siapa pun yang login (Pemilik/Staf) bisa mengganti password sendiri
app.get('/admin/me', (req, res) => res.send(v2.adminMe(req.admin, req.query.e)));
app.post('/admin/me/password', (req, res) => {
  try {
    accounts.changePassword('admin', req.admin.id, req.body.old_password, req.body.new_password);
    res.cookie('adm', accounts.createSession('admin', req.admin.id, 'web'), { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 12 * 3600e3 });
    res.redirect('/admin/me' + msgq('Password diganti'));
  } catch (e) {
    if (!(e instanceof accounts.UserError)) throw e;
    res.status(400).send(v2.adminMe(req.admin, e.message));
  }
});

app.get('/healthz', (req, res) => res.send('ok'));
app.use((req, res) => res.status(404).send(v.notFound()));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Terjadi kesalahan server');
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Toko berjalan di http://localhost:${port}`);
    fulfill.startWorker();
  });
}

module.exports = app;
