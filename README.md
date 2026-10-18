# Toko Digital

Toko produk digital (Netflix, CapCut, Canva, ChatGPT, Claude, YouTube, dll). Pembeli checkout → bayar via Midtrans (QRIS, e-wallet, VA) → produk otomatis tampil di halaman pesanan.

Stack: Node.js, Express, SQLite bawaan Node (`node:sqlite`, perlu Node ≥ 22.13). Tanpa build step.

## Jalankan lokal

```bash
npm install
npm start          # http://localhost:3000
```

Tanpa key Midtrans, app jalan dalam **mode demo** (ada tombol "Simulasikan pembayaran"). Admin: `/admin` (password default dev: `admin`).

## Cara pakai

1. Login `/admin` → **Produk** → pilih produk → **Tambah stok** (satu item per baris, mis. `email|password`).
2. Pembeli bayar → stok dialokasikan otomatis dan tampil di halaman pesanan (`/order/ID?k=...`).
3. Bila bayar masuk saat stok habis, status "Lunas · menunggu stok"; setelah stok ditambah, pesanan terpenuhi otomatis atau lewat tombol **Kirim** di admin.

## Deploy ke Render

1. Push repo ke GitHub, lalu di Render: **New → Blueprint** dan pilih repo ini (`render.yaml` dipakai otomatis).
2. Isi env var: `ADMIN_PASSWORD`, `BASE_URL` (URL Render Anda), `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, `WHATSAPP_NUMBER`.
3. Di Dashboard Midtrans → Settings → Payment → **Payment Notification URL**: `https://<domain-anda>/midtrans/notify`.
4. Ganti `MIDTRANS_IS_PRODUCTION=true` + key production saat siap live.

Catatan: database SQLite disimpan di disk persisten Render (`/var/data`), yang membutuhkan plan berbayar. Tanpa disk, data hilang setiap deploy.

## Keamanan

- Webhook diverifikasi dengan signature SHA-512 dan dicocokkan nominalnya.
- Halaman pesanan dilindungi kunci acak di URL; admin pakai cookie HttpOnly + rate limit login.
- Jangan commit `.env`.
