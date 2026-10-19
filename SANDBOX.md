# Uji sandbox → produksi

Aturan: **tidak ada integrasi yang dipindah ke produksi sebelum lulus uji sandbox.** Aplikasi menegakkannya:
tombol *Pindah ke produksi* (admin → Integrasi) terkunci sampai ada uji koneksi sukses yang tercatat saat integrasi itu di mode sandbox (maks. 30 hari terakhir), dan kunci produksi Xendit (`xnd_production_…`) ditolak sebelum uji sandbox lulus.

## Dua lapis uji

1. **Otomatis, lokal/CI (sudah ada):** `npm test` menjalankan aplikasi sungguhan melawan gateway & agregator **tiruan** (`sandbox/mock-gateways.js`): pembelian, webhook, failover, refund otomatis, refund gagal/ganda, akun, hak akses, pengaturan terenkripsi, gerbang go-live. Ini membuktikan logika kita benar. Ini **bukan** bukti bahwa format API asli sama dengan tiruannya.
2. **Sandbox resmi (Anda jalankan dengan kunci Anda):** satu-satunya cara memastikan format request/refund sesuai penyedia asli.

## Langkah uji sandbox resmi

1. Admin → **Pengaturan**: isi kunci **sandbox** tiap gateway/pemasok (Midtrans `SB-Mid-server-…`, Xendit `xnd_development_…`, Reloadly `RELOADLY_SANDBOX` aktif, Digiflazz mode uji `DIGIFLAZZ_TESTING=true`). Daftarkan webhook ke `{BASE_URL}/pay/midtrans/notify` dan `/pay/xendit/notify` di dashboard sandbox mereka.
2. Admin → **Integrasi** → **Uji koneksi** (atau `npm run sandbox:check` di server). Semua harus ✔.
3. Uji alur nyata di toko, lalu catat hasilnya:
   - [ ] Beli produk berstok lokal → bayar di halaman sandbox → produk muncul, notifikasi terkirim.
   - [ ] Beli produk via pemasok (sandbox/testing) → terkirim; matikan kunci pemasok 1 → pesanan beralih ke pemasok 2.
   - [ ] Matikan kunci gateway 1 → tagihan baru dibuat di gateway 2 (failover).
   - [ ] Bayar dua tagihan untuk satu pesanan → pembayaran kedua **direfund otomatis** (cek di dashboard sandbox gateway).
   - [ ] Pesanan lunas tanpa stok → admin → detail pesanan → **Refund** → status `refunded`, dana tercatat di dashboard sandbox.
   - [ ] Metode bayar yang tidak mendukung refund API (mis. VA bank) → refund gagal terbaca jelas, lalu **Tandai direfund manual** bekerja.
   - [ ] Daftar akun di web & lewat API (`/api/v1`), pesanan terhubung ke akun, hapus akun.
4. Bila ada beda format dengan API asli (terutama **refund**, **preset agregator**, dan Reloadly/DingConnect), perbaiki di `providers/*.js` / `suppliers/presets.js` dan jalankan lagi.
5. Baru **Pindah ke produksi**, ganti kunci ke kunci produksi, lakukan **satu transaksi kecil nyata** dan satu refund kecil nyata, lalu buka untuk umum.

## Tripay & iPaymu
1. Tripay: isi API key, Private key, Kode merchant (kunci **sandbox**), pilih `TRIPAY_METHOD` yang aktif di akun, dan daftarkan Callback URL `{BASE_URL}/pay/tripay/notify`. iPaymu: isi VA dan API key sandbox (webhook dikirim otomatis).
2. Admin → Integrasi → **Uji koneksi** untuk keduanya, lalu beli satu produk lewat masing-masing (taruh gateway itu di urutan pertama di Pengaturan → Urutan gateway) dan bayar di halaman sandbox mereka.
3. Pastikan: produk terkirim otomatis, webhook diterima (Tripay membalas `{"success":true}`), nominal cocok (di Tripay: `total_amount − fee_customer`), dan failover bekerja saat kunci sengaja dikosongkan.
4. Periksa terutama: nama kolom/nilai status dari API asli (Tripay `status`, iPaymu `Status`/`Amount`), format timestamp dan tanda tangan iPaymu, dan apakah `TRIPAY_METHOD` Anda tersedia.
5. Refund: keduanya tanpa API refund di sini; uji jalur **Tandai direfund manual**.

## Yang belum teruji dengan penyedia asli (per tanggal ini)
Tripay, iPaymu, refund Midtrans & Xendit, Reloadly, DingConnect, VIP Reseller, Tokovoucher, Apigames (format ditulis dari dokumentasi publik/ingatan, dokumentasi resmi tidak bisa diakses saat pembuatan). Digiflazz dan alur pembayaran/webhook Midtrans & Xendit sudah ada sejak awal namun juga belum pernah dijalankan terhadap akun Anda.
