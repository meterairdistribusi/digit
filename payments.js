const store = require('./db');
const { health } = require('./http');

const providers = {
  midtrans: require('./providers/midtrans'),
  xendit: require('./providers/xendit'),
  tripay: require('./providers/tripay'),
  ipaymu: require('./providers/ipaymu'),
};

// Urutan prioritas gateway; ubah lewat env PAYMENT_PRIORITY=xendit,midtrans
const priority = () =>
  (process.env.PAYMENT_PRIORITY || 'midtrans,xendit,tripay,ipaymu')
    .split(',')
    .map((s) => s.trim())
    .filter((n) => providers[n]);
const enabledNames = () => priority().filter((n) => providers[n].enabled());
const anyEnabled = () => enabledNames().length > 0;

// Buat tagihan di gateway pertama yang berhasil; otomatis pindah ke cadangan bila gagal.
// `exclude` dipakai saat pembeli minta ganti metode (lewati gateway yang sedang dipakai).
async function createAttempt(order, productName, baseUrl, exclude = []) {
  const finishUrl = `${baseUrl}/order/${order.id}?k=${order.access_key}`;
  const names = health.order(enabledNames().filter((n) => !exclude.includes(n)), 'pay:');
  const errors = [];
  for (const name of names) {
    const ref = `${order.id}-P${store.attemptsOf(order.id).length + 1}`;
    try {
      const { payUrl, extRef } = await providers[name].create({ ref, order, productName, finishUrl });
      health.good('pay:' + name);
      return store.addAttempt(order.id, name, ref, payUrl, extRef);
    } catch (e) {
      health.bad('pay:' + name);
      errors.push(`${name}: ${e.message}`);
      console.error(`[payments] ${name} gagal membuat tagihan:`, e.message);
    }
  }
  throw new Error(names.length ? 'Semua gateway gagal: ' + errors.join('; ') : 'Tidak ada gateway pembayaran aktif');
}

module.exports = { providers, enabledNames, anyEnabled, createAttempt, priority };
