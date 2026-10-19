const { icon } = require('./admin-shell');
const ctx = require('./ctx');

// Etalase pelanggan: beranda, halaman produk, halaman pesanan. Semua teks pengguna di-escape.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const env = (k, d = '') => process.env[k] || d;
const STORE = () => env('STORE_NAME', 'Toko Digital');
const WA = () => env('WHATSAPP_NUMBER').replace(/\D/g, '');

const imgSrc = (p) => p.image || `/img/p/${p.id}.svg`;
const pct = (p) => (p.compare_at && p.compare_at > p.price ? Math.round((1 - p.price / p.compare_at) * 100) : 0);

function layout(title, body, { head = '', desc = '', image = '' } = {}) {
  const { user, path = '/' } = ctx.get();
  const q = ''; // diisi lewat halaman beranda
  const on = (p) => (p === '/' ? path === '/' || path.startsWith('/product') : path.startsWith(p));
  const wa = WA();
  return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)} · ${esc(STORE())}</title>
${desc ? `<meta name="description" content="${esc(desc)}"><meta property="og:description" content="${esc(desc)}">` : ''}
<meta property="og:title" content="${esc(title)} · ${esc(STORE())}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<link rel="stylesheet" href="/store.css">
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#5b4bff">
<link rel="icon" href="/icon-192.png"><link rel="apple-touch-icon" href="/icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">${head}
</head><body>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><span class="brand-mark">${icon('bag', 20)}</span>${esc(STORE())}</a>
  <form class="top-search" action="/" method="get" role="search"><span>${icon('search', 18)}</span><input name="q" placeholder="Cari Netflix, Canva, ChatGPT…" aria-label="Cari produk" autocomplete="off"></form>
  <nav aria-label="Menu utama">
    <a href="/track">${icon('clock', 17)}<span class="t">Lacak pesanan</span></a>
    ${wa ? `<a href="https://wa.me/${wa}" target="_blank" rel="noopener">${icon('chat', 17)}<span class="t">Bantuan</span></a>` : ''}
    ${user ? `<a class="cta" href="/account">${icon('user', 17)}<span class="t">${esc(user.name.split(' ')[0])}</span></a>` : `<a class="cta" href="/login">${icon('user', 17)}<span class="t">Masuk</span></a>`}
  </nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap">
  <div class="cols">
    <div><b>${esc(STORE())}</b>Produk digital premium dengan harga hemat. Bayar mudah, produk dikirim otomatis setelah pembayaran terkonfirmasi.</div>
    <div><b>Belanja</b><a href="/">Semua produk</a><a href="/track">Lacak pesanan</a><a href="/account">Akun saya</a></div>
    <div><b>Informasi</b><a href="/legal/terms">Syarat &amp; Ketentuan</a><a href="/legal/privacy">Kebijakan Privasi</a><a href="/legal/refund">Kebijakan Refund</a>${wa ? `<a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
  </div>
  <div>© ${new Date().getFullYear()} ${esc(STORE())}</div>
</div></footer>
<nav class="tabbar" aria-label="Navigasi bawah">
  <a href="/" class="${on('/') ? 'on' : ''}">${icon('home', 22)}<span>Beranda</span></a>
  <a href="/?q=" onclick="var i=document.querySelector('[data-search]');if(i){i.focus();return false}" class="">${icon('search', 22)}<span>Cari</span></a>
  <a href="/track" class="${on('/track') ? 'on' : ''}">${icon('clock', 22)}<span>Lacak</span></a>
  <a href="${user ? '/account' : '/login'}" class="${on('/account') || on('/login') || on('/register') ? 'on' : ''}">${icon('user', 22)}<span>${user ? 'Akun' : 'Masuk'}</span></a>
</nav>
<script src="/store.js" defer></script>
<script>if("serviceWorker"in navigator)addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}))</script>
</body></html>`;
}

// ---------- kartu produk ----------
function stockBadge(p) {
  if (!p.orderable) return '<span class="pill-bad">Habis</span>';
  if (!p.viaSupplier && p.available <= 5) return `<span class="pill-warn">Sisa ${p.available}</span>`;
  return '<span class="pill-ok">Tersedia</span>';
}

