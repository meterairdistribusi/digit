# Toko Digital: aplikasi native (Android & iPhone)

React Native + Expo (TypeScript), satu kode untuk Android dan iOS. Aplikasi ini hanya klien: semua data, pembayaran, refund, dan akun ada di backend repo ini lewat API `/api/v1`.

**Fitur:** mode gelap otomatis (ikut sistem, bisa dipaksa Terang/Gelap) · notifikasi push saat pembayaran diterima, produk siap, dan refund · katalog + cari + kategori · detail produk, jumlah, kupon · daftar/masuk (token di Keychain/Keystore) · beli & bayar di halaman gateway (browser dalam aplikasi) · status pesanan otomatis diperbarui · produk terkirim + tombol salin · riwayat pesanan · ganti password · unduh data · hapus akun di dalam aplikasi · Syarat, Privasi, Refund · persetujuan saat daftar.

## Menjalankan (pengembangan)

```bash
# 1) backend (folder atas)
npm install && npm start                      # http://localhost:3000

# 2) aplikasi
cd mobile && npm install
EXPO_PUBLIC_API_URL=http://<IP-komputer-anda>:3000 npx expo start
```
Buka dengan **Expo Go** di HP (satu jaringan Wi-Fi), atau emulator (`a` Android, `i` iOS, iOS hanya di Mac). Emulator Android memakai `http://10.0.2.2:3000` untuk mengakses komputer. Versi **produksi wajib `https`**.

## Notifikasi push

Alur: aplikasi meminta izin (setelah pesanan pertama, atau lewat saklar di Akun) → mendapat *Expo push token* → dikirim ke backend (`PUT /api/v1/me/push-token`) → saat status pesanan berubah backend mengirim lewat layanan **Expo Push** ke Android (FCM) dan iPhone (APNs). Mengetuk notifikasi membuka halaman pesanan. Isi produk (akun/kode) **tidak pernah** dikirim lewat push, hanya ringkasan + ID pesanan. Token yang sudah tidak berlaku otomatis dibersihkan, dan dicabut saat keluar akun/hapus akun.

Yang perlu Anda siapkan (tidak bisa dilakukan dari sini):
1. `eas init` supaya `extra.eas.projectId` terisi (wajib untuk mendapat push token).
2. **iPhone**: build lewat EAS; EAS membuat kunci APNs untuk Anda (butuh Apple Developer Program).
3. **Android**: buat project Firebase, unduh `google-services.json`, lalu simpan sebagai *file env var* EAS (`eas env:create`) dan isi `android.googleServicesFile` di `app.json` dengan path-nya; unggah kunci FCM V1 ke Expo (`eas credentials`). Tanpa ini push Android tidak jalan.
4. Push **tidak berfungsi di Expo Go** (Android) maupun simulator; pakai development build/preview build di HP sungguhan.
5. Opsional: `EXPO_ACCESS_TOKEN` di admin → Pengaturan → Notifikasi bila Anda mengaktifkan "Enhanced Push Security" di akun Expo.

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
- ✔ Mode gelap diuji (ikut sistem gelap, paksa Terang/Gelap, pilihan tersimpan setelah muat ulang).
- ✔ Sisi server push diuji end-to-end dengan layanan Expo tiruan (token valid/tidak valid, terkirim saat pesanan siap & refund, tanpa isi produk, token mati dibersihkan, pindah akun, cabut token, hapus akun).
- ✘ **Push ke perangkat sungguhan belum diuji** (butuh build di HP, project EAS, FCM/APNs).
- ✘ **Belum dijalankan di emulator/perangkat Android atau iPhone sungguhan** (tidak ada Android SDK/Xcode di lingkungan pembuatan). Uji di perangkat sebelum dirilis: keyboard, safe area/notch, Keychain/Keystore, halaman bayar gateway, tombol kembali Android.

## Belum ada
Login sosial dan unggahan ke toko aplikasi. Notifikasi push sudah ada tetapi butuh setup EAS/FCM/APNs di atas.
