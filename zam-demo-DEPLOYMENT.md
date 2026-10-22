# ZAM Demo Stores: running them

Three demo online stores for ZAM Checkout:

| Store | Sells | Path |
|---|---|---|
| **Xcite Electronics** | phones, laptops, gaming gear | `/xcite/` |
| **Kuwait Travel** | flights and packages | `/travel/` |
| **Talabat** | light healthy meals | `/talabat/` |

They use ZAM Checkout the way a real store should (checkout v2, see
`zam-service/checkout-sdk/ZAM_CHECKOUT_INTEGRATION.md`): **a page never holds a
key.** `server.js` holds the stores' secret keys, prices every order itself from
the store pages' own catalogues, creates the payment at ZAM, and marks an order
paid only when ZAM says it is approved for the amount, currency and order
reference it asked for. The pages show ZAM's pay page in the checkout widget and
ask this server how the order stands.

Because it needs a server, the demo no longer runs as static files (GitHub Pages
and `demo.techween.net` as it was). Run `server.js` somewhere a browser can reach.

## What you need

- Node 18 or later. There is nothing to install.
- A ZAM environment (staging) and, for each store, an **online POS** with a **secret key**.

## 1. One online POS per store, in the merchant portal

For each store (any merchant will do for a demo; one merchant can hold all three):

1. **POS Terminals → create** an *Online* terminal named after the store. A POS created now uses checkout v2: it takes a secret key and refuses browser-side creation.
2. Open its **Checkout Keys** page.
3. **Generate new key → Secret key.** Copy it at once; it is shown once. It goes in `.env`, nowhere else.
4. **Limit for one checkout session:** set a low one, for example `500`. A demo does not need more, and the limit is what contains a leaked key.
5. **Web addresses:** add the address the demo is served from, for example `http://localhost:8090` or `https://demo.example`. This is required: ZAM's pay page appears *inside* the demo, and ZAM lets only the addresses registered for the POS frame it. Without this the payment window stays blank.

## 2. Configure and start

```sh
cp .env.example .env      # fill in ZAM_BASE_URL and the three secret keys
set -a; . ./.env; set +a
node server.js            # http://localhost:8090
```

`GET /api/config` (and the landing page) say which stores are connected: a store
whose key is missing loads but cannot take payments.

`ZAM_BASE_URL` is the ZAM Service's public address. The pay-page address ZAM
returns comes from its `CHECKOUT_BASE_URL` setting; on staging it must be the
public address too, not `localhost`. If it is not, set `ZAM_PAY_BASE` here.

## 3. Pay

Open a store, add items, press **Pay with ZAM**. The widget shows ZAM's pay page.
Pay with the ZAM Cards wallet; the widget closes with the order reference once
ZAM reports the payment approved. The server log shows
`order … paid (status check)`.

## Optional: confirm by webhook

By default the server asks ZAM for the session's status while the widget is
open. To use the signed webhook as well, make the server reachable from ZAM over
https, register `https://<server>/zam/webhook/<store>` as a **Webhook endpoint**
on the store's POS, and put the signing secret it shows in `ZAM_WHSEC_<STORE>`.
The server verifies `ZAM-Signature`, matches the order, and treats a repeated
event as already done.

## Tests

```sh
node --test test
```

They run the server against a stand-in for ZAM: the server's own price, the
secret key and `Idempotency-Key` on the create call, an approval for the wrong
amount, currency or order not paying anything, cancel, expiry, the webhook's
signature, and that no page holds a key.

## Files

| | |
|---|---|
| `server.js` | the stores' server: pricing, ZAM calls, payment confirmation, static files |
| `zam-demo-pay.js` | what the pages call to pay: asks the server, opens the widget |
| `zam-checkout.js`, `zam-pay-button.js` | copies of `zam-service/checkout-sdk`; update both |
| `index.html`, `xcite/`, `travel/`, `talabat/` | the pages; their catalogues (`PRODUCTS`, `TRIPS`, `MEALS`) are the prices the server uses |
| `.env.example` | the settings; `.env` is never committed |
