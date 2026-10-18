const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const STORE = () => process.env.STORE_NAME || 'Toko Digital';
const WA = () => (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');

const layout = (title, body, { head = '', admin = false } = {}) => `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(STORE())}</title>
<link rel="stylesheet" href="/style.css">${head}
</head><body>
<header class="top"><div class="wrap">
  <a class="brand" href="${admin ? '/admin' : '/'}">${esc(STORE())}${admin ? ' · Admin' : ''}</a>
  <nav>${
    admin
      ? '<a href="/admin">Pesanan</a><a href="/admin/products">Produk</a><a href="/admin/status">Integrasi</a><a href="/">Lihat toko</a><form method="post" action="/admin/logout"><button class="link">Keluar</button></form>'
      : '<a href="/">Produk</a>' + (WA() ? `<a href="https://wa.me/${WA()}" target="_blank" rel="noopener">WhatsApp</a>` : '')
  }</nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="wrap foot">© ${new Date().getFullYear()} ${esc(STORE())}</footer>
</body></html>`;

const stockLabel = (p) => (p.available ? 'Stok ' + p.available : p.orderable ? 'Tersedia' : 'Habis');
const stockClass = (p) => (p.orderable ? 'ok' : 'out');

const productCard = (p) => `
<a class="card" href="/product/${p.id}">
  <span class="tag">${esc(p.category)}</span>
  <h3>${esc(p.name)}</h3>
  <p class="muted">${esc(p.description).slice(0, 90)}</p>
  <div class="row"><strong>${rp(p.price)}</strong>
  <span class="${stockClass(p)}">${stockLabel(p)}</span></div>
</a>`;

const home = (products, cats, active) =>
  layout(
    'Beranda',
    `<section class="hero"><h1>Produk digital premium, kirim otomatis</h1>
<p class="muted">Bayar via QRIS, e-wallet, atau transfer. Produk langsung muncul setelah pembayaran terkonfirmasi.</p></section>
<div class="chips"><a class="${!active ? 'on' : ''}" href="/">Semua</a>${cats
      .map((c) => `<a class="${active === c ? 'on' : ''}" href="/?c=${encodeURIComponent(c)}">${esc(c)}</a>`)
      .join('')}</div>
<div class="grid">${products.map(productCard).join('') || '<p class="muted">Belum ada produk.</p>'}</div>`
  );

const productPage = (p, error) =>
  layout(
    p.name,
    `<a href="/" class="muted">← Semua produk</a>
<div class="panel"><span class="tag">${esc(p.category)}</span>
<h1>${esc(p.name)}</h1><p>${esc(p.description)}</p>
<p class="price">${rp(p.price)} <span class="${stockClass(p)}">${stockLabel(p)}</span></p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
${
  p.orderable
    ? `<form method="post" action="/checkout" class="form">
<input type="hidden" name="product_id" value="${p.id}">
<label>Nama<input name="name" required maxlength="60" autocomplete="name"></label>
<label>WhatsApp / Email<input name="contact" required maxlength="80" placeholder="08xxxx atau email@..."></label>
<label>Jumlah<input name="qty" type="number" min="1" max="${p.maxQty}" value="1" required></label>
<button class="btn">Beli sekarang</button></form>`
    : ''
}</div>`
  );

const STATUS = {
  pending: ['Menunggu pembayaran', 'warn'],
  paid: ['Lunas', 'ok'],
  paid_nostock: ['Lunas · menunggu stok', 'warn'],
  paid_sourcing: ['Lunas · produk sedang disiapkan', 'warn'],
  failed: ['Gagal / kedaluwarsa', 'out'],
};
const badge = (s) => `<span class="${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || s}</span>`;

const orderPage = (o, items, { attempts, labels, canSwitch, demo, error }) => {
  let action = '';
  if (o.status === 'pending') {
    const live = [...attempts].reverse().find((a) => a.status === 'pending');
    if (live) {
      action = `<a class="btn" href="${esc(live.pay_url)}">Bayar sekarang (${esc(labels[live.provider] || live.provider)})</a>`;
    } else if (demo) {
      action = `<p class="muted">Mode demo (belum ada gateway pembayaran yang dikonfigurasi).</p>
<form method="post" action="/order/${o.id}/simulate?k=${o.access_key}"><button class="btn">Simulasikan pembayaran</button></form>`;
    } else {
      action = '<p class="warn">Tagihan sebelumnya gagal atau kedaluwarsa. Buat tagihan baru di bawah.</p>';
    }
    if (!demo && canSwitch) {
      action += `<form method="post" action="/order/${o.id}/pay?k=${o.access_key}" class="form" style="margin-top:12px">
<button class="btn ${live ? 'ghost' : ''}">${live ? 'Ada kendala? Coba metode pembayaran lain' : 'Buat tagihan baru'}</button></form>`;
    }
    if (error) action += `<p class="err">${esc(error)}</p>`;
  }
  const delivered = items.length
    ? `<h2>Produk Anda</h2>${items
        .map((c) => `<pre class="secret">${esc(c)}</pre>`)
        .join('')}<p class="muted">Simpan baik-baik. Halaman ini tetap bisa dibuka lewat link ini.</p>`
    : '';
  const wait =
    o.status === 'paid_nostock'
      ? '<p class="warn">Pembayaran diterima, stok sedang diisi ulang. Produk akan muncul di halaman ini; hubungi admin bila lama.</p>'
      : o.status === 'paid_sourcing'
      ? '<p class="warn">Pembayaran diterima. Produk sedang disiapkan, halaman ini memuat ulang otomatis.</p>'
      : '';
  const refresh = ['pending', 'paid_sourcing'].includes(o.status) ? '<meta http-equiv="refresh" content="10">' : '';
  return layout(
    'Pesanan ' + o.id,
    `<div class="panel"><h1>Pesanan ${esc(o.id)}</h1>
<p>${esc(o.product_name)} × ${o.qty} · <strong>${rp(o.amount)}</strong></p>
<p>Status: ${badge(o.status)}</p>${action}${wait}${delivered}
<p class="muted">Simpan link halaman ini untuk membuka kembali pesanan Anda.</p></div>`,
    { head: refresh }
  );
};

// ---------- Admin ----------
const adminLogin = (error) =>
  layout(
    'Login Admin',
    `<div class="panel narrow"><h1>Login Admin</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/admin/login" class="form"><label>Password<input type="password" name="password" required autofocus></label>
<button class="btn">Masuk</button></form></div>`,
    { admin: true }
  );

const adminOrders = (orders, stats) =>
  layout(
    'Pesanan',
    `<h1>Pesanan</h1>
<div class="stats"><div><b>${stats.orders}</b><span>Total pesanan</span></div><div><b>${stats.paid}</b><span>Lunas</span></div><div><b>${rp(stats.revenue)}</b><span>Pendapatan</span></div></div>
<div class="scroll"><table><tr><th>ID</th><th>Waktu</th><th>Produk</th><th>Pembeli</th><th>Total</th><th>Status</th><th></th></tr>${orders
      .map(
        (o) => `<tr><td><a href="/order/${o.id}?k=${o.access_key}" target="_blank">${esc(o.id)}</a></td><td>${esc(o.created_at)}</td>
<td>${esc(o.product_name)} ×${o.qty}</td><td>${esc(o.customer_name)}<br><small>${esc(o.contact)}</small></td><td>${rp(o.amount)}<br><small>${esc(o.gateway || '-')}</small></td><td>${badge(o.status)}${
          o.dup ? '<br><small class="out">⚠ dibayar ganda, perlu refund</small>' : ''
        }${o.unknown_tx ? '<br><small class="out">⚠ transaksi pemasok tidak pasti, cek manual</small>' : ''}</td>
<td>${
          ['paid_nostock', 'paid_sourcing'].includes(o.status)
            ? `<form method="post" action="/admin/orders/${o.id}/fulfill"><button class="btn sm">Proses ulang</button></form>`
            : ''
        }</td></tr>`
      )
      .join('')}</table></div>`,
    { admin: true }
  );

const productForm = (p = {}) => `
<label>Nama<input name="name" value="${esc(p.name)}" required></label>
<label>Kategori<input name="category" value="${esc(p.category || 'Lainnya')}" required></label>
<label>Harga (Rp)<input name="price" type="number" min="1000" value="${esc(p.price)}" required></label>
<label>Deskripsi<textarea name="description" rows="3">${esc(p.description)}</textarea></label>`;

const adminProducts = (products) =>
  layout(
    'Produk',
    `<h1>Produk</h1>
<div class="scroll"><table><tr><th>Produk</th><th>Kategori</th><th>Harga</th><th>Stok</th><th>Aktif</th><th></th></tr>${products
      .map(
        (p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${rp(p.price)}</td><td>${p.available}</td><td>${p.active ? 'Ya' : 'Tidak'}</td>
<td><a class="btn sm" href="/admin/products/${p.id}">Kelola</a></td></tr>`
      )
      .join('')}</table></div>
