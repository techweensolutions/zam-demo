// Run: node --test
//
// The demo stores' server, against a stand-in for ZAM. What matters here: the
// server prices the order itself, creates the session with the secret key and an
// Idempotency-Key, and calls an order paid only when ZAM's answer matches it.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

// A stand-in for ZAM's checkout API.
function fakeZam() {
  const state = { sessions: new Map(), calls: [], n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      state.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], body: raw ? JSON.parse(raw) : null });
      const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: status < 300, data })); };
      if (!req.headers.authorization) return reply(401, null);
      let m;
      if (req.method === 'POST' && req.url === '/api/checkout/sessions') {
        const b = JSON.parse(raw);
        const id = 'KW' + String(++state.n).padStart(11, '0');
        const s = { session_id: id, payment_url: `http://zam.test/api/pos/view/${id}`, amount: b.amount, currency: 'KWD', order_ref: b.order_ref, status: 'pending' };
        state.sessions.set(id, s);
        return reply(201, s);
      }
      if (req.method === 'GET' && (m = /^\/api\/checkout\/sessions\/(\w+)$/.exec(req.url))) {
        const s = state.sessions.get(m[1]);
        if (!s) return reply(404, null);
        if (s.status === 'gone') return reply(410, null);
        return reply(200, s);
      }
      if (req.method === 'POST' && (m = /^\/api\/checkout\/sessions\/(\w+)\/cancel$/.exec(req.url))) {
        state.sessions.get(m[1]).status = 'canceled';
        return reply(200, null);
      }
      reply(404, null);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}

let zam, app, base;

