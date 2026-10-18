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
// order status: pending | paid | paid_sourcing (menunggu pemasok) | paid_nostock | failed
// attempt status: pending | paid | paid_duplicate | failed

const SAMPLE = [
  ['Netflix Premium 1 Bulan', 'Streaming', 'Akun Netflix Premium 1 profil, garansi selama masa aktif.', 35000],
  ['YouTube Premium 1 Bulan', 'Streaming', 'YouTube Premium tanpa iklan + YouTube Music.', 15000],
  ['CapCut Pro 1 Bulan', 'Editing', 'Akses CapCut Pro: template, efek, dan export tanpa watermark.', 25000],
  ['Canva Pro 1 Bulan', 'Editing', 'Canva Pro: Brand Kit, Magic Resize, ribuan template premium.', 10000],
  ['ChatGPT Plus 1 Bulan', 'AI', 'Akses ChatGPT Plus selama 1 bulan.', 60000],
  ['Claude Pro 1 Bulan', 'AI', 'Akses Claude Pro selama 1 bulan.', 65000],
];
if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
  const ins = db.prepare('INSERT INTO products (name, category, description, price) VALUES (?,?,?,?)');
  for (const p of SAMPLE) ins.run(...p);
}

const listProducts = (activeOnly = true, category = null) =>
  db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.order_id IS NULL) AS available
    FROM products p
    WHERE (? = 0 OR p.active = 1) AND (? IS NULL OR p.category = ?)
    ORDER BY p.category, p.name`).all(activeOnly ? 1 : 0, category, category);

const getProduct = (id) =>
  db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.order_id IS NULL) AS available
    FROM products p WHERE p.id = ?`).get(id);

const categories = () =>
  db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category').all().map((r) => r.category);

const getOrder = (id) =>
  db.prepare(`
    SELECT o.*, p.name AS product_name FROM orders o
    JOIN products p ON p.id = o.product_id WHERE o.id = ?`).get(id);

const orderItems = (orderId) =>
  db.prepare('SELECT content FROM stock WHERE order_id = ? ORDER BY id').all(orderId).map((r) => r.content);

function createOrder({ productId, qty, name, contact, backorder = false }) {
  const id = 'ORD-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const key = crypto.randomBytes(16).toString('hex');
  return db.transaction(() => {
    const p = getProduct(productId);
    if (!p || !p.active) throw new Error('Produk tidak ditemukan');
    if (p.available < qty && !backorder) throw new Error('Stok tidak mencukupi');
    db.prepare(
      'INSERT INTO orders (id, product_id, qty, amount, customer_name, contact, access_key) VALUES (?,?,?,?,?,?,?)'
    ).run(id, productId, qty, p.price * qty, name, contact, key);
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
  db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(orderId);

// ---------- Percobaan pembayaran ----------
const attemptsOf = (orderId) =>
  db.prepare('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY rowid').all(orderId);
const getAttempt = (ref) => db.prepare('SELECT * FROM payment_attempts WHERE ref = ?').get(ref);
const addAttempt = (orderId, provider, ref, payUrl) => {
  db.prepare('INSERT INTO payment_attempts (ref, order_id, provider, pay_url) VALUES (?,?,?,?)').run(ref, orderId, provider, payUrl);
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

module.exports = {
  db, listProducts, getProduct, categories, getOrder, orderItems, createOrder, fulfillLocal, markFailed,
  allocatedCount, setOrderStatus, attemptsOf, getAttempt, addAttempt, setAttemptStatus,
  listSources, addSource, deleteSource, txOf, addTx, setTx, sourcingOrders, nostockOrders, addDeliveredItem,
};
