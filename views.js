const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp' + Number(n).toLocaleString('id-ID');
const STORE = () => process.env.STORE_NAME || 'Toko Digital';
const WA = () => (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '');

const layout = (title, body, opts = {}) => (opts.admin ? require('./admin-shell').shell({ title, body, head: opts.head || '' }) : require('./store-pages').layout(title, body, opts));

// ---------- Admin ----------
const track = (error) =>
  layout(
    'Lacak pesanan',
    `<div class="panel narrow"><h1>Lacak pesanan</h1><p class="muted">Masukkan ID pesanan dan kontak yang dipakai saat checkout.</p>
${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/track" class="form"><label>ID pesanan<input name="id" required placeholder="ORD-XXXXXXXXXX" autocapitalize="characters"></label>
<label>WhatsApp / Email<input name="contact" required></label><button class="btn">Cari pesanan</button></form></div>`
  );

const bar = (v, max) => `<div style="background:var(--brand);height:8px;border-radius:4px;width:${max ? Math.max(2, Math.round((v / max) * 100)) : 0}%;min-width:2px"></div>`;

const adminReports = (r, days) => {
  const { columnChart } = require('./charts');
  const total = r.daily.reduce((a, d) => ({ orders: a.orders + d.orders, revenue: a.revenue + d.revenue, discount: a.discount + d.discount }), { orders: 0, revenue: 0, discount: 0 });
  // r.daily hanya berisi hari yang ada penjualan; lengkapi hari kosong agar grafik tidak menyesatkan
  const byDay = new Map(r.daily.map((d) => [d.day, d]));
  const series = [];
  for (let i = Math.min(days, 90) - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    series.push({ day, orders: byDay.get(day)?.orders || 0, revenue: byDay.get(day)?.revenue || 0 });
  }
  const table = (head, rows) => `<div class="card flush"><div class="card-head" style="padding:20px 20px 0"><h2>${head[0]}</h2></div><div class="scroll"><table><thead><tr>${head.slice(1).map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${head.length - 1}" class="muted">Belum ada data.</td></tr>`}</tbody></table></div></div>`;
  return layout(
    'Laporan',
    `<div class="page-head"><div><h1>Laporan penjualan</h1><p>Hanya pesanan yang sudah lunas.</p></div><div class="actions"><a class="btn ghost" href="/admin/reports.csv?days=${days}">Unduh CSV</a></div></div>
<div class="chips">${[7, 30, 90, 365].map((d) => `<a class="${d === days ? 'on' : ''}" href="/admin/reports?days=${d}">${d} hari</a>`).join('')}</div>
<div class="grid g3" style="margin-bottom:18px"><div class="kpi"><div class="label">Pesanan lunas</div><div class="value">${total.orders}</div></div><div class="kpi"><div class="label">Pendapatan</div><div class="value">${rp(total.revenue)}</div></div><div class="kpi"><div class="label">Diskon kupon diberikan</div><div class="value">${rp(total.discount)}</div></div></div>
<div class="card"><div class="card-head"><h2>Pendapatan per hari</h2></div>${columnChart(series)}</div>
<div class="grid g2" style="align-items:start">
${table(['Per produk', 'Produk', 'Terjual', 'Pendapatan'], r.byProduct.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.qty}</td><td class="num">${rp(x.revenue)}</td></tr>`).join(''))}
${table(['Per gateway pembayaran', 'Gateway', 'Pesanan', 'Pendapatan'], r.byGateway.map((x) => `<tr><td>${esc(x.gateway)}</td><td class="num">${x.orders}</td><td class="num">${rp(x.revenue)}</td></tr>`).join(''))}
</div>
${table(['Keandalan pemasok', 'Pemasok', 'Berhasil', 'Gagal', 'Pending/tak pasti'], r.bySupplier.map((x) => `<tr><td>${esc(x.supplier)}</td><td class="num ok">${x.ok}</td><td class="num out">${x.failed}</td><td class="num">${x.other}</td></tr>`).join(''))}`,
    { admin: true }
  );
};

const adminCoupons = (list, error) =>
  layout(
    'Kupon',
    `<h1>Kupon</h1>${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<div class="scroll"><table><tr><th>Kode</th><th>Potongan</th><th>Min. belanja</th><th>Dipakai</th><th>Kedaluwarsa</th><th>Status</th><th></th></tr>${list
      .map(
        (c) => `<tr><td><code>${esc(c.code)}</code></td><td>${c.type === 'percent' ? c.value + '%' : rp(c.value)}</td><td>${rp(c.min_amount)}</td>
<td>${c.used}${c.max_uses ? ' / ' + c.max_uses : ''}</td><td>${esc(c.expires_at || '-')}</td><td class="${c.active ? 'ok' : 'out'}">${c.active ? 'Aktif' : 'Nonaktif'}</td>
<td><form method="post" action="/admin/coupons/${encodeURIComponent(c.code)}/toggle"><button class="btn sm">${c.active ? 'Nonaktifkan' : 'Aktifkan'}</button></form></td></tr>`
      )
      .join('') || '<tr><td colspan="7" class="muted">Belum ada kupon.</td></tr>'}</table></div>
<div class="panel"><h2>Buat / ubah kupon</h2><p class="muted">Kode yang sudah ada akan diperbarui (hitungan pemakaian tetap).</p>
<form method="post" action="/admin/coupons" class="form">
<label>Kode<input name="code" required maxlength="30" style="text-transform:uppercase"></label>
<label>Jenis<select name="type"><option value="percent">Persen (%)</option><option value="fixed">Nominal (Rp)</option></select></label>
<label>Nilai<input name="value" type="number" min="1" required></label>
<label>Minimal belanja (Rp)<input name="min_amount" type="number" min="0" value="0"></label>
<label>Maks. pemakaian (0 = tanpa batas)<input name="max_uses" type="number" min="0" value="0"></label>
<label>Kedaluwarsa (opsional)<input name="expires_at" type="date"></label>
<button class="btn">Simpan kupon</button></form></div>`,
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

const notFound = () => layout('404', '<div class="panel"><h1>Halaman tidak ditemukan</h1><a href="/">Kembali ke toko</a></div>');

const sp = () => require('./store-pages');
module.exports = { layout, rp, track, adminReports, adminCoupons, adminCatalog, notFound, esc, home: (...a) => sp().home(...a), productPage: (...a) => sp().productPage(...a), orderPage: (...a) => sp().orderPage(...a) };
