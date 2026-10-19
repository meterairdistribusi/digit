# Toko Digital

Toko produk digital (Netflix, CapCut, Canva, ChatGPT, Claude, YouTube, dll). Pembeli checkout → bayar → produk otomatis tampil di halaman pesanan.

Stack: Node.js, Express, SQLite bawaan Node (`node:sqlite`, perlu Node ≥ 22.13). Tanpa build step.

## Jalankan lokal

```bash
npm install
npm start          # http://localhost:3000
```

Tanpa key gateway, app jalan dalam **mode demo** (ada tombol "Simulasikan pembayaran"). Admin: `/admin` (username `admin`, password default dev: `admin`).

## Cara kerja

1. **Stok lokal**: `/admin` → Produk → pilih produk → Tambah stok (satu item per baris, mis. `email|password`).
2. **Pembayaran multi-gateway**: tagihan dibuat di gateway pertama pada `PAYMENT_PRIORITY`. Bila gagal/gangguan, otomatis pindah ke gateway berikutnya (gateway yang baru gagal dilewati 2 menit). Pembeli juga bisa menekan "Coba metode pembayaran lain" di halaman pesanan.
3. **Pemasok cadangan**: di halaman produk, tambah *sumber cadangan* (pemasok + SKU + prioritas). Setelah pembayaran lunas, stok lokal dipakai dulu; kekurangannya dibeli dari pemasok prioritas 1, bila gagal otomatis ke prioritas 2, dst. Produk dengan sumber cadangan tampil "Tersedia" walau stok lokal 0.
4. Status pesanan: `pending` → `paid` (terkirim) / `paid_sourcing` (menunggu pemasok, dicek tiap 30 detik) / `paid_nostock` (semua sumber gagal; admin tekan **Proses ulang** setelah isi stok).

## Gateway pembayaran

| Gateway | Env | Webhook (daftarkan di dashboard) |
|---|---|---|
| Midtrans | `MIDTRANS_SERVER_KEY`, `MIDTRANS_IS_PRODUCTION` | `https://<domain>/pay/midtrans/notify` |
| Xendit | `XENDIT_SECRET_KEY`, `XENDIT_CALLBACK_TOKEN` | `https://<domain>/pay/xendit/notify` (isi token yang sama di Xendit → Webhook verification token) |

Gateway baru cukup ditambah satu file di `providers/` (`create`, `parseWebhook`, `status`) dan didaftarkan di `payments.js`.

Pembeli yang membayar dua tagihan sekaligus ditandai **⚠ dibayar ganda** di admin (perlu refund manual).

## Pemasok / agregator

Semua pemasok dipakai sebagai **cadangan berurutan**: per produk, tambahkan beberapa sumber (pemasok + SKU + prioritas). Bila satu gagal atau sedang gangguan, otomatis pindah ke berikutnya. Pemasok yang baru error dilewati 2 menit (circuit breaker) dan `/admin/status` menandainya.

| Pemasok | Wilayah | Env | Catatan |
|---|---|---|---|
| Digiflazz | ID | `DIGIFLAZZ_USERNAME`, `DIGIFLAZZ_API_KEY` | Terverifikasi. Saldo, cari SKU, cek ulang otomatis. `DIGIFLAZZ_TESTING=true` untuk uji. |
| VIP Reseller | ID | `VIPRESELLER_API_ID`, `VIPRESELLER_API_KEY` | Preset, **belum diuji** |
| Tokovoucher | ID | `TOKOVOUCHER_MEMBER_CODE`, `TOKOVOUCHER_SECRET` | Preset, **belum diuji** |
| Apigames | ID | `APIGAMES_MERCHANT_ID`, `APIGAMES_SECRET` | Preset, **belum diuji** |
| Reloadly (gift card) | Luar negeri | `RELOADLY_CLIENT_ID`, `RELOADLY_CLIENT_SECRET`, `RELOADLY_SANDBOX`, `RELOADLY_FALLBACK_EMAIL` | SKU: `productId:harga:KODENEGARA`. **Belum diuji** |
| DingConnect | Luar negeri | `DINGCONNECT_API_KEY` | Preset, **belum diuji** |
| Lainnya | bebas | `SUPPLIERS_JSON` | Lihat di bawah |

**Preset "belum diuji"** ditulis dari dokumentasi publik tanpa akun nyata. Sebelum dipakai: cocokkan dengan dokumentasi resmi penyedia, uji di sandbox/akun kecil, dan bila ada beda, timpa dengan entri bernama sama di `SUPPLIERS_JSON` (preset ada di `suppliers/presets.js`).

### Agregator lain lewat `SUPPLIERS_JSON`

Tanpa ubah kode. Mendukung GET/POST, body JSON atau `form`, tanda tangan, token OAuth, cek status async, dan saldo:

```json
[{
  "name": "agregatorku", "label": "Agregatorku", "region": "INT",
  "url": "https://api.contoh.com/order", "method": "POST", "bodyType": "json",
  "auth": { "url": "https://api.contoh.com/token", "body": { "id": "${AGR_ID}", "secret": "${AGR_SECRET}" }, "tokenPath": "access_token" },
  "headers": { "Authorization": "Bearer {{token}}" },
  "sign": { "algo": "md5", "template": "${AGR_ID}:${AGR_SECRET}:{{ref}}" },
  "body": { "product": "{{sku}}", "trx_id": "{{ref}}", "target": "{{customer}}", "sign": "{{signature}}" },
  "successPath": "status", "successValues": ["success"], "pendingValues": ["processing"],
  "contentPath": "data.voucher", "messagePath": "message",
  "check": { "url": "https://api.contoh.com/status/{{ref}}", "method": "GET" },
  "balance": { "url": "https://api.contoh.com/balance", "method": "GET", "path": "data.balance" },
  "requireEnv": ["AGR_ID", "AGR_SECRET"]
}]
```

