# Tampilan admin (panel penjual)

Jalankan `npm run demo` lalu buka http://localhost:3000/admin. Login **admin / admin** (Pemilik) atau **kasir / kasir12345** (Staf). Data pada gambar adalah data contoh.

Kerangka: **sidebar** (Dasbor · Pesanan · Produk · Stok · Promo & kupon · Laporan · Integrasi · Pengaturan · Admin), lencana merah di *Pesanan* = jumlah yang perlu tindakan, bisa dibuka dari HP, dan mengikuti mode gelap sistem.

| Gambar | Halaman | Isi |
|---|---|---|
| `00-login.png` | Login | Layar masuk dua kolom |
| `01-dasbor.png` | **Dasbor** | Pendapatan, pesanan lunas, hari ini, rata-rata per pesanan (dengan perbandingan periode lalu), grafik pendapatan per hari (7/30/90 hari), daftar **Perlu perhatian** (menunggu stok, refund gagal, bayar ganda, transaksi pemasok tak pasti, stok menipis), produk terlaris, pesanan terbaru |
| `02-pesanan.png` | Pesanan | Tab status dengan jumlah, pencarian, penanda masalah per pesanan |
| `03-detail-pesanan-refund.png` | Detail pesanan | Pembayaran, riwayat refund, refund otomatis / catat manual |
| `04-produk.png` | **Produk** | Kartu bergambar: harga coret, diskon, label, stok, jumlah terjual, saklar tampil/sembunyi, filter (aktif, menipis, habis) |
| `05-produk-edit.png` | Tambah/Edit produk | **Unggah gambar** (diperkecil otomatis), harga coret + pratinjau diskon, label (Promo/Terlaris/Baru/Terbatas), produk unggulan, stok, sumber cadangan agregator |
| `06-stok.png` | **Stok** | Ringkasan total/menipis/habis, tingkat stok per produk, tambah stok langsung dari daftar |
| `07-promo-kupon.png` | Promo & kupon | Kupon persen/nominal, kuota, kedaluwarsa |
| `08-laporan.png` | Laporan | Grafik, per produk, per gateway, keandalan pemasok, unduh CSV |
| `09-integrasi.png` | Integrasi (Pemilik) | Mode sandbox/produksi, uji koneksi, gerbang go-live |
| `10-pengaturan-kunci-api.png`, `11-pengaturan-tampilan-toko.png` | Pengaturan (Pemilik) | Kunci API terenkripsi; banner promo toko & ambang stok menipis |
| `12-admin.png` | Admin (Pemilik) | Akun & peran Pemilik/Staf |
| `13-dasbor-hp.png` | Dasbor di HP | |

Staf tidak melihat menu Pengaturan/Integrasi/Admin dan tidak bisa refund.