<div class="panel"><h2>Tambah produk</h2><form method="post" action="/admin/products" class="form">${productForm()}<button class="btn">Tambah</button></form></div>`,
    { admin: true }
  );

const adminStatus = ({ gateways, suppliers }) =>
  layout(
    'Integrasi',
    `<h1>Integrasi</h1>
<div class="panel"><h2>Gateway pembayaran (urutan prioritas)</h2>
<table><tr><th>#</th><th>Gateway</th><th>Status</th></tr>${gateways
      .map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.label)}</td><td class="${g.enabled ? 'ok' : 'out'}">${g.enabled ? 'Aktif' : 'Belum dikonfigurasi'}</td></tr>`)
      .join('')}</table>
<p class="muted">Bila gateway pertama gagal membuat tagihan, sistem otomatis memakai berikutnya. Atur urutan lewat env <code>PAYMENT_PRIORITY</code>.</p></div>
<div class="panel"><h2>Pemasok / agregator</h2>
<table><tr><th>Pemasok</th><th>Status</th><th>Saldo</th><th></th></tr>${suppliers
      .map(
        (s) => `<tr><td>${esc(s.label)}</td><td class="${s.enabled ? 'ok' : 'out'}">${s.enabled ? 'Aktif' : 'Belum dikonfigurasi'}</td>
