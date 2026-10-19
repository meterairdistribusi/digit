const store = require('./db');
const payments = require('./payments');
const suppliers = require('./suppliers');

// Logika checkout yang dipakai bersama oleh web dan API aplikasi mobile.

class CheckoutError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PROD = () => process.env.NODE_ENV === 'production';

// Produk bisa dibeli bila ada stok lokal ATAU ada pemasok cadangan yang aktif
const decorate = (p) => {
  const viaSupplier = store.listSources(p.id).some((s) => suppliers.get(s.supplier)?.enabled());
  p.viaSupplier = viaSupplier;
  p.orderable = p.available > 0 || viaSupplier;
  p.maxQty = viaSupplier ? 10 : Math.min(p.available, 10);
  return p;
};

async function placeOrder({ productId, qty, name, contact, coupon = '', userId = null, baseUrl }) {
  qty = Math.min(10, Math.max(1, parseInt(qty, 10) || 1));
  name = String(name || '').trim().slice(0, 60);
  contact = String(contact || '').trim().slice(0, 80);
  const p = store.getProduct(Number(productId));
  if (!p || !p.active) throw new CheckoutError(404, 'Produk tidak ditemukan');
  decorate(p);
  if (!name || !contact) throw new CheckoutError(400, 'Nama dan kontak wajib diisi');
  if (PROD() && !payments.anyEnabled()) throw new CheckoutError(503, 'Pembayaran belum tersedia');

  let order;
  try {
    order = store.createOrder({ productId: p.id, qty, name, contact, backorder: p.viaSupplier, coupon, userId });
  } catch (e) {
    throw new CheckoutError(400, e.message);
  }
  let attempt = null;
  if (payments.anyEnabled()) {
    try {
      attempt = await payments.createAttempt(order, p.name, baseUrl);
    } catch (e) {
      console.error(e.message);
      store.markFailed(order.id);
      throw new CheckoutError(502, 'Semua metode pembayaran sedang gangguan, coba lagi sebentar lagi.');
    }
  }
  return { order, attempt, product: p };
}

module.exports = { placeOrder, decorate, CheckoutError };
