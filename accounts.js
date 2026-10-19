const { db } = require('./db');
const box = require('./cryptobox');

// Akun pembeli (web + app Android/iPhone lewat API), akun admin (penjual), dan sesi keduanya.
// Sesi = token acak; yang disimpan hanya hash-nya, jadi kebocoran DB tidak membocorkan sesi aktif.

const TTL = { user: 30 * 24 * 3600e3, admin: 12 * 3600e3 };
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;

class UserError extends Error {}

function createSession(kind, subjectId, device = '') {
  const token = box.randomToken();
  db.prepare('INSERT INTO sessions (token_hash, kind, subject_id, device, expires_at) VALUES (?,?,?,?,?)').run(
    box.sha256(token), kind, subjectId, String(device).slice(0, 80), Date.now() + TTL[kind]
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return token;
}

function sessionSubject(kind, token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND kind = ?').get(box.sha256(token), kind);
  if (!s || s.expires_at < Date.now()) return null;
  return kind === 'user'
    ? db.prepare('SELECT id, email, name, phone, created_at FROM users WHERE id = ?').get(s.subject_id) || null
    : db.prepare('SELECT id, username, role FROM admins WHERE id = ? AND active = 1').get(s.subject_id) || null;
}

const revokeSession = (token) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(box.sha256(token || ''));
const revokeAll = (kind, id) => db.prepare('DELETE FROM sessions WHERE kind = ? AND subject_id = ?').run(kind, id);

// ---------- Pembeli ----------
function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Password minimal 8 karakter';
  if (pw.length > 200) return 'Password terlalu panjang';
  if (/^(.)\1+$/.test(pw) || ['password', '12345678', 'qwertyui'].includes(pw.toLowerCase())) return 'Password terlalu mudah ditebak';
  return null;
}

function registerUser({ email, name, phone = '', password, acceptTerms }) {
  email = String(email || '').trim().toLowerCase();
  name = String(name || '').trim().slice(0, 60);
  phone = String(phone || '').trim().slice(0, 20);
  if (!EMAIL.test(email)) throw new UserError('Email tidak valid');
  if (!name) throw new UserError('Nama wajib diisi');
  const bad = passwordProblem(password);
  if (bad) throw new UserError(bad);
  if (!acceptTerms) throw new UserError('Anda harus menyetujui Syarat & Ketentuan dan Kebijakan Privasi');
  try {
    const r = db
      .prepare('INSERT INTO users (email, name, phone, pass_hash, accepted_terms_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)')
      .run(email, name, phone, box.hashPassword(password));
    return Number(r.lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new UserError('Email sudah terdaftar');
    throw e;
  }
}

// Verifikasi tetap dijalankan walau email tak ada, supaya waktu respons tidak membocorkan email terdaftar
const DUMMY = box.hashPassword('dummy-password');
function authUser(email, password) {
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
  const ok = box.verifyPassword(password, u ? u.pass_hash : DUMMY);
  return u && ok ? u : null;
}

function changePassword(kind, id, oldPw, newPw) {
  const table = kind === 'user' ? 'users' : 'admins';
  const row = db.prepare(`SELECT pass_hash FROM ${table} WHERE id = ?`).get(id);
  if (!row || !box.verifyPassword(oldPw, row.pass_hash)) throw new UserError('Password lama salah');
  const bad = passwordProblem(newPw);
  if (bad) throw new UserError(bad);
  db.prepare(`UPDATE ${table} SET pass_hash = ? WHERE id = ?`).run(box.hashPassword(newPw), id);
  revokeAll(kind, id);
}

// Hapus akun (wajib ada di app store). Riwayat pesanan tetap disimpan tanpa tautan ke akun, sesuai masa simpan data keuangan.
function deleteUser(id) {
  db.transaction(() => {
    db.prepare('UPDATE orders SET user_id = NULL WHERE user_id = ?').run(id);
    revokeAll('user', id);
    db.prepare('DELETE FROM push_tokens WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  })();
}

function exportUser(id) {
  const u = db.prepare('SELECT id, email, name, phone, accepted_terms_at, created_at FROM users WHERE id = ?').get(id);
  const orders = db.prepare('SELECT id, product_id, qty, amount, discount, coupon_code, status, created_at, paid_at FROM orders WHERE user_id = ? ORDER BY created_at').all(id);
  return { profile: u, orders };
}

// ---------- Admin ----------
const ADMIN_NAME = /^[a-z0-9._-]{3,32}$/;

function createAdmin(username, password, role = 'staff') {
  username = String(username || '').trim().toLowerCase();
  if (!ADMIN_NAME.test(username)) throw new UserError('Username 3-32 karakter: huruf kecil, angka, titik, strip');
  const bad = passwordProblem(password);
  if (bad) throw new UserError(bad);
  try {
    db.prepare('INSERT INTO admins (username, pass_hash, role) VALUES (?,?,?)').run(username, box.hashPassword(password), role === 'owner' ? 'owner' : 'staff');
  } catch (e) {
    if (/UNIQUE/.test(e.message)) throw new UserError('Username sudah dipakai');
    throw e;
  }
}

const listAdmins = () => db.prepare('SELECT id, username, role, active, created_at FROM admins ORDER BY id').all();
const activeOwners = () => db.prepare("SELECT COUNT(*) c FROM admins WHERE role = 'owner' AND active = 1").get().c;

function authAdmin(username, password) {
  const a = db.prepare('SELECT * FROM admins WHERE username = ? AND active = 1').get(String(username || '').trim().toLowerCase());
  const ok = box.verifyPassword(password, a ? a.pass_hash : DUMMY);
  return a && ok ? a : null;
}

function setAdminActive(id, active) {
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!a) return;
  if (!active && a.role === 'owner' && a.active && activeOwners() <= 1) throw new UserError('Tidak bisa menonaktifkan pemilik terakhir');
  db.prepare('UPDATE admins SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  if (!active) revokeAll('admin', id);
}

function resetAdminPassword(id, newPw) {
  const bad = passwordProblem(newPw);
  if (bad) throw new UserError(bad);
  db.prepare('UPDATE admins SET pass_hash = ? WHERE id = ?').run(box.hashPassword(newPw), id);
  revokeAll('admin', id);
}

// Admin pertama dibuat dari ADMIN_PASSWORD (env) saat belum ada admin sama sekali.
function bootstrapAdmin() {
  if (db.prepare('SELECT COUNT(*) c FROM admins').get().c) return false;
  const pw = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin');
  if (!pw) return false;
  db.prepare('INSERT INTO admins (username, pass_hash, role) VALUES (?,?,?)').run('admin', box.hashPassword(pw), 'owner');
  return true;
}

module.exports = {
  UserError, createSession, sessionSubject, revokeSession, revokeAll, registerUser, authUser, changePassword, deleteUser, exportUser,
  createAdmin, listAdmins, authAdmin, setAdminActive, resetAdminPassword, bootstrapAdmin, passwordProblem,
};