test.before(async () => {
  zam = await fakeZam();
  process.env.ZAM_BASE_URL = zam.url;
  process.env.ZAM_KEY_XCITE = 'zam_sk_live_XCITEKEYXCITEKEY';
  process.env.ZAM_KEY_TRAVEL = 'zam_sk_live_TRAVELKEYTRAVELKEY';
  process.env.ZAM_KEY_TALABAT = 'zam_sk_live_TALABATKEYTALABATKEY';
  process.env.ZAM_WHSEC_XCITE = 'whsec_demo';
  app = require('../server.js').createServer();
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.address().port}`;
});
test.after(() => { app.close(); zam.server.close(); });

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const sessionOf = (ref) => [...zam.state.sessions.values()].find((x) => x.order_ref === ref);
const statusOf = async (ref) => (await fetch(`${base}/api/orders/${ref}/status`)).json();

test('prices come from the stores\' own pages', () => {
  const { price } = require('../server.js');
  assert.strictEqual(price('xcite', { items: [{ id: 1, qty: 1 }, { id: 10, qty: 2 }] }).amount, '479.700'); // 449.900 + 2 x 14.900
  assert.strictEqual(price('talabat', { items: [{ id: 1, qty: 1 }, { id: 6, qty: 2 }] }).amount, '6.750'); // 3.250 + 2 x 1.750
  assert.strictEqual(price('travel', { tripId: 1, cls: 1.5, pax: 3 }).amount, '202.500'); // Dubai 45.000, business, 3 passengers
});

test('the server refuses what the page could not have offered', () => {
  const { price } = require('../server.js');
  for (const bad of [
    ['xcite', { items: [] }], ['xcite', { items: [{ id: 999, qty: 1 }] }], ['xcite', { items: [{ id: 1, qty: 0 }] }],
    ['xcite', { items: [{ id: 1, qty: 21 }] }], ['xcite', { items: [{ id: 1, qty: 1.5 }] }], ['xcite', { items: 'x' }],
    ['travel', { tripId: 1, cls: 0.01, pax: 1 }], ['travel', { tripId: 1, cls: 1, pax: 40 }], ['travel', { tripId: 77, cls: 1, pax: 1 }],
  ]) assert.ok(price(...bad).error, JSON.stringify(bad));
});

test('creating an order makes a session with the secret key and an idempotency key', async () => {
  const r = await post('/api/orders/xcite', { items: [{ id: 5, qty: 2 }], amount: '0.001', price: 0.001 });
  assert.strictEqual(r.status, 201);
  const o = await r.json();
  assert.match(o.order_ref, /^XCITE-/);
  assert.strictEqual(o.amount, '179.800', 'the server\'s price, not anything the page sent');
  assert.match(o.payment_url, /\/api\/pos\/view\/KW/);
  const call = zam.state.calls.filter((c) => c.method === 'POST' && c.url === '/api/checkout/sessions').pop();
  assert.strictEqual(call.auth, 'Token zam_sk_live_XCITEKEYXCITEKEY');
  assert.strictEqual(call.idem, o.order_ref + '-1');
  assert.deepStrictEqual(Object.keys(call.body).sort(), ['amount', 'note', 'order_ref'], 'nothing else is sent: no payer');
  assert.strictEqual(call.body.note, 'Xcite order ' + o.order_ref, 'the wallet requires a note, and shows this one');
});

test('each store uses its own key', async () => {
  await post('/api/orders/talabat', { items: [{ id: 3, qty: 1 }] });
  await post('/api/orders/travel', { tripId: 2, cls: 1, pax: 1 });
  const auths = zam.state.calls.filter((c) => c.method === 'POST' && c.url === '/api/checkout/sessions').map((c) => c.auth);
  assert.ok(auths.includes('Token zam_sk_live_TALABATKEYTALABATKEY') && auths.includes('Token zam_sk_live_TRAVELKEYTRAVELKEY'));
});

test('an order is paid only when ZAM approves the amount, currency and reference asked for', async () => {
  const o = await (await post('/api/orders/xcite', { items: [{ id: 10, qty: 1 }] })).json();
  assert.strictEqual((await statusOf(o.order_ref)).status, 'pending');

  const s = sessionOf(o.order_ref);
  Object.assign(s, { status: 'approved', amount: '0.100' }); // approved, but for another amount
  assert.strictEqual((await statusOf(o.order_ref)).status, 'pending', 'a mismatched approval must not fulfil the order');
  Object.assign(s, { amount: o.amount, order_ref: 'SOMEONE-ELSE' }); // ...or another order
  assert.strictEqual((await statusOf(o.order_ref)).status, 'pending');
  Object.assign(s, { order_ref: o.order_ref, currency: 'USD' }); // ...or another currency
  assert.strictEqual((await statusOf(o.order_ref)).status, 'pending');
  Object.assign(s, { currency: 'KWD' }); // the real thing
  const ok = await statusOf(o.order_ref);
  assert.strictEqual(ok.status, 'approved');
  assert.strictEqual(ok.amount, '14.900');
  s.status = 'pending'; // and it stays paid however ZAM answers later
  assert.strictEqual((await statusOf(o.order_ref)).status, 'approved');
});

test('canceled and expired sessions are reported, and cancel reaches ZAM', async () => {
  const o = await (await post('/api/orders/talabat', { items: [{ id: 2, qty: 1 }] })).json();
  assert.strictEqual((await post(`/api/orders/${o.order_ref}/cancel`, {})).status, 200);
  assert.strictEqual(sessionOf(o.order_ref).status, 'canceled');
  assert.strictEqual((await statusOf(o.order_ref)).status, 'canceled');

  const e = await (await post('/api/orders/talabat', { items: [{ id: 2, qty: 1 }] })).json();
  sessionOf(e.order_ref).status = 'gone';
  assert.strictEqual((await statusOf(e.order_ref)).status, 'expired');
});

test('a paid order cannot be canceled, and an unknown order is unknown', async () => {
  assert.strictEqual((await fetch(`${base}/api/orders/NOPE-1/status`)).status, 404);
  assert.strictEqual((await post('/api/orders/NOPE-1/cancel', {})).status, 404);
  const o = await (await post('/api/orders/xcite', { items: [{ id: 10, qty: 1 }] })).json();
  sessionOf(o.order_ref).status = 'approved';
  await statusOf(o.order_ref);
  assert.strictEqual((await post(`/api/orders/${o.order_ref}/cancel`, {})).status, 409);
});

test('bad requests are refused without reaching ZAM', async () => {
  const before = zam.state.calls.length;
  assert.strictEqual((await post('/api/orders/xcite', 'not json')).status, 400);
  assert.strictEqual((await post('/api/orders/xcite', { items: [] })).status, 400);
  assert.strictEqual((await post('/api/orders/nostore', {})).status, 404);
  assert.strictEqual(zam.state.calls.length, before);
});

test('only the demo\'s own files are served', async () => {
  for (const ok of ['/', '/xcite/', '/travel/', '/talabat/', '/zam-checkout.js', '/zam-demo-pay.js', '/zam-pay-button.js']) {
    assert.strictEqual((await fetch(base + ok)).status, 200, ok);
  }
  for (const no of ['/server.js', '/.env', '/package.json', '/xcite/../server.js', '/test/server.test.js', '/.git/config', '/zam-demo-DEPLOYMENT.md']) {
    assert.notStrictEqual((await fetch(base + no)).status, 200, no);
  }
});

test('no page holds a key or talks to ZAM itself', async () => {
  for (const p of ['/', '/xcite/', '/travel/', '/talabat/']) {
    const html = await (await fetch(base + p)).text();
    assert.ok(!/zam_[sp]k_|apiKey|zam_demo_key|Authorization/.test(html), p);
    assert.ok(!/ZamCheckout\.(configure|open)\(/.test(html), p + ' must use the store\'s server');
  }
});

test('webhook: a signed approval marks the order paid once; a bad signature does nothing', async () => {
  const { verifySignature } = require('../server.js');
  const o = await (await post('/api/orders/xcite', { items: [{ id: 12, qty: 1 }] })).json();
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.approved', data: { order_ref: o.order_ref, amount: o.amount, currency: 'KWD', status: 'approved' } });
  const t = Math.floor(Date.now() / 1000);
  const sig = (secret, ts = t) => crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const send = (header) => fetch(base + '/zam/webhook/xcite', { method: 'POST', headers: { 'ZAM-Signature': header, 'Content-Type': 'application/json' }, body });

  assert.strictEqual((await send(`t=${t},v1=${sig('whsec_wrong')}`)).status, 400);
  assert.strictEqual((await send(`t=${t - 4000},v1=${sig('whsec_demo', t - 4000)}`)).status, 400, 'stale');
  assert.strictEqual((await fetch(base + '/zam/webhook/xcite', { method: 'POST', body })).status, 400, 'unsigned');
  assert.strictEqual((await fetch(base + '/zam/webhook/travel', { method: 'POST', headers: { 'ZAM-Signature': `t=${t},v1=${sig('whsec_demo')}` }, body })).status, 400, 'a store with no secret takes no webhooks');
  assert.strictEqual((await statusOf(o.order_ref)).status, 'pending', 'nothing above paid it');
  assert.strictEqual((await send(`t=${t},v1=${sig('whsec_demo')}`)).status, 200);
  assert.strictEqual((await send(`t=${t},v1=${sig('whsec_demo')}`)).status, 200, 'the same event twice is harmless');
  assert.strictEqual((await statusOf(o.order_ref)).status, 'approved');

  assert.ok(verifySignature(Buffer.from(body), `t=${t},v1=${sig('x')},v1=${sig('whsec_demo')}`, 'whsec_demo'), 'a rotation: any v1 may match');
});

test('a webhook that does not match the order does not pay it', async () => {
  const o = await (await post('/api/orders/xcite', { items: [{ id: 12, qty: 1 }] })).json();
  const body = JSON.stringify({ id: 'evt_2', type: 'checkout.session.approved', data: { order_ref: o.order_ref, amount: '0.100', currency: 'KWD', status: 'approved' } });
  const t = Math.floor(Date.now() / 1000);
  const h = `t=${t},v1=${crypto.createHmac('sha256', 'whsec_demo').update(`${t}.${body}`).digest('hex')}`;
  await fetch(base + '/zam/webhook/xcite', { method: 'POST', headers: { 'ZAM-Signature': h }, body });
  assert.strictEqual((await statusOf(o.order_ref)).status, 'pending');
});

test('the pay page address is whatever ZAM reports, however it reports it', () => {
  const { payPage } = require('../server.js');
  const B = 'http://zam.test:8082';
  assert.strictEqual(payPage('http://zam.test:8082/api/pos/view/KW1', '', B), 'http://zam.test:8082/api/pos/view/KW1');
  assert.strictEqual(payPage('/api/pos/view/KW1', '', B), 'http://zam.test:8082/api/pos/view/KW1', 'a bare path is resolved against ZAM');
  assert.strictEqual(payPage('/api/pos/view/KW1', 'https://pay.test', B), 'https://pay.test/api/pos/view/KW1');
  assert.strictEqual(payPage('http://localhost:8082/api/pos/view/KW1', 'https://pay.test', B), 'https://pay.test/api/pos/view/KW1', 'an address the browser cannot reach is replaced');
});

test('the pay helper unlocks the confirmation sound inside the tap', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'zam-demo-pay.js'), 'utf8');
  const prepare = src.indexOf('ZamCheckout.prepare()');
  assert.ok(prepare > 0, 'pay() must call ZamCheckout.prepare()');
  assert.ok(prepare < src.indexOf('json("POST"'), 'and before the first asynchronous step, or the browser will not allow it');
});

test('the server says whether it can reach ZAM', async () => {
  const c = await (await fetch(base + '/api/config')).json();
  assert.strictEqual(c.zam_reachable, true);
  assert.strictEqual(c.zam_url, zam.url);
  assert.ok(!('zam_error' in c));
});

// A server whose ZAM address is wrong must say so, and say why, instead of
// "could not be reached".
const { spawn } = require('node:child_process');
async function withBrokenZam(baseURL, fn) {
  const port = 8300 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [require('node:path').join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ZAM_BASE_URL: baseURL, ZAM_KEY_TALABAT: 'zam_sk_live_x' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    await fn(`http://127.0.0.1:${port}`);
  } finally { child.kill(); }
}

