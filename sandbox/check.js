// Uji koneksi SEMUA integrasi yang sudah diisi kuncinya (dari Pengaturan admin atau env), memakai kunci SANDBOX Anda.
// Jalankan di server/komputer yang punya akses internet:   npm run sandbox:check
// Hasil dicatat di tabel integration_checks, sehingga menu Integrasi di admin akan membuka kunci "Pindah ke produksi".
// Skrip ini TIDAK membuat transaksi uang sungguhan di mode sandbox; di mode produksi hanya membaca (saldo/status).
const settings = require('../settings');
settings.apply();
const integrations = require('../integrations');

(async () => {
  const items = integrations.list().filter((i) => i.enabled);
  if (!items.length) return console.log('Belum ada integrasi yang diisi kuncinya. Isi di admin → Pengaturan, atau lewat env.');
  let bad = 0;
  for (const i of items) {
    if (!i.testable) { console.log(`–  ${i.label.padEnd(26)} tanpa uji otomatis: catat uji manual di admin → Integrasi`); continue; }
    const r = await integrations.test(i.id, 'cli');
    if (!r.ok) bad++;
    console.log(`${r.ok ? '✔' : '✘'}  ${i.label.padEnd(26)} [${r.mode}] ${r.detail}`);
    if (r.mode === 'production') console.log('   ⚠ mode PRODUKSI: hanya uji baca; ini TIDAK dihitung sebagai uji sandbox');
  }
  console.log(bad ? `\n${bad} integrasi gagal. Periksa kunci & mode.` : '\nSemua uji koneksi lulus.');
  process.exit(bad ? 1 : 0);
})();
