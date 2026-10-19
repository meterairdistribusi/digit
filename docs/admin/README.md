# Tampilan admin (backend penjual)

Dijalankan dengan `npm run demo` (data contoh, gateway/pemasok tiruan). Login: **admin / admin** (Pemilik) atau **kasir / kasir12345** (Staf).
Alamat: `/admin`. Menu: Pesanan · Produk · Kupon · Laporan · Integrasi · Pengaturan · Admin · Akun saya.

| Gambar | Halaman | Untuk apa |
|---|---|---|
| `00-login.png` | Login | Username + password, dibatasi percobaan |
| `01-pesanan.png` | Pesanan | Ringkasan, filter status, cari, halaman; peringatan pembayaran ganda / transaksi pemasok tak pasti; tombol *Proses ulang* |
| `02-detail-refund-gagal.png` | Detail pesanan | Pembayaran, riwayat refund (di sini gagal di gateway), refund otomatis ulang atau *Tandai direfund manual* |
| `03-detail-refund-sukses.png` | Detail pesanan | Pesanan yang sudah direfund |
| `04-produk.png`, `05-produk-detail.png` | Produk | Harga, stok (satu item per baris), sumber cadangan agregator berprioritas |
| `06-kupon.png` | Kupon | Persen/nominal, kuota, kedaluwarsa |
| `07-laporan.png` | Laporan | Pendapatan per hari/produk/gateway, keandalan pemasok, unduh CSV |
| `08-integrasi.png` | Integrasi (Pemilik) | Status tiap gateway/pemasok, mode sandbox/produksi, uji koneksi, gerbang go-live |
| `09`/`10-pengaturan-*.png` | Pengaturan (Pemilik) | Kunci API terenkripsi (tampil bermasker), urutan gateway |
| `11-pengaturan-hukum.png` | Pengaturan → hukum | Data penjual + teks Privasi/Syarat/Refund |
| `12-akun-admin.png` | Admin (Pemilik) | Tambah/nonaktifkan admin, peran Pemilik/Staf, reset password |

Peran **Staf** tidak bisa membuka Pengaturan, Integrasi, Admin, dan tidak bisa refund.
Tangkapan layar dibuat ulang dengan skrip uji; data pada gambar adalah data contoh.
