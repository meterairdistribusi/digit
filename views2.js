const { layout, rp, esc } = require('./views');

// ---------- Akun pembeli ----------
const consent = `<label class="inline"><input type="checkbox" name="accept" value="1" required>
Saya menyetujui <a href="/legal/terms" target="_blank">Syarat &amp; Ketentuan</a> dan <a href="/legal/privacy" target="_blank">Kebijakan Privasi</a></label>`;

const userLogin = (error, next = '') =>
  layout(
    'Masuk',
    `<div class="panel narrow"><h1>Masuk</h1>${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/login" class="form"><input type="hidden" name="next" value="${esc(next)}">
<label>Email<input type="email" name="email" required autocomplete="email"></label>
<label>Password<input type="password" name="password" required autocomplete="current-password"></label>
<button class="btn">Masuk</button></form>
<p class="muted">Belum punya akun? <a href="/register">Daftar</a></p></div>`
  );

const userRegister = (error, v = {}) =>
  layout(
    'Daftar',
    `<div class="panel narrow"><h1>Buat akun</h1>${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/register" class="form">
<label>Nama<input name="name" required maxlength="60" value="${esc(v.name)}" autocomplete="name"></label>
<label>Email<input type="email" name="email" required value="${esc(v.email)}" autocomplete="email"></label>
<label>WhatsApp (opsional)<input name="phone" maxlength="20" value="${esc(v.phone)}" autocomplete="tel"></label>
<label>Password (min. 8 karakter)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
${consent}<button class="btn">Daftar</button></form>
<p class="muted">Sudah punya akun? <a href="/login">Masuk</a></p></div>`
  );

const STATUS = { pending: 'Menunggu bayar', paid: 'Lunas', paid_nostock: 'Menunggu stok', paid_sourcing: 'Disiapkan', failed: 'Gagal', refunded: 'Direfund' };

const account = (u, orders, msg) =>
  layout(
    'Akun saya',
    `<h1>Halo, ${esc(u.name)}</h1>${msg ? `<div class="flash ok" role="status">${esc(msg)}</div>` : ''}
<p class="muted">${esc(u.email)}</p>
<div class="panel"><h2>Pesanan saya</h2>${
      orders.length
        ? `<div class="scroll"><table><tr><th>Pesanan</th><th>Total</th><th>Status</th><th></th></tr>${orders
            .map((o) => `<tr><td>${esc(o.product_name)} ×${o.qty}<br><small>${esc(o.created_at)}</small></td><td>${rp(o.amount)}</td><td>${esc(STATUS[o.status] || o.status)}</td>
<td><a class="btn sm" href="/order/${o.id}?k=${o.access_key}">Buka</a></td></tr>`)
            .join('')}</table></div>`
        : '<p class="muted">Belum ada pesanan. <a href="/">Mulai belanja</a></p>'
    }</div>
<div class="panel"><h2>Keamanan</h2>
<form method="post" action="/account/password" class="form">
<label>Password lama<input type="password" name="old_password" required autocomplete="current-password"></label>
<label>Password baru<input type="password" name="new_password" required minlength="8" autocomplete="new-password"></label>
<button class="btn">Ganti password</button></form></div>
<div class="panel"><h2>Data & privasi</h2>
<p><a class="btn ghost" href="/account/export">Unduh data saya (JSON)</a></p>
<details><summary class="out">Hapus akun</summary>
<p class="muted">Akun dan profil Anda dihapus permanen. Riwayat transaksi tetap disimpan tanpa tautan ke akun, sesuai kewajiban pencatatan keuangan (lihat Kebijakan Privasi).</p>
<form method="post" action="/account/delete" class="form" onsubmit="return confirm('Hapus akun secara permanen?')">
<label>Konfirmasi password<input type="password" name="password" required autocomplete="current-password"></label>
<button class="btn danger">Hapus akun saya</button></form></details></div>
<form method="post" action="/logout"><button class="btn ghost">Keluar</button></form>`
  );

const legalPage = (d) =>
  layout(
    d.title,
    `<div class="panel"><h1>${esc(d.title)}</h1><p class="muted">Terakhir diperbarui: ${esc(d.updated)}</p><div class="legal">${d.html}</div></div>
<p class="muted"><a href="/legal/terms">Syarat &amp; Ketentuan</a> · <a href="/legal/privacy">Kebijakan Privasi</a> · <a href="/legal/refund">Kebijakan Refund</a></p>`
  );

