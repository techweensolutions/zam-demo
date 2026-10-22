# zam-demo

Demo storefronts for ZAM Checkout v2: static pages plus `server.js`, which holds the secret keys and prices orders (no key ever sits in a page). Workspace context: `../CLAUDE.md`. System note: `../zam-brain/20-Systems/zam-demo.md`.

- `zam-checkout.js` and `zam-pay-button.js` are copies of `zam-service/checkout-sdk`; update both.
- Run and test: `zam-demo-DEPLOYMENT.md`; `node --test test`. The pages' catalogues are the server's price list; change a price in the page and the server follows.
- Never put a ZAM key in a page or commit `.env`.
