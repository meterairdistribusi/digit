const crypto = require('crypto');

const serverKey = () => process.env.MIDTRANS_SERVER_KEY || '';
const clientKey = () => process.env.MIDTRANS_CLIENT_KEY || '';
const isProd = () => process.env.MIDTRANS_IS_PRODUCTION === 'true';
const enabled = () => Boolean(serverKey() && clientKey());

const snapBase = () => (isProd() ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com');
const apiBase = () => (isProd() ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com');
const auth = () => 'Basic ' + Buffer.from(serverKey() + ':').toString('base64');

async function createSnapToken(order, productName, finishUrl) {
  const res = await fetch(snapBase() + '/snap/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth() },
    body: JSON.stringify({
      transaction_details: { order_id: order.id, gross_amount: order.amount },
      item_details: [
        { id: String(order.product_id), price: order.amount / order.qty, quantity: order.qty, name: productName.slice(0, 50) },
      ],
      customer_details: { first_name: order.customer_name.slice(0, 50) },
      callbacks: { finish: finishUrl },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('Midtrans: ' + JSON.stringify(data.error_messages || data));
  return data.token;
}

function validSignature(n) {
  const expected = crypto
    .createHash('sha512')
    .update(String(n.order_id) + String(n.status_code) + String(n.gross_amount) + serverKey())
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(n.signature_key || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function fetchStatus(orderId) {
  const res = await fetch(`${apiBase()}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: 'application/json', Authorization: auth() },
  });
  return res.json();
}

// Ubah payload status Midtrans menjadi 'paid' | 'failed' | 'pending'
function interpret(n) {
  const s = n.transaction_status;
  if (s === 'settlement' || (s === 'capture' && n.fraud_status === 'accept')) return 'paid';
  if (['deny', 'cancel', 'expire', 'failure'].includes(s)) return 'failed';
  return 'pending';
}

module.exports = { enabled, clientKey, snapBase, createSnapToken, validSignature, fetchStatus, interpret };
