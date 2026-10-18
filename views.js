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
      ? '<a href="/admin">Pesanan</a><a href="/admin/products">Produk</a><a href="/">Lihat toko</a><form method="post" action="/admin/logout"><button class="link">Keluar</button></form>'
      : '<a href="/">Produk</a>' + (WA() ? `<a href="https://wa.me/${WA()}" target="_blank" rel="noopener">WhatsApp</a>` : '')
  }</nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="wrap foot">© ${new Date().getFullYear()} ${esc(STORE())}</footer>
</body></html>`;

const productCard = (p) => `
<a class="card" href="/product/${p.id}">
  <span class="tag">${esc(p.category)}</span>
  <h3>${esc(p.name)}</h3>
  <p class="muted">${esc(p.description).slice(0, 90)}</p>
  <div class="row"><strong>${rp(p.price)}</strong>
  <span class="${p.available ? 'ok' : 'out'}">${p.available ? 'Stok ' + p.available : 'Habis'}</span></div>
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
<p class="price">${rp(p.price)} <span class="${p.available ? 'ok' : 'out'}">${p.available ? 'Stok ' + p.available : 'Stok habis'}</span></p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
${
  p.available
    ? `<form method="post" action="/checkout" class="form">
<input type="hidden" name="product_id" value="${p.id}">
<label>Nama<input name="name" required maxlength="60" autocomplete="name"></label>
<label>WhatsApp / Email<input name="contact" required maxlength="80" placeholder="08xxxx atau email@..."></label>
<label>Jumlah<input name="qty" type="number" min="1" max="${Math.min(p.available, 10)}" value="1" required></label>
<button class="btn">Beli sekarang</button></form>`
    : ''
}</div>`
  );

const STATUS = {
  pending: ['Menunggu pembayaran', 'warn'],
  paid: ['Lunas', 'ok'],
  paid_nostock: ['Lunas · menunggu stok', 'warn'],
  failed: ['Gagal / kedaluwarsa', 'out'],
};
const badge = (s) => `<span class="${STATUS[s]?.[1] || ''}">${STATUS[s]?.[0] || s}</span>`;

const orderPage = (o, items, { midtrans, clientKey, snapBase, demo }) => {
  let action = '';
  if (o.status === 'pending') {
    action = midtrans
      ? `<button class="btn" id="pay">Bayar sekarang</button>
<script src="${snapBase}/snap/snap.js" data-client-key="${esc(clientKey)}"></script>
<script>document.getElementById('pay').onclick=()=>snap.pay(${JSON.stringify(o.snap_token)},{onSuccess:()=>location.reload(),onPending:()=>location.reload(),onClose:()=>{}});</script>`
      : demo
      ? `<p class="muted">Mode demo (Midtrans belum dikonfigurasi).</p>
<form method="post" action="/order/${o.id}/simulate?k=${o.access_key}"><button class="btn">Simulasikan pembayaran</button></form>`
      : '<p class="err">Pembayaran belum tersedia.</p>';
  }
  const delivered = items.length
    ? `<h2>Produk Anda</h2>${items
        .map((c) => `<pre class="secret">${esc(c)}</pre>`)
        .join('')}<p class="muted">Simpan baik-baik. Halaman ini tetap bisa dibuka lewat link ini.</p>`
    : '';
  const wait =
    o.status === 'paid_nostock'
      ? '<p class="warn">Pembayaran diterima, stok sedang diisi ulang. Produk akan muncul di halaman ini; hubungi admin bila lama.</p>'
      : '';
  return layout(
    'Pesanan ' + o.id,
    `<div class="panel"><h1>Pesanan ${esc(o.id)}</h1>
<p>${esc(o.product_name)} × ${o.qty} · <strong>${rp(o.amount)}</strong></p>
<p>Status: ${badge(o.status)}</p>${action}${wait}${delivered}
<p class="muted">Simpan link halaman ini untuk membuka kembali pesanan Anda.</p></div>`
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
<td>${esc(o.product_name)} ×${o.qty}</td><td>${esc(o.customer_name)}<br><small>${esc(o.contact)}</small></td><td>${rp(o.amount)}</td><td>${badge(o.status)}</td>
<td>${
          o.status === 'paid_nostock'
            ? `<form method="post" action="/admin/orders/${o.id}/fulfill"><button class="btn sm">Kirim</button></form>`
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

const adminProduct = (p, stock) =>
  layout(
    p.name,
    `<a href="/admin/products" class="muted">← Produk</a><h1>${esc(p.name)}</h1>
<div class="panel"><h2>Edit</h2><form method="post" action="/admin/products/${p.id}" class="form">${productForm(p)}
<label class="inline"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Tampilkan di toko</label>
<button class="btn">Simpan</button></form></div>
<div class="panel"><h2>Tambah stok (satu item per baris)</h2>
<p class="muted">Isi tiap baris dengan data yang dikirim ke pembeli, mis. <code>email|password</code> atau kode/link.</p>
<form method="post" action="/admin/products/${p.id}/stock" class="form"><textarea name="items" rows="6" required></textarea><button class="btn">Tambah stok</button></form></div>
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

module.exports = { home, productPage, orderPage, adminLogin, adminOrders, adminProducts, adminProduct, notFound, esc };
