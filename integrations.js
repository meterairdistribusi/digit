const { db } = require('./db');
const settings = require('./settings');
const payments = require('./payments');
const suppliers = require('./suppliers');
const { health } = require('./http');

// Satu tempat untuk semua integrasi (gateway + pemasok): status, mode sandbox/produksi, uji koneksi, dan gerbang go-live.
//
// Aturan go-live: mode PRODUKSI hanya boleh dipilih setelah ada uji koneksi SUKSES yang dicatat saat integrasi itu
// berada di mode SANDBOX (maks. 30 hari terakhir). Integrasi tanpa mode sandbox (mis. VIP Reseller) hanya bisa
// "diuji" lewat saldo (bila ada) atau dengan pernyataan manual dari pemilik.

const MAX_AGE_MS = 30 * 24 * 3600e3;
const SWITCH = {
  // id: [kunci setting, nilai untuk produksi, nilai untuk sandbox]
  midtrans: ['MIDTRANS_IS_PRODUCTION', 'true', 'false'],
  tripay: ['TRIPAY_SANDBOX', 'false', 'true'],
  ipaymu: ['IPAYMU_SANDBOX', 'false', 'true'],
  digiflazz: ['DIGIFLAZZ_TESTING', 'false', 'true'],
  reloadly: ['RELOADLY_SANDBOX', 'false', 'true'],
};

function adapterOf(id) {
  return payments.providers[id] || suppliers.get(id);
}

const row = (id, label, kind, group, a) => ({
  id, label, kind, group,
  enabled: a ? a.enabled() : false,
  testable: Boolean(a && a.selfTest),
  verified: a ? a.verified : undefined,
  healthy: health.ok((kind === 'supplier' ? 'sup:' : 'pay:') + id),
  hasCatalog: Boolean(a && a.catalog),
  mode: a && a.mode ? a.mode() : 'n/a',
  switchable: Boolean(SWITCH[id]),
  last: lastCheck(id),
  sandboxOk: sandboxPassed(id),
});

function list() {
  const out = [];
  for (const g of settings.GROUPS.filter((x) => x.kind)) {
    if (g.id === 'custom') {
      // agregator dari SUPPLIERS_JSON: satu baris per agregator
      for (const a of Object.values(suppliers.adapters()).filter((x) => !suppliers.builtin(x.name))) out.push(row(a.name, a.label, 'supplier', 'custom', a));
    } else out.push(row(g.id, g.label, g.kind, g.id, adapterOf(g.id)));
  }
  return out;
}

const lastCheck = (id) => db.prepare('SELECT * FROM integration_checks WHERE integration = ? ORDER BY id DESC LIMIT 1').get(id) || null;

// Ada uji sukses di mode sandbox (atau pernyataan manual) dalam 30 hari terakhir?
function sandboxPassed(id) {
  // Integrasi yang punya mode sandbox hanya dihitung dari uji di mode sandbox; pernyataan manual hanya untuk yang tidak punya sandbox
  const hasSandbox = Boolean(adapterOf(id)?.mode);
  const r = db
    .prepare(`SELECT created_at FROM integration_checks WHERE integration = ? AND ok = 1 AND mode = ? ORDER BY id DESC LIMIT 1`)
    .get(id, hasSandbox ? 'sandbox' : 'manual');
  return Boolean(r && Date.now() - Date.parse(r.created_at.replace(' ', 'T') + 'Z') < MAX_AGE_MS);
}

async function test(id, by = '') {
  const a = adapterOf(id);
  if (!a || !a.selfTest) throw new Error('Integrasi ini tidak punya uji otomatis');
  if (!a.enabled()) return record(id, 'n/a', false, 'Belum dikonfigurasi', by);
  const mode = a.mode ? a.mode() : 'n/a';
  let r;
  try {
    r = await a.selfTest();
  } catch (e) {
    r = { ok: false, message: e.message };
  }
  return record(id, mode, r.ok, r.message, by);
}

function record(id, mode, ok, detail, by) {
  db.prepare('INSERT INTO integration_checks (integration, mode, ok, detail, by) VALUES (?,?,?,?,?)').run(id, mode, ok ? 1 : 0, String(detail || '').slice(0, 300), by);
  return { ok: Boolean(ok), mode, detail };
}

// Integrasi tanpa mode sandbox dan tanpa uji otomatis: pemilik menyatakan sudah menguji dengan transaksi kecil
function attest(id, note, by) {
  if (!note || String(note).trim().length < 5) throw new Error('Tulis catatan hasil uji (min. 5 karakter)');
  return record(id, 'manual', true, 'Pernyataan manual: ' + String(note).trim(), by);
}

function setMode(id, mode, by = '') {
  const sw = SWITCH[id];
  if (!sw) throw new Error('Integrasi ini mengatur mode lewat kunci API-nya');
  if (mode === 'production' && !sandboxPassed(id)) throw new Error('Belum lulus uji sandbox. Jalankan "Uji koneksi" di mode sandbox dulu.');
  settings.set(sw[0], mode === 'production' ? sw[1] : sw[2], by);
}

// Dipakai saat menyimpan kunci: kunci produksi Xendit hanya diterima bila uji sandbox sudah lulus
function guardKeys(id, newValues) {
  if (id === 'xendit' && String(newValues.XENDIT_SECRET_KEY || '').startsWith('xnd_production_') && !sandboxPassed('xendit')) {
    throw new Error('Kunci produksi Xendit ditolak: uji dulu dengan kunci sandbox (xnd_development_…) sampai "Uji koneksi" sukses.');
  }
}

module.exports = { list, test, attest, setMode, guardKeys, sandboxPassed, lastCheck, adapterOf };