test('a ZAM address that refuses connections is named in the config and in the order error', async () => {
  // A port nothing listens on: bind one, then let it go.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const closed = probe.address().port;
  await new Promise((r) => probe.close(r));
  await withBrokenZam(`http://127.0.0.1:${closed}`, async (b) => {
    const c = await (await fetch(b + '/api/config')).json();
    assert.strictEqual(c.zam_reachable, false);
    assert.match(c.zam_error, /refused the connection/);
    assert.ok(c.zam_error.includes(`127.0.0.1:${closed}`));
    const r = await fetch(b + '/api/orders/talabat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 3, qty: 1 }] }) });
    assert.strictEqual(r.status, 502);
    const body = await r.json();
    assert.match(body.error, /ZAM could not be reached: .*refused the connection/);
  });
});

test('a ZAM address that does not resolve is named too, as the placeholder in .env.example would', async () => {
  await withBrokenZam('https://zam-staging.example', async (b) => {
    const c = await (await fetch(b + '/api/config')).json();
    assert.strictEqual(c.zam_reachable, false);
    assert.match(c.zam_error, /does not resolve|did not answer|zam-staging\.example/);
  });
});

test('an address that is not ZAM at all is recognised by its answer', async () => {
  const other = http.createServer((q, r) => { r.writeHead(200); r.end('hello'); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  try {
    await withBrokenZam(`http://127.0.0.1:${other.address().port}`, async (b) => {
      const c = await (await fetch(b + '/api/config')).json();
      assert.strictEqual(c.zam_reachable, false);
      assert.match(c.zam_error, /answered 200, not the 401/);
    });
  } finally { other.close(); }
});

test('an address that points back at the demo itself is recognised by its answer', async () => {
  // The demo listening on the very port its ZAM address names answers for itself:
  // a 404 where ZAM gives a 401.
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, [require('node:path').join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ZAM_BASE_URL: `http://127.0.0.1:${port}`, ZAM_KEY_TALABAT: 'zam_sk_live_x' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${port}/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const c = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
    assert.strictEqual(c.zam_reachable, false);
    assert.match(c.zam_error, /not the 401 ZAM gives/);
  } finally { child.kill(); }
});

test('a refused connection to the demo\'s own port says ZAM is on 8082', () => {
  const { whyUnreachable } = require('../server.js');
  const refused = { cause: { code: 'ECONNREFUSED' } };
  const msg = whyUnreachable(refused, 'http://192.168.8.160:8090', 8090);
  assert.match(msg, /192\.168\.8\.160:8090 refused the connection/);
  assert.match(msg, /8090 is this demo's own port, and ZAM's POS API is on 8082 \(use http:\/\/192\.168\.8\.160:8082\)/);
  // another refused port gets the general advice and no wrong hint
  const other = whyUnreachable(refused, 'http://192.168.8.160:9999', 8090);
  assert.ok(!/own port/.test(other));
  assert.match(whyUnreachable({ cause: { code: 'ENOTFOUND' } }, 'https://zam-staging.example', 8090), /does not resolve/);
  assert.match(whyUnreachable({ name: 'TimeoutError' }, 'http://192.168.8.160:8082', 8090), /did not answer in time/);
});
