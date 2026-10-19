const store = require('./db');
const payments = require('./payments');
const settings = require('./settings');
const notify = require('./notify');

// Refund otomatis lewat API gateway tempat pembeli membayar.
//
// Aturan keamanan:
//  - satu refund aktif per tagihan (indeks unik di DB) → tidak bisa refund dua kali walau tombol ditekan berulang;
//  - tagihan dengan status paid_duplicate (pembeli membayar dua kali) boleh direfund penuh;
//  - tagihan utama hanya boleh direfund bila pesanan belum menerima produk apa pun dan tidak ada transaksi pemasok
//    yang masih pending/tak pasti (kalau tidak, uang kembali tapi barang bisa terbeli);
//  - bila API gateway menolak (mis. metode bayar tak mendukung refund), status 'failed' dan admin bisa refund manual
//    di dashboard gateway lalu menekan "Tandai direfund manual".

class RefundError extends Error {}
const db = store.db;

const activeRefund = (ref) => db.prepare("SELECT * FROM refunds WHERE attempt_ref = ? AND status IN ('pending','succeeded')").get(ref);
const listFor = (orderId) => db.prepare('SELECT * FROM refunds WHERE order_id = ? ORDER BY id DESC').all(orderId);

function plan(orderId, attemptRef) {
  const o = store.getOrder(orderId);
  if (!o) throw new RefundError('Pesanan tidak ditemukan');
  const attempts = store.attemptsOf(orderId);
  const a = attemptRef
    ? attempts.find((x) => x.ref === attemptRef)
    : attempts.find((x) => x.status === 'paid_duplicate' && !activeRefund(x.ref)) || attempts.find((x) => x.status === 'paid');
  if (!a || !['paid', 'paid_duplicate'].includes(a.status)) throw new RefundError('Tidak ada pembayaran lunas yang bisa direfund');
  if (activeRefund(a.ref)) throw new RefundError('Tagihan ini sudah direfund / sedang diproses');
  if (a.status === 'paid') {
    if (require('./fulfill').isBusy(orderId)) throw new RefundError('Pesanan sedang diproses sistem, coba lagi sebentar lagi');
    if (store.allocatedCount(orderId) > 0) throw new RefundError('Produk sudah terkirim, refund otomatis tidak diizinkan');
    const open = store.txOf(orderId).filter((t) => ['pending', 'unknown', 'success'].includes(t.status));
    if (open.length) throw new RefundError('Ada transaksi pemasok yang belum final; selesaikan dulu agar tidak rugi dua kali');
  }
  return { o, a };
}

// manual=true: admin sudah mengembalikan uang lewat dashboard gateway; hanya dicatat
async function requestRefund(orderId, { reason = '', by = 'sistem', kind, attemptRef, manual = false } = {}) {
  const { o, a } = plan(orderId, attemptRef);
  kind = kind || (a.status === 'paid_duplicate' ? 'duplicate' : 'customer');
  reason = reason || (kind === 'duplicate' ? 'Pembayaran ganda' : 'Permintaan refund');
  let id;
  try {
    id = Number(
      db.prepare('INSERT INTO refunds (order_id, attempt_ref, provider, amount, reason, requested_by) VALUES (?,?,?,?,?,?)')
        .run(orderId, a.ref, a.provider, o.amount, reason, by).lastInsertRowid
    );
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new RefundError('Tagihan ini sudah direfund / sedang diproses');
    throw e;
  }
  const finish = (status, providerRef, message) => {
    db.prepare("UPDATE refunds SET status = ?, provider_ref = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, providerRef ?? null, String(message ?? '').slice(0, 300), id);
    if (status === 'succeeded') onSucceeded(o, a);
    return db.prepare('SELECT * FROM refunds WHERE id = ?').get(id);
  };

  if (manual) return finish('succeeded', 'manual', 'Dicatat manual oleh ' + by);
  const prov = payments.providers[a.provider];
  if (!prov || !prov.refund || !prov.enabled()) return finish('failed', null, 'Gateway tidak mendukung/aktif untuk refund API');
  try {
    const r = await prov.refund({ ref: a.ref, amount: o.amount, reason, refundKey: `RF${id}-${a.ref}`, kind });
    return finish(r.status, r.providerRef, r.message);
  } catch (e) {
    // Hasil tak diketahui (timeout): tetap 'pending' agar tidak bisa dikirim dua kali; admin memeriksa dashboard gateway.
    return finish('pending', null, 'Respons gateway tidak jelas: ' + e.message);
  }
}

function onSucceeded(o, a) {
  if (a.status === 'paid') store.setOrderStatus(o.id, 'refunded');
  notify.refunded(o, a).catch(() => {});
}

// Pembayaran ganda → refund otomatis (bisa dimatikan di Pengaturan → Refund)
async function autoRefundDuplicate(orderId, attemptRef) {
  if (!settings.bool('AUTO_REFUND_DUPLICATE')) return null;
  try {
    const r = await requestRefund(orderId, { attemptRef, kind: 'duplicate', by: 'sistem' });
    if (r.status !== 'succeeded') notify.alert(`Refund otomatis pesanan ${orderId} berstatus ${r.status}: ${r.message || '-'}. Periksa di admin.`);
    return r;
  } catch (e) {
    notify.alert(`Refund otomatis pesanan ${orderId} gagal: ${e.message}`);
    return null;
  }
}

module.exports = { requestRefund, autoRefundDuplicate, listFor, plan, RefundError };
