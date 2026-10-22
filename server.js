#!/usr/bin/env node
// The demo stores' server (ZAM Checkout v2, server-side flow).
//
// The stores are plain pages, but a payment must not be: a key that creates
// sessions cannot sit in a page. This server holds the stores' secret keys,
// prices every order itself from the stores' own catalogues, creates the
// session at ZAM with an Idempotency-Key, and tells the page only the address
// of the pay page. It marks an order paid when ZAM says the session is approved
// for the amount, currency and order reference it created, and never because
// the browser said so.
//
// No dependencies; Node 18 or later.
//
//   ZAM_BASE_URL=https://<staging host> \
//   ZAM_KEY_XCITE=zam_sk_live_... ZAM_KEY_TRAVEL=zam_sk_live_... ZAM_KEY_TALABAT=zam_sk_live_... \
//   node server.js
//
// Optional:
//   PORT=8090
//   ZAM_PAY_BASE          replace the origin of payment_url (when ZAM reports an address
//                         the shopper's browser cannot reach)
//   ZAM_WHSEC_<STORE>     signing secret of a webhook endpoint registered for the store's
//                         POS, to receive POST /zam/webhook/<store>; needs a public https
//                         address. Without it the page's status check is the confirmation.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = __dirname;
const STORES = {
  xcite:   { dir: 'xcite',   prefix: 'XCITE',   catalog: 'PRODUCTS', env: 'XCITE',   name: 'Xcite' },
  travel:  { dir: 'travel',  prefix: 'KWT',     catalog: 'TRIPS',    env: 'TRAVEL',  name: 'Kuwait Travel' },
  talabat: { dir: 'talabat', prefix: 'TALABAT', catalog: 'MEALS',    env: 'TALABAT', name: 'Talabat' },
};

// ── what each store sells, read from the store's own page ───────────────
//
// The page's catalogue is the one source of prices: the server reads the
// array out of the page rather than keeping a second copy that could drift.
function pageSource(store) {
  return fs.readFileSync(path.join(ROOT, STORES[store].dir, 'index.html'), 'utf8');
}

function readLiteral(src, name) {
  const start = src.indexOf('var ' + name + ' = [');
  if (start < 0) throw new Error('no ' + name + ' in the page');
  const open = src.indexOf('[', start);
  const end = src.indexOf('\n        ];', open);
  if (end < 0) throw new Error('the end of ' + name + ' was not found');
  return vm.runInNewContext('(' + src.slice(open, end + 10).replace(/;\s*$/, '') + ')', {}, { timeout: 1000 });
}

function loadCatalog(store) {
  const src = pageSource(store);
  const items = readLiteral(src, STORES[store].catalog);
  const locale = /var ZAM_DEMO = \{\s*currency:\s*'([A-Z]{3})',\s*decimals:\s*(\d)/.exec(src);
  if (!locale) throw new Error('no ZAM_DEMO in the ' + store + ' page');
  const byId = new Map(items.map((i) => [i.id, i]));
  const sel = (id) => {
    const m = new RegExp('<select id="' + id + '"[^>]*>(.*?)</select>').exec(src);
    return m ? [...m[1].matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]) : [];
  };
  return {
    byId, currency: locale[1], decimals: Number(locale[2]),
    // The travel page's booking form: what it offers is what the server accepts.
    classes: sel('class').map(Number), passengers: sel('pax').map(Number),
  };
}

const catalogs = {};
for (const s of Object.keys(STORES)) catalogs[s] = loadCatalog(s);

// ── configuration ──────────────────────────────────────────────────────
const BASE = (process.env.ZAM_BASE_URL || '').replace(/\/+$/, '');
const PAY_BASE = (process.env.ZAM_PAY_BASE || '').replace(/\/+$/, '');
const keys = {};
const whsec = {};
for (const [s, d] of Object.entries(STORES)) {
  keys[s] = process.env['ZAM_KEY_' + d.env] || '';
  whsec[s] = process.env['ZAM_WHSEC_' + d.env] || '';
}

// ── orders (in memory: this is a demo) ─────────────────────────────────
const orders = new Map();
const MAX_ORDERS = 5000;

