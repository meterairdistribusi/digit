const { esc } = require('./admin-shell');

// Grafik kolom SVG sisi-server (tanpa pustaka). Satu seri → tanpa legenda (judul kartu yang menamai). Mengikuti spesifikasi:
// batang ≤ 24px dengan ujung atas membulat 4px dan dasar rata, satu garis dasar, grid hairline, label hanya pada puncak,
// area sentuh lebih besar dari batang (tooltip), dan tampilan tabel sebagai alternatif aksesibel.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const shortDate = (iso) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
const compact = (n) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + ' jt' : n >= 1e3 ? +(n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + ' rb' : String(n));
const rp = (n) => 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// Batas atas yang "bulat" (1/2/5 × 10^n) dengan ≤ 4 sela
function niceScale(max) {
  if (max <= 0) return { top: 4, step: 1 };
  const raw = max / 4, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { top: Math.ceil(max / step) * step, step };
}

function columnChart(daily, { height = 230, label = 'Pendapatan' } = {}) {
  const W = 760, H = height, L = 46, R = 8, T = 22, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const max = Math.max(0, ...daily.map((d) => d.revenue));
  const { top, step } = niceScale(max);
  const y = (v) => T + ph - (v / top) * ph;
  const slot = pw / daily.length, bw = Math.min(24, slot * 0.66);
  const every = Math.max(1, Math.ceil(64 / slot));
  const peak = daily.reduce((a, d, i) => (d.revenue > (daily[a]?.revenue ?? -1) ? i : a), 0);

  let g = '';
  for (let v = 0; v <= top + 1e-6; v += step) {
    g += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-text" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v ? compact(v) : '0'}</text>`;
  }
  const r = 4;
  const bars = daily
    .map((d, i) => {
      const cx = L + slot * i + slot / 2, x0 = cx - bw / 2, h = (d.revenue / top) * ph;
      const tip = `${shortDate(d.day)}\n${rp(d.revenue)}\n${d.orders} pesanan`;
      const bar = d.revenue > 0 && h > 0.5
        ? `<path class="bar" d="M${x0},${y(0)} V${y(0) - Math.max(h, r) + r} Q${x0},${y(0) - Math.max(h, r)} ${x0 + r},${y(0) - Math.max(h, r)} H${x0 + bw - r} Q${x0 + bw},${y(0) - Math.max(h, r)} ${x0 + bw},${y(0) - Math.max(h, r) + r} V${y(0)} Z"/>`
        : '';
      const lab = i % every === 0 || i === daily.length - 1 ? `<text class="axis-text" x="${cx}" y="${H - 8}" text-anchor="middle">${shortDate(d.day)}</text>` : '';
      const pk = i === peak && d.revenue > 0 ? `<text class="peak-label" x="${Math.min(W - 30, Math.max(L + 20, cx))}" y="${y(d.revenue) - 7}" text-anchor="middle">${compact(d.revenue)}</text>` : '';
      return `<g class="col">${bar}<rect class="bar-hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ph + B - 6}" data-tip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(tip.replace(/\n/g, ', '))}"/>${lab}${pk}</g>`;
    })
    .join('');
  const total = daily.reduce((a, d) => a + d.revenue, 0);
  const rows = daily.filter((d) => d.orders).map((d) => `<tr><td>${shortDate(d.day)}</td><td class="num">${d.orders}</td><td class="num">${rp(d.revenue)}</td></tr>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(label)} per hari, total ${rp(total)}">${g}<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" style="stroke:var(--muted);opacity:.5"/>${bars}</svg>
<details style="margin-top:8px"><summary class="small muted">Lihat sebagai tabel</summary><div class="scroll"><table><thead><tr><th>Tanggal</th><th class="num">Pesanan</th><th class="num">${esc(label)}</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">Belum ada penjualan pada periode ini.</td></tr>'}</tbody></table></div></details>`;
}

module.exports = { columnChart, compact, rp, shortDate };
