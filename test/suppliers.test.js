const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { fromConfig, interpret, digest, fill } = require('../suppliers/generic');

test('digest md5 dan hmac', () => {
  assert.strictEqual(digest({ algo: 'md5', template: 'a{{ref}}' }, { ref: 'b' }), crypto.createHash('md5').update('ab').digest('hex'));
  assert.strictEqual(
    digest({ algo: 'sha256', hmacKey: 'k', template: '{{ref}}' }, { ref: 'x' }),
    crypto.createHmac('sha256', 'k').update('x').digest('hex')
  );
});

test('fill env dan variabel', () => {
  process.env.T_KEY = 'rahasia';
  assert.deepStrictEqual(fill({ a: '${T_KEY}-{{sku}}' }, { sku: 'S1' }), { a: 'rahasia-S1' });
});

test('interpret: success, pending, failed', () => {
  const c = { successPath: 'st', successValues: ['ok'], pendingValues: ['wait'], contentPath: 'c' };
  assert.strictEqual(interpret(c, { st: 'OK', c: 'kode' }).status, 'success');
  assert.strictEqual(interpret(c, { st: 'ok' }).status, 'failed'); // sukses tanpa isi tidak boleh dianggap terkirim
  assert.strictEqual(interpret(c, { st: 'wait' }).status, 'pending');
  assert.strictEqual(interpret(c, { st: 'err', message: 'saldo habis' }).message, 'saldo habis');
});

test('adapter generik: request, tanda tangan, form', async (t) => {
  let seen;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    seen = { url, opts };
    return new Response(JSON.stringify({ status: 'ok', c: 'KODE-1' }));
  });
  const a = fromConfig({
    name: 'x', url: 'https://x.test/o', bodyType: 'form', sign: { template: '{{ref}}:s' },
    body: { p: '{{sku}}', s: '{{signature}}' }, successPath: 'status', successValues: ['ok'], contentPath: 'c',
  });
  const r = await a.buy({ sku: 'A', ref: 'R1', customer: '081' });
  assert.deepStrictEqual([r.status, r.content], ['success', 'KODE-1']);
  assert.match(seen.opts.body, new RegExp('s=' + crypto.createHash('md5').update('R1:s').digest('hex')));
  assert.strictEqual(a.idempotent, false);
});

test('token OAuth di-cache', async (t) => {
  let auth = 0;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (url.includes('/auth')) { auth++; return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 })); }
    assert.strictEqual(opts.headers.Authorization, 'Bearer T');
    return new Response(JSON.stringify({ status: 'ok', c: 'z' }));
  });
  const a = fromConfig({ name: 'y', url: 'https://y.test/o', auth: { url: 'https://y.test/auth' }, headers: { Authorization: 'Bearer {{token}}' }, successValues: ['ok'], contentPath: 'c' });
  await a.buy({ sku: 'a', ref: 'r1', customer: 'c' });
  await a.buy({ sku: 'a', ref: 'r2', customer: 'c' });
  assert.strictEqual(auth, 1);
});