function newRef(store) {
  return STORES[store].prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Price an order from the catalogue. Returns { amount, error }.
function price(store, body) {
  const cat = catalogs[store];
  const fmt = (n) => n.toFixed(cat.decimals);
  if (store === 'travel') {
    const trip = cat.byId.get(Number(body.tripId));
    const cls = Number(body.cls), pax = Number(body.pax);
    if (!trip) return { error: 'unknown trip' };
    if (!cat.classes.includes(cls)) return { error: 'unknown class' };
    if (!cat.passengers.includes(pax)) return { error: 'unknown passenger count' };
    // The page's own expression, so the two agree to the last digit.
    return { amount: fmt(trip.price * cls * pax), label: trip.dest };
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length < 1 || items.length > 30) return { error: 'the order needs between 1 and 30 lines' };
  let total = 0;
  for (const it of items) {
    const p = cat.byId.get(Number(it.id));
    const qty = Number(it.qty);
    if (!p) return { error: 'unknown item ' + it.id };
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return { error: 'quantity must be 1 to 20' };
    total += p.price * qty;
  }
  return { amount: fmt(total) };
}

// The address of the pay page the browser should show. ZAM reports it from its
// CHECKOUT_BASE_URL: a full address, or only a path when that is not set. Either
// way ZAM_PAY_BASE, when given, is where the browser reaches ZAM; otherwise a
// bare path is resolved against ZAM_BASE_URL.
function payPage(paymentURL, payBase = PAY_BASE, base = BASE) {
  const u = new URL(paymentURL, (payBase || base) + '/');
  return payBase ? payBase + u.pathname + u.search : u.href;
}

// ── talking to ZAM ─────────────────────────────────────────────────────
async function zam(store, method, pathname, { body, idempotencyKey } = {}) {
  const headers = { Authorization: 'Token ' + keys[store], 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(BASE + pathname, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* not JSON */ }
  return { status: res.status, json };
}

// Paid means: ZAM says approved, for the amount, currency and order reference
// this server asked for. Anything else is not paid.
function verified(order, session) {
  return session.status === 'approved' &&
    session.order_ref === order.ref &&
    session.amount === order.amount &&
    session.currency === order.currency;
}

function markPaid(order, session, via) {
  if (order.paid) return false; // a second delivery of the same fact changes nothing
  order.paid = true;
  order.paidVia = via;
  order.paidAt = new Date().toISOString();
  console.log(`order ${order.ref} paid (${via}) ${order.amount} ${order.currency}`);
  return true;
}

// ── signature check for the webhook (ZAM Rules 17.4.4) ──────────────────
function verifySignature(rawBody, header, secret, toleranceSeconds = 300, now = Date.now() / 1000) {
  if (!secret || !header) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    if (part.startsWith('t=')) t = part.slice(2);
    if (part.startsWith('v1=')) sigs.push(part.slice(3));
  }
  if (t === null || !/^\d+$/.test(t) || Math.abs(now - Number(t)) > toleranceSeconds) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.').update(rawBody).digest('hex');
  return sigs.some((s) => s.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// ── HTTP ───────────────────────────────────────────────────────────────
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const STATIC = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'],
  ['/zam-checkout.js', 'zam-checkout.js'], ['/zam-demo-pay.js', 'zam-demo-pay.js'], ['/zam-pay-button.js', 'zam-pay-button.js'],
  ['/zam_logo.png', 'zam_logo.png'], ['/zam-pay-button-demo.html', 'zam-pay-button-demo.html'],
]);
for (const d of Object.values(STORES)) {
  STATIC.set('/' + d.dir + '/', d.dir + '/index.html');
  STATIC.set('/' + d.dir + '/index.html', d.dir + '/index.html');
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png' };

function serveStatic(res, file) {
  const full = path.join(ROOT, file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(data);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && STATIC.has(p)) return serveStatic(res, STATIC.get(p));
  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });

  // Which stores can take payments here: the key is configured.
  if (req.method === 'GET' && p === '/api/config') {
    return send(res, 200, {
      zam: Boolean(BASE),
      stores: Object.fromEntries(Object.keys(STORES).map((s) => [s, Boolean(keys[s])])),
    });
  }

  let m;
  // Create an order and its ZAM session.
  if (req.method === 'POST' && (m = /^\/api\/orders\/(xcite|travel|talabat)$/.exec(p))) {
    const store = m[1];
    if (!BASE || !keys[store]) return send(res, 503, { error: 'This store is not connected to ZAM on this server.' });
    let body;
    try { body = JSON.parse((await readBody(req)).toString() || '{}'); } catch (e) {
      return send(res, e.status || 400, { error: 'That request could not be read.' });
    }
    const priced = price(store, body);
    if (priced.error) return send(res, 400, { error: priced.error });

    if (orders.size >= MAX_ORDERS) orders.delete(orders.keys().next().value);
    const order = { store, ref: newRef(store), amount: priced.amount, currency: catalogs[store].currency, paid: false };
    let r;
    try {
      r = await zam(store, 'POST', '/api/checkout/sessions', {
        // The note is what the ZAM Cards wallet shows the shopper, and the wallet
        // requires one. It names the store and the order, nothing about the shopper.
        body: { amount: order.amount, order_ref: order.ref, note: STORES[store].name + ' order ' + order.ref },
        idempotencyKey: order.ref + '-1',
      });
    } catch (e) {
      console.error('create session failed:', e.message);
      return send(res, 502, { error: 'ZAM could not be reached.' });
    }
    if (r.status !== 201 && r.status !== 200) {
      console.error('create session refused:', r.status, JSON.stringify(r.json && (r.json.error || r.json.message)));
      return send(res, 502, { error: (r.json && (r.json.message || r.json.error)) || 'ZAM refused the order.' });
    }
    const s = r.json.data;
    order.sessionId = s.session_id;
    order.currency = s.currency || order.currency;
    orders.set(order.ref, order);
    const paymentURL = payPage(s.payment_url);
    return send(res, 201, { order_ref: order.ref, payment_url: paymentURL, amount: s.amount, currency: s.currency });
  }

  // The page asks how the order stands; this server asks ZAM.
  if (req.method === 'GET' && (m = /^\/api\/orders\/([A-Z0-9-]+)\/status$/.exec(p))) {
    const order = orders.get(m[1]);
    if (!order) return send(res, 404, { error: 'unknown order' });
    if (order.paid) return send(res, 200, { status: 'approved', order_ref: order.ref, amount: order.amount, currency: order.currency, session_id: order.sessionId });
    let r;
    try { r = await zam(order.store, 'GET', '/api/checkout/sessions/' + encodeURIComponent(order.sessionId)); } catch (e) {
      return send(res, 502, { error: 'ZAM could not be reached.' });
    }
    if (r.status === 410) return send(res, 200, { status: 'expired', order_ref: order.ref });
    if (r.status !== 200) return send(res, 502, { error: 'ZAM could not say.' });
    const s = r.json.data;
    if (s.status === 'approved') {
      if (!verified(order, s)) {
        console.error(`order ${order.ref}: ZAM approved a session that does not match the order`, { asked: order.amount + order.currency, got: s.amount + s.currency, ref: s.order_ref });
        return send(res, 200, { status: 'pending', order_ref: order.ref });
      }
      markPaid(order, s, 'status check');
      return send(res, 200, { status: 'approved', order_ref: order.ref, amount: order.amount, currency: order.currency, session_id: order.sessionId });
    }
    return send(res, 200, { status: s.status, order_ref: order.ref });
  }

  if (req.method === 'POST' && (m = /^\/api\/orders\/([A-Z0-9-]+)\/cancel$/.exec(p))) {
    const order = orders.get(m[1]);
    if (!order) return send(res, 404, { error: 'unknown order' });
    if (order.paid) return send(res, 409, { error: 'already paid' });
    try { await zam(order.store, 'POST', '/api/checkout/sessions/' + encodeURIComponent(order.sessionId) + '/cancel'); } catch (_) { /* the page is closing anyway */ }
    return send(res, 200, { ok: true });
  }

  // Signed events from ZAM, when this server is reachable from it.
  if (req.method === 'POST' && (m = /^\/zam\/webhook\/(xcite|travel|talabat)$/.exec(p))) {
    const store = m[1];
    let raw;
    try { raw = await readBody(req); } catch (e) { return send(res, e.status || 400, { error: 'bad body' }); }
    if (!verifySignature(raw, req.headers['zam-signature'], whsec[store])) return send(res, 400, { error: 'bad signature' });
    let ev;
    try { ev = JSON.parse(raw.toString()); } catch (_) { return send(res, 400, { error: 'bad body' }); }
    const d = ev.data || {};
    const order = orders.get(d.order_ref);
    if (ev.type === 'checkout.session.approved' && order && order.store === store && verified(order, d)) {
      markPaid(order, d, 'webhook ' + ev.id);
    } else if (ev.type === 'checkout.session.approved') {
      console.error('webhook for an order that does not match', ev.id, d.order_ref);
    } else if (ev.type === 'payment.reversed' && order) {
      order.paid = false;
      console.log(`order ${order.ref} reversed`);
    }
    return send(res, 200, { received: true });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'The demo server had a problem.' });
    });
  });
}

module.exports = { createServer, payPage, price, verifySignature, verified, loadCatalog, readLiteral };

if (require.main === module) {
  if (!BASE) console.warn('ZAM_BASE_URL is not set: the stores will load but cannot take payments.');
  for (const s of Object.keys(STORES)) if (!keys[s]) console.warn(`ZAM_KEY_${STORES[s].env} is not set: ${s} cannot take payments.`);
  const port = Number(process.env.PORT || 8090);
  // HOST=127.0.0.1 when a reverse proxy in front takes the public connections.
  const host = process.env.HOST || '0.0.0.0';
  createServer().listen(port, host, () => {
    console.log(`ZAM demo stores on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  (ZAM: ${BASE || 'not set'})`);
    // ZAM's pay page is framed by these pages, and ZAM lets only the addresses
    // registered for the POS do that.
    console.log(`Each store's POS must list this site's address as a web address (e.g. http://localhost:${port}), or its payment window stays blank.`);
  });
}
