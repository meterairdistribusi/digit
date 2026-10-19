const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Kunci enkripsi pengaturan: SETTINGS_KEY, atau SESSION_SECRET, atau file acak di DATA_DIR (dibuat sekali, mode 0600).
// Ganti kunci = nilai tersimpan tidak bisa dibaca lagi (harus diisi ulang), jadi jaga SETTINGS_KEY tetap stabil.
function masterKey() {
  const env = process.env.SETTINGS_KEY || process.env.SESSION_SECRET;
  if (env) return crypto.createHash('sha256').update(env).digest();
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
  const file = path.join(dir, '.secret');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest();
}

// AES-256-GCM: "v1.<iv>.<tag>.<data>" (base64url)
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), data].map((x) => (Buffer.isBuffer(x) ? x.toString('base64url') : x)).join('.');
}

function decrypt(blob) {
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') throw new Error('format tidak dikenal');
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

// Password: scrypt + salt acak
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${crypto.scryptSync(String(pw), salt, 64).toString('base64url')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), 64);
  const b = Buffer.from(hash, 'base64url');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const randomToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

module.exports = { encrypt, decrypt, hashPassword, verifyPassword, randomToken, sha256 };
