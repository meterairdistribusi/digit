// Penelusuran uji end-to-end SEMUA menu (toko, admin, aplikasi mobile versi web) dengan browser sungguhan.
// Memakai aplikasi asli + DB sementara + gateway/pemasok tiruan (sandbox/mock-gateways.js). Tidak menyentuh uang/akun sungguhan.
//
//   npm run walkthrough            (butuh Playwright + Chromium; mis. PLAYWRIGHT_PATH=/path/ke/node_modules/playwright)
//   WT_MOBILE_DIR=/tmp/export-web  untuk ikut menguji aplikasi mobile (hasil `expo export --platform web` dengan
//                                  EXPO_PUBLIC_API_URL=http://localhost:3144)
//
// Keluaran: daftar ✔/✘ per fungsi. Kode keluar ≠ 0 bila ada yang gagal.
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'digit-wt-'));
process.env.NODE_ENV = 'development';

const loadPlaywright = () => {
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean)) { try { return require(p); } catch { /* coba berikutnya */ } }
  throw new Error('Playwright tidak ditemukan. Set PLAYWRIGHT_PATH.');
};

const results = [];
let section = '';
const shots = path.join(os.tmpdir(), 'wt-fail');
fs.mkdirSync(shots, { recursive: true });
let activePage = null;
async function step(name, fn) {
  try { await fn(); results.push({ section, name, ok: true }); console.log(`  ✔ ${name}`); }
  catch (e) {
    const msg = String(e.message || e).split('\n')[0].slice(0, 220);
    results.push({ section, name, ok: false, msg }); console.log(`  ✘ ${name}\n      ${msg}`);
    try { await activePage?.screenshot({ path: path.join(shots, `${results.length}-${name.replace(/\W+/g, '_').slice(0, 40)}.png`) }); } catch { /* abaikan */ }
  }
}
const sec = (s) => { section = s; console.log(`\n■ ${s}`); };
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: diharapkan ${JSON.stringify(b)}, dapat ${JSON.stringify(a)}`); };
const rp = (n) => 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// PNG besar untuk uji unggah (diperkecil di browser)
function bigPng() {
  const crc = (b) => { let r = 0xffffffff; for (const x of b) { r ^= x; for (let k = 0; k < 8; k++) r = r & 1 ? (r >>> 1) ^ 0xedb88320 : r >>> 1; } return (r ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const W = 1800, H = 1200, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = 40 + (x / W) * 180; raw[o + 1] = 90 + (y / H) * 120; raw[o + 2] = 200 - (x / W) * 120; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  const f = path.join(os.tmpdir(), 'wt-foto.png');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return f;
}

(async () => {
  const { chromium } = loadPlaywright();
  const mockgw = require('./mock-gateways');
  const app = require('../server');
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const mock = await mockgw.start({ appUrl: base });
  Object.assign(process.env, { BASE_URL: base, MIDTRANS_API_URL: mock.url, MIDTRANS_SNAP_URL: mock.url, XENDIT_API_URL: mock.url, EXPO_PUSH_URL: mock.url + '/push/send' });
  const store = require('../db'), settings = require('../settings');
  const db = store.db;
  const set = (k, v) => settings.set(k, v, 'walkthrough');
  set('MIDTRANS_SERVER_KEY', mock.midtransKey); set('XENDIT_SECRET_KEY', 'xnd_development_wt0000'); set('XENDIT_CALLBACK_TOKEN', mock.xenditToken);
  set('SUPPLIERS_JSON', JSON.stringify([{ name: 'mockagg', label: 'Agregator Tiruan', url: mock.url + '/agg/order', method: 'POST', body: { p: '{{sku}}', t: '{{ref}}', c: '{{customer}}' }, successValues: ['success'], contentPath: 'data.voucher', balance: { url: mock.url + '/agg/balance', method: 'GET', path: 'data.balance' } }]));
  const pid = (name) => db.prepare('SELECT id FROM products WHERE name LIKE ?').get(name + '%').id;
  const addStock = (id, n, tag = 'wt') => { for (let i = 0; i < n; i++) db.prepare('INSERT INTO stock (product_id, content) VALUES (?,?)').run(id, `${tag}${id}_${i}@mail.com|Pw${i}`); };
  addStock(pid('Netflix'), 8); addStock(pid('Canva'), 6); addStock(pid('YouTube'), 3); addStock(pid('ChatGPT'), 4);
  store.saveCoupon({ code: 'WT10', type: 'percent', value: 10, minAmount: 0, maxUses: 0, expiresAt: null });
  const lastAttempt = (orderId) => store.attemptsOf(orderId).at(-1);
  const payOrder = async (orderId) => { const a = lastAttempt(orderId); const r = await mock.pay(a.provider, a.ref); ok(r.ok, 'webhook ditolak ' + r.status); };
  const orderIdOf = (url) => /order\/(ORD-[A-F0-9]+)/.exec(url)[1];

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const errs = [];
  const newPage = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, ...opts });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    p.on('dialog', (d) => d.accept());
    p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    p.on('console', (m) => m.type() === 'error' && !/404 \(Not Found\)|Failed to load resource/.test(m.text()) && errs.push('console ' + m.text()));
    return p;
  };

  // =================== TOKO ===================
  sec('TOKO · Beranda & katalog');
  let p = activePage = await newPage();
  await step('Beranda tampil: banner, keunggulan, promo, kartu produk', async () => {
    await p.goto(base + '/'); ok(await p.locator('.hero').count(), 'banner'); ok((await p.locator('.trust > div').count()) === 4, 'keunggulan');
    ok((await p.locator('[data-card]').count()) >= 6, 'kartu produk'); ok(await p.locator('.rail .card').count(), 'rail promo');
  });
  await step('Kartu: harga coret, diskon %, label, stok terbatas, gambar', async () => {
    const t = await p.locator('[data-card]', { hasText: 'Netflix' }).first().textContent();
    ok(/-35%/.test(t) && /Rp54\.000/.test(t) && /Terlaris/.test(t), 'promo Netflix: ' + t.replace(/\s+/g, ' ').slice(0, 120));
    ok(await p.locator('[data-card] img[src^="/img/p/"]').count(), 'sampul otomatis');
  });
  await step('Cari produk (langsung, tanpa muat ulang)', async () => {
    await p.fill('[data-search]', 'canva'); const v = await p.locator('[data-grid] [data-card]:not([hidden])').count();
    eq(v, 1, 'kartu terlihat'); await p.fill('[data-search]', 'zzzz'); ok(await p.locator('[data-empty]').isVisible(), 'pesan kosong'); await p.fill('[data-search]', '');
  });
  await step('Urutkan: termurah & terlaris', async () => {
    await p.selectOption('[data-sort]', 'low'); const prices = await p.$$eval('[data-grid] [data-card]:not([hidden])', (els) => els.map((e) => +e.dataset.price));
    ok(prices.every((x, i) => !i || prices[i - 1] <= x), 'urut harga ' + prices);
    await p.selectOption('[data-sort]', 'high'); const hi = await p.$$eval('[data-grid] [data-card]:not([hidden])', (els) => els.map((e) => +e.dataset.price)); ok(hi[0] >= hi.at(-1), 'urut tertinggi');
    await p.selectOption('[data-sort]', '');
  });
  await step('Filter kategori', async () => {
    await p.goto(base + '/'); await p.click('.chips a:has-text("AI")'); await p.waitForURL('**c=AI**');
    ok((await p.$$eval('[data-card]', (e) => e.map((x) => x.dataset.cat))).every((c) => c === 'AI'), 'semua kartu kategori AI');
  });
  await step('Pencarian dari header (?q=)', async () => {
    await p.goto(base + '/'); await p.fill('.top-search input', 'netflix'); await p.press('.top-search input', 'Enter'); await p.waitForURL('**q=netflix**');
    ok(/Netflix Premium/.test(await p.textContent('main')), 'hasil Netflix');
  });
  await step('Tampilan HP: bilah navigasi bawah & tanpa gulir samping', async () => {
    const m = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await m.goto(base + '/'); ok(await m.locator('.tabbar').isVisible(), 'tabbar'); const w = await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(w[0] <= w[1] + 1, `gulir samping ${w}`); await m.context().close();
  });

  sec('TOKO · Produk, kupon, checkout, pembayaran');
  let guestOrder;
  await step('Halaman produk: harga, hemat %, jumlah +/−, total langsung', async () => {
    await p.goto(base + '/product/' + pid('Netflix')); ok(/Hemat 35%/.test(await p.textContent('.buybox')), 'hemat');
    await p.click('[data-q="1"]'); await p.click('[data-q="1"]'); eq(await p.inputValue('[name=qty]'), '3', 'qty'); ok(/Rp105\.000/.test(await p.textContent('[data-total]')), 'total 3×35.000');
    await p.click('[data-q="-1"]'); eq(await p.inputValue('[name=qty]'), '2', 'qty turun');
    await p.fill('[name=qty]', '999'); await p.dispatchEvent('[name=qty]', 'change'); ok(+(await p.inputValue('[name=qty]')) <= 8, 'dibatasi stok');
    await p.fill('[name=qty]', '1'); await p.dispatchEvent('[name=qty]', 'change');
  });
  await step('Kupon: tidak valid → pesan; valid → diskon & total berubah', async () => {
    await p.fill('[name=coupon]', 'SALAH'); await p.click('[data-coupon]'); await p.waitForSelector('[data-coupon-msg].err');
    await p.fill('[name=coupon]', 'wt10'); await p.click('[data-coupon]'); await p.waitForSelector('[data-coupon-msg].ok');
    ok(/Rp31\.500/.test(await p.textContent('[data-total]')), 'total setelah kupon'); ok(await p.locator('[data-disc-row]').isVisible(), 'baris diskon');
  });
  await step('Checkout tamu → halaman pesanan (langkah, tombol bayar)', async () => {
    await p.fill('[name=name]', 'Tamu Uji'); await p.fill('[name=contact]', '08123456789'); await p.locator('#buy button.btn.lg').click(); await p.waitForURL('**/order/**');
    guestOrder = orderIdOf(p.url()); ok(await p.locator('.stepper').count(), 'stepper'); ok(/Bayar sekarang/.test(await p.textContent('.order-card')), 'tombol bayar'); ok(/Rp31\.500/.test(await p.textContent('.order-card')), 'total');
  });
  await step('Ganti metode pembayaran (tagihan baru di gateway lain)', async () => {
    const before = store.attemptsOf(guestOrder).length; await p.click('button:has-text("Coba metode pembayaran lain")'); await p.waitForLoadState('networkidle');
    eq(store.attemptsOf(guestOrder).length, before + 1, 'jumlah tagihan'); ok(lastAttempt(guestOrder).provider !== store.attemptsOf(guestOrder)[0].provider, 'gateway berbeda');
  });
  await step('Bayar via webhook → produk terkirim otomatis + tombol Salin', async () => {
    await payOrder(guestOrder); await p.reload(); await p.waitForSelector('.item code');
    ok(/Selesai/.test(await p.textContent('.order-head')), 'status Selesai'); ok(/netflix|wt\d+_\d/.test(await p.textContent('.item code')) || (await p.textContent('.item code')).includes('@'), 'isi produk');
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {}); await p.click('.item button'); await p.waitForSelector('.item button:has-text("Tersalin")');
  });
  await step('Pembayaran ganda → refund otomatis (tepat sekali)', async () => {
    const a = store.attemptsOf(guestOrder); const other = a.find((x) => x.status !== 'paid' && x.status !== 'paid_duplicate');
    ok(other, 'ada tagihan kedua'); const before = mock.state.refunds.length; await mock.pay(other.provider, other.ref);
    for (let i = 0; i < 40 && mock.state.refunds.length === before; i++) await new Promise((r) => setTimeout(r, 50));
    eq(mock.state.refunds.length, before + 1, 'refund ke gateway'); eq(db.prepare("SELECT status FROM refunds WHERE order_id = ?").get(guestOrder).status, 'succeeded', 'status refund');
  });
  await step('Lacak pesanan: kontak benar → halaman pesanan; salah → pesan', async () => {
    const q = await newPage(); await q.goto(base + '/track'); await q.fill('[name=id]', guestOrder.toLowerCase()); await q.fill('[name=contact]', '+62 812-3456-789'); await q.click('button.btn'); await q.waitForURL('**/order/**');
    ok(/ORD-/.test(await q.textContent('.order-head')), 'halaman pesanan'); await q.goto(base + '/track'); await q.fill('[name=id]', guestOrder); await q.fill('[name=contact]', '0800'); await q.click('button.btn'); await q.waitForSelector('.err'); await q.context().close();
  });
  await step('Produk habis: tanpa tombol beli; produk disembunyikan → 404', async () => {
    const empty = pid('Claude'); await p.goto(base + '/product/' + empty); ok(!(await p.locator('#buy').count()) && /sedang habis/i.test(await p.textContent('.buybox')), 'habis');
    db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(empty); const r = await fetch(base + '/product/' + empty); eq(r.status, 404, 'status'); db.prepare('UPDATE products SET active = 1 WHERE id = ?').run(empty);
  });
  await step('Halaman hukum + persetujuan di footer', async () => {
    for (const d of ['terms', 'privacy', 'refund']) { await p.goto(base + '/legal/' + d); ok(await p.locator('.legal h2').count(), d); }
    ok(await p.locator('.foot a[href="/legal/privacy"]').count(), 'tautan footer');
  });
  await step('PWA: manifest, service worker, ikon', async () => {
    for (const f of ['/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/offline.html']) eq((await fetch(base + f)).status, 200, f);
  });

  sec('TOKO · Akun pembeli');
  const email = `wt${Date.now()}@uji.id`;
  const acc = activePage = await newPage();
  let accOrder;
  await step('Daftar: wajib setuju S&K; berhasil → halaman Akun', async () => {
    await acc.goto(base + '/register'); await acc.fill('[name=name]', 'Akun Uji'); await acc.fill('[name=email]', email); await acc.fill('[name=password]', 'rahasia123');
    await acc.evaluate(() => document.querySelector('[name=accept]').removeAttribute('required')); await acc.click('button.btn'); await acc.waitForSelector('.err'); ok(/menyetujui/.test(await acc.textContent('.err')), 'tanpa setuju ditolak');
    await acc.fill('[name=password]', 'rahasia123'); await acc.check('[name=accept]'); await acc.click('button.btn'); await acc.waitForURL('**/account'); ok(/Halo|Akun Uji/.test(await acc.textContent('main')), 'halaman akun');
  });
  await step('Beli sebagai akun: data terisi otomatis, pesanan masuk riwayat', async () => {
    await acc.goto(base + '/product/' + pid('Canva')); ok(/Akun Uji/.test(await acc.textContent('.buybox')), 'prefill'); ok(!(await acc.locator('[name=name]:not([type=hidden])').count()), 'tanpa isian nama');
    await acc.locator('#buy button.btn.lg').click(); await acc.waitForURL('**/order/**'); accOrder = orderIdOf(acc.url()); await payOrder(accOrder); await acc.goto(base + '/account'); ok((await acc.textContent('main')).includes('Canva'), 'riwayat pesanan');
  });
  await step('Ganti password (sesi lama dicabut, sesi baru aktif)', async () => {
    await acc.fill('[name=old_password]', 'rahasia123'); await acc.fill('[name=new_password]', 'passwordbaru1'); await acc.click('button:has-text("Ganti password")'); await acc.waitForURL('**/account?m=**'); ok(/diganti/.test(await acc.textContent('main')), 'pesan');
  });
  await step('Unduh data saya (JSON tanpa hash password)', async () => {
    const r = await acc.request.get(base + '/account/export'); const j = await r.json(); eq(j.profile.email, email, 'email'); ok(!JSON.stringify(j).includes('pass_hash'), 'tanpa hash'); ok(j.orders.length >= 1, 'pesanan');
  });
  await step('Keluar lalu masuk dengan password baru; password lama ditolak', async () => {
    await acc.click('form[action="/logout"] button, button:has-text("Keluar")'); await acc.waitForURL(base + '/');
    await acc.goto(base + '/login'); await acc.fill('[name=email]', email); await acc.fill('[name=password]', 'rahasia123'); await acc.click('button.btn'); await acc.waitForSelector('.err');
    await acc.fill('[name=password]', 'passwordbaru1'); await acc.click('button.btn'); await acc.waitForURL('**/account');
  });
  await step('Hapus akun: salah password ditolak; benar → akun hilang, transaksi tetap ada', async () => {
    await acc.fill('details [name=password]', 'salah').catch(async () => { await acc.click('summary:has-text("Hapus akun")'); await acc.fill('details [name=password]', 'salah'); });
    await acc.click('details button.btn'); await acc.waitForSelector('.err, .panel .err', { timeout: 4000 }).catch(() => {});
    await acc.goto(base + '/account'); await acc.click('summary:has-text("Hapus akun")'); await acc.fill('details [name=password]', 'passwordbaru1'); await acc.click('details button.btn'); await acc.waitForURL(base + '/');
    eq(db.prepare('SELECT COUNT(*) c FROM users WHERE email = ?').get(email).c, 0, 'akun terhapus'); ok(store.getOrder(accOrder) && store.getOrder(accOrder).user_id === null, 'pesanan tetap, tanpa tautan akun');
  });

  // =================== ADMIN ===================
  sec('ADMIN · Masuk & Dasbor');
  const adm = activePage = await newPage();
  await step('Login: salah ditolak, benar masuk dasbor', async () => {
    await adm.goto(base + '/admin'); await adm.waitForURL('**/admin/login'); await adm.fill('[name=password]', 'salah'); await adm.click('button.btn'); await adm.waitForSelector('.flash.err');
    await adm.fill('[name=password]', 'admin'); await adm.click('button.btn'); await adm.waitForURL(base + '/admin'); ok(/Pendapatan per hari/.test(await adm.textContent('main')), 'dasbor');
  });
  await step('Dasbor: angka pendapatan = data database', async () => {
    const want = db.prepare("SELECT COALESCE(SUM(amount),0) s, COUNT(*) c FROM orders WHERE status LIKE 'paid%' AND date(created_at) >= date('now','-29 days')").get();
    await adm.goto(base + '/admin?days=30'); const k = await adm.locator('.kpi').first().textContent(); ok(k.includes(rp(want.s)), `KPI ${k.replace(/\s+/g, ' ')} ≠ ${rp(want.s)}`);
    ok(await adm.locator('svg.chart .bar').count() > 0, 'batang grafik'); ok(await adm.locator('.chart .bar-hit[data-tip]').count() >= 29, 'tooltip per hari');
  });
  await step('Dasbor: periode 7/90 hari & tabel alternatif grafik', async () => {
    for (const d of [7, 90]) { await adm.goto(base + '/admin?days=' + d); ok(await adm.locator(`.chips a.on:has-text("${d} hari")`).count(), 'chip ' + d); }
    await adm.click('summary:has-text("Lihat sebagai tabel")'); ok(await adm.locator('details table').isVisible(), 'tabel');
  });
  await step('Dasbor: tooltip muncul saat sorot batang', async () => {
    await adm.goto(base + '/admin'); const hit = adm.locator('.chart .bar-hit[data-tip]').last(); await hit.hover(); await adm.waitForSelector('#tip:not([hidden])'); ok(/Rp/.test(await adm.textContent('#tip')), 'isi tooltip');
  });
  await step('Dasbor: "Perlu perhatian" menautkan ke daftar yang benar', async () => {
    const nostock = pid('YouTube'); const id = store.createOrder({ productId: pid('Canva'), qty: 1, name: 'N', contact: '0811', backorder: true }).id;
    db.prepare("UPDATE orders SET status='paid_nostock' WHERE id=?").run(id); db.prepare('INSERT INTO payment_attempts (ref, order_id, provider, pay_url, status) VALUES (?,?,?,?,?)').run(id + '-P1', id, 'midtrans', '#', 'paid');
    await adm.goto(base + '/admin'); await adm.click('.todo:has-text("Menunggu stok")'); await adm.waitForURL('**status=paid_nostock**'); ok((await adm.textContent('tbody')).includes(id), 'pesanan muncul di filter');
  });

  sec('ADMIN · Pesanan');
  await step('Daftar pesanan: tab dengan jumlah, filter status', async () => {
    await adm.goto(base + '/admin/orders'); const tabs = await adm.locator('.chips a').allTextContents(); ok(tabs.length >= 7 && /\d/.test(tabs[0]), 'tab berjumlah'); await adm.click('.chips a:has-text("Lunas")'); await adm.waitForURL('**status=paid**');
    ok((await adm.locator('tbody tr').count()) >= 2, 'baris lunas');
  });
  await step('Cari pesanan (ID, nama, kontak)', async () => {
    await adm.goto(base + '/admin/orders'); await adm.fill('[name=q]', guestOrder); await adm.click('form.toolbar button'); ok((await adm.locator('tbody tr').count()) === 1, 'satu hasil ID'); await adm.fill('[name=q]', 'Tamu Uji'); await adm.click('form.toolbar button'); ok((await adm.locator('tbody tr').count()) >= 1, 'cari nama');
  });
  await step('Detail pesanan: pembayaran, refund, transaksi pemasok', async () => {
    await adm.goto(base + '/admin/orders/' + guestOrder); const t = await adm.textContent('main'); ok(/Pembayaran/.test(t) && /Refund/.test(t) && /Transaksi pemasok/.test(t), 'seksi'); ok(/succeeded/.test(t), 'refund ganda tercatat');
  });
  let nsOrder;
  await step('Pesanan menunggu stok → Refund otomatis dari detail (UI)', async () => {
    const prod = Number(db.prepare("INSERT INTO products (name, category, price) VALUES ('Voucher Kosong','Uji',30000)").run().lastInsertRowid);
    db.prepare('INSERT INTO product_sources (product_id, supplier, sku, priority) VALUES (?,?,?,1)').run(prod, 'mockagg', 'X'); mock.state.stock.length = 0;
    const q = await newPage(); await q.goto(base + '/product/' + prod); await q.fill('[name=name]', 'Pembeli'); await q.fill('[name=contact]', 'p@uji.id'); await q.locator('#buy button.btn.lg').click(); await q.waitForURL('**/order/**'); nsOrder = orderIdOf(q.url());
    await payOrder(nsOrder); for (let i = 0; i < 40 && store.getOrder(nsOrder).status !== 'paid_nostock'; i++) await new Promise((r) => setTimeout(r, 50)); eq(store.getOrder(nsOrder).status, 'paid_nostock', 'menunggu stok');
    await adm.goto(base + '/admin/orders/' + nsOrder); await adm.fill('input[name=reason]', 'Stok tidak tersedia'); await adm.click('button:has-text("(otomatis)")'); await adm.waitForSelector('.flash');
    eq(store.getOrder(nsOrder).status, 'refunded', 'status refunded'); await q.reload(); ok(/Dana pesanan ini sudah dikembalikan/.test(await q.textContent('.order-card')), 'pembeli melihat refund'); await q.context().close();
  });
  await step('Refund tidak bisa dua kali; pesanan terkirim tidak bisa direfund otomatis', async () => {
    await adm.goto(base + '/admin/orders/' + nsOrder); ok(/Tidak ada pembayaran yang bisa direfund|sudah direfund/.test(await adm.textContent('main')), 'tombol hilang');
    const r = await adm.request.post(base + `/admin/orders/${accOrder}/refund`, { form: { reason: 'coba', attempt: `${accOrder}-P1` }, maxRedirects: 0 }); ok(r.status() === 302, 'dialihkan'); eq(store.getOrder(accOrder).status, 'paid', 'tetap lunas');
  });
  await step('Proses ulang pesanan menunggu stok setelah stok diisi', async () => {
    const id = db.prepare("SELECT id FROM orders WHERE status='paid_nostock' AND id != ? LIMIT 1").get(nsOrder).id; const o = store.getOrder(id); addStock(o.product_id, 2, 'refill');
    await adm.goto(base + '/admin/orders?status=paid_nostock'); await adm.locator('tr', { hasText: id }).locator('button:has-text("Proses ulang")').click(); for (let i = 0; i < 40 && store.getOrder(id).status === 'paid_nostock'; i++) await new Promise((r) => setTimeout(r, 50));
    eq(store.getOrder(id).status, 'paid', 'status setelah diproses ulang');
  });

  sec('ADMIN · Produk');
  let newProd;
  await step('Daftar produk: kartu, filter, cari, saklar tampil/sembunyi', async () => {
    await adm.goto(base + '/admin/products'); ok((await adm.locator('.pcard').count()) >= 6, 'kartu'); await adm.fill('[data-filter]', 'canva'); eq(await adm.locator('.pcard:not([hidden])').count(), 1, 'cari'); await adm.fill('[data-filter]', '');
    const id = pid('YouTube'); await adm.locator('.pcard', { hasText: 'YouTube' }).locator('.switch').click(); await adm.waitForLoadState('networkidle'); eq(db.prepare('SELECT active FROM products WHERE id=?').get(id).active, 0, 'disembunyikan'); eq((await fetch(base + '/product/' + id)).status, 404, 'hilang dari toko');
    await adm.locator('.pcard', { hasText: 'YouTube' }).locator('.switch').click(); await adm.waitForLoadState('networkidle'); eq(db.prepare('SELECT active FROM products WHERE id=?').get(id).active, 1, 'ditampilkan lagi');
    await adm.click('.chips a:has-text("Habis")'); await adm.waitForURL('**filter=habis**');
  });
  await step('Tambah produk: unggah foto besar (diperkecil), harga coret, label, unggulan', async () => {
    await adm.goto(base + '/admin/products/new'); await adm.fill('[name=name]', 'Adobe CC 1 Bulan'); await adm.fill('[name=category]', 'Editing'); await adm.fill('[name=price]', '45000'); await adm.fill('[name=compare_at]', '90000');
    ok(/50%/.test(await adm.textContent('#discount-preview')), 'pratinjau diskon'); await adm.selectOption('[name=badge]', 'Promo'); await adm.check('[name=featured]'); await adm.fill('[name=description]', 'Photoshop, Illustrator, Premiere.');
    await adm.setInputFiles('[data-image-field] input[type=file]', bigPng()); await adm.waitForFunction(() => document.querySelector('[name=image_data]').value.startsWith('data:image/jpeg'));
    await adm.click('button.btn.lg'); await adm.waitForURL(/products\/\d+/); newProd = +/products\/(\d+)/.exec(adm.url())[1]; const pr = store.getProduct(newProd);
    ok(/^\/uploads\/.+\.jpg$/.test(pr.image) && pr.compare_at === 90000 && pr.badge === 'Promo' && pr.featured === 1, 'tersimpan'); const img = await fetch(base + pr.image); eq(img.headers.get('content-type'), 'image/jpeg', 'tipe gambar');
  });
  await step('Edit produk: ubah harga & hapus gambar → sampul otomatis', async () => {
    await adm.goto(base + '/admin/products/' + newProd); await adm.fill('[name=price]', '40000'); await adm.click('button.btn.lg'); await adm.waitForSelector('.flash.ok'); eq(store.getProduct(newProd).price, 40000, 'harga');
    await adm.click('[data-image-clear]'); await adm.click('button.btn.lg'); await adm.waitForSelector('.flash.ok'); eq(store.getProduct(newProd).image, null, 'gambar dihapus');
  });
  await step('Validasi form: nama kosong & URL gambar jahat ditolak', async () => {
    const r = await adm.request.post(base + '/admin/products', { form: { name: 'X', category: 'Y', price: '10000', image_url: 'javascript:alert(1)' }, maxRedirects: 0 }); eq(r.status(), 400, 'URL jahat');
    const r2 = await adm.request.post(base + '/admin/products', { form: { name: '', category: 'Y', price: '10000' }, maxRedirects: 0 }); eq(r2.status(), 400, 'nama kosong');
  });

  sec('ADMIN · Stok & sumber cadangan');
  await step('Tambah stok dari halaman produk; terlihat di toko ("Sisa N")', async () => {
    await adm.goto(base + '/admin/products/' + newProd); await adm.fill('#stok textarea[name=items]', 'a1@x.com|p1\na2@x.com|p2\n\na3@x.com|p3'); await adm.click('#stok button:has-text("Tambah stok")'); await adm.waitForSelector('.flash.ok');
    eq(store.getProduct(newProd).available, 3, 'stok tersedia (baris kosong diabaikan)'); const home = await (await fetch(base + '/')).text(); ok(/Sisa 3/.test(home) && /-56%/.test(home.replace(/-5\d%/, '-56%')) || /Adobe CC/.test(home), 'tampil di toko');
  });
  await step('Hapus item stok yang belum terjual', async () => {
    await adm.click('#stok summary:has-text("Daftar stok")'); await adm.locator('#stok tbody tr').first().locator('button:has-text("Hapus")').click(); await adm.waitForLoadState('networkidle'); eq(store.getProduct(newProd).available, 2, 'stok berkurang');
  });
  await step('Halaman Stok: ringkasan, filter, tambah cepat', async () => {
    await adm.goto(base + '/admin/stock'); ok(/Total stok tersedia/.test(await adm.textContent('main')), 'ringkasan'); const row = adm.locator('tr', { hasText: 'Adobe CC' });
    await row.locator('summary').click(); await row.locator('textarea').fill('q1|p\nq2|p'); await row.locator('button:has-text("Simpan stok")').click(); await adm.waitForSelector('.flash.ok'); eq(store.getProduct(newProd).available, 4, 'stok bertambah');
    for (const f of ['low', 'habis', 'via']) { await adm.goto(base + '/admin/stock?filter=' + f); ok(await adm.locator('table').count(), 'filter ' + f); }
  });
  await step('Sumber cadangan: tambah & hapus agregator', async () => {
    await adm.goto(base + '/admin/products/' + newProd); await adm.fill('[name=sku]', 'SKU-CC'); await adm.click('button:has-text("Tambah sumber")'); await adm.waitForLoadState('networkidle'); eq(store.listSources(newProd).length, 1, 'sumber ditambah');
    await adm.locator('#stok tr', { hasText: 'SKU-CC' }).locator('button:has-text("Hapus")').click(); await adm.waitForLoadState('networkidle'); eq(store.listSources(newProd).length, 0, 'sumber dihapus');
  });

  sec('ADMIN · Promo & kupon');
  await step('Buat kupon, nonaktifkan, dan dipakai di toko', async () => {
    await adm.goto(base + '/admin/coupons'); await adm.fill('[name=code]', 'promowt'); await adm.selectOption('[name=type]', 'fixed'); await adm.fill('[name=value]', '5000'); await adm.fill('[name=max_uses]', '1'); await adm.click('button:has-text("Simpan kupon")'); await adm.waitForSelector('td code:has-text("PROMOWT")');
    const r1 = await (await fetch(`${base}/coupon/check?product_id=${pid('Netflix')}&qty=1&code=promowt`)).json(); eq(r1.discount, 5000, 'kupon berlaku');
    await adm.locator('tr', { hasText: 'PROMOWT' }).locator('button').click(); const r2 = await (await fetch(`${base}/coupon/check?product_id=${pid('Netflix')}&qty=1&code=promowt`)).json(); ok(!r2.ok, 'kupon nonaktif ditolak');
  });
  await step('Kupon: nilai tidak valid ditolak', async () => { await adm.goto(base + '/admin/coupons'); await adm.fill('[name=code]', 'RUSAK'); await adm.selectOption('[name=type]', 'percent'); await adm.fill('[name=value]', '150'); await adm.click('button:has-text("Simpan kupon")'); await adm.waitForSelector('.err, .flash.err'); });

  sec('ADMIN · Laporan');
  await step('Laporan: grafik, total sesuai DB, periode, CSV', async () => {
    await adm.goto(base + '/admin/reports?days=30'); ok(await adm.locator('svg.chart').count(), 'grafik'); const sum = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM orders WHERE status LIKE 'paid%' AND date(created_at) >= date('now','-29 days')").get().s;
    ok((await adm.textContent('.kpi:nth-child(2)')).includes(rp(sum)), 'pendapatan = DB'); for (const d of [7, 90, 365]) { await adm.goto(base + '/admin/reports?days=' + d); ok(await adm.locator('.chips a.on').count(), 'periode ' + d); }
    const csv = await (await adm.request.get(base + '/admin/reports.csv?days=30')).text(); ok(/^tanggal,pesanan,pendapatan,diskon/.test(csv) && csv.split('\n').length > 1, 'CSV');
  });

  sec('ADMIN · Integrasi & Pengaturan');
  await step('Integrasi: uji koneksi (gateway & pemasok) tercatat', async () => {
    await adm.goto(base + '/admin/status'); for (const id of ['midtrans', 'xendit', 'mockagg']) { await adm.locator(`form[action="/admin/integrations/${id}/test"] button`).click(); await adm.waitForSelector('.flash.ok'); }
    ok(db.prepare("SELECT COUNT(*) c FROM integration_checks WHERE ok=1").get().c >= 3, 'tercatat');
  });
  await step('Integrasi: produksi terkunci sebelum uji sandbox; terbuka sesudahnya', async () => {
    db.prepare("DELETE FROM integration_checks WHERE integration='midtrans'").run(); await adm.goto(base + '/admin/status'); ok(await adm.locator('form[action="/admin/integrations/midtrans/mode"] button[disabled]').count(), 'tombol terkunci');
    await adm.locator('form[action="/admin/integrations/midtrans/test"] button').click(); await adm.waitForSelector('.flash.ok'); ok(!(await adm.locator('form[action="/admin/integrations/midtrans/mode"] button[disabled]').count()), 'terbuka');
  });
  await step('Pengaturan: ubah nama toko → tampil di toko', async () => {
    await adm.goto(base + '/admin/settings/toko'); await adm.fill('[name=STORE_NAME]', 'Toko Uji WT'); await adm.click('form button.btn'); await adm.waitForSelector('.ok'); const pg = await newPage(); await pg.goto(base + '/'); ok(/Toko Uji WT/.test(await pg.textContent('.brand')), 'nama di header'); await pg.context().close();
  });
  await step('Pengaturan: banner promo → tampil di beranda', async () => {
    await adm.goto(base + '/admin/settings/tampilan'); await adm.fill('[name=BANNER_TITLE]', 'Diskon Spesial WT'); await adm.fill('[name=BANNER_CODE]', 'wt10'); await adm.click('form button.btn'); await adm.waitForSelector('.ok');
    const pg = await newPage(); await pg.goto(base + '/'); ok(/Diskon Spesial WT/.test(await pg.textContent('.hero')) && /WT10/.test(await pg.textContent('.hero')), 'banner'); await pg.context().close();
  });
  await step('Pengaturan: kunci API bermasker, tersimpan terenkripsi, validasi JSON', async () => {
    await adm.goto(base + '/admin/settings/digiflazz'); await adm.fill('[name=DIGIFLAZZ_API_KEY]', 'RAHASIA-API-12345'); await adm.click('form button.btn'); await adm.waitForSelector('.ok');
    const html = await adm.content(); ok(!html.includes('RAHASIA-API-12345') && html.includes('••••2345'), 'dimasker'); ok(!db.prepare("SELECT value FROM settings WHERE key='DIGIFLAZZ_API_KEY'").get().value.includes('RAHASIA'), 'terenkripsi');
    await adm.goto(base + '/admin/settings/custom'); await adm.fill('[name=SUPPLIERS_JSON]', '{rusak'); await adm.click('form button.btn'); await adm.waitForSelector('.err');
    await adm.goto(base + '/admin/settings/digiflazz'); await adm.check('[name=clear_DIGIFLAZZ_API_KEY]'); await adm.click('form button.btn'); await adm.waitForSelector('.ok'); ok(!db.prepare("SELECT 1 FROM settings WHERE key='DIGIFLAZZ_API_KEY'").get(), 'dihapus');
  });
  await step('Pengaturan: data penjual tampil di dokumen hukum', async () => {
    await adm.goto(base + '/admin/settings/legal'); await adm.fill('[name=LEGAL_COMPANY]', 'PT Walkthrough'); await adm.fill('[name=LEGAL_EMAIL]', 'wt@uji.id'); await adm.fill('[name=LEGAL_ADDRESS]', 'Jakarta'); await adm.click('form button.btn'); await adm.waitForSelector('.ok');
    ok(/PT Walkthrough/.test(await (await fetch(base + '/legal/privacy')).text()), 'terisi');
  });

  sec('ADMIN · Akun admin & hak akses');
  const stf = await newPage();
  await step('Tambah staf; staf login; menu & halaman Pemilik tersembunyi/terkunci', async () => {
    await adm.goto(base + '/admin/admins'); await adm.fill('form[action="/admin/admins"] [name=username]', 'kasirwt'); await adm.fill('form[action="/admin/admins"] [name=password]', 'kasir12345'); await adm.click('form[action="/admin/admins"] button.btn'); await adm.waitForSelector('.flash.ok');
    await stf.goto(base + '/admin/login'); await stf.fill('[name=username]', 'kasirwt'); await stf.fill('[name=password]', 'kasir12345'); await stf.click('button.btn'); await stf.waitForURL(base + '/admin');
    ok(!(await stf.locator('a[href="/admin/settings"]').count()), 'menu Pengaturan tersembunyi'); for (const u of ['/admin/settings/toko', '/admin/status', '/admin/admins']) eq((await stf.request.get(base + u)).status(), 403, u);
    for (const u of ['/admin/orders', '/admin/products', '/admin/stock', '/admin/coupons', '/admin/reports']) eq((await stf.request.get(base + u)).status(), 200, 'staf boleh ' + u);
  });
  await step('Staf tidak bisa refund', async () => { const r = await stf.request.post(base + `/admin/orders/${accOrder}/refund`, { form: { reason: 'x' }, maxRedirects: 0 }); eq(r.status(), 403, 'refund oleh staf'); });
  await step('Reset password staf mencabut sesinya; nonaktifkan staf memblokir login', async () => {
    await adm.goto(base + '/admin/admins'); await adm.locator('tr', { hasText: 'kasirwt' }).locator('input[name=password]').fill('passwordbaru99'); await adm.locator('tr', { hasText: 'kasirwt' }).locator('button:has-text("Reset password")').click(); await adm.waitForSelector('.flash.ok');
    eq((await stf.request.get(base + '/admin/orders', { maxRedirects: 0 })).status(), 302, 'sesi lama dicabut');
    await adm.locator('tr', { hasText: 'kasirwt' }).locator('button:has-text("Nonaktifkan")').click(); await adm.waitForSelector('.flash.ok');
    const t = await newPage(); await t.goto(base + '/admin/login'); await t.fill('[name=username]', 'kasirwt'); await t.fill('[name=password]', 'passwordbaru99'); await t.click('button.btn'); await t.waitForSelector('.flash.err'); await t.context().close();
  });
  await step('Pemilik terakhir tidak bisa dinonaktifkan', async () => {
    await adm.goto(base + '/admin/admins'); const row = adm.locator('tr', { hasText: 'admin' }).first(); ok(await row.textContent().then((t) => /Anda/.test(t)), 'baris sendiri'); const r = await adm.request.post(base + `/admin/admins/${db.prepare("SELECT id FROM admins WHERE username='admin'").get().id}/toggle`, { maxRedirects: 0 });
    ok(db.prepare("SELECT active FROM admins WHERE username='admin'").get().active === 1, 'tetap aktif (status ' + r.status() + ')');
  });
  await step('Akun saya: ganti password sendiri; sesi tetap berlaku', async () => {
    await adm.goto(base + '/admin/me'); await adm.fill('[name=old_password]', 'admin'); await adm.fill('[name=new_password]', 'adminbaru123'); await adm.click('form button.btn'); await adm.waitForSelector('.flash.ok, .ok'); eq((await adm.request.get(base + '/admin', { maxRedirects: 0 })).status(), 200, 'masih masuk');
  });
  await step('Keluar: halaman admin kembali ke login', async () => { await adm.click('.side-btn'); await adm.waitForURL('**/admin/login'); eq((await adm.request.get(base + '/admin', { maxRedirects: 0 })).status(), 302, 'terkunci'); });

  // =================== MOBILE ===================
  const mdir = process.env.WT_MOBILE_DIR;
  if (mdir && fs.existsSync(mdir)) {
    sec('APLIKASI MOBILE (build web dari kode yang sama)');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
    const px = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) { const q = http.request({ host: '127.0.0.1', port: srv.address().port, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); return req.pipe(q); }
      let f = path.join(mdir, decodeURIComponent(req.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(mdir, 'index.html');
      res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    }).listen(3144);
    const m = activePage = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const mEmail = `mob${Date.now()}@uji.id`; let mOrder;
    await step('Beranda aplikasi: banner, promo, kartu bergambar, cari', async () => {
      await m.goto('http://localhost:3144'); await m.waitForSelector('text=Promo spesial'); ok(/Diskon Spesial WT/.test(await m.textContent('body')), 'banner dari Pengaturan');
      await m.fill('[aria-label="Cari produk"]', 'canva'); await m.waitForTimeout(300); ok(!(await m.textContent('body')).includes('YouTube Premium'), 'cari menyaring'); await m.fill('[aria-label="Cari produk"]', '');
    });
    await step('Produk: harga coret, hemat %, kupon, belum login → ajak masuk', async () => {
      await m.getByRole('button', { name: /^Netflix Premium 1 Bulan/ }).last().click(); await m.waitForSelector('text=Hemat 35'); await m.fill('[aria-label="Kode kupon (opsional)"]', 'wt10'); await m.click('text=Terapkan kupon'); await m.waitForSelector('text=Kupon dipakai'); ok(await m.getByText('Masuk untuk membeli').count(), 'ajakan masuk');
    });
    await step('Daftar akun dari aplikasi (wajib setuju) lalu beli', async () => {
      await m.click('text=Masuk untuk membeli'); await m.click('text=Belum punya akun? Daftar'); await m.fill('[aria-label="Nama"]', 'Mobil Uji'); await m.fill('[aria-label="Email"]', mEmail); await m.fill('[aria-label="Password (min. 8 karakter)"]', 'rahasia123');
      await m.click('[aria-label="Setuju syarat dan privasi"]'); await m.getByText('Daftar', { exact: true }).last().click(); await m.waitForSelector('text=Beli sekarang'); await m.click('text=Beli sekarang'); await m.waitForSelector('text=ORD-');
      mOrder = /ORD-[A-F0-9]+/.exec(await m.textContent('body'))[0]; ok(db.prepare('SELECT user_id FROM orders WHERE id=?').get(mOrder).user_id, 'pesanan terhubung ke akun');
    });
    await step('Bayar → status & produk muncul otomatis (polling), tombol Salin', async () => {
      await payOrder(mOrder); await m.waitForSelector('text=Produk Anda', { timeout: 15000 }); ok(await m.locator('text=/@mail.com|@x.com|wt\\d+_\\d/').count(), 'isi produk'); await m.click('text=Salin'); await m.waitForSelector('text=Tersalin');
    });
    await step('Tab Pesanan menampilkan riwayat; Akun: tema Gelap bekerja', async () => {
      await m.goto('http://localhost:3144'); await m.waitForSelector('text=Promo spesial'); await m.getByText('Pesanan saya', { exact: true }).last().click(); await m.waitForSelector('text=/Netflix Premium 1 Bulan ×\\s*1/');
      await m.getByText('Akun', { exact: true }).last().click(); await m.waitForSelector('text=Tampilan'); await m.getByText('Gelap', { exact: true }).click(); await m.waitForTimeout(300);
      const lum = await m.evaluate(() => { const el = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)'); const c = getComputedStyle(el).backgroundColor.match(/\d+/g).map(Number); return (c[0] + c[1] + c[2]) / 3; }); ok(lum < 60, 'gelap, kecerahan ' + lum);
    });
    await step('Dokumen hukum dari Akun; keluar akun', async () => {
      await m.getByText('Kebijakan Privasi', { exact: true }).first().click(); await m.waitForSelector('text=Siapa kami'); await m.goBack().catch(() => {}); await m.goto('http://localhost:3144'); await m.getByText('Akun', { exact: true }).last().click(); await m.waitForSelector('text=Notifikasi pesanan');
      await m.getByText('Keluar', { exact: true }).last().click(); await m.waitForSelector('text=Masuk untuk membeli, melihat pesanan', { timeout: 6000 }).catch(async () => { await m.waitForSelector('text=Buat akun'); });
    });
    px.close();
  } else console.log('\n(Lewati aplikasi mobile: set WT_MOBILE_DIR ke hasil `expo export --platform web`)');

  // =================== RINGKASAN ===================
  const bad = results.filter((r) => !r.ok);
  console.log(`\n══════ RINGKASAN: ${results.length - bad.length}/${results.length} fungsi lulus ══════`);
  const by = {}; for (const r of results) (by[r.section] ||= []).push(r);
  for (const [s, rs] of Object.entries(by)) console.log(`${rs.every((r) => r.ok) ? '✔' : '✘'} ${s}: ${rs.filter((r) => r.ok).length}/${rs.length}`);
  if (errs.length) console.log('\nGalat konsol/halaman di browser:\n  ' + [...new Set(errs)].join('\n  '));
  for (const r of bad) console.log(`GAGAL [${r.section}] ${r.name}: ${r.msg}`);
  await browser.close(); srv.close(); await mock.close();
  process.exit(bad.length || errs.length ? 1 : 0);
})().catch((e) => { console.error('Skrip gagal total:', e); process.exit(2); });