// ---------- Admin: pengaturan ----------
const settingsPage = (groups, active, rows, { msg, error, missingLegal }) => {
  const g = groups.find((x) => x.id === active);
  const field = (f) => {
    const src = f.source ? `<small class="muted"> · sumber: ${f.source === 'admin' ? 'admin' : 'env server'}</small>` : '';
    if (f.bool)
      return `<label>${esc(f.label)}${src}<select name="${f.key}"><option value="true" ${f.isSet ? (f.value === 'true' ? 'selected' : '') : f.def === 'true' ? 'selected' : ''}>Aktif</option><option value="false" ${f.value === 'false' ? 'selected' : ''}>Nonaktif</option></select></label>`;
    if (f.secret)
      return `<label>${esc(f.label)}${src}<input type="password" name="${f.key}" autocomplete="new-password" placeholder="${f.isSet ? f.masked + ' (kosongkan = tidak diubah)' : 'belum diisi'}">
${f.source === 'admin' ? `<span class="inline"><input type="checkbox" name="clear_${f.key}" value="1"> hapus nilai ini</span>` : ''}</label>`;
    if (f.textarea) return `<label>${esc(f.label)}${src}<textarea name="${f.key}" rows="8">${esc(f.value)}</textarea></label>`;
    return `<label>${esc(f.label)}${src}<input name="${f.key}" value="${esc(f.value)}"></label>`;
  };
  return layout(
    'Pengaturan',
    `<h1>Pengaturan</h1>
<div class="chips">${groups.map((x) => `<a class="${x.id === active ? 'on' : ''}" href="/admin/settings/${x.id}">${esc(x.label)}</a>`).join('')}</div>
${msg ? `<div class="flash ok" role="status">${esc(msg)}</div>` : ''}${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<div class="panel"><h2>${esc(g.label)}</h2>${g.help ? `<p class="muted">${esc(g.help.replace('{BASE_URL}', process.env.BASE_URL || 'https://domain-anda'))}</p>` : ''}
${
  g.kind
    ? `<p class="muted">Kunci disimpan terenkripsi di database dan hanya 4 karakter terakhir yang ditampilkan. Setelah menyimpan, jalankan <a href="/admin/status">Uji koneksi</a>.</p>`
    : ''
}
${
  active === 'legal'
    ? `<p class="warn">Dokumen bawaan adalah draf umum. ${missingLegal.length ? 'Data penjual belum lengkap, dokumen masih berisi tanda [ … ]. ' : ''}Mohon ditinjau konsultan hukum sebelum toko dibuka untuk umum. Pratinjau: <a href="/legal/privacy" target="_blank">Privasi</a> · <a href="/legal/terms" target="_blank">S&amp;K</a> · <a href="/legal/refund" target="_blank">Refund</a></p>`
    : ''
}
<form method="post" action="/admin/settings/${active}" class="form">${rows.map(field).join('')}<button class="btn">Simpan</button></form></div>`,
    { admin: true }
  );
};