function card(p) {
  const d = pct(p);
  return `<a class="card${p.orderable ? '' : ' soldout'}" href="/product/${p.id}" data-card data-name="${esc(p.name.toLowerCase())}" data-price="${p.price}" data-sold="${p.sold || 0}" data-cat="${esc(p.category)}">
  <div class="img"><img src="${esc(imgSrc(p))}" alt="${esc(p.name)}" loading="lazy" width="400" height="300">
    <div class="badges"><span>${d ? `<span class="tag-disc">-${d}%</span>` : ''}</span>${p.badge ? `<span class="tag-label">${esc(p.badge)}</span>` : ''}</div></div>
  <div class="body"><span class="cat">${esc(p.category)}</span><h3>${esc(p.name)}</h3><p class="desc">${esc(p.description)}</p>
    <div class="price-row"><b>${rp(p.price)}</b>${d ? `<s>${rp(p.compare_at)}</s>` : ''}</div>
    <div class="meta">${stockBadge(p)}${p.sold >= 5 ? `<span>${p.sold}+ terjual</span>` : ''}</div>
    ${p.orderable ? `<span class="btn block buy">Beli sekarang</span>` : ''}</div>
</a>`;
}

// ---------- beranda ----------
function home(products, cats, active, { q = '' } = {}) {
  const promo = products.filter((p) => p.orderable && (pct(p) || p.featured || p.badge)).slice(0, 8);
  const bannerTitle = env('BANNER_TITLE') || 'Produk digital premium, harga hemat';
  const bannerText = env('BANNER_TEXT') || 'Netflix, Canva, ChatGPT dan banyak lagi. Bayar mudah lewat QRIS atau e-wallet, produk langsung dikirim otomatis.';
  const code = env('BANNER_CODE').toUpperCase();
  const art = (promo.length ? promo : products).slice(0, 3);
  const filtering = Boolean(active || q);
  const catChip = (c, n) => `<a class="${active === c ? 'on' : ''}" href="${c ? '/?c=' + encodeURIComponent(c) : '/'}#produk">${c ? esc(c) : 'Semua'}</a>`;
  const body = `
${filtering ? '' : `<section class="hero" aria-label="Promo">
  <div><span class="eyebrow">${icon('zap', 15)} Kirim otomatis 24 jam</span>
    <h1>${esc(bannerTitle)}</h1><p>${esc(bannerText)}</p>
    ${code ? `<div class="code"><span>Kode promo</span><b>${esc(code)}</b><button type="button" data-copy="${esc(code)}">Salin</button></div>` : ''}
    <div><a class="btn white lg" href="#produk">Belanja sekarang</a> <a class="btn ghost lg" style="color:#fff;border-color:rgba(255,255,255,.6)" href="#cara">Cara beli</a></div></div>
  <div class="hero-art" aria-hidden="true">${art.map((p) => `<img src="${esc(imgSrc(p))}" alt="" width="400" height="300">`).join('')}</div>
</section>
<section class="trust" aria-label="Keunggulan">
  <div><span class="ti">${icon('zap', 20)}</span><span><b>Kirim otomatis</b><small>Produk tampil setelah bayar</small></span></div>
  <div><span class="ti">${icon('shield', 20)}</span><span><b>Pembayaran aman</b><small>QRIS, e-wallet, transfer</small></span></div>
  <div><span class="ti">${icon('refund', 20)}</span><span><b>Refund jika gagal</b><small>Dana kembali bila tak terkirim</small></span></div>
  <div><span class="ti">${icon('chat', 20)}</span><span><b>Bantuan cepat</b><small>${WA() ? 'Via WhatsApp' : 'Hubungi penjual'}</small></span></div>
</section>`}
${!filtering && promo.length ? `<section class="section" data-promo><div class="section-head"><div><h2>🔥 Promo spesial</h2><p>Harga hemat untuk produk pilihan</p></div></div><div class="rail">${promo.map(card).join('')}</div></section>` : ''}
<section class="section" id="produk"><div class="section-head"><div><h2>${q ? `Hasil untuk “${esc(q)}”` : active ? esc(active) : 'Semua produk'}</h2><p>${products.length} produk tersedia</p></div></div>
  <div class="chips" role="navigation" aria-label="Kategori">${catChip('', 0)}${cats.map((c) => catChip(c)).join('')}</div>
  <div class="toolbar"><label class="grow">${icon('search', 18)}<input data-search value="${esc(q)}" placeholder="Cari produk…" aria-label="Cari produk" autocomplete="off"></label>
    <select data-sort aria-label="Urutkan"><option value="">Urutkan: Rekomendasi</option><option value="sold">Terlaris</option><option value="low">Harga terendah</option><option value="high">Harga tertinggi</option></select></div>
  <div class="grid" data-grid>${products.map(card).join('')}</div>
  <div class="empty" data-empty ${products.length ? 'hidden' : ''}><b>Produk tidak ditemukan</b>Coba kata kunci atau kategori lain.</div>
</section>
${filtering ? '' : `<section class="section" id="cara"><div class="section-head"><div><h2>Beli dalam 3 langkah</h2><p>Tanpa ribet, tanpa harus daftar akun</p></div></div>
  <div class="steps"><div class="step"><span class="n">1</span><b>Pilih produk</b><p>Pilih produk, jumlah, dan masukkan kode promo bila ada.</p></div>
  <div class="step"><span class="n">2</span><b>Bayar</b><p>Bayar lewat QRIS, e-wallet, atau transfer bank di halaman pembayaran yang aman.</p></div>
  <div class="step"><span class="n">3</span><b>Terima produk</b><p>Produk langsung muncul di halaman pesanan dan bisa dibuka kapan saja.</p></div></div></section>
<section class="section"><div class="section-head"><h2>Pertanyaan umum</h2></div><div class="faq">
  <details><summary>Berapa lama produk dikirim?</summary><p>Otomatis setelah pembayaran terkonfirmasi, biasanya dalam hitungan detik. Jika sedang disiapkan, halaman pesanan memperbarui status sendiri.</p></details>
  <details><summary>Bagaimana kalau produk tidak terkirim?</summary><p>Dana dikembalikan ke metode pembayaran Anda. Lihat <a href="/legal/refund">Kebijakan Refund</a>.</p></details>
  <details><summary>Perlu daftar akun?</summary><p>Tidak wajib. Dengan akun, riwayat pesanan tersimpan dan checkout lebih cepat. Tanpa akun, simpan link pesanan atau gunakan menu <a href="/track">Lacak pesanan</a>.</p></details>
  <details><summary>Apakah pembayarannya aman?</summary><p>Pembayaran diproses penyedia pembayaran resmi. Kami tidak menyimpan data kartu atau kredensial e-wallet Anda.</p></details>
</div></section>`}`;
  return layout(q ? `Cari ${q}` : 'Beranda', body, { desc: bannerText });
}

