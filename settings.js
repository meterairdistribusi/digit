const { db } = require('./db');
const box = require('./cryptobox');

// Pengaturan yang bisa diubah dari admin. Nilai tersimpan di DB (rahasia dienkripsi AES-256-GCM) dan menimpa env;
// menghapus nilai di admin mengembalikan nilai env aslinya. Kode lain tetap membaca process.env, jadi tidak perlu diubah.

const F = (key, label, o = {}) => ({ key, label, secret: false, ...o });
const S = (key, label, o = {}) => F(key, label, { secret: true, ...o });

const GROUPS = [
  {
    id: 'toko', label: 'Toko',
    fields: [
      F('STORE_NAME', 'Nama toko'),
      F('WHATSAPP_NUMBER', 'Nomor WhatsApp (628xxx)'),
      F('BASE_URL', 'URL publik toko', { help: 'Dipakai untuk link di notifikasi dan redirect pembayaran, mis. https://toko.com' }),
    ],
  },
  {
    id: 'midtrans', label: 'Midtrans', kind: 'gateway',
    help: 'Daftarkan webhook: {BASE_URL}/pay/midtrans/notify',
    fields: [S('MIDTRANS_SERVER_KEY', 'Server key'), F('MIDTRANS_IS_PRODUCTION', 'Mode produksi', { hidden: true })],
  },
  {
    id: 'xendit', label: 'Xendit', kind: 'gateway',
    help: 'Daftarkan webhook: {BASE_URL}/pay/xendit/notify. Kunci "xnd_development_…" = sandbox, "xnd_production_…" = produksi.',
    fields: [S('XENDIT_SECRET_KEY', 'Secret key'), S('XENDIT_CALLBACK_TOKEN', 'Callback verification token')],
  },
  { id: 'pembayaran', label: 'Urutan gateway', fields: [F('PAYMENT_PRIORITY', 'Urutan prioritas', { help: 'Pisahkan koma, mis. midtrans,xendit' })] },
  { id: 'digiflazz', label: 'Digiflazz', kind: 'supplier', fields: [F('DIGIFLAZZ_USERNAME', 'Username'), S('DIGIFLAZZ_API_KEY', 'API key (production)'), F('DIGIFLAZZ_TESTING', 'Mode uji', { hidden: true })] },
  { id: 'vipreseller', label: 'VIP Reseller', kind: 'supplier', fields: [F('VIPRESELLER_API_ID', 'API ID'), S('VIPRESELLER_API_KEY', 'API key')] },
  { id: 'tokovoucher', label: 'Tokovoucher', kind: 'supplier', fields: [F('TOKOVOUCHER_MEMBER_CODE', 'Member code'), S('TOKOVOUCHER_SECRET', 'Secret')] },
  { id: 'apigames', label: 'Apigames', kind: 'supplier', fields: [F('APIGAMES_MERCHANT_ID', 'Merchant ID'), S('APIGAMES_SECRET', 'Secret')] },
  {
    id: 'reloadly', label: 'Reloadly (luar negeri)', kind: 'supplier',
    fields: [F('RELOADLY_CLIENT_ID', 'Client ID'), S('RELOADLY_CLIENT_SECRET', 'Client secret'), F('RELOADLY_FALLBACK_EMAIL', 'Email penerima cadangan'), F('RELOADLY_SANDBOX', 'Mode sandbox', { hidden: true })],
  },
  { id: 'dingconnect', label: 'DingConnect (luar negeri)', kind: 'supplier', fields: [S('DINGCONNECT_API_KEY', 'API key')] },
  {
    id: 'custom', label: 'Agregator lain (JSON)', kind: 'supplier',
    help: 'Daftar agregator tambahan dalam format JSON (lihat README). Rahasia boleh ditulis langsung di sini; disimpan terenkripsi.',
    fields: [S('SUPPLIERS_JSON', 'SUPPLIERS_JSON', { textarea: true })],
  },
  {
    id: 'notifikasi', label: 'Notifikasi',
    fields: [
      S('FONNTE_TOKEN', 'Fonnte token (WhatsApp)'), S('RESEND_API_KEY', 'Resend API key (email)'), F('MAIL_FROM', 'Alamat pengirim email'),
      S('TELEGRAM_BOT_TOKEN', 'Telegram bot token (alert admin)'), F('TELEGRAM_CHAT_ID', 'Telegram chat ID'),
      S('EXPO_ACCESS_TOKEN', 'Expo access token (push, opsional; wajib bila "Enhanced Push Security" aktif)'),
    ],
  },
  { id: 'refund', label: 'Refund', fields: [F('AUTO_REFUND_DUPLICATE', 'Refund otomatis pembayaran ganda', { bool: true, def: 'true' })] },
  {
    id: 'legal', label: 'Data penjual & dokumen hukum',
    help: 'Isi data penjual agar kebijakan terisi otomatis. Teks kebijakan boleh diganti penuh; kosongkan untuk memakai templat bawaan.',
    fields: [
      F('LEGAL_COMPANY', 'Nama penjual / badan usaha'), F('LEGAL_EMAIL', 'Email kontak privasi'), F('LEGAL_ADDRESS', 'Alamat'),
      F('LEGAL_PRIVACY', 'Teks Kebijakan Privasi (opsional)', { textarea: true }),
      F('LEGAL_TERMS', 'Teks Syarat & Ketentuan (opsional)', { textarea: true }),
      F('LEGAL_REFUND', 'Teks Kebijakan Refund (opsional)', { textarea: true }),
    ],
  },
];