// ---------- Admin: integrasi (mode sandbox/produksi + uji) ----------
const when = (t) => (t ? esc(t.created_at) : '');
const integrationsPage = (items, { msg, error, balances }) => {
  const risky = items.filter((i) => i.enabled && i.mode === 'production' && !i.sandboxOk);
  const row = (i) => `<tr>
<td><strong>${esc(i.label)}</strong><br><small class="muted">${i.kind === 'gateway' ? 'Gateway pembayaran' : 'Pemasok'}${i.healthy === false ? ' · <span class="warn">sedang dilewati (gangguan)</span>' : ''}${i.verified === false ? ' · <span class="warn">format API belum diuji</span>' : ''}</small></td>
<td class="${i.enabled ? 'ok' : 'out'}">${i.enabled ? 'Terkonfigurasi' : 'Belum diisi'}</td>
<td>${!i.enabled ? '<span class="muted">-</span>' : i.mode === 'production' ? '<b class="out">PRODUKSI</b>' : i.mode === 'sandbox' ? '<b class="warn">Sandbox</b>' : '<span class="muted">tanpa sandbox</span>'}</td>
<td>${i.last ? `<span class="${i.last.ok ? 'ok' : 'out'}">${i.last.ok ? '✔' : '✘'}</span> ${esc(i.last.mode)} · ${when(i.last)}<br><small>${esc(i.last.detail)}</small>` : '<span class="muted">belum pernah diuji</span>'}
${i.sandboxOk ? '<br><small class="ok">lulus uji sandbox</small>' : ''}${balances?.[i.id] !== undefined ? `<br><small>Saldo: ${esc(balances[i.id])}</small>` : ''}</td>
<td class="acts">
<a class="btn sm ghost" href="/admin/settings/${i.group}">Kunci API</a>
${i.testable && i.enabled ? `<form method="post" action="/admin/integrations/${i.id}/test"><button class="btn sm">Uji koneksi</button></form>` : ''}
${
  i.switchable && i.enabled
    ? i.mode === 'production'
      ? `<form method="post" action="/admin/integrations/${i.id}/mode"><input type="hidden" name="mode" value="sandbox"><button class="btn sm ghost">Kembali ke sandbox</button></form>`
      : `<form method="post" action="/admin/integrations/${i.id}/mode" onsubmit="return confirm('Pindah ke PRODUKSI? Transaksi akan memakai uang sungguhan.')"><input type="hidden" name="mode" value="production"><button class="btn sm danger" ${i.sandboxOk ? '' : 'disabled title="Lulus uji sandbox dulu"'}>Pindah ke produksi</button></form>`
    : ''
}
${i.enabled && !i.testable ? `<form method="post" action="/admin/integrations/${i.id}/attest" class="stack"><input name="note" placeholder="Hasil uji transaksi kecil…" required minlength="5"><button class="btn sm ghost">Catat uji manual</button></form>` : ''}
${i.hasCatalog && i.enabled ? `<a class="btn sm ghost" href="/admin/suppliers/${i.id}/catalog">Cari SKU</a>` : ''}
</td></tr>`;
  return layout(
    'Integrasi',
    `<h1>Integrasi</h1>${msg ? `<div class="flash ok" role="status">${esc(msg)}</div>` : ''}${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
${risky.length ? `<p class="err">⚠ Mode produksi tanpa catatan uji sandbox: ${risky.map((r) => esc(r.label)).join(', ')}. Uji dulu sebelum menerima uang sungguhan.</p>` : ''}
<div class="panel"><p class="muted"><b>Alur go-live:</b> 1) isi kunci <b>sandbox</b> di Pengaturan → 2) <b>Uji koneksi</b> sampai sukses → 3) uji alur beli sungguhan di toko (bayar, kirim, refund) → 4) baru <b>Pindah ke produksi</b> dan ganti dengan kunci produksi. Mode produksi terkunci sampai ada uji sandbox yang lulus dalam 30 hari terakhir.</p></div>
<div class="scroll"><table><tr><th>Integrasi</th><th>Status</th><th>Mode</th><th>Uji terakhir</th><th></th></tr>${items.map(row).join('')}</table></div>`,
    { admin: true }
  );
};

// ---------- Admin: daftar admin ----------
const adminsPage = (list, me, { msg, error }) =>
  layout(
    'Admin',
    `<h1>Akun admin</h1>${msg ? `<div class="flash ok" role="status">${esc(msg)}</div>` : ''}${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<div class="scroll"><table><tr><th>Username</th><th>Peran</th><th>Status</th><th></th></tr>${list
      .map(
        (a) => `<tr><td>${esc(a.username)}${a.id === me.id ? ' <small class="muted">(Anda)</small>' : ''}</td>
<td>${a.role === 'owner' ? 'Pemilik' : 'Staf'}</td><td class="${a.active ? 'ok' : 'out'}">${a.active ? 'Aktif' : 'Nonaktif'}</td>
<td class="acts"><form method="post" action="/admin/admins/${a.id}/toggle"><button class="btn sm ghost">${a.active ? 'Nonaktifkan' : 'Aktifkan'}</button></form>
<form method="post" action="/admin/admins/${a.id}/password" class="stack"><input type="password" name="password" placeholder="Password baru" minlength="8" required><button class="btn sm ghost">Reset password</button></form></td></tr>`
      )
      .join('')}</table></div>
<div class="panel"><h2>Tambah admin</h2><p class="muted"><b>Pemilik</b>: semua akses termasuk Pengaturan, Integrasi, Admin, dan Refund. <b>Staf</b>: pesanan, produk, stok, kupon, laporan.</p>
<form method="post" action="/admin/admins" class="form"><label>Username<input name="username" required pattern="[a-z0-9._\-]{3,32}" autocapitalize="none"></label>
<label>Password (min. 8)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
<label>Peran<select name="role"><option value="staff">Staf</option><option value="owner">Pemilik</option></select></label><button class="btn">Tambah</button></form></div>
<div class="panel"><h2>Ganti password saya</h2><form method="post" action="/admin/me/password" class="form">
<label>Password lama<input type="password" name="old_password" required autocomplete="current-password"></label>
<label>Password baru<input type="password" name="new_password" required minlength="8" autocomplete="new-password"></label><button class="btn">Ganti</button></form></div>`,
    { admin: true }
  );

