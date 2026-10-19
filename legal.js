const settings = require('./settings');

// Dokumen hukum untuk aplikasi pelanggan. Templat bawaan di bawah ini adalah DRAF UMUM, bukan nasihat hukum:
// wajib ditinjau konsultan hukum sebelum toko dibuka untuk umum. Penjual bisa mengganti teksnya penuh di Pengaturan.
// Sintaks teks: "## Judul", "- poin", **tebal**, paragraf dipisah baris kosong. Variabel: {{company}} {{email}} {{address}} {{store}} {{wa}}.

const TEMPLATE_DATE = '2026-10-19';

const PRIVACY = `## 1. Siapa kami
{{store}} dikelola oleh {{company}} ("kami"), beralamat di {{address}}. Kebijakan ini menjelaskan bagaimana kami mengumpulkan, menggunakan, menyimpan, dan melindungi data pribadi Anda sesuai Undang-Undang No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP). Kontak pelindungan data: {{email}}.

## 2. Data yang kami kumpulkan
- **Data akun**: nama, alamat email, nomor WhatsApp (opsional), dan kata sandi (disimpan dalam bentuk hash satu arah, tidak pernah dalam bentuk asli).
- **Data pesanan**: produk yang dibeli, jumlah, nilai transaksi, kupon, status pembayaran, dan waktu transaksi.
- **Kontak pembeli**: nomor WhatsApp/email yang Anda isi saat checkout, untuk mengirim informasi pesanan.
- **Data teknis**: alamat IP dan jenis perangkat, dipakai untuk keamanan (mis. pembatasan percobaan login) dan pencegahan penyalahgunaan.
- Kami **tidak** menyimpan nomor kartu, PIN, atau kredensial e-wallet/bank Anda. Pembayaran diproses penuh oleh penyedia pembayaran.

## 3. Untuk apa data digunakan
- Memproses pesanan dan mengirim produk digital kepada Anda.
- Mengirim informasi status pesanan, refund, dan layanan pelanggan.
- Mencegah penipuan, penyalahgunaan, dan pembayaran ganda.
- Memenuhi kewajiban hukum, akuntansi, dan perpajakan.
Dasar pemrosesan: pelaksanaan perjanjian jual-beli dengan Anda, persetujuan Anda, kepentingan sah kami untuk keamanan, dan kewajiban hukum.

## 4. Dengan siapa data dibagikan
Hanya sebatas yang diperlukan untuk melayani pesanan Anda:
- **Penyedia pembayaran** (mis. Midtrans, Xendit) untuk memproses pembayaran dan refund.
- **Pemasok produk digital** (agregator, termasuk yang berada di luar negeri) untuk memenuhi pesanan. Yang diteruskan terbatas pada identitas pesanan serta kontak penerima yang diperlukan produk.
- **Penyedia notifikasi** (WhatsApp/email) untuk mengirim informasi pesanan. Isi produk (akun/kode) tidak dikirim lewat notifikasi.
- **Otoritas** bila diwajibkan oleh hukum.
Kami tidak menjual data pribadi Anda. Sebagian penyedia berada di luar Indonesia sehingga data dapat diproses di luar negeri dengan perlindungan yang setara sesuai UU PDP.

## 5. Berapa lama data disimpan
- Data akun: selama akun aktif, dan dihapus saat Anda menghapus akun.
- Data pesanan dan transaksi: disimpan sesuai kewajiban pencatatan keuangan/perpajakan (umumnya hingga 10 tahun), dipisahkan dari akun Anda setelah akun dihapus.
- Log keamanan: dalam jangka pendek sesuai kebutuhan keamanan.

## 6. Hak Anda
Anda berhak mengakses, memperbaiki, mengunduh salinan, membatasi, menarik persetujuan, dan meminta penghapusan data pribadi Anda. Di aplikasi: menu **Akun → Unduh data saya** dan **Akun → Hapus akun**. Untuk permintaan lain, hubungi {{email}}; kami menanggapi dalam waktu wajar sesuai ketentuan hukum.

## 7. Keamanan
Kata sandi di-hash, data kunci integrasi dienkripsi, koneksi memakai HTTPS, dan akses admin dibatasi per peran. Tidak ada sistem yang sepenuhnya kebal; bila terjadi kebocoran data yang berisiko bagi Anda, kami akan memberitahu Anda dan pihak berwenang sesuai hukum.

## 8. Anak-anak
Layanan ini ditujukan bagi pengguna berusia 17 tahun ke atas atau di bawah pengawasan orang tua/wali.

## 9. Perubahan kebijakan
Perubahan material akan diumumkan di aplikasi/situs. Tanggal pembaruan tercantum di bagian atas halaman.`;

