# Toko Digital

Toko produk digital (Netflix, CapCut, Canva, ChatGPT, Claude, YouTube, dll). Pembeli checkout → bayar → produk otomatis tampil di halaman pesanan.

Stack: Node.js, Express, SQLite bawaan Node (`node:sqlite`, perlu Node ≥ 22.13). Tanpa build step.

## Jalankan lokal

```bash
npm install
npm start          # http://localhost:3000
```

Tanpa key gateway, app jalan dalam **mode demo** (ada tombol "Simulasikan pembayaran"). Admin: `/admin` (password default dev: `admin`).

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

- **Digiflazz**: isi `DIGIFLAZZ_USERNAME` dan `DIGIFLAZZ_API_KEY`. Di `/admin/status` ada saldo dan pencarian SKU. Transaksi pending dicek ulang otomatis dengan `ref_id` yang sama. Isi `DIGIFLAZZ_TESTING=true` untuk uji tanpa potong saldo.
- **Agregator lain** (API HTTP/JSON sinkron) lewat env `SUPPLIERS_JSON`, tanpa ubah kode:

```json
[{
  "name": "agregatorku",
  "url": "https://api.contoh.com/order",
  "method": "POST",
  "headers": { "Authorization": "Bearer ${AGREGATORKU_TOKEN}" },
  "body": { "product": "{{sku}}", "trx_id": "{{ref}}", "target": "{{customer}}" },
  "successPath": "status", "successValues": ["success"],
  "contentPath": "data.voucher", "messagePath": "message"
}]
```

`${NAMA_ENV}` diambil dari environment (rahasia tidak ditulis di JSON). Pemasok generik tidak dicek ulang otomatis; bila request timeout, transaksi ditandai **tidak pasti** dan pemasok lain tidak dicoba, supaya tidak membeli dua kali. Admin memeriksa manual.

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
