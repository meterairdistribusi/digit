# Toko Digital: aplikasi native (Android & iPhone)

React Native + Expo (TypeScript), satu kode untuk Android dan iOS. Aplikasi ini hanya klien: semua data, pembayaran, refund, dan akun ada di backend repo ini lewat API `/api/v1`.

**Fitur:** katalog + cari + kategori · detail produk, jumlah, kupon · daftar/masuk (token di Keychain/Keystore) · beli & bayar di halaman gateway (browser dalam aplikasi) · status pesanan otomatis diperbarui · produk terkirim + tombol salin · riwayat pesanan · ganti password · unduh data · hapus akun di dalam aplikasi · Syarat, Privasi, Refund · persetujuan saat daftar.

## Menjalankan (pengembangan)

```bash
# 1) backend (folder atas)
npm install && npm start                      # http://localhost:3000

# 2) aplikasi
cd mobile && npm install
EXPO_PUBLIC_API_URL=http://<IP-komputer-anda>:3000 npx expo start
```
Buka dengan **Expo Go** di HP (satu jaringan Wi-Fi), atau emulator (`a` Android, `i` iOS, iOS hanya di Mac). Emulator Android memakai `http://10.0.2.2:3000` untuk mengakses komputer. Versi **produksi wajib `https`**.

## Pemeriksaan otomatis

```bash
npm run typecheck        # tipe TypeScript
npm run bundle:check     # kompilasi bundel Hermes untuk Android & iOS
# dari folder atas: kontrak API klien ↔ backend asli
npm test
```

## Build untuk dibagikan (membutuhkan akun Anda)

Build tidak bisa dibuat dari lingkungan pengembangan ini (butuh akun Expo; iOS butuh Apple Developer). Langkahnya:

1. `npm i -g eas-cli && eas login && eas init` (membuat project di akun Expo Anda).
2. **Ganti** `id.tokodigital.app` (bundle ID / package) di `app.json` dengan ID milik Anda, dan isi URL backend di `eas.json` (`https://…`).
3. **Android**: `eas build -p android --profile preview` menghasilkan **APK** yang bisa dipasang langsung (uji internal). Untuk Play Store: `eas build -p android --profile production` (AAB) lalu `eas submit -p android`. Akun Google Play Developer: sekali bayar US$25.
4. **iPhone**: `eas build -p ios --profile preview` (TestFlight/ad hoc) dan `--profile production` untuk App Store. Butuh **Apple Developer Program (US$99/tahun)**; EAS mengurus sertifikat.
5. Ikon dibuat ulang dengan `npm run icons` (`scripts/make-icons.js`); ganti `assets/*` bila punya logo sendiri.

## Sebelum dikirim ke Play Store / App Store (penting)

- **Pembayaran barang digital.** Apple (App Store Review 3.1.1) dan Google Play (kebijakan Payments) mengharuskan pembelian barang/layanan digital *di dalam aplikasi* memakai sistem pembayaran mereka (In-App Purchase / Play Billing, komisi 15–30%). Aplikasi ini membayar lewat halaman gateway (Midtrans/Xendit), sehingga **berisiko ditolak** untuk produk seperti akun/langganan digital. Ada pengecualian yang bergantung negara dan jenis produk; periksa kebijakan terbaru dan, bila perlu, konsultasikan. Alternatif yang tetap sah: bagikan APK langsung (Android) dan tetap pakai PWA/web untuk iPhone.
- **Keabsahan produk.** Pastikan produk yang dijual (mis. langganan layanan lain) tidak melanggar syarat penyedia aslinya; toko aplikasi bisa menolak aplikasi yang memperjualbelikan akun.
- **Hapus akun.** Sudah ada di dalam aplikasi (Akun → Hapus akun). Play Store juga meminta URL web untuk permintaan penghapusan; gunakan `https://<domain>/account` (menu "Hapus akun") dan isi kontak di Kebijakan Privasi.
- **Data safety / Privacy nutrition label:** data yang dikumpulkan: nama, email, nomor telepon (opsional), riwayat pembelian. Tidak ada pelacak iklan/analitik di aplikasi ini.
- **Tinjau dokumen hukum** (draf) dengan konsultan hukum dan isi data penjual di admin → Pengaturan.

## Status pengujian
- ✔ `tsc` bersih; bundel Hermes Android & iOS terkompilasi.
- ✔ Klien API diuji terhadap backend asli (`test/mobile-api.test.js`).
- ✔ UI dijalankan lewat build web dari kode yang sama (react-native-web) + backend asli: cari, kupon, daftar, beli, produk terkirim otomatis, salin, sesi bertahan setelah muat ulang, dokumen hukum.
- ✘ **Belum dijalankan di emulator/perangkat Android atau iPhone sungguhan** (tidak ada Android SDK/Xcode di lingkungan pembuatan). Uji di perangkat sebelum dirilis: keyboard, safe area/notch, Keychain/Keystore, halaman bayar gateway, tombol kembali Android.

## Belum ada
Notifikasi push (pembeli dikabari lewat WhatsApp/email, dan status diperbarui otomatis saat aplikasi terbuka), login sosial, mode gelap, dan unggahan ke toko aplikasi.