const FIELDS = Object.fromEntries(GROUPS.flatMap((g) => g.fields.map((f) => [f.key, { ...f, group: g.id }])));
const original = Object.fromEntries(Object.keys(FIELDS).map((k) => [k, process.env[k]]));

function apply() {
  for (const [k, orig] of Object.entries(original)) {
    if (orig === undefined) delete process.env[k];
    else process.env[k] = orig;
  }
  for (const r of db.prepare('SELECT * FROM settings').all()) {
    if (!FIELDS[r.key]) continue;
    try {
      process.env[r.key] = r.secret ? box.decrypt(r.value) : r.value;
    } catch (e) {
      console.error(`[settings] ${r.key} tidak bisa didekripsi (SETTINGS_KEY berubah?) — isi ulang di admin`);
    }
  }
}

const stored = (key) => db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
const get = (key) => process.env[key] ?? FIELDS[key]?.def ?? '';
const bool = (key) => String(get(key)).toLowerCase() === 'true';

// Simpan satu nilai (string kosong = hapus override, kembali ke env). Rahasia tidak pernah dikembalikan utuh ke UI.
function set(key, value, by = '') {
  const f = FIELDS[key];
  if (!f) throw new Error('Pengaturan tidak dikenal: ' + key);
  value = String(value ?? '').trim();
  if (!value) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else
    db.prepare(
      `INSERT INTO settings (key, value, secret, updated_by, updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, secret=excluded.secret, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`
    ).run(key, f.secret ? box.encrypt(value) : value, f.secret ? 1 : 0, by);
  apply();
}

const mask = (v) => (v ? (v.length <= 8 ? '••••' : '••••' + v.slice(-4)) : '');

// Tampilan aman untuk admin: rahasia hanya 4 karakter terakhir
function view(groupId) {
  const g = GROUPS.find((x) => x.id === groupId);
  return g.fields.filter((f) => !f.hidden).map((f) => {
    const cur = process.env[f.key] || '';
    const row = stored(f.key);
    return { ...f, value: f.secret ? '' : cur, masked: f.secret ? mask(cur) : '', isSet: Boolean(cur), source: row ? 'admin' : cur ? 'env' : '' };
  });
}

module.exports = { GROUPS, FIELDS, apply, get, bool, set, view };
