const { shell, icon, esc } = require('./admin-shell');
const { columnChart, compact, rp } = require('./charts');
const store = require('./db');

// Halaman panel penjual: dasbor, pesanan, produk (grid + form), stok, login.
const L = (title, body) => shell({ title, body });
const imgSrc = (p) => p.image || (p.id ? `/img/p/${p.id}.svg` : '');
const pct = (p) => (p.compare_at && p.compare_at > p.price ? Math.round((1 - p.price / p.compare_at) * 100) : 0);

const STATUS = {
  pending: ['Menunggu bayar', 'warn'], paid: ['Lunas', 'ok'], paid_nostock: ['Menunggu stok', 'warn'],
  paid_sourcing: ['Diproses pemasok', 'info'], failed: ['Gagal', 'bad'], refunded: ['Direfund', 'muted'],
};
const pill = (text, tone = '') => `<span class="pill${tone ? '-' + tone : ''}">${esc(text)}</span>`;
const statusPill = (s) => pill(STATUS[s]?.[0] || s, STATUS[s]?.[1] || '');

const flash = (m, e) => (e ? `<div class="flash err" role="alert">${esc(e)}</div>` : m ? `<div class="flash ok" role="status">${esc(m)}</div>` : '');

const delta = (cur, prev) => {
  if (!prev) return cur ? '<span class="delta up">Baru pada periode ini</span>' : '<span class="delta flat">Belum ada data</span>';
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return '<span class="delta flat">Sama seperti periode lalu</span>';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${icon(d > 0 ? 'trend_up' : 'trend_down', 14)} ${d > 0 ? '+' : ''}${d}% dari periode lalu</span>`;
};

const thumb = (p, cls = 'thumb') => `<img class="${cls}" src="${esc(imgSrc(p))}" alt="" loading="lazy" width="48" height="48">`;

// ---------- Dasbor ----------
function dashboard(d, { days, user }) {
  const aov = d.cur.orders ? d.cur.revenue / d.cur.orders : 0;
  const a = d.attention;
  const todo = [
    a.nostock && ['warn', 'orders', 'Menunggu stok', 'Pembayaran sudah masuk. Isi stok atau lakukan refund.', a.nostock, '/admin/orders?status=paid_nostock'],
    a.refundFailed && ['bad', 'alert', 'Refund gagal', 'Gateway menolak. Ulangi atau tandai refund manual.', a.refundFailed, '/admin/orders?flag=refund_failed'],
    a.dupOpen && ['bad', 'alert', 'Pembayaran ganda belum direfund', 'Pembeli membayar dua kali.', a.dupOpen, '/admin/orders?flag=dup'],
    a.unknownTx && ['bad', 'alert', 'Transaksi pemasok tak pasti', 'Periksa di dashboard pemasok sebelum diproses ulang.', a.unknownTx, '/admin/orders?flag=unknown'],
    d.low.length && ['warn', 'stock', 'Stok menipis', d.low.slice(0, 3).map((p) => p.name).join(', ') + (d.low.length > 3 ? '…' : ''), d.low.length, '/admin/stock?filter=low'],
    a.sourcing && ['info', 'integrations', 'Diproses pemasok', 'Menunggu respons agregator.', a.sourcing, '/admin/orders?status=paid_sourcing'],
    a.pending && ['info', 'orders', 'Menunggu pembayaran', 'Pesanan belum dibayar.', a.pending, '/admin/orders?status=pending'],
  ].filter(Boolean);
  const urgent = todo.some((t) => t[0] === 'bad' || t[0] === 'warn');

  const maxTop = Math.max(1, ...d.top.map((t) => t.revenue));
  const body = `
<div class="page-head">
  <div><h1>Halo, ${esc(user.username)} 👋</h1><p>${esc(new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</p></div>
  <div class="actions">
    <a class="btn" href="/admin/products/new">${icon('plus', 16)} Produk</a>
    <a class="btn ghost" href="/admin/stock">${icon('stock', 16)} Tambah stok</a>
    <a class="btn ghost" href="/admin/coupons">${icon('promo', 16)} Buat promo</a>
  </div>
</div>
<div class="chips" aria-label="Periode">${[7, 30, 90].map((n) => `<a class="${n === days ? 'on' : ''}" href="/admin?days=${n}">${n} hari</a>`).join('')}</div>
<div class="grid g4" style="margin-bottom:18px">
  <div class="kpi"><div class="label">Pendapatan ${days} hari</div><div class="value">${rp(d.cur.revenue)}</div>${delta(d.cur.revenue, d.prev.revenue)}</div>
  <div class="kpi"><div class="label">Pesanan lunas</div><div class="value">${d.cur.orders}</div>${delta(d.cur.orders, d.prev.orders)}</div>
  <div class="kpi"><div class="label">Hari ini</div><div class="value">${rp(d.today.revenue)}</div><span class="delta flat">${d.today.orders} pesanan lunas</span></div>
  <div class="kpi"><div class="label">Rata-rata per pesanan</div><div class="value">${rp(aov)}</div><span class="delta flat">${d.users} pelanggan terdaftar</span></div>
</div>
<div class="grid g-main">
  <div class="card"><div class="card-head"><h2>Pendapatan per hari</h2><span class="legend-line"><i class="swatch"></i> Pesanan lunas · ${days} hari terakhir</span></div>${columnChart(d.daily)}</div>
  <div class="card"><div class="card-head"><h2>Perlu perhatian</h2></div>
    ${todo.length
      ? todo.map(([tone, ic, t, sub, n, href]) => `<a class="todo" href="${href}"><span class="todo-ic ${tone}">${icon(ic, 18)}</span><span class="todo-text"><b>${esc(t)}</b><small>${esc(sub)}</small></span><span class="todo-n">${n}</span></a>`).join('')
      : ''}
    ${urgent ? '' : `<div class="todo"><span class="todo-ic ok">${icon('check', 18)}</span><span class="todo-text"><b>Semua aman</b><small>Tidak ada pesanan atau stok yang butuh tindakan.</small></span></div>`}
  </div>
</div>
<div class="grid g2">
  <div class="card"><div class="card-head"><h2>Produk terlaris</h2><a href="/admin/products" class="small">Semua produk →</a></div>
    ${d.top.length ? `<div class="rank">${d.top.map((t) => `<div class="rank-row">${thumb(t)}<div class="meta"><b>${esc(t.name)}</b><div class="small muted">${t.qty} terjual · ${rp(t.revenue)}</div><div class="rank-bar"><i style="width:${Math.max(3, Math.round((t.revenue / maxTop) * 100))}%"></i></div></div></div>`).join('')}</div>` : '<div class="empty"><b>Belum ada penjualan</b>Produk terlaris akan muncul setelah ada pesanan lunas.</div>'}
  </div>
  <div class="card flush"><div class="card-head" style="padding:20px 20px 0"><h2>Pesanan terbaru</h2><a href="/admin/orders" class="small">Semua pesanan →</a></div>
    ${d.recent.length ? `<div class="scroll"><table><tbody>${d.recent.map((o) => `<tr><td><a href="/admin/orders/${o.id}"><b>${esc(o.id)}</b></a><br><small>${esc(o.product_name)} ×${o.qty}</small></td><td class="num">${rp(o.amount)}</td><td>${statusPill(o.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>Belum ada pesanan</b>Bagikan link toko Anda untuk mulai berjualan.</div>'}
  </div>
</div>`;
  return L('Dasbor', body);
}

// ---------- Pesanan ----------
const TABS = [['', 'Semua'], ['pending', 'Menunggu bayar'], ['paid', 'Lunas'], ['paid_nostock', 'Menunggu stok'], ['paid_sourcing', 'Diproses pemasok'], ['refunded', 'Direfund'], ['failed', 'Gagal']];
const FLAG_LABEL = { refund_failed: 'Refund gagal', unknown: 'Transaksi pemasok tak pasti', dup: 'Pembayaran ganda belum direfund' };

function orders({ rows, total, page, pages }, counts, f) {
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const c = (k) => (k === '' ? all : k === 'paid' ? (counts.paid || 0) + (counts.paid_nostock || 0) + (counts.paid_sourcing || 0) : counts[k] || 0);
  const qs = (o) => '?' + new URLSearchParams(Object.entries({ ...f, ...o }).filter(([k, v]) => v && !(k === 'page' && v === 1))).toString();
  const body = `
<div class="page-head"><div><h1>Pesanan</h1><p>${total} pesanan${f.flag ? ' · ' + esc(FLAG_LABEL[f.flag] || '') : ''}</p></div></div>
<div class="chips">${TABS.map(([k, l]) => `<a class="${!f.flag && f.status === k ? 'on' : ''}" href="/admin/orders${k ? '?status=' + k : ''}">${l}<b>${c(k)}</b></a>`).join('')}</div>
${f.flag ? `<div class="flash err">Menyaring: ${esc(FLAG_LABEL[f.flag] || f.flag)}. <a href="/admin/orders">Tampilkan semua</a></div>` : ''}
<form method="get" action="/admin/orders" class="toolbar"><input type="hidden" name="status" value="${esc(f.status)}">${f.flag ? `<input type="hidden" name="flag" value="${esc(f.flag)}">` : ''}
  <div class="search">${icon('search', 16)}<input name="q" value="${esc(f.q)}" placeholder="Cari ID pesanan, nama, atau kontak" aria-label="Cari pesanan"></div><button class="btn ghost">Cari</button></form>
<div class="card flush"><div class="scroll"><table>
<thead><tr><th>Pesanan</th><th>Produk</th><th>Pembeli</th><th class="num">Total</th><th>Status</th><th></th></tr></thead><tbody>
${rows.map((o) => `<tr>
<td><a href="/admin/orders/${o.id}"><b>${esc(o.id)}</b></a><br><small>${esc(o.created_at)}</small></td>
<td>${esc(o.product_name)} <small>×${o.qty}</small></td>
<td>${esc(o.customer_name)}<br><small>${esc(o.contact)}</small></td>
<td class="num"><b>${rp(o.amount)}</b>${o.coupon_code ? `<br><small>kupon ${esc(o.coupon_code)}</small>` : ''}<br><small>${esc(o.gateway || '-')}</small></td>
<td>${statusPill(o.status)}${o.dup_open ? `<br>${pill('Bayar ganda', 'bad')}` : o.dup ? `<br>${pill('Ganda direfund', 'ok')}` : ''}${o.refund_failed ? `<br>${pill('Refund gagal', 'bad')}` : ''}${o.unknown_tx ? `<br>${pill('Pemasok tak pasti', 'bad')}` : ''}</td>
<td class="acts">${['paid_nostock', 'paid_sourcing'].includes(o.status) ? `<form method="post" action="/admin/orders/${o.id}/fulfill"><button class="btn sm soft">Proses ulang</button></form>` : ''}<a class="btn sm ghost" href="/admin/orders/${o.id}">Detail</a></td></tr>`).join('') || `<tr><td colspan="6"><div class="empty"><b>Tidak ada pesanan</b>Coba ubah filter atau kata kunci.</div></td></tr>`}
</tbody></table></div></div>
<p class="muted small">Halaman ${page} dari ${pages}${page > 1 ? ` · <a href="/admin/orders${qs({ page: page - 1 })}">← Sebelumnya</a>` : ''}${page < pages ? ` · <a href="/admin/orders${qs({ page: page + 1 })}">Berikutnya →</a>` : ''}</p>`;
  return L('Pesanan', body);
}

// ---------- Produk ----------
const stockPill = (p, low) =>
  p.viaSupplier && !p.available ? pill('Via pemasok', 'info') : p.available === 0 ? pill('Habis', 'bad') : p.available <= low ? pill(`Menipis · ${p.available}`, 'warn') : pill(`Stok ${p.available}`, 'ok');

function products(list, { filter, msg }) {
  const low = store.LOW_STOCK();
  const cat = (p) => (p.viaSupplier ? 'ok' : p.available === 0 ? 'habis' : p.available <= low ? 'low' : 'ok');
  const counts = { '': list.length, active: list.filter((p) => p.active).length, hidden: list.filter((p) => !p.active).length, low: list.filter((p) => cat(p) === 'low').length, habis: list.filter((p) => cat(p) === 'habis').length };
  const shown = list.filter((p) => (filter === 'active' ? p.active : filter === 'hidden' ? !p.active : filter === 'low' ? cat(p) === 'low' : filter === 'habis' ? cat(p) === 'habis' : true));
  const tabs = [['', 'Semua'], ['active', 'Aktif'], ['hidden', 'Disembunyikan'], ['low', 'Stok menipis'], ['habis', 'Habis']];
  const body = `
<div class="page-head"><div><h1>Produk</h1><p>${list.length} produk di katalog</p></div><div class="actions"><a class="btn" href="/admin/products/new">${icon('plus', 16)} Tambah produk</a></div></div>
${flash(msg)}
<div class="chips">${tabs.map(([k, l]) => `<a class="${filter === k ? 'on' : ''}" href="/admin/products${k ? '?filter=' + k : ''}">${l}<b>${counts[k]}</b></a>`).join('')}</div>
<div class="toolbar"><div class="search">${icon('search', 16)}<input data-filter="[data-row]" placeholder="Cari produk di halaman ini" aria-label="Cari produk"></div></div>
<div class="pgrid">${shown.map((p) => `
<article class="pcard${p.active ? '' : ' off'}" data-row>
  <a class="img" href="/admin/products/${p.id}"><img src="${esc(imgSrc(p))}" alt="" loading="lazy">
    <span class="tags">${pct(p) ? pill(`-${pct(p)}%`, 'bad') : ''}${p.badge ? pill(p.badge, 'info') : ''}${p.featured ? pill('★ Unggulan', 'warn') : ''}${p.active ? '' : pill('Disembunyikan', 'muted')}</span></a>
  <div class="body"><span class="cat">${esc(p.category)}</span><a class="name" href="/admin/products/${p.id}" style="color:inherit">${esc(p.name)}</a>
    <div class="price-line"><b>${rp(p.price)}</b>${pct(p) ? `<s>${rp(p.compare_at)}</s>` : ''}</div>
    <div>${stockPill(p, low)} <span class="small muted">· ${p.sold} terjual</span></div></div>
  <div class="foot"><a class="btn sm ghost" href="/admin/products/${p.id}">Edit</a>
    <form method="post" action="/admin/products/${p.id}/toggle"><label class="inline small" style="gap:7px">${p.active ? 'Tampil' : 'Sembunyi'}<span class="switch"><input type="checkbox" ${p.active ? 'checked' : ''} onchange="this.form.submit()" aria-label="Tampilkan ${esc(p.name)} di toko"><span></span></span></label></form></div>
</article>`).join('')}</div>
<div class="empty" id="filter-empty" hidden><b>Tidak ada produk yang cocok</b></div>
${shown.length ? '' : `<div class="card"><div class="empty"><b>Belum ada produk di filter ini</b><a class="btn" href="/admin/products/new">Tambah produk</a></div></div>`}`;
  return L('Produk', body);
}

const BADGES = ['', 'Promo', 'Terlaris', 'Baru', 'Terbatas'];

function productForm(p, { isNew, categories, stock = [], sources = [], supplierNames = [], error, msg }) {
  const low = store.LOW_STOCK();
  const avail = stock.filter((s) => !s.order_id).length;
  const body = `
<div class="page-head"><div><a class="small muted" href="/admin/products">← Semua produk</a><h1>${isNew ? 'Tambah produk' : esc(p.name)}</h1></div>
  ${isNew ? '' : `<div class="actions"><a class="btn ghost" href="/product/${p.id}" target="_blank" rel="noopener">Lihat di toko ${icon('external', 14)}</a></div>`}</div>
${flash(msg, error)}
<form method="post" action="${isNew ? '/admin/products' : '/admin/products/' + p.id}" class="grid g-main" style="align-items:start" autocomplete="off">
  <div>
    <div class="card"><h2>Informasi produk</h2><div class="form wide">
      <label>Nama produk<input name="name" required maxlength="80" value="${esc(p.name)}" placeholder="mis. Netflix Premium 1 Bulan"></label>
      <div class="field-row">
        <label>Kategori<input name="category" list="cats" required maxlength="40" value="${esc(p.category || '')}" placeholder="Streaming, AI, Editing…"><datalist id="cats">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label>Label di kartu produk<select name="badge">${BADGES.map((b) => `<option value="${b}" ${p.badge === b ? 'selected' : ''}>${b || 'Tanpa label'}</option>`).join('')}</select></label>
      </div>
      <div class="field-row">
        <label>Harga jual (Rp)<input name="price" type="number" min="1000" required value="${esc(p.price ?? '')}"></label>
        <label>Harga coret / normal (Rp), opsional<input name="compare_at" type="number" min="0" value="${esc(p.compare_at ?? '')}" placeholder="kosongkan jika tanpa promo"><span class="hint ok" id="discount-preview">Isi lebih besar dari harga jual untuk menampilkan diskon.</span></label>
      </div>
      <label>Deskripsi<textarea name="description" rows="4" maxlength="500" placeholder="Apa yang didapat pembeli, masa aktif, garansi…">${esc(p.description)}</textarea><span class="hint">Tampil di halaman produk. Maks. 500 karakter.</span></label>
    </div></div>
    <div class="actions" style="margin-bottom:18px"><button class="btn lg">${isNew ? 'Simpan & lanjut isi stok' : 'Simpan perubahan'}</button><a class="btn ghost lg" href="/admin/products">Batal</a></div>
  </div>
  <div>
    <div class="card" data-image-field><h2>Gambar produk</h2>
      <div class="dz"><img src="${esc(isNew ? '' : imgSrc(p))}" alt="Pratinjau gambar" ${isNew ? 'hidden' : ''}>
        <div class="actions"><label class="btn soft sm" style="cursor:pointer">Pilih gambar<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>${p.image ? '<button type="button" class="btn ghost sm" data-image-clear>Hapus gambar</button>' : ''}</div>
        <p class="hint" style="margin:8px 0 0">JPG/PNG/WebP, rasio 4:3 paling bagus. Otomatis diperkecil. Tanpa gambar, toko memakai sampul berwarna otomatis.</p><p class="msg hint"></p></div>
      <input type="hidden" name="image_data"><input type="hidden" name="image_remove">
      <label style="margin-top:12px">…atau tempel URL gambar (https)<input name="image_url" value="${esc(/^https:/.test(p.image || '') ? p.image : '')}" placeholder="https://…"></label>
    </div>
    <div class="card"><h2>Tampilan di toko</h2>
      <label class="inline"><input type="checkbox" name="active" value="1" ${isNew || p.active ? 'checked' : ''}> Tampilkan di toko</label>
      <label class="inline" style="margin-top:10px"><input type="checkbox" name="featured" value="1" ${p.featured ? 'checked' : ''}> ★ Produk unggulan (muncul di bagian atas beranda)</label>
    </div>
  </div>
</form>
${isNew ? '' : `
<div class="grid g2" id="stok" style="align-items:start">
  <div class="card"><div class="card-head"><h2>Stok</h2>${avail === 0 ? pill('Habis', 'bad') : avail <= low ? pill('Menipis', 'warn') : pill('Aman', 'ok')}</div>
    <p class="muted" style="margin-top:-6px"><b style="color:var(--ink);font-size:22px">${avail}</b> tersedia · ${stock.length - avail} terjual</p>
    <form method="post" action="/admin/products/${p.id}/stock" class="form wide"><label>Tambah stok <span class="hint">satu item per baris, mis. email|password atau kode/link</span><textarea name="items" rows="5" required placeholder="akun1@mail.com|password1&#10;akun2@mail.com|password2"></textarea></label><button class="btn">Tambah stok</button></form>
    <details style="margin-top:16px"><summary class="muted">Daftar stok (${stock.length})</summary><div class="scroll" style="max-height:340px;overflow:auto;margin-top:8px"><table><tbody>${stock.map((s) => `<tr><td><code>${esc(s.content)}</code></td><td>${s.order_id ? pill('Terjual', 'muted') + ' <small>' + esc(s.order_id) + '</small>' : pill('Tersedia', 'ok')}</td><td>${s.order_id ? '' : `<form method="post" action="/admin/stock/${s.id}/delete" data-confirm="Hapus item stok ini?"><button class="btn sm ghost">Hapus</button></form>`}</td></tr>`).join('') || '<tr><td class="muted">Belum ada stok.</td></tr>'}</tbody></table></div></details>
  </div>
  <div class="card"><h2>Sumber cadangan (agregator)</h2><p class="muted" style="margin-top:-6px">Dipakai otomatis saat stok lokal habis, dicoba berurutan dari prioritas terkecil. Jika satu pemasok gagal, lanjut ke berikutnya.</p>
    ${sources.length ? `<table><thead><tr><th>#</th><th>Pemasok</th><th>SKU</th><th></th></tr></thead><tbody>${sources.map((s) => `<tr><td>${s.priority}</td><td>${esc(s.supplier)}</td><td><code>${esc(s.sku)}</code></td><td><form method="post" action="/admin/sources/${s.id}/delete"><button class="btn sm ghost">Hapus</button></form></td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:14px"><b>Belum ada sumber cadangan</b>Tambahkan agar produk tetap bisa dijual saat stok lokal habis.</div>'}
    ${supplierNames.length ? `<form method="post" action="/admin/products/${p.id}/sources" class="form wide" style="margin-top:12px"><div class="field-row"><label>Pemasok<select name="supplier">${supplierNames.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label><label>Prioritas<input name="priority" type="number" min="1" value="${sources.length + 1}"></label></div><label>SKU di pemasok<input name="sku" required></label><button class="btn ghost">Tambah sumber</button></form>` : '<p class="muted small">Belum ada pemasok aktif. Isi kunci API di <a href="/admin/settings">Pengaturan</a>.</p>'}
  </div>
</div>`}`;
  return L(isNew ? 'Tambah produk' : 'Edit produk', body);
}

// ---------- Stok ----------
function stock(list, { filter, msg }) {
  const low = store.LOW_STOCK();
  const state = (p) => (p.sources && !p.available ? 'via' : p.available === 0 ? 'habis' : p.available <= low ? 'low' : 'ok');
  const total = list.reduce((a, p) => a + p.available, 0);
  const counts = { '': list.length, low: list.filter((p) => state(p) === 'low').length, habis: list.filter((p) => state(p) === 'habis').length, via: list.filter((p) => p.sources).length };
  const shown = list.filter((p) => !filter || (filter === 'via' ? p.sources : state(p) === filter));
  const tabs = [['', 'Semua'], ['low', 'Menipis'], ['habis', 'Habis'], ['via', 'Punya pemasok']];
  const scale = Math.max(low * 4, ...list.map((p) => p.available), 1);
  const body = `
<div class="page-head"><div><h1>Stok produk</h1><p>Pantau dan isi stok semua produk di satu tempat.</p></div></div>
${flash(msg)}
<div class="grid g3" style="margin-bottom:18px">
  <div class="kpi"><div class="label">Total stok tersedia</div><div class="value">${total}</div><span class="delta flat">di ${list.length} produk</span></div>
  <div class="kpi"><div class="label">Stok menipis (≤ ${low})</div><div class="value" style="color:${counts.low ? 'var(--warn)' : 'inherit'}">${counts.low}</div><span class="delta flat">produk</span></div>
  <div class="kpi"><div class="label">Stok habis</div><div class="value" style="color:${counts.habis ? 'var(--bad)' : 'inherit'}">${counts.habis}</div><span class="delta flat">produk</span></div>
</div>
<div class="chips">${tabs.map(([k, l]) => `<a class="${filter === k ? 'on' : ''}" href="/admin/stock${k ? '?filter=' + k : ''}">${l}<b>${counts[k]}</b></a>`).join('')}</div>
<div class="toolbar"><div class="search">${icon('search', 16)}<input data-filter="[data-row]" placeholder="Cari produk" aria-label="Cari produk"></div></div>
<div class="card flush"><div class="scroll"><table><thead><tr><th>Produk</th><th>Status</th><th style="width:22%">Tingkat stok</th><th class="num">Tersedia</th><th class="num">Terjual</th><th>Tambah stok</th></tr></thead><tbody>
${shown.map((p) => {
  const s = state(p);
  return `<tr data-row><td><div class="cell">${thumb(p)}<div><a href="/admin/products/${p.id}"><b>${esc(p.name)}</b></a><small>${esc(p.category)}${p.active ? '' : ' · disembunyikan'}</small></div></div></td>
<td>${s === 'habis' ? pill('Habis', 'bad') : s === 'low' ? pill('Menipis', 'warn') : s === 'via' ? pill('Via pemasok', 'info') : pill('Aman', 'ok')}</td>
<td><div class="level ${p.available === 0 ? 'zero' : p.available <= low ? 'low' : ''}" role="img" aria-label="${p.available} item"><i style="width:${p.available ? Math.max(4, Math.min(100, Math.round((p.available / scale) * 100))) : 0}%"></i></div></td>
<td class="num"><b>${p.available}</b></td><td class="num">${p.used}</td>
<td><details class="quick"><summary>+ Tambah</summary><form method="post" action="/admin/products/${p.id}/stock?back=stock" class="form" style="min-width:260px"><textarea name="items" rows="4" required placeholder="satu item per baris" aria-label="Stok untuk ${esc(p.name)}"></textarea><button class="btn sm">Simpan stok</button></form></details></td></tr>`;
}).join('')}
</tbody></table></div></div>
<div class="empty" id="filter-empty" hidden><b>Tidak ada produk yang cocok</b></div>`;
  return L('Stok', body);
}

// ---------- Login admin (tanpa sidebar) ----------
function login(error) {
  const name = esc(process.env.STORE_NAME || 'Toko Digital');
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Masuk · ${name} Admin</title><link rel="stylesheet" href="/admin.css"><link rel="icon" href="/icon-192.png"></head>
<body class="admin auth"><div class="auth-wrap">
<section class="auth-art"><div class="logo"><span class="logo-mark">${icon('orders', 20)}</span><span class="logo-text">${name}<small>Panel penjual</small></span></div>
  <div><h2>Kelola toko digital Anda dengan mudah.</h2><p>Pantau penjualan, atur produk dan stok, kirim produk otomatis, dan refund dalam satu panel.</p>
  <ul><li>${icon('check')} Dasbor penjualan real-time</li><li>${icon('check')} Stok &amp; pemasok cadangan otomatis</li><li>${icon('check')} Refund otomatis lewat gateway</li></ul></div>
  <small style="opacity:.7">© ${new Date().getFullYear()} ${name}</small></section>
<section class="auth-form"><div class="auth-card"><h1>Masuk</h1><p class="muted" style="margin-bottom:18px">Gunakan akun admin Anda.</p>
  ${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
  <form method="post" action="/admin/login" class="form wide"><label>Username<input name="username" value="admin" required autocapitalize="none" autocomplete="username"></label>
  <label>Password<input type="password" name="password" required autofocus autocomplete="current-password"></label><button class="btn lg">Masuk</button></form>
  <p class="muted small" style="margin-top:18px"><a href="/">← Kembali ke toko</a></p></div></section></div></body></html>`;
}

module.exports = { dashboard, orders, products, productForm, stock, login, statusPill, pill, imgSrc, pct };
