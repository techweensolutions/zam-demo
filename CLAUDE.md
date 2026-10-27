# zam-demo

Demo storefronts for ZAM Checkout v2: static pages plus `server.js`, which holds the secret keys and prices orders (no key ever sits in a page). Workspace context: `../CLAUDE.md`. System note: `../zam-brain/20-Systems/zam-demo.md`.

- `zam-checkout.js` and `zam-pay-button.js` are copies of `zam-service/checkout-sdk`; update both.
- Run and test: `zam-demo-DEPLOYMENT.md`; `node --test`. The pages' catalogues are the server's price list; change a price in the page and the server follows.
- Never put a ZAM key in a page or commit `.env`.
- Install and operate it: `INSTALL-VM.md` (office network, cloud VM, or the office gateway), the gateway's nginx site is `deploy/zamdemo.techween.net.conf`. The estate-specific facts (hosts, public name, what went wrong and why) are in `../zam-brain/70-Operations/ZAM-Demo-Deployment.md`; the reasons in `../zam-brain/30-Decisions/D-2026-10-27-Demo-stores-run-on-checkout-v2-behind-the-gateway.md`.
- Each POS must list the address the demo is opened at under Web addresses, or its payment window stays blank.