const TERMS = `## 1. Ketentuan umum
Dengan membuat akun atau membeli di {{store}} (dikelola {{company}}), Anda menyetujui Syarat & Ketentuan ini serta Kebijakan Privasi dan Kebijakan Refund.

## 2. Produk digital
- Produk berupa akun, langganan, token, voucher, atau kode digital yang dikirim elektronik setelah pembayaran terkonfirmasi.
- Deskripsi produk (durasi, jenis akses) tercantum di halaman produk. Baca sebelum membeli.
- Ketersediaan dapat berubah; bila produk tidak dapat dipenuhi, Anda berhak atas refund penuh.

## 3. Harga dan pembayaran
- Harga dalam Rupiah dan dapat berubah sewaktu-waktu; harga yang berlaku adalah saat pesanan dibuat.
- Pembayaran melalui penyedia pembayaran pihak ketiga. Tagihan memiliki batas waktu; pesanan yang tidak dibayar akan kedaluwarsa.
- Kupon berlaku sesuai syaratnya (periode, kuota, minimal belanja) dan tidak dapat diuangkan.

## 4. Penggunaan produk
- Gunakan produk sesuai syarat penyedia layanan aslinya (mis. layanan streaming/AI/desain). Jangan menyalahgunakan, menjual ulang tanpa izin, atau mengubah kredensial yang bukan hak Anda kecuali dinyatakan di deskripsi produk.
- Anda bertanggung jawab menjaga kerahasiaan akun dan produk yang Anda terima.

## 5. Garansi
Garansi mengikuti masa aktif dan ketentuan yang tertulis di halaman produk. Klaim garansi diajukan melalui kontak penjual dengan menyertakan ID pesanan.

## 6. Akun pembeli
Anda wajib memberi data yang benar, menjaga kata sandi, dan bertanggung jawab atas aktivitas di akun Anda. Kami dapat menangguhkan akun yang melanggar ketentuan atau terindikasi penipuan. Anda dapat menghapus akun kapan saja dari menu Akun.

## 7. Batas tanggung jawab
Sejauh diizinkan hukum, tanggung jawab kami terbatas pada nilai pesanan yang bersangkutan. Kami tidak bertanggung jawab atas gangguan, perubahan, atau penghentian layanan pihak ketiga (penyedia produk, pembayaran, jaringan) di luar kendali kami.

## 8. Hukum yang berlaku
Ketentuan ini tunduk pada hukum Republik Indonesia. Sengketa diupayakan diselesaikan secara musyawarah terlebih dahulu.

## 9. Kontak
{{company}} · {{address}} · {{email}}{{wa}}`;

const REFUND = `## 1. Kapan Anda berhak refund
- Produk **tidak dapat dikirim** (stok/pemasok tidak tersedia) setelah pembayaran diterima.
- **Pembayaran ganda** untuk pesanan yang sama: kelebihan bayar dikembalikan penuh.
- Produk yang dikirim **tidak berfungsi / tidak sesuai deskripsi** dan tidak dapat kami ganti dalam masa garansi.

## 2. Kapan refund tidak berlaku
- Produk sudah terkirim dan dapat digunakan sesuai deskripsi (produk digital tidak dapat "dikembalikan").
- Kesalahan penggunaan, perubahan kredensial, atau pelanggaran ketentuan oleh pembeli.
- Pembatalan karena berubah pikiran setelah produk diterima.

## 3. Cara dan waktu pengembalian dana
- Refund dikembalikan ke **metode pembayaran yang sama** yang Anda pakai. Pada pembayaran ganda/produk tak terkirim, refund diproses otomatis melalui penyedia pembayaran bila metode bayar mendukung; bila tidak, kami proses manual.
- Waktu dana masuk bergantung penyedia pembayaran dan bank/e-wallet: umumnya 1-14 hari kerja.
- Anda akan menerima pemberitahuan saat refund diproses.

## 4. Cara mengajukan
Hubungi kami di {{email}}{{wa}} dengan menyertakan **ID pesanan** dan penjelasan singkat. Klaim garansi/produk bermasalah sebaiknya diajukan sesegera mungkin selama masa garansi.`;

const DOCS = {
  privacy: { title: 'Kebijakan Privasi', key: 'LEGAL_PRIVACY', template: PRIVACY },
  terms: { title: 'Syarat & Ketentuan', key: 'LEGAL_TERMS', template: TERMS },
  refund: { title: 'Kebijakan Refund', key: 'LEGAL_REFUND', template: REFUND },
};

const vars = () => {
  const wa = (settings.get('WHATSAPP_NUMBER') || '').replace(/\D/g, '');
  return {
    store: settings.get('STORE_NAME') || 'Toko Digital',
    company: settings.get('LEGAL_COMPANY') || '[nama penjual — isi di Pengaturan]',
    email: settings.get('LEGAL_EMAIL') || '[email kontak — isi di Pengaturan]',
    address: settings.get('LEGAL_ADDRESS') || '[alamat — isi di Pengaturan]',
    wa: wa ? ` atau WhatsApp +${wa}` : '',
  };
};

// Markdown ringan → HTML aman (semua teks di-escape lebih dulu)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
function toHtml(md) {
  const out = [];
  let list = null; // item <li> yang sedang dikumpulkan
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    if (list) out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
    para = [];
    list = null;
  };
  for (const line of String(md).split('\n')) {
    if (!line.trim()) flush();
    else if (line.startsWith('## ')) (flush(), out.push(`<h2>${inline(line.slice(3))}</h2>`));
    else if (line.startsWith('- ')) {
      if (para.length) flush();
      (list ||= []).push(line.slice(2));
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('');
}

function doc(name) {
  const d = DOCS[name];
  if (!d) return null;
  const custom = settings.get(d.key).trim();
  const v = vars();
  const text = (custom || d.template).replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] ?? '');
  return { name, title: d.title, markdown: text, html: toHtml(text), updated: TEMPLATE_DATE, custom: Boolean(custom) };
}

const names = () => Object.keys(DOCS);
const missingSellerInfo = () => ['LEGAL_COMPANY', 'LEGAL_EMAIL', 'LEGAL_ADDRESS'].filter((k) => !settings.get(k));

module.exports = { doc, names, DOCS, toHtml, missingSellerInfo, TEMPLATE_DATE };