Placeholder: `{{sku}} {{ref}} {{customer}} {{signature}} {{token}}`, dan `${NAMA_ENV}` (rahasia tetap di env). `sign` mendukung `algo` md5/sha1/sha256 dan `hmacKey`. Dengan `check`, transaksi pending dicek ulang otomatis dengan `ref` yang sama. **Tanpa `check`**, respons dianggap final dan bila request timeout transaksi ditandai **tidak pasti** (pemasok lain tidak dicoba, supaya tidak membeli dua kali); admin memeriksa manual.

## Akun, aplikasi mobile, dan admin

- **Akun pembeli**: daftar/masuk di web (`/register`, `/login`, `/account`) atau lewat **API** (`/api/v1`, token Bearer) untuk aplikasi Android/iPhone. Hapus akun, unduh data, dan ganti password tersedia di web dan API. Password di-hash (scrypt); sesi disimpan sebagai hash token.
- **Aplikasi native Android & iPhone**: folder [`mobile/`](mobile/README.md) (React Native + Expo) memakai API `/api/v1`: katalog, kupon, daftar/masuk, beli & bayar, pesanan, produk terkirim, hapus akun, dokumen hukum. Cara menjalankan, build, dan catatan kebijakan toko aplikasi ada di `mobile/README.md`.
- **PWA**: toko web ini juga (bisa dipasang ke layar utama: Android lewat Chrome "Instal aplikasi", iPhone lewat Safari "Tambah ke Layar Utama"). Aplikasi native di Play Store/App Store belum dibuat; API-nya sudah siap dipakai klien native. Catatan: Apple mewajibkan In-App Purchase untuk barang digital yang dijual di dalam aplikasi native, jadi untuk produk seperti ini PWA/web adalah jalur paling aman.
- **Akun admin**: banyak admin dengan peran **Pemilik** (semua akses: Pengaturan, Integrasi, Admin, Refund) dan **Staf** (pesanan, produk, stok, kupon, laporan). Admin pertama (`admin`) dibuat dari `ADMIN_PASSWORD`; kelola di menu Admin.
- **Pengaturan** (`/admin/settings`): kunci API gateway dan pemasok, notifikasi, data penjual. Disimpan terenkripsi AES-256-GCM (kunci dari `SETTINGS_KEY`/`SESSION_SECRET`), hanya 4 karakter terakhir yang ditampilkan, dan menimpa env.
- **Refund otomatis**: pembayaran ganda direfund otomatis lewat API gateway; pesanan lunas tanpa stok direfund dari halaman detail pesanan (Pemilik). Satu refund aktif per tagihan, produk yang sudah terkirim tidak bisa direfund otomatis, dan bila API gateway menolak ada jalur "Tandai direfund manual".
- **Dokumen hukum**: Kebijakan Privasi, Syarat & Ketentuan, Kebijakan Refund di `/legal/*` (dan API), dengan persetujuan wajib saat daftar. **Itu draf umum, wajib ditinjau konsultan hukum**; isi data penjual di Pengaturan → Data penjual.
- **Sandbox → produksi**: lihat [SANDBOX.md](SANDBOX.md). Mode produksi terkunci sampai uji sandbox lulus.

## Fitur toko

- **Kupon** (`/admin/coupons`): persen atau nominal, minimal belanja, kuota, tanggal kedaluwarsa. Kuota otomatis kembali bila pesanan gagal/kedaluwarsa.
- **Lacak pesanan** (`/track`): pembeli memasukkan ID + kontak saat checkout untuk membuka kembali pesanannya (dibatasi per IP).
- **Notifikasi**: pembeli dikabari lewat WhatsApp (Fonnte) atau email (Resend) saat pesanan siap, hanya berisi link, tidak pernah isi produk. Admin dikabari lewat Telegram bila stok/pemasok kosong, transaksi tak pasti, atau pembeli bayar dua kali.
- **Laporan** (`/admin/reports`): pendapatan per hari/produk/gateway, keandalan pemasok, unduh CSV.
- **Pesanan admin**: filter status, pencarian, halaman. Pembayaran ganda: refund dilakukan di dashboard gateway lalu ditandai **Tandai direfund** (refund otomatis lewat API belum ada).
- **Docker** (`Dockerfile`) dan **CI** (`.github/workflows/ci.yml`, menjalankan `npm test`).

## Tes

```bash
npm test    # node:test, tanpa dependensi tambahan
```

## Deploy ke Render

1. Di Render: **New → Blueprint**, pilih repo ini (`render.yaml` dipakai otomatis).
2. Isi env var: `ADMIN_PASSWORD`, `BASE_URL`, key gateway, key pemasok, `WHATSAPP_NUMBER`.
3. Daftarkan webhook tiap gateway (tabel di atas).
4. Pakai key sandbox dulu; ganti ke production setelah satu transaksi uji berhasil.

Database SQLite ada di disk persisten Render (`/var/data`), yang butuh plan berbayar. Tanpa disk, data hilang setiap deploy.

## Keamanan

- Webhook diverifikasi (signature SHA-512 Midtrans, token Xendit) dan nominalnya dicocokkan.
- Halaman pesanan dilindungi kunci acak di URL; admin pakai cookie HttpOnly + rate limit login.
- Jangan commit `.env`.
