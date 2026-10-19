// Membuat ikon aplikasi (tas belanja) tanpa dependensi: node scripts/make-icons.js
const zlib = require('zlib'), fs = require('fs'), path = require('path');
const crc = (buf) => { let r = 0xffffffff; for (const b of buf) { r ^= b; for (let k = 0; k < 8; k++) r = r & 1 ? (r >>> 1) ^ 0xedb88320 : r >>> 1; } return (r ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = pixel(x / size, y / size); // supersampling 2x2 agar tepi halus
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 4; i++) raw[o + i] = px[i];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const inRR = (u, v, x0, y0, x1, y1, r) => { const cx = Math.min(Math.max(u, x0 + r), x1 - r), cy = Math.min(Math.max(v, y0 + r), y1 - r); return (u - cx) ** 2 + (v - cy) ** 2 <= r * r && u >= x0 && u <= x1 && v >= y0 && v <= y1; };
// true = bagian putih tas. `s` memperkecil gambar di sekitar tengah (area aman adaptive icon)
const bag = (u, v, s = 1) => {
  u = (u - 0.5) / s + 0.5; v = (v - 0.5) / s + 0.5;
  if (v >= 0.38 && v <= 0.75) { const half = 0.2 + 0.05 * ((v - 0.38) / 0.37); if (Math.abs(u - 0.5) <= half && inRR(u, v, 0.25, 0.38, 0.75, 0.75, 0.045)) return !(Math.hypot(u - 0.42, v - 0.44) < 0.018 || Math.hypot(u - 0.58, v - 0.44) < 0.018); }
  const d = Math.hypot(u - 0.5, v - 0.4);
  return v < 0.4 && d > 0.115 && d < 0.155;
};
const BG = [91, 75, 255], WHITE = [255, 255, 255];
const ss = (size, f) => (u, v) => { // rata-rata 4 sub-sampel
  const e = 0.25 / size, acc = [0, 0, 0, 0];
  for (const [dx, dy] of [[-e, -e], [e, -e], [-e, e], [e, e]]) { const c = f(u + dx, v + dy); for (let i = 0; i < 4; i++) acc[i] += c[i] / 4; }
  return acc.map(Math.round);
};
const out = (name, size, f) => fs.writeFileSync(path.join(__dirname, '../assets', name), png(size, ss(size, f)));
out('icon.png', 1024, (u, v) => (bag(u, v) ? [...WHITE, 255] : [...BG, 255]));
out('android-icon-background.png', 1024, () => [...BG, 255]);
out('android-icon-foreground.png', 1024, (u, v) => (bag(u, v, 0.62) ? [...WHITE, 255] : [0, 0, 0, 0]));
out('android-icon-monochrome.png', 1024, (u, v) => (bag(u, v, 0.62) ? [0, 0, 0, 255] : [0, 0, 0, 0]));
out('splash-icon.png', 1024, (u, v) => (bag(u, v, 0.8) ? [...WHITE, 255] : [0, 0, 0, 0]));
out('favicon.png', 48, (u, v) => (bag(u, v) ? [...WHITE, 255] : [...BG, 255]));
console.log('ikon dibuat di assets/');
