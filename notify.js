const store = require('./db');
const { fetchJson } = require('./http');

// Notifikasi ke pembeli (WhatsApp via Fonnte, email via Resend) dan ke admin (Telegram).
// Semuanya opsional lewat env; tanpa env, fungsi ini tidak melakukan apa-apa. Kegagalan kirim hanya dicatat di log
// dan tidak pernah menggagalkan pesanan. Isi produk (akun/kode) TIDAK dikirim lewat notifikasi, hanya link pesanan.

const STORE = () => process.env.STORE_NAME || 'Toko Digital';
const link = (o) => `${(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}/order/${o.id}?k=${o.access_key}`;
const isEmail = (c) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c);
const isPhone = (c) => String(c).replace(/\D/g, '').length >= 9 && !isEmail(c);
const phone = (c) => String(c).replace(/\D/g, '').replace(/^0/, '62');

const channels = {
  async whatsapp(to, text) {
    if (!process.env.FONNTE_TOKEN) return false;
    await fetchJson('https://api.fonnte.com/send', {
      method: 'POST',
      headers: { Authorization: process.env.FONNTE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: phone(to), message: text }),
    });
    return true;
  },
  async email(to, subject, text) {
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return false;
    await fetchJson('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
    });
    return true;
  },
  async telegram(text) {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return false;
    await fetchJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    });
    return true;
  },
};

const safe = (label, p) => p.catch((e) => console.error(`[notify] ${label} gagal:`, e.message));

function toBuyer(o, subject, text) {
  if (isEmail(o.contact)) return safe('email', channels.email(o.contact, subject, text));
  if (isPhone(o.contact)) return safe('whatsapp', channels.whatsapp(o.contact, text));
  return Promise.resolve();
}

const toAdmin = (text) => safe('telegram', channels.telegram(`[${STORE()}] ${text}`));

// Dipanggil setiap status pesanan mungkin berubah. Satu status hanya diumumkan sekali per pesanan.
async function announce(orderId) {
  const o = store.getOrder(orderId);
  if (!o || !o.status.startsWith('paid') || !store.claimNotice(orderId, o.status)) return;
  const head = `Halo ${o.customer_name}, `;
  if (o.status === 'paid') {
    await toBuyer(o, `Pesanan ${o.id} siap`, `${head}pesanan ${o.id} (${o.product_name} ×${o.qty}) sudah siap. Buka produk Anda di:\n${link(o)}`);
  } else if (o.status === 'paid_nostock') {
    await toBuyer(o, `Pesanan ${o.id} diproses`, `${head}pembayaran ${o.id} diterima. Produk sedang disiapkan, kami kabari bila sudah siap. Pantau di:\n${link(o)}`);
    await toAdmin(`Pesanan ${o.id} (${o.product_name} ×${o.qty}) lunas tapi stok/pemasok tidak mencukupi. Isi stok lalu tekan Proses ulang.`);
  }
}

const alert = (text) => toAdmin(text);

module.exports = { announce, alert, channels };
