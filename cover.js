// Sampul produk otomatis (SVG) bila admin belum mengunggah gambar: gradasi per kategori + nama produk.
// Dipakai web; aplikasi native menggambar sampul sendiri dari data yang sama (warna + teks) karena tidak bisa menampilkan SVG.

const PAIRS = [
  ['#5b4bff', '#9a8cff'], ['#e11d48', '#fb923c'], ['#0d9488', '#4ade80'], ['#2563eb', '#22d3ee'],
  ['#c026d3', '#6366f1'], ['#ea580c', '#facc15'], ['#16a34a', '#a3e635'], ['#334155', '#64748b'],
];
const BY_CATEGORY = { streaming: 1, ai: 2, editing: 4, musik: 6, game: 3 };

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function cover(p) {
  const idx = BY_CATEGORY[String(p.category || '').toLowerCase()] ?? hash(p.category || p.name) % PAIRS.length;
  const words = String(p.name || '').trim().split(/\s+/);
  return { c1: PAIRS[idx][0], c2: PAIRS[idx][1], title: words[0] || '', subtitle: words.slice(1).join(' ') };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function svg(p) {
  const c = cover(p);
  // Lebar teks dijaga ≤ ~270px agar tetap utuh saat dipotong jadi kotak (thumbnail 1:1 memotong sisi kiri-kanan)
  const n = c.title.length;
  const size = n <= 5 ? 76 : n <= 7 ? 54 : n <= 9 ? 44 : 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="${esc(p.name)}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.c1}"/><stop offset="1" stop-color="${c.c2}"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#g)"/>
<circle cx="350" cy="40" r="120" fill="#fff" opacity=".10"/><circle cx="30" cy="290" r="100" fill="#fff" opacity=".10"/><circle cx="330" cy="270" r="46" fill="#fff" opacity=".12"/>
<text x="200" y="${c.subtitle ? 150 : 165}" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-weight="800" font-size="${size}" fill="#fff">${esc(c.title)}</text>
${c.subtitle ? `<text x="200" y="196" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-weight="600" font-size="26" fill="#fff" opacity=".92">${esc(c.subtitle.slice(0, 26))}</text>` : ''}
</svg>`;
}

module.exports = { cover, svg };
