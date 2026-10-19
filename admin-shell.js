const ctx = require('./ctx');
const store = require('./db');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ikon garis 24px (gaya Feather). aria-hidden: label teks selalu ada di sebelahnya.
const ICON = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  orders: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  products: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  stock: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  promo: '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  reports: '<path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>',
  integrations: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  settings: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  admins: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="m15 3 6 0 0 6"/><path d="M10 14 21 3"/>',
  menu: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  refund: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  minus: '<path d="M5 12h14"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  trend_up: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  trend_down: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
};
const icon = (name, size = 18) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ''}</svg>`;

const NAV = [
  { group: 'Toko', items: [
    { href: '/admin', key: 'dashboard', label: 'Dasbor', exact: true },
    { href: '/admin/orders', key: 'orders', label: 'Pesanan', badge: true },
    { href: '/admin/products', key: 'products', label: 'Produk' },
    { href: '/admin/stock', key: 'stock', label: 'Stok' },
    { href: '/admin/coupons', key: 'promo', label: 'Promo & kupon' },
    { href: '/admin/reports', key: 'reports', label: 'Laporan' },
  ] },
  { group: 'Sistem', owner: true, items: [
    { href: '/admin/status', key: 'integrations', label: 'Integrasi', also: ['/admin/suppliers'] },
    { href: '/admin/settings', key: 'settings', label: 'Pengaturan' },
    { href: '/admin/admins', key: 'admins', label: 'Admin' },
  ] },
];

const isActive = (it, path) => (it.exact ? path === it.href : path === it.href || path.startsWith(it.href + '/') || (it.also || []).some((a) => path.startsWith(a)));

function shell({ title, body, head = '' }) {
  const { admin, path = '' } = ctx.get();
  const owner = admin?.role === 'owner';
  let attention = 0;
  try { attention = admin ? store.attentionCount() : 0; } catch { /* abaikan */ }
  const storeName = esc(process.env.STORE_NAME || 'Toko Digital');
  const nav = NAV.filter((g) => !g.owner || owner || !admin)
    .map(
      (g) => `<div class="nav-group">${g.group}</div>${g.items
        .map((it) => `<a href="${it.href}" class="nav-item${isActive(it, path) ? ' active' : ''}"${isActive(it, path) ? ' aria-current="page"' : ''}>${icon(it.key === 'promo' ? 'promo' : it.key)}<span>${it.label}</span>${it.badge && attention ? `<b class="nav-badge" title="${attention} perlu tindakan">${attention}</b>` : ''}</a>`)
        .join('')}`
    )
    .join('');
  return `<!doctype html>
<html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${storeName} Admin</title>
<link rel="stylesheet" href="/admin.css"><link rel="icon" href="/icon-192.png"><meta name="theme-color" content="#12142b">${head}
</head><body class="admin">
<input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Buka menu">
<label for="nav-toggle" class="scrim"></label>
<aside class="sidebar">
  <a class="logo" href="/admin"><span class="logo-mark">${icon('orders', 20)}</span><span class="logo-text">${storeName}<small>Panel penjual</small></span></a>
  <nav aria-label="Menu admin">${nav}</nav>
  <div class="side-foot">
    ${admin ? `<a class="user" href="/admin/me"><span class="avatar">${esc(admin.username.slice(0, 1).toUpperCase())}</span><span class="user-text"><b>${esc(admin.username)}</b><small>${owner ? 'Pemilik' : 'Staf'}</small></span></a>` : ''}
    <form method="post" action="/admin/logout"><button class="side-btn" title="Keluar">${icon('logout')}<span>Keluar</span></button></form>
  </div>
</aside>
<div class="main">
  <header class="topbar">
    <label for="nav-toggle" class="burger" aria-label="Menu">${icon('menu', 22)}</label>
    <span class="topbar-title">${esc(title)}</span>
    <span class="spacer"></span>
    <a class="top-link" href="/" target="_blank" rel="noopener">Lihat toko ${icon('external', 15)}</a>
  </header>
  <main class="content">${body}</main>
</div>
<div class="tip" id="tip" role="tooltip" hidden></div>
<script src="/admin.js" defer></script>
</body></html>`;
}

module.exports = { shell, icon, esc, ICON };
