const store = require('./db');
const suppliers = require('./suppliers');
const payments = require('./payments');
const { health } = require('./http');
const notify = require('./notify');

const inflight = new Set();

function applyResult(order, tx, r) {
  if (r.status === 'success') store.addDeliveredItem(order.product_id, order.id, r.content);
  store.setTx(tx.ref, r.status, r.message);
}

// Ambil kekurangan stok dari pemasok sesuai urutan prioritas; pindah ke pemasok berikutnya bila gagal.
// Satu pesanan hanya diproses satu proses pada satu waktu (inflight) supaya tidak membeli ganda.
async function sourceOrder(orderId) {
  if (inflight.has(orderId)) return;
  inflight.add(orderId);
  try {
    const order = store.getOrder(orderId);
    if (!order || !['paid_sourcing', 'paid_nostock'].includes(order.status)) return;

    // 1) Cek ulang transaksi yang masih pending (hanya untuk pemasok yang aman diulang dengan ref sama)
    for (const tx of store.txOf(orderId).filter((t) => t.status === 'pending')) {
      const a = suppliers.get(tx.supplier);
      if (!a || !a.enabled() || !a.idempotent) continue;
      try {
        applyResult(order, tx, await (a.check || a.buy).call(a, { sku: tx.sku, ref: tx.ref, customer: order.contact, prev: tx.message }));
      } catch (e) {
        console.error('[sourcing] cek ulang gagal', tx.ref, e.message);
      }
    }

    // 2) Beli kekurangannya
    const count = (s) => store.txOf(orderId).filter((t) => t.status === s).length;
    let missing = order.qty - store.allocatedCount(orderId) - count('pending') - count('unknown');
    const sources = store
      .listSources(order.product_id)
      .filter((s) => suppliers.get(s.supplier)?.enabled());
    const ordered = [...sources.filter((s) => health.ok('sup:' + s.supplier)), ...sources.filter((s) => !health.ok('sup:' + s.supplier))];

    let halted = false;
    while (missing > 0 && !halted) {
      let got = false;
      for (const s of ordered) {
        const a = suppliers.get(s.supplier);
        const ref = `${orderId}-S${store.txOf(orderId).length + 1}`;
        store.addTx(ref, orderId, s.supplier, s.sku); // dicatat dulu agar aman bila proses mati di tengah
        const tx = { ref };
        let r;
        try {
          r = await a.buy({ sku: s.sku, ref, customer: order.contact });
          health.good('sup:' + s.supplier);
        } catch (e) {
          health.bad('sup:' + s.supplier);
          console.error(`[sourcing] ${s.supplier} error:`, e.message);
          if (a.idempotent) r = { status: 'pending', message: 'timeout, dicek ulang' };
          else {
            // Tidak tahu apakah pembelian terjadi: jangan coba pemasok lain, serahkan ke admin
            store.setTx(ref, 'unknown', e.message);
            halted = true;
            break;
          }
        }
        applyResult(order, tx, r);
        if (r.status !== 'failed') {
          got = true;
          break;
        }
      }
      if (!got) break;
      missing--;
    }

    // 3) Tentukan status akhir
    const done = store.allocatedCount(orderId) >= order.qty;
    store.setOrderStatus(orderId, done ? 'paid' : count('pending') > 0 ? 'paid_sourcing' : 'paid_nostock');
    if (count('unknown') > 0) notify.alert(`Pesanan ${orderId}: transaksi pemasok tidak pasti, cek manual di dashboard pemasok.`);
    await notify.announce(orderId);
  } finally {
    inflight.delete(orderId);
  }
}

// Alokasi stok lokal dulu, sisanya ke pemasok. Dipanggil tanpa await agar webhook cepat membalas.
async function settle(orderId) {
  const r = store.fulfillLocal(orderId);
  if (r && r.missing > 0) await sourceOrder(orderId);
  else await notify.announce(orderId);
}

// Satu pintu untuk semua kabar pembayaran (webhook maupun cek status). Idempotent.
function onPayment(ref, result, amount) {
  const a = store.getAttempt(ref);
  if (!a) return 'unknown';
  const o = store.getOrder(a.order_id);
  if (result === 'failed') {
    if (a.status === 'pending') store.setAttemptStatus(ref, 'failed');
    return 'ok';
  }
  if (result !== 'paid' || a.status === 'paid' || a.status === 'paid_duplicate') return 'ok';
  if (Number(amount) !== o.amount) {
    console.error('[payments] nominal tidak cocok', ref, amount, o.amount);
    return 'mismatch';
  }
  const alreadyPaid = store.attemptsOf(o.id).some((x) => x.status === 'paid');
  store.setAttemptStatus(ref, alreadyPaid ? 'paid_duplicate' : 'paid'); // duplicate = pembeli bayar dua kali, perlu refund
  if (alreadyPaid) notify.alert(`Pesanan ${o.id}: pembeli membayar dua kali (${ref}). Refund manual lewat dashboard gateway, lalu tandai di admin.`);
  if (!alreadyPaid) settle(o.id).catch((e) => console.error('[settle]', e));
  return 'ok';
}

// Tanya gateway langsung untuk tagihan yang masih pending (jaga-jaga webhook terlambat/hilang)
async function syncPayments(orderId) {
  for (const a of store.attemptsOf(orderId).filter((x) => x.status === 'pending')) {
    try {
      const s = await payments.providers[a.provider].status(a.ref);
      onPayment(a.ref, s.result, s.amount);
    } catch (e) {
      console.error('[payments] sync gagal', a.ref, e.message);
    }
  }
}

// Stok lokal baru ditambah admin → pesanan yang menunggu otomatis terpenuhi
function retryLocal(order) {
  if (order.status === 'paid_nostock' && store.getProduct(order.product_id).available > 0) {
    settle(order.id).catch((e) => console.error('[settle]', e));
  }
}

function startWorker() {
  setInterval(() => {
    for (const id of store.sourcingOrders()) sourceOrder(id).catch((e) => console.error('[worker]', e));
    for (const id of store.nostockOrders()) retryLocal(store.getOrder(id));
  }, 30000).unref();
}

module.exports = { settle, sourceOrder, onPayment, syncPayments, retryLocal, startWorker };
