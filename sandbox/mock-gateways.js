const http = require('http');
const crypto = require('crypto');

// Gateway & agregator TIRUAN untuk uji lokal/CI. Meniru bentuk API yang dipakai kode kita (Midtrans, Xendit, satu agregator generik),
// BUKAN pengganti uji di sandbox resmi mereka: format asli harus tetap dikonfirmasi lewat `npm run sandbox:check` dengan kunci sandbox.
//
// Kendali uji: state.fail.<midtrans|xendit|agg> = true → layanan itu menjawab 500; state.refundFail = true → refund ditolak.

async function start({ appUrl, midtransKey = 'SB-mock-key', xenditToken = 'cb-token' } = {}) {
  const state = {
    midtrans: new Map(), // order_id -> {amount, status}
    xendit: new Map(), // external_id -> {id, amount, status}
    refunds: [],
    supplierCalls: [],
    fail: {},
    refundFail: false,
    stock: ['MOCK-CODE-1', 'MOCK-CODE-2', 'MOCK-CODE-3'],
  };
  const json = (res, code, body) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(body)));
  const body = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } }); });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const b = req.method === 'POST' ? await body(req) : {};
    const authed = (kind) => {
      const h = req.headers.authorization || '';
      return kind === 'basic' ? h === 'Basic ' + Buffer.from(midtransKey + ':').toString('base64') : h.startsWith('Basic ');
    };

    // ----- Midtrans -----
    if (p === '/snap/v1/transactions') {
      if (state.fail.midtrans) return json(res, 500, { error_messages: ['mock down'] });
      if (!authed('basic')) return json(res, 401, { error_messages: ['Access denied'] });
      const d = b.transaction_details;
      state.midtrans.set(d.order_id, { amount: d.gross_amount, status: 'pending' });
      return json(res, 201, { token: 't-' + d.order_id, redirect_url: `${appUrl || ''}/mock/pay/midtrans/${d.order_id}` });
    }
    let m = p.match(/^\/v2\/([^/]+)\/status$/);
    if (m) {
      if (!authed('basic')) return json(res, 401, { status_code: '401', status_message: 'Unauthorized' });
      const t = state.midtrans.get(decodeURIComponent(m[1]));
      if (!t) return json(res, 200, { status_code: '404', status_message: 'Transaction doesn\'t exist.' });
      return json(res, 200, { status_code: '200', order_id: m[1], gross_amount: t.amount + '.00', transaction_status: t.status === 'paid' ? 'settlement' : 'pending' });
    }
    m = p.match(/^\/v2\/([^/]+)\/refund$/);
    if (m && req.method === 'POST') {
      const t = state.midtrans.get(decodeURIComponent(m[1]));
      if (state.refundFail || !t || t.status !== 'paid') return json(res, 200, { status_code: '412', status_message: 'Transaction status cannot be updated' });
      if (state.refunds.some((r) => r.key === b.refund_key)) return json(res, 200, { status_code: '200', refund_key: b.refund_key, status_message: 'duplicate key ignored' });
      state.refunds.push({ provider: 'midtrans', ref: m[1], amount: b.amount, key: b.refund_key });
      return json(res, 200, { status_code: '200', status_message: 'Success, refund request is approved', refund_chargeback_id: state.refunds.length, refund_key: b.refund_key });
    }

    // ----- Xendit -----
    if (p === '/balance') return authed('any') ? json(res, 200, { balance: 1000000 }) : json(res, 401, { message: 'invalid key' });
    if (p === '/v2/invoices' && req.method === 'POST') {
      if (state.fail.xendit) return json(res, 500, { message: 'mock down' });
      const id = 'inv-' + b.external_id;
      state.xendit.set(b.external_id, { id, amount: b.amount, status: 'PENDING' });
      return json(res, 200, { id, invoice_url: `${appUrl || ''}/mock/pay/xendit/${b.external_id}`, status: 'PENDING' });
    }
    if (p === '/v2/invoices') {
      const x = state.xendit.get(url.searchParams.get('external_id'));
      return json(res, 200, x ? [{ id: x.id, status: x.status, amount: x.amount, paid_amount: x.status === 'PAID' ? x.amount : 0 }] : []);
    }
    if (p === '/refunds' && req.method === 'POST') {
      const inv = [...state.xendit.values()].find((x) => x.id === b.invoice_id);
      if (state.refundFail || !inv || inv.status !== 'PAID') return json(res, 400, { error_code: 'REFUND_NOT_ALLOWED', message: 'invoice not paid' });
      const dup = state.refunds.find((r) => r.key === req.headers['idempotency-key']);
      if (!dup) state.refunds.push({ provider: 'xendit', ref: inv.id, amount: b.amount, key: req.headers['idempotency-key'], reason: b.reason });
      return json(res, 200, { id: 'rfd-' + state.refunds.length, status: 'SUCCEEDED', amount: b.amount });
    }

    // ----- Agregator generik -----
    if (p === '/agg/order') {
      state.supplierCalls.push(b);
      if (state.fail.agg) return json(res, 500, { status: 'error', message: 'mock down' });
      const code = state.stock.shift();
      return code ? json(res, 200, { status: 'success', data: { voucher: code } }) : json(res, 200, { status: 'failed', message: 'stok habis' });
    }
    if (p === '/agg/balance') return json(res, 200, { data: { balance: 500000 } });

    json(res, 404, { error: 'mock: tidak dikenal ' + p });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;

  // Simulasikan pembeli membayar lalu gateway memanggil webhook aplikasi (dengan tanda tangan yang benar)
  async function pay(provider, ref, { amount } = {}) {
    if (provider === 'midtrans') {
      const t = state.midtrans.get(ref);
      t.status = 'paid';
      const gross = String(amount ?? t.amount) + '.00';
      const sig = crypto.createHash('sha512').update(ref + '200' + gross + midtransKey).digest('hex');
      return fetch(appUrl + '/pay/midtrans/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: ref, status_code: '200', gross_amount: gross, signature_key: sig, transaction_status: 'settlement', fraud_status: 'accept' }),
      });
    }
    const x = state.xendit.get(ref);
    x.status = 'PAID';
    return fetch(appUrl + '/pay/xendit/notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-callback-token': xenditToken },
      body: JSON.stringify({ external_id: ref, status: 'PAID', paid_amount: amount ?? x.amount, amount: x.amount }),
    });
  }

  return { url, state, pay, midtransKey, xenditToken, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { start };

// Jalankan mandiri: node sandbox/mock-gateways.js  → server tiruan di port 4010 untuk uji manual
if (require.main === module) {
  start({ appUrl: process.env.APP_URL || 'http://localhost:3000' }).then((m) => console.log('Mock gateway di', m.url));
}