const adminMe = (a, error) =>
  layout(
    'Akun saya',
    `<h1>${esc(a.username)} <small class="muted">(${a.role === 'owner' ? 'Pemilik' : 'Staf'})</small></h1>${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<div class="panel"><h2>Ganti password</h2><form method="post" action="/admin/me/password" class="form">
<label>Password lama<input type="password" name="old_password" required autocomplete="current-password"></label>
<label>Password baru (min. 8)<input type="password" name="new_password" required minlength="8" autocomplete="new-password"></label><button class="btn">Ganti</button></form></div>`,
    { admin: true }
  );

// ---------- Admin: detail pesanan + refund ----------
const orderDetail = (o, d, { msg, error, isOwner }) => {
  const canRefund = d.plan && isOwner;
  return layout(
    'Pesanan ' + o.id,
    `<a href="/admin/orders" class="muted">← Pesanan</a><h1>${esc(o.id)}</h1>${msg ? `<div class="flash ok" role="status">${esc(msg)}</div>` : ''}${error ? `<div class="flash err" role="alert">${esc(error)}</div>` : ''}
<div class="panel"><p>${esc(o.product_name)} ×${o.qty} · <strong>${rp(o.amount)}</strong>${o.coupon_code ? ` · kupon ${esc(o.coupon_code)} −${rp(o.discount)}` : ''}</p>
<p>Pembeli: ${esc(o.customer_name)} · ${esc(o.contact)}${o.user_id ? ` · akun #${o.user_id}` : ' · tamu'}</p><p>Status: <b>${esc(o.status)}</b> · ${esc(o.created_at)}</p></div>
<div class="panel"><h2>Pembayaran</h2><table><tr><th>Ref</th><th>Gateway</th><th>Status</th></tr>${d.attempts
      .map((a) => `<tr><td><code>${esc(a.ref)}</code></td><td>${esc(a.provider)}</td><td>${esc(a.status)}</td></tr>`)
      .join('') || '<tr><td colspan="3" class="muted">Tidak ada.</td></tr>'}</table></div>
<div class="panel"><h2>Refund</h2>
${d.refunds.length ? `<table><tr><th>Waktu</th><th>Gateway</th><th>Nominal</th><th>Status</th><th>Catatan</th></tr>${d.refunds
      .map((r) => `<tr><td>${esc(r.created_at)}</td><td>${esc(r.provider)}</td><td>${rp(r.amount)}</td><td class="${r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'out' : 'warn'}">${esc(r.status)}</td><td><small>${esc(r.message || r.reason)}${r.provider_ref ? ' · ' + esc(r.provider_ref) : ''}</small></td></tr>`)
      .join('')}</table>` : '<p class="muted">Belum ada refund.</p>'}
${
  !isOwner
    ? '<p class="muted">Hanya Pemilik yang dapat melakukan refund.</p>'
    : d.plan
    ? `<form method="post" action="/admin/orders/${o.id}/refund" class="form" onsubmit="return confirm('Refund ${rp(o.amount)} ke pembeli lewat gateway ${esc(d.plan.provider)}?')">
<input type="hidden" name="attempt" value="${esc(d.plan.ref)}"><label>Alasan<input name="reason" required maxlength="100" value="${o.status === 'paid_nostock' ? 'Stok tidak tersedia' : ''}"></label>
<button class="btn danger">Refund ${rp(o.amount)} via ${esc(d.plan.provider)} (otomatis)</button></form>
<form method="post" action="/admin/orders/${o.id}/refund" class="form" style="margin-top:8px" onsubmit="return confirm('Hanya catat bahwa uang sudah dikembalikan manual lewat dashboard gateway?')">
<input type="hidden" name="attempt" value="${esc(d.plan.ref)}"><input type="hidden" name="manual" value="1"><label>Catatan refund manual<input name="reason" required maxlength="100" placeholder="mis. direfund lewat dashboard Midtrans"></label>
<button class="btn ghost">Tandai direfund manual</button></form>`
    : `<p class="muted">Tidak ada pembayaran yang bisa direfund: ${esc(d.planError || '-')}</p>`
}</div>
<div class="panel"><h2>Transaksi pemasok</h2><table><tr><th>Ref</th><th>Pemasok</th><th>SKU</th><th>Status</th><th>Pesan</th></tr>${d.tx
      .map((t) => `<tr><td><code>${esc(t.ref)}</code></td><td>${esc(t.supplier)}</td><td>${esc(t.sku)}</td><td>${esc(t.status)}</td><td><small>${esc(t.message)}</small></td></tr>`)
      .join('') || '<tr><td colspan="5" class="muted">Tidak ada.</td></tr>'}</table></div>`,
    { admin: true }
  );
};

module.exports = { userLogin, userRegister, account, legalPage, settingsPage, integrationsPage, adminsPage, adminMe, orderDetail };
