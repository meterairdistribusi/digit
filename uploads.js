const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Gambar produk. Admin mengunggah dari browser (diperkecil dulu di sisi klien jadi JPEG ≤ 800px) lewat data URL;
// server memvalidasi isi file sebenarnya (magic bytes), bukan nama/tipe yang dikirim klien, membatasi ukuran,
// dan menyimpan dengan nama berbasis hash di DATA_DIR/uploads. File disajikan dengan nosniff + tipe tetap.

const dir = () => path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'uploads');
const MAX_BYTES = 700 * 1024;

const SIGS = [
  { ext: 'jpg', type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', type: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

class UploadError extends Error {}

function saveDataUrl(dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new UploadError('Format gambar harus JPG, PNG, atau WebP');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_BYTES) throw new UploadError('Gambar terlalu besar (maks. 700 KB). Gunakan gambar yang lebih kecil.');
  const sig = SIGS.find((s) => buf.length > 12 && s.test(buf));
  if (!sig) throw new UploadError('Isi berkas bukan gambar JPG/PNG/WebP yang valid');
  const name = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20) + '.' + sig.ext;
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), name), buf);
  return '/uploads/' + name;
}

// Hanya URL http(s) atau berkas hasil unggahan sendiri yang boleh disimpan sebagai gambar produk
const cleanImageRef = (v) => {
  v = String(v || '').trim();
  if (!v) return null;
  if (/^\/uploads\/[a-f0-9]{20}\.(jpg|png|webp)$/.test(v)) return v;
  if (/^https:\/\/[^\s"'<>]{4,300}$/.test(v)) return v;
  throw new UploadError('URL gambar harus diawali https://');
};

const typeOf = (file) => SIGS.find((s) => file.endsWith('.' + s.ext))?.type || 'application/octet-stream';

module.exports = { saveDataUrl, cleanImageRef, UploadError, dir, typeOf, MAX_BYTES };