<td>${s.balance === undefined ? '-' : esc(s.balance)}</td>
<td>${s.enabled && s.hasCatalog ? `<a class="btn sm" href="/admin/suppliers/${esc(s.name)}/catalog">Cari SKU</a>` : ''}</td></tr>`
      )
      .join('')}</table>
<p class="muted">Pemasok dipakai otomatis bila stok lokal habis. Hubungkan SKU ke produk di halaman produk.</p></div>`,
    { admin: true }
  );

const adminCatalog = (name, rows, q) =>
  layout(
    'Katalog ' + name,
    `<a href="/admin/status" class="muted">← Integrasi</a><h1>Katalog ${esc(name)}</h1>
<form method="get" class="form" style="grid-template-columns:1fr auto"><input name="q" value="${esc(q)}" placeholder="Cari: netflix, canva, ..."><button class="btn">Cari</button></form>
<div class="scroll"><table><tr><th>SKU</th><th>Produk</th><th>Harga modal</th><th>Ready</th></tr>${rows
      .map((r) => `<tr><td><code>${esc(r.sku)}</code></td><td>${esc(r.name)}</td><td>${rp(r.price)}</td><td>${r.available ? 'Ya' : 'Tidak'}</td></tr>`)
      .join('')}</table></div>`,
    { admin: true }
  );

const adminProduct = (p, stock, sources, supplierNames) =>
  layout(
    p.name,
    `<a href="/admin/products" class="muted">← Produk</a><h1>${esc(p.name)}</h1>
<div class="panel"><h2>Edit</h2><form method="post" action="/admin/products/${p.id}" class="form">${productForm(p)}
<label class="inline"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Tampilkan di toko</label>
<button class="btn">Simpan</button></form></div>
<div class="panel"><h2>Tambah stok (satu item per baris)</h2>
<p class="muted">Isi tiap baris dengan data yang dikirim ke pembeli, mis. <code>email|password</code> atau kode/link.</p>
<form method="post" action="/admin/products/${p.id}/stock" class="form"><textarea name="items" rows="6" required></textarea><button class="btn">Tambah stok</button></form></div>
<div class="panel"><h2>Sumber cadangan (agregator)</h2>
<p class="muted">Dipakai otomatis bila stok lokal habis, dicoba berurutan dari prioritas terkecil. Bila satu pemasok gagal, lanjut ke pemasok berikutnya.</p>
${
  sources.length
    ? `<table><tr><th>Prioritas</th><th>Pemasok</th><th>SKU</th><th></th></tr>${sources
        .map(
          (s) => `<tr><td>${s.priority}</td><td>${esc(s.supplier)}</td><td><code>${esc(s.sku)}</code></td>
<td><form method="post" action="/admin/sources/${s.id}/delete"><button class="btn sm danger">Hapus</button></form></td></tr>`
        )
        .join('')}</table>`
    : '<p class="muted">Belum ada sumber cadangan.</p>'
}
<form method="post" action="/admin/products/${p.id}/sources" class="form" style="margin-top:12px">
<label>Pemasok<select name="supplier">${supplierNames.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
<label>SKU di pemasok<input name="sku" required></label>
<label>Prioritas (1 = dicoba pertama)<input name="priority" type="number" min="1" value="${sources.length + 1}"></label>
<button class="btn">Tambah sumber</button></form></div>
<div class="panel"><h2>Stok tersedia (${stock.filter((s) => !s.order_id).length}) / terjual (${stock.filter((s) => s.order_id).length})</h2>
<div class="scroll"><table><tr><th>Isi</th><th>Status</th><th></th></tr>${stock
      .map(
        (s) => `<tr><td><code>${esc(s.content)}</code></td><td>${s.order_id ? 'Terjual · ' + esc(s.order_id) : 'Tersedia'}</td>
<td>${s.order_id ? '' : `<form method="post" action="/admin/stock/${s.id}/delete"><button class="btn sm danger">Hapus</button></form>`}</td></tr>`
      )
      .join('')}</table></div></div>`,
    { admin: true }
  );

const notFound = () => layout('404', '<div class="panel"><h1>Halaman tidak ditemukan</h1><a href="/">Kembali ke toko</a></div>');

module.exports = { home, productPage, orderPage, adminLogin, adminOrders, adminProducts, adminProduct, adminStatus, adminCatalog, notFound, esc };
