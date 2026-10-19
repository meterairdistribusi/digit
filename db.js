const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(path.join(dir, 'shop.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
// node:sqlite tidak punya helper transaksi; dibuat sendiri agar atomik
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(...args);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Lainnya',
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  content TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id, order_id);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  access_key TEXT NOT NULL,
  snap_token TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS payment_attempts (
  ref TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  pay_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attempt_order ON payment_attempts(order_id);
CREATE TABLE IF NOT EXISTS product_sources (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  supplier TEXT NOT NULL,
  sku TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS supplier_tx (
  ref TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  supplier TEXT NOT NULL,
  sku TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tx_order ON supplier_tx(order_id);
`);
const addColumn = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addColumn('orders', 'discount', 'INTEGER NOT NULL DEFAULT 0');
addColumn('orders', 'coupon_code', 'TEXT');
addColumn('orders', 'notified', 'TEXT');
addColumn('payment_attempts', 'refund_status', 'TEXT');
db.exec(`
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'percent',
  value INTEGER NOT NULL,
  min_amount INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
addColumn('orders', 'user_id', 'INTEGER');
addColumn('payment_attempts', 'ext_ref', 'TEXT'); // ID transaksi di sisi gateway (mis. reference Tripay)
addColumn('products', 'image', 'TEXT');
addColumn('products', 'compare_at', 'INTEGER');
addColumn('products', 'badge', "TEXT NOT NULL DEFAULT ''");
addColumn('products', 'featured', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  accepted_terms_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  device TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(kind, subject_id);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  secret INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS integration_checks (
  id INTEGER PRIMARY KEY,
  integration TEXT NOT NULL,
  mode TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT,
  by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_checks ON integration_checks(integration, mode, ok);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  attempt_ref TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  provider_ref TEXT,
  message TEXT,
  requested_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);
-- satu refund aktif (pending/succeeded) per tagihan: mencegah refund ganda
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_active ON refunds(attempt_ref) WHERE status IN ('pending','succeeded');
`);
db.exec(`
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_tokens(user_id);
`);
// order status: pending | paid | paid_sourcing (menunggu pemasok) | paid_nostock | failed
// attempt status: pending | paid | paid_duplicate | failed

// [nama, kategori, deskripsi, harga, harga coret, label, unggulan]
const SAMPLE = [
  ['Netflix Premium 1 Bulan', 'Streaming', 'Akun Netflix Premium 1 profil, garansi selama masa aktif.', 35000, 54000, 'Terlaris', 1],
  ['YouTube Premium 1 Bulan', 'Streaming', 'YouTube Premium tanpa iklan + YouTube Music.', 15000, 24000, '', 0],
  ['CapCut Pro 1 Bulan', 'Editing', 'Akses CapCut Pro: template, efek, dan export tanpa watermark.', 25000, null, '', 0],
  ['Canva Pro 1 Bulan', 'Editing', 'Canva Pro: Brand Kit, Magic Resize, ribuan template premium.', 10000, 17000, 'Promo', 1],
  ['ChatGPT Plus 1 Bulan', 'AI', 'Akses ChatGPT Plus selama 1 bulan.', 60000, null, '', 1],
  ['Claude Pro 1 Bulan', 'AI', 'Akses Claude Pro selama 1 bulan.', 65000, null, 'Baru', 0],
];
if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
  const ins = db.prepare('INSERT INTO products (name, category, description, price, compare_at, badge, featured) VALUES (?,?,?,?,?,?,?)');
  for (const p of SAMPLE) ins.run(...p);
}

const SOLD = "(SELECT COALESCE(SUM(o.qty),0) FROM orders o WHERE o.product_id = p.id AND (o.status LIKE 'paid%'))";
const listProducts = (activeOnly = true, category = null) =>
  db.prepare(`
    SELECT p.*, ${SOLD} AS sold, (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.order_id IS NULL) AS available
    FROM products p
    WHERE (? = 0 OR p.active = 1) AND (? IS NULL OR p.category = ?)
    ORDER BY p.featured DESC, p.category, p.name`).all(activeOnly ? 1 : 0, category, category);

const getProduct = (id) =>
  db.prepare(`
    SELECT p.*, ${SOLD} AS sold, (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.order_id IS NULL) AS available
    FROM products p WHERE p.id = ?`).get(id);

const categories = () =>
  db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').all().map((r) => r.category);

const getOrder = (id) =>
  db.prepare(`
    SELECT o.*, p.name AS product_name FROM orders o
    JOIN products p ON p.id = o.product_id WHERE o.id = ?`).get(id);

const orderItems = (orderId) =>
  db.prepare('SELECT content FROM stock WHERE order_id = ? ORDER BY id').all(orderId).map((r) => r.content);

// ---------- Kupon ----------
const normCode = (c) => String(c || '').trim().toUpperCase().slice(0, 30);
const getCoupon = (code) => db.prepare('SELECT * FROM coupons WHERE code = ?').get(normCode(code));

// Hitung potongan; melempar Error berisi alasan yang aman ditampilkan ke pembeli
function applyCoupon(code, subtotal) {
  const c = getCoupon(code);
  if (!c || !c.active) throw new Error('Kode kupon tidak valid');
  if (c.expires_at && c.expires_at < new Date().toISOString().slice(0, 10)) throw new Error('Kupon sudah kedaluwarsa');
  if (c.max_uses && c.used >= c.max_uses) throw new Error('Kuota kupon sudah habis');
  if (subtotal < c.min_amount) throw new Error('Minimal belanja untuk kupon ini Rp' + c.min_amount.toLocaleString('id-ID'));
  const off = c.type === 'percent' ? Math.floor((subtotal * Math.min(c.value, 100)) / 100) : c.value;
  return { code: c.code, discount: Math.min(off, subtotal - 1000) }; // total tidak boleh di bawah Rp1.000 (batas minimal gateway)
}

function createOrder({ productId, qty, name, contact, backorder = false, coupon = '', userId = null }) {
  const id = 'ORD-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const key = crypto.randomBytes(16).toString('hex');
  return db.transaction(() => {
    const p = getProduct(productId);
    if (!p || !p.active) throw new Error('Produk tidak ditemukan');
    if (p.available < qty && !backorder) throw new Error('Stok tidak mencukupi');
    const subtotal = p.price * qty;
    const c = normCode(coupon) ? applyCoupon(coupon, subtotal) : { code: null, discount: 0 };
    db.prepare(
      'INSERT INTO orders (id, product_id, qty, amount, customer_name, contact, access_key, discount, coupon_code, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(id, productId, qty, subtotal - c.discount, name, contact, key, c.discount, c.code, userId);
    if (c.code) db.prepare('UPDATE coupons SET used = used + 1 WHERE code = ?').run(c.code);
    return getOrder(id);
  })();
}

const allocatedCount = (orderId) =>
  db.prepare('SELECT COUNT(*) c FROM stock WHERE order_id = ?').get(orderId).c;

const setOrderStatus = (orderId, status) =>
  db.prepare("UPDATE orders SET status = ?, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE id = ?").run(status, orderId);

// Tandai lunas & alokasikan stok lokal secara atomik. Aman dipanggil berulang (idempotent, inkremental).
// Mengembalikan { status, missing }; missing > 0 berarti sisanya harus diambil dari pemasok.
function fulfillLocal(orderId) {
  return db.transaction(() => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!o || !['pending', 'paid_nostock', 'paid_sourcing'].includes(o.status)) {
      return o ? { status: o.status, missing: 0 } : null;
    }
    let have = allocatedCount(orderId);
    const rows = db
      .prepare('SELECT id FROM stock WHERE product_id = ? AND order_id IS NULL ORDER BY id LIMIT ?')
      .all(o.product_id, Math.max(0, o.qty - have));
    const upd = db.prepare('UPDATE stock SET order_id = ? WHERE id = ?');
    for (const r of rows) upd.run(orderId, r.id);
    have += rows.length;
    const missing = o.qty - have;
    const hasSources = db.prepare('SELECT 1 x FROM product_sources WHERE product_id = ? AND active = 1').get(o.product_id);
    const status = missing === 0 ? 'paid' : hasSources ? 'paid_sourcing' : 'paid_nostock';
    setOrderStatus(orderId, status);
    return { status, missing };
  })();
}

const markFailed = (orderId) =>
  db.transaction(() => {
    const r = db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(orderId);
    if (r.changes) db.prepare('UPDATE coupons SET used = MAX(0, used - 1) WHERE code = (SELECT coupon_code FROM orders WHERE id = ?)').run(orderId);
  })();

// ---------- Percobaan pembayaran ----------
const attemptsOf = (orderId) =>
  db.prepare('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY rowid').all(orderId);
const getAttempt = (ref) => db.prepare('SELECT * FROM payment_attempts WHERE ref = ?').get(ref);
const addAttempt = (orderId, provider, ref, payUrl, extRef = null) => {
  db.prepare('INSERT INTO payment_attempts (ref, order_id, provider, pay_url, ext_ref) VALUES (?,?,?,?,?)').run(ref, orderId, provider, payUrl, extRef);
  return getAttempt(ref);
};
const setAttemptStatus = (ref, status) =>
  db.prepare('UPDATE payment_attempts SET status = ? WHERE ref = ?').run(status, ref);

// ---------- Pemasok / agregator ----------
const listSources = (productId) =>
  db.prepare('SELECT * FROM product_sources WHERE product_id = ? AND active = 1 ORDER BY priority, id').all(productId);
const addSource = (productId, supplier, sku, priority) =>
  db.prepare('INSERT INTO product_sources (product_id, supplier, sku, priority) VALUES (?,?,?,?)').run(productId, supplier, sku, priority);
const deleteSource = (id) => db.prepare('DELETE FROM product_sources WHERE id = ?').run(id);

const txOf = (orderId) => db.prepare('SELECT * FROM supplier_tx WHERE order_id = ? ORDER BY rowid').all(orderId);
const addTx = (ref, orderId, supplier, sku) =>
  db.prepare('INSERT INTO supplier_tx (ref, order_id, supplier, sku) VALUES (?,?,?,?)').run(ref, orderId, supplier, sku);
const setTx = (ref, status, message) =>
  db.prepare('UPDATE supplier_tx SET status = ?, message = ? WHERE ref = ?').run(status, String(message ?? '').slice(0, 300), ref);
const sourcingOrders = () =>
  db.prepare("SELECT id FROM orders WHERE status = 'paid_sourcing'").all().map((r) => r.id);
const nostockOrders = () =>
  db.prepare("SELECT id FROM orders WHERE status = 'paid_nostock'").all().map((r) => r.id);

// Hasil dari pemasok langsung dicatat sebagai stok milik pesanan
const addDeliveredItem = (productId, orderId, content) =>
  db.prepare('INSERT INTO stock (product_id, content, order_id) VALUES (?,?,?)').run(productId, content, orderId);

// ---------- Daftar pesanan admin (filter + halaman) ----------
const ORDER_SELECT = `
  SELECT o.*, p.name AS product_name,
    COALESCE((SELECT provider FROM payment_attempts a WHERE a.order_id = o.id AND a.status IN ('paid','paid_duplicate') ORDER BY a.rowid LIMIT 1),
             (SELECT provider FROM payment_attempts a WHERE a.order_id = o.id ORDER BY a.rowid DESC LIMIT 1)) AS gateway,
    (SELECT COUNT(*) FROM payment_attempts a WHERE a.order_id = o.id AND a.status = 'paid_duplicate') AS dup,
    (SELECT COUNT(*) FROM payment_attempts a WHERE a.order_id = o.id AND a.status = 'paid_duplicate' AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.attempt_ref = a.ref AND r.status IN ('pending','succeeded'))) AS dup_open,
    (SELECT COUNT(*) FROM refunds r WHERE r.order_id = o.id AND r.status = 'failed' AND NOT EXISTS (SELECT 1 FROM refunds r2 WHERE r2.attempt_ref = r.attempt_ref AND r2.status IN ('pending','succeeded'))) AS refund_failed,
    (SELECT COUNT(*) FROM supplier_tx t WHERE t.order_id = o.id AND t.status = 'unknown') AS unknown_tx
  FROM orders o JOIN products p ON p.id = o.product_id`;

const FLAGS = {
  refund_failed: "EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id AND r.status = 'failed' AND NOT EXISTS (SELECT 1 FROM refunds r2 WHERE r2.attempt_ref = r.attempt_ref AND r2.status IN ('pending','succeeded')))",
  unknown: "EXISTS (SELECT 1 FROM supplier_tx t WHERE t.order_id = o.id AND t.status = 'unknown')",
  dup: "EXISTS (SELECT 1 FROM payment_attempts a WHERE a.order_id = o.id AND a.status = 'paid_duplicate' AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.attempt_ref = a.ref AND r.status IN ('pending','succeeded')))",
};

function searchOrders({ status = '', q = '', page = 1, size = 25, flag = '' } = {}) {
  const where = [];
  const args = [];
  if (status === 'paid') where.push("o.status LIKE 'paid%'");
  else if (status) (where.push('o.status = ?'), args.push(status));
  if (q) {
    where.push('(o.id LIKE ? OR o.customer_name LIKE ? OR o.contact LIKE ?)');
    args.push(...Array(3).fill(`%${q}%`));
  }
  if (FLAGS[flag]) where.push(FLAGS[flag]);
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM orders o${w}`).get(...args).c;
  const pages = Math.max(1, Math.ceil(total / size));
  page = Math.min(Math.max(1, page), pages);
  const rows = db.prepare(`${ORDER_SELECT}${w} ORDER BY o.created_at DESC, o.rowid DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  return { rows, total, page, pages };
}

const orderStats = () =>
  db.prepare("SELECT COUNT(*) orders, COALESCE(SUM(status LIKE 'paid%'),0) paid, COALESCE(SUM(CASE WHEN status LIKE 'paid%' THEN amount END),0) revenue FROM orders").get();

// Laporan penjualan `days` hari terakhir (hanya pesanan lunas)
function salesReport(days = 30) {
  const since = `-${Math.max(1, Math.min(365, days))} days`;
  const paid = "o.status LIKE 'paid%' AND date(o.created_at) >= date('now', ?)";
  return {
    daily: db.prepare(`SELECT date(o.created_at) day, COUNT(*) orders, SUM(o.amount) revenue, SUM(o.discount) discount FROM orders o WHERE ${paid} GROUP BY day ORDER BY day DESC`).all(since),
    byProduct: db.prepare(`SELECT p.name, SUM(o.qty) qty, SUM(o.amount) revenue FROM orders o JOIN products p ON p.id = o.product_id WHERE ${paid} GROUP BY p.id ORDER BY revenue DESC`).all(since),
    byGateway: db.prepare(`SELECT COALESCE(a.provider,'-') gateway, COUNT(*) orders, SUM(o.amount) revenue FROM orders o LEFT JOIN payment_attempts a ON a.order_id = o.id AND a.status IN ('paid','paid_duplicate') WHERE ${paid} GROUP BY gateway ORDER BY revenue DESC`).all(since),
    bySupplier: db.prepare(`SELECT t.supplier, SUM(t.status = 'success') ok, SUM(t.status = 'failed') failed, SUM(t.status IN ('pending','unknown')) other FROM supplier_tx t JOIN orders o ON o.id = t.order_id WHERE date(o.created_at) >= date('now', ?) GROUP BY t.supplier`).all(since),
  };
}

// Pelacakan pesanan: ID + kontak yang sama dengan saat checkout (angka saja untuk nomor HP, 08.. = 628..)
const digits = (c) => String(c).replace(/\D/g, '').replace(/^0/, '62');
function findOrderByContact(id, contact) {
  const o = getOrder(String(id || '').trim().toUpperCase());
  if (!o) return null;
  const a = String(contact || '').trim().toLowerCase();
  const b = String(o.contact).trim().toLowerCase();
  return a && (a === b || (digits(a).length >= 8 && digits(a) === digits(b))) ? o : null;
}

const ordersOfUser = (userId) =>
  db.prepare(`SELECT o.id, o.qty, o.amount, o.discount, o.coupon_code, o.status, o.created_at, o.access_key, p.name AS product_name FROM orders o JOIN products p ON p.id = o.product_id WHERE o.user_id = ? ORDER BY o.created_at DESC, o.rowid DESC LIMIT 100`).all(userId);

const listCoupons = () => db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
const saveCoupon = ({ code, type, value, minAmount, maxUses, expiresAt }) =>
  db.prepare(
    `INSERT INTO coupons (code, type, value, min_amount, max_uses, expires_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(code) DO UPDATE SET type=excluded.type, value=excluded.value, min_amount=excluded.min_amount, max_uses=excluded.max_uses, expires_at=excluded.expires_at, active=1`
  ).run(normCode(code), type === 'fixed' ? 'fixed' : 'percent', value, minAmount, maxUses, expiresAt || null);
const toggleCoupon = (code) => db.prepare('UPDATE coupons SET active = 1 - active WHERE code = ?').run(normCode(code));

// Penanda status yang sudah diberitahukan ke pembeli/admin, agar notifikasi tidak terkirim dua kali
const claimNotice = (orderId, status) =>
  db.prepare('UPDATE orders SET notified = ? WHERE id = ? AND COALESCE(notified, \'\') != ?').run(status, orderId, status).changes > 0;

// ---------- Stok & dasbor ----------
const LOW_STOCK = () => Math.max(1, parseInt(process.env.LOW_STOCK, 10) || 5);

function stockOverview() {
  return db
    .prepare(
      `SELECT p.id, p.name, p.category, p.active, p.image,
        (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.order_id IS NULL) AS available,
        (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.order_id IS NOT NULL) AS used,
        (SELECT COUNT(*) FROM product_sources ps WHERE ps.product_id = p.id AND ps.active = 1) AS sources
       FROM products p ORDER BY available ASC, p.name`
    )
    .all();
}

const orderCounts = () => Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM orders GROUP BY status').all().map((r) => [r.status, r.c]));

// Jumlah hal yang perlu tindakan admin (untuk lencana di menu)
const attentionCount = () =>
  db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'paid_nostock'").get().c +
  db.prepare("SELECT COUNT(DISTINCT order_id) c FROM supplier_tx WHERE status = 'unknown'").get().c;

// Angka dasbor. Periode dibandingkan dengan periode sebelumnya yang sama panjang.
function dashboard(days = 30) {
  const sum = (from, to) =>
    db
      .prepare(
        `SELECT COUNT(*) orders, COALESCE(SUM(amount),0) revenue FROM orders
         WHERE status LIKE 'paid%' AND date(created_at) >= date('now', ?) AND date(created_at) < date('now', ?)`
      )
      .get(from, to);
  const cur = sum(`-${days - 1} days`, '+1 day');
  const prev = sum(`-${days * 2 - 1} days`, `-${days - 1} days`);
  const today = db.prepare("SELECT COUNT(*) orders, COALESCE(SUM(amount),0) revenue FROM orders WHERE status LIKE 'paid%' AND date(created_at) = date('now')").get();
  const series = db
    .prepare(`SELECT date(created_at) day, COUNT(*) orders, SUM(amount) revenue FROM orders WHERE status LIKE 'paid%' AND date(created_at) >= date('now', ?) GROUP BY day`)
    .all(`-${days - 1} days`);
  const byDay = new Map(series.map((r) => [r.day, r]));
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    daily.push({ day: d, orders: byDay.get(d)?.orders || 0, revenue: byDay.get(d)?.revenue || 0 });
  }
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM orders GROUP BY status').all().map((r) => [r.status, r.c]));
  const attention = {
    nostock: counts.paid_nostock || 0,
    sourcing: counts.paid_sourcing || 0,
    pending: counts.pending || 0,
    refundFailed: db.prepare("SELECT COUNT(DISTINCT order_id) c FROM refunds r WHERE status = 'failed' AND NOT EXISTS (SELECT 1 FROM refunds r2 WHERE r2.attempt_ref = r.attempt_ref AND r2.status IN ('pending','succeeded'))").get().c,
    unknownTx: db.prepare("SELECT COUNT(DISTINCT order_id) c FROM supplier_tx WHERE status = 'unknown'").get().c,
    dupOpen: db.prepare("SELECT COUNT(*) c FROM payment_attempts a WHERE a.status = 'paid_duplicate' AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.attempt_ref = a.ref AND r.status IN ('pending','succeeded'))").get().c,
  };
  const top = db
    .prepare(`SELECT p.id, p.name, p.image, SUM(o.qty) qty, SUM(o.amount) revenue FROM orders o JOIN products p ON p.id = o.product_id WHERE o.status LIKE 'paid%' AND date(o.created_at) >= date('now', ?) GROUP BY p.id ORDER BY revenue DESC LIMIT 5`)
    .all(`-${days - 1} days`);
  const low = stockOverview().filter((p) => p.active && p.sources === 0 && p.available <= LOW_STOCK());
  const recent = searchOrders({ size: 6 }).rows;
  return { cur, prev, today, daily, counts, attention, top, low, recent, users: db.prepare('SELECT COUNT(*) c FROM users').get().c };
}

module.exports = {
  orderCounts, attentionCount, stockOverview, dashboard, LOW_STOCK,
  ordersOfUser, addColumn,
  applyCoupon, getCoupon, listCoupons, saveCoupon, toggleCoupon, searchOrders, orderStats, salesReport, findOrderByContact, claimNotice,
  db, listProducts, getProduct, categories, getOrder, orderItems, createOrder, fulfillLocal, markFailed,
  allocatedCount, setOrderStatus, attemptsOf, getAttempt, addAttempt, setAttemptStatus,
  listSources, addSource, deleteSource, txOf, addTx, setTx, sourcingOrders, nostockOrders, addDeliveredItem,
};