// ---------- halaman produk ----------
function productPage(p, error, user, related = []) {
  const d = pct(p);
  const guest = !user;
  const wa = WA();
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Beranda</a> › <a href="/?c=${encodeURIComponent(p.category)}">${esc(p.category)}</a> › ${esc(p.name)}</nav>
<div class="pdp">
    <div class="pdp-img"><img src="${esc(imgSrc(p))}" alt="${esc(p.name)}" width="800" height="600"><div class="badges"><span>${d ? `<span class="tag-disc">-${d}%</span>` : ''}</span>${p.badge ? `<span class="tag-label">${esc(p.badge)}</span>` : ''}</div></div>
    <div class="pdp-info">
      <h2 style="margin-top:0">Tentang produk</h2><p>${esc(p.description) || 'Produk digital premium, dikirim otomatis setelah pembayaran.'}</p>
      <h2>Yang Anda dapatkan</h2>
      <ul class="checks"><li>${icon('check', 18)}<span>Produk dikirim <b>otomatis</b> setelah pembayaran terkonfirmasi</span></li><li>${icon('check', 18)}<span>Bisa dibuka lagi kapan saja dari halaman pesanan${guest ? '' : ' atau menu Akun'}</span></li><li>${icon('check', 18)}<span>Dana <b>dikembalikan</b> bila produk tidak dapat dikirim</span></li>${wa ? `<li>${icon('check', 18)}<span>Bantuan penjual via <a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a></span></li>` : ''}</ul>
    </div>
  <aside class="buybox" aria-label="Pembelian">
    <span class="cat">${esc(p.category)}</span><h1>${esc(p.name)}</h1>
    <div class="pdp-price"><b>${rp(p.price)}</b>${d ? `<s>${rp(p.compare_at)}</s><span class="tag-disc">Hemat ${d}%</span>` : ''}</div>
    <div class="stockline">${stockBadge(p)}${p.sold >= 5 ? `<span class="small muted">${p.sold}+ terjual</span>` : ''}</div>
    ${error ? `<div class="alert bad" role="alert">${esc(error)}</div>` : ''}
    ${p.orderable ? `
    <form method="post" action="/checkout" id="buy" class="form" style="max-width:none" data-price="${p.price}" data-max="${p.maxQty}" data-pid="${p.id}">
      <input type="hidden" name="product_id" value="${p.id}">
      <div class="rowl"><span style="font-weight:600">Jumlah</span><div class="qty"><button type="button" data-q="-1" aria-label="Kurangi">${icon('minus', 18)}</button><input name="qty" type="number" inputmode="numeric" min="1" max="${p.maxQty}" value="1" aria-label="Jumlah"><button type="button" data-q="1" aria-label="Tambah">${icon('plus', 18)}</button></div></div>
      ${guest ? `<label>Nama<input name="name" required maxlength="60" autocomplete="name" placeholder="Nama Anda"></label>
      <label>WhatsApp atau email<input name="contact" required maxlength="80" autocomplete="email" placeholder="08xxxxxxxxxx atau email@anda.com"><span class="small muted" style="font-weight:400">Untuk info pesanan. <a href="/login">Punya akun? Masuk</a></span></label>`
        : `<div class="alert info" style="margin:0">Pesanan atas nama <b>${esc(user.name)}</b> · ${esc(user.email)}</div><input type="hidden" name="name" value="${esc(user.name)}"><input type="hidden" name="contact" value="${esc(user.phone || user.email)}">`}
      <label>Kode promo (opsional)<div class="coupon"><input name="coupon" maxlength="30" autocomplete="off" placeholder="Masukkan kode"><button type="button" class="btn ghost" data-coupon>Pakai</button></div><span class="msg" data-coupon-msg role="status"></span></label>
      <div class="sum"><div class="rowl"><span>Subtotal</span><b data-subtotal>${rp(p.price)}</b></div><div class="rowl" data-disc-row hidden><span>Diskon kupon</span><b class="ok" data-disc></b></div><div class="rowl total"><span>Total bayar</span><span data-total>${rp(p.price)}</span></div></div>
      <button class="btn lg block">Beli sekarang</button>
      <p class="note">Dengan membeli, Anda menyetujui <a href="/legal/terms">Syarat &amp; Ketentuan</a>, <a href="/legal/privacy">Kebijakan Privasi</a>, dan <a href="/legal/refund">Kebijakan Refund</a>.</p>
    </form>
    <div class="mini-trust"><span>${icon('lock', 16)} Pembayaran aman via gateway resmi</span><span>${icon('zap', 16)} Produk dikirim otomatis</span><span>${icon('refund', 16)} Refund jika gagal terkirim</span></div>`
      : `<div class="alert warn">Produk ini sedang habis. ${wa ? `<a href="https://wa.me/${wa}?text=${encodeURIComponent('Halo, kapan ' + p.name + ' tersedia lagi?')}" target="_blank" rel="noopener">Tanya penjual</a>` : ''}</div>`}
  </aside>
</div>
${p.orderable ? `<div class="sticky-buy"><div class="st"><small>Total</small><b data-total2>${rp(p.price)}</b></div><button class="btn lg" form="buy">Beli sekarang</button></div>` : ''}
${related.length ? `<section class="section"><div class="section-head"><h2>Produk lainnya</h2></div><div class="grid">${related.map(card).join('')}</div></section>` : ''}`;
  return layout(p.name, body, { desc: `${p.name} — ${p.description}`.slice(0, 160), image: p.image && p.image.startsWith('http') ? p.image : '' });
}

// ---------- halaman pesanan ----------
const STATUS = {
  pending: ['Menunggu pembayaran', 'warn'], paid: ['Selesai', 'ok'], paid_nostock: ['Pembayaran diterima', 'info'],
  paid_sourcing: ['Produk disiapkan', 'info'], failed: ['Gagal / kedaluwarsa', 'bad'], refunded: ['Dana dikembalikan', 'muted'],
};

function orderPage(o, items, { attempts, labels, canSwitch, demo, error }) {
  const stage = o.status === 'pending' ? 1 : o.status === 'paid' ? 4 : 2;
  const live = [...attempts].reverse().find((a) => a.status === 'pending');
  const wa = WA();
  let action = '';
  if (o.status === 'pending') {
    if (live) action = `<a class="btn lg block" href="${esc(live.pay_url)}">Bayar sekarang · ${rp(o.amount)}</a>`;
    else if (demo) action = `<div class="alert info">Mode demo: belum ada gateway pembayaran yang dikonfigurasi.</div><form method="post" action="/order/${o.id}/simulate?k=${o.access_key}"><button class="btn lg block">Simulasikan pembayaran</button></form>`;
    else action = '<div class="alert warn">Tagihan sebelumnya gagal atau kedaluwarsa. Buat tagihan baru di bawah.</div>';
    if (!demo && canSwitch) action += `<form method="post" action="/order/${o.id}/pay?k=${o.access_key}" style="margin-top:10px"><button class="btn block ${live ? 'ghost' : ''}">${live ? 'Ada kendala? Coba metode pembayaran lain' : 'Buat tagihan baru'}</button></form>`;
    if (error) action += `<div class="alert bad">${esc(error)}</div>`;
    action += `<p class="note" style="text-align:center">Halaman ini diperbarui otomatis setelah pembayaran diterima.</p>`;
  }
  const msg = {
    paid_nostock: ['info', 'Pembayaran diterima. Produk sedang disiapkan dan akan muncul di halaman ini. Jika terlalu lama, hubungi penjual.'],
    paid_sourcing: ['info', 'Pembayaran diterima. Produk sedang disiapkan, halaman ini memuat ulang otomatis.'],
    refunded: ['info', 'Dana pesanan ini sudah dikembalikan ke metode pembayaran Anda (1–14 hari kerja tergantung bank/e-wallet).'],
    failed: ['bad', 'Pesanan kedaluwarsa atau gagal. Silakan buat pesanan baru dari halaman produk.'],
  }[o.status];
  const [slabel, stone] = STATUS[o.status] || [o.status, ''];
  const refresh = ['pending', 'paid_sourcing', 'paid_nostock'].includes(o.status) ? '<meta http-equiv="refresh" content="8">' : '';
  const body = `<div class="order-card">
  <div class="order-head"><div><span class="small muted">Pesanan</span><h1>${esc(o.id)}</h1></div><span class="pill-${stone}">${esc(slabel)}</span></div>
  ${['pending', 'paid', 'paid_sourcing', 'paid_nostock'].includes(o.status) ? `<ol class="stepper" aria-label="Progres pesanan" style="padding:0"><li class="${stage > 1 ? 'done' : 'now'}">Pembayaran</li><li class="${stage > 2 ? 'done' : stage === 2 ? 'now' : ''}">Diproses</li><li class="${stage >= 4 ? 'done' : ''}">Selesai</li></ol>` : ''}
  <div class="kv"><div><span>Produk</span><b>${esc(o.product_name)} × ${o.qty}</b></div>${o.discount ? `<div><span>Kupon ${esc(o.coupon_code)}</span><b class="ok">−${rp(o.discount)}</b></div>` : ''}<div><span>Total</span><b>${rp(o.amount)}</b></div></div>
  ${action}
  ${msg ? `<div class="alert ${msg[0]}">${esc(msg[1])}</div>` : ''}
  ${items.length ? `<h2 style="margin-top:22px">🎉 Produk Anda</h2>${items.map((c) => `<div class="item"><code>${esc(c)}</code><button type="button" class="btn ghost" data-copy="${esc(c)}">Salin</button></div>`).join('')}<p class="note">Simpan baik-baik dan jangan bagikan. Halaman ini bisa dibuka lagi lewat link ini${o.user_id ? ' atau menu Akun → Pesanan saya' : ' atau menu <a href="/track">Lacak pesanan</a>'}.</p>` : ''}
  ${wa ? `<p class="note" style="margin-top:18px">Butuh bantuan? <a href="https://wa.me/${wa}?text=${encodeURIComponent('Halo, saya butuh bantuan untuk pesanan ' + o.id)}" target="_blank" rel="noopener">Chat penjual di WhatsApp</a></p>` : ''}
</div>`;
  return layout('Pesanan ' + o.id, body, { head: refresh });
}

module.exports = { layout, home, productPage, orderPage, card, imgSrc, pct, esc, rp };
