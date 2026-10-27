# Install the ZAM demo stores on a VM

Run the three demo stores (Xcite, Kuwait Travel, Talabat) on a Linux VM of your
own. The steps are the same everywhere except two choices, which depend on **where
the browser is when someone pays**. Decide that first.

| Where is the browser? | Demo VM | `ZAM_BASE_URL` | How the browser reaches the demo |
|---|---|---|---|
| **Inside the office network** (192.168.8.x) | a VM on that network: the dev server 192.168.8.100, or a local VM | `http://192.168.8.160:8082` and the same as `ZAM_PAY_BASE` | an SSH tunnel, then `http://localhost:8090` (**path L**, step 6L) |
| **Outside the office** (a laptop at home, a phone on mobile data) | a cloud VM with a domain name | `https://zam.techween.net` | nginx and a Let's Encrypt certificate (**path C**, step 6C) |
| **Outside the office**, demo on the office dev server | 192.168.8.170, published as `zamdemo.techween.net` through the office gateway | `http://192.168.8.160:8082`, with `ZAM_PAY_BASE=https://zam.techween.net` | the gateway's nginx and certbot (**path G**, step 6G) |

> **Two limits to know before you start.**
>
> 1. **Inside the office, the public name `zam.techween.net` does not work.** It
>    points at the office's own public address, and the office network refuses
>    to loop back to it (checked 2026-10-26: connection refused). So an
>    office browser cannot show ZAM's pay page from a cloud demo, and a demo on
>    the office network must use staging's LAN address.
> 2. **The portal accepts only `https://…` web addresses, plus `http://localhost`.**
>    The pay page appears inside the store page, and ZAM lets only registered
>    addresses frame it. On the office network that rules out an `https://`
>    address for the demo (a browser will not show a plain-http pay page inside an
>    https page), which is why path L uses the tunnel and `http://localhost:8090`.

How it works, in short: the pages never hold a key. `server.js` holds one secret
key per store, prices each order itself, creates the payment at ZAM, and marks an
order paid only when ZAM says it is approved for the amount, currency and order
reference it asked for. See `zam-demo-DEPLOYMENT.md`.

---

## 0. What you need before you start

| | |
|---|---|
| A Linux VM | Ubuntu 24.04 LTS or newer, 1 vCPU, 1 GB RAM, 5 GB disk. SSH access with sudo. |
| ZAM's address | The ZAM Service the stores pay through: path L `http://192.168.8.160:8082`, path C `https://zam.techween.net`. The VM must be able to reach it (step 5 checks). |
| Three POS secret keys | One per store. Create them in the merchant portal (step 1). |
| A domain name (path C only) | For example `demo.example.com`, with an `A` record pointing at the VM's public IP. |

---

## 1. In the merchant portal, once per store

For Xcite, Kuwait Travel and Talabat (one merchant can hold all three):

1. **POS Terminals → create**, type **Online**, named after the store. A POS
   takes a secret key; checkout has no mode in which a browser creates a payment.
2. Open the terminal's **Checkout Keys** page.
3. **Generate new key → Secret key.** Copy it now; it is shown once. It goes into
   the VM's env file in step 4 and nowhere else.
4. **Limit for one checkout session:** set a low limit such as `500`. A demo needs
   no more, and the limit is what contains a leaked key.
5. **Web addresses:** leave this for step 7, when you know the demo's address.

---

## 2. Prepare the VM

```sh
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

Node 18.19 or newer is needed, and nothing else: the demo has no dependencies.
Ubuntu's own package is enough (24.04 has 18.19.1, 26.04 has 22):

```sh
sudo apt-get install -y nodejs
node --version          # v18.19 or newer
```

The test suite and the server were run on exactly 18.19.1, and on 22 and 26.

---

## 3. Get the code

```sh
sudo git clone https://github.com/techweensolutions/zam-demo.git /opt/zam-demo
cd /opt/zam-demo && sudo node --test      # 14 tests pass
```

To update later: `cd /opt/zam-demo && sudo git pull && sudo systemctl restart zam-demo`.

---

## 4. Configure and run it as a service

A system user with no login, and a settings file only that user and root can read:

```sh
sudo useradd --system --home /opt/zam-demo --shell /usr/sbin/nologin zamdemo
sudo cp /opt/zam-demo/.env.example /etc/zam-demo.env
sudo chown root:zamdemo /etc/zam-demo.env && sudo chmod 640 /etc/zam-demo.env
sudo nano /etc/zam-demo.env
```

Set these (the file lists the rest as comments).

Path L, the office network:

```ini
ZAM_BASE_URL=http://192.168.8.160:8082
ZAM_PAY_BASE=http://192.168.8.160:8082
ZAM_KEY_XCITE=zam_sk_live_…
ZAM_KEY_TRAVEL=zam_sk_live_…
ZAM_KEY_TALABAT=zam_sk_live_…
PORT=8090
HOST=127.0.0.1
```

Path C, a cloud VM (leave `ZAM_PAY_BASE` out: ZAM's pay-page address is then
resolved against the https address):

```ini
ZAM_BASE_URL=https://zam.techween.net
ZAM_KEY_XCITE=zam_sk_live_…
ZAM_KEY_TRAVEL=zam_sk_live_…
ZAM_KEY_TALABAT=zam_sk_live_…
PORT=8090
HOST=127.0.0.1
```

`HOST=127.0.0.1` makes the demo reachable only through the tunnel or web server
you set up in step 6.

**4a. Create the service file.** Run this whole block at once, from `sudo tee` down
to the line that says `EOF` on its own:

```sh
sudo tee /etc/systemd/system/zam-demo.service >/dev/null <<'EOF'
[Unit]
Description=ZAM demo stores
After=network-online.target
Wants=network-online.target

[Service]
User=zamdemo
WorkingDirectory=/opt/zam-demo
EnvironmentFile=/etc/zam-demo.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
```

Check that it exists before going on:

```sh
ls -l /etc/systemd/system/zam-demo.service      # the file is listed
systemctl cat zam-demo | head -3                # shows [Unit] / Description=ZAM demo stores
```

If your terminal mangles the pasted block, create the file in an editor instead:
`sudo nano /etc/systemd/system/zam-demo.service`, paste the lines between the two
`EOF` markers (not the markers), save, and run the checks above.

**4b. Start it.**

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now zam-demo
systemctl is-active zam-demo                       # active
curl -s localhost:8090/api/config                  # {"zam":true,"stores":{"xcite":true,…}}
```

A store shows `false` until its key is in the env file (then
`sudo systemctl restart zam-demo`). The steps for adding or replacing a key are in
[Adding or replacing a store's key](#adding-or-replacing-a-stores-key) below.

---

## 5. Check that the VM can reach ZAM

Path L:

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.8.160:8082/api/checkout/sessions/x
```

Path C:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://zam.techween.net/api/checkout/sessions/x
```

The demo server runs the same check itself and reports it, so once it is up you
can also ask it:

```sh
curl -s localhost:8090/api/config
# {"zam":true,"zam_url":"http://192.168.8.160:8082","zam_reachable":true,"stores":{…}}
# or: "zam_reachable":false,"zam_error":"192.168.8.160:80 refused the connection (wrong address or port, …)"
```

The landing page shows the same message in orange, and the service log prints
`ZAM at … is reachable` or `is NOT reachable: …` when it starts.

`401` is the right answer on both: ZAM is reachable and wants a key. Anything else
(`000`, a timeout, a certificate error) means the VM cannot reach ZAM, and no
payment will work until it can. For path C that usually means the office router is
not forwarding port 443 to the staging server; ask whoever manages the network.
(A cloud VM cannot use the private address `192.168.8.160` at all.)

---

## 6C. Path C, a cloud VM: nginx and a Let's Encrypt certificate

Open ports 22, 80 and 443 in the provider's firewall, and make sure the domain's
`A` record points at the VM. Then:

```sh
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/zam-demo >/dev/null <<'EOF'
server {
    listen 80;
    server_name demo.example.com;
    client_max_body_size 16k;
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
sudo sed -i 's/demo.example.com/YOUR.DOMAIN/' /etc/nginx/sites-available/zam-demo   # your domain
sudo ln -sf /etc/nginx/sites-available/zam-demo /etc/nginx/sites-enabled/zam-demo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR.DOMAIN --redirect -m you@example.com --agree-tos -n
```

Open `https://YOUR.DOMAIN/`. The address to register in step 7 is
**`https://YOUR.DOMAIN`**.

*Optional, cloud only:* to confirm payments by signed webhook as well, register
`https://YOUR.DOMAIN/zam/webhook/<store>` (`xcite`, `travel`, `talabat`) as a
Webhook endpoint on each POS and put the secret it shows in the env file as
`ZAM_WHSEC_XCITE` and so on. Without it the demo asks ZAM for the status, which
works everywhere. A VM on a private network cannot receive webhooks; ZAM refuses
to deliver to private addresses.

---

## 6L. Path L, the office network: an SSH tunnel

For the dev server at 192.168.8.100, or any VM on the office network. Nothing to
install beyond steps 1 to 5. On your Mac (or any computer on the office network):

```sh
ssh -L 8090:localhost:8090 <user>@192.168.8.100
```

Leave it open and use **`http://localhost:8090`** in the browser. `http://localhost`
is the one plain-http address the portal accepts, so register
**`http://localhost:8090`** in step 7. Keep `HOST=127.0.0.1` in the env file.

The tunnel serves one computer at a time. To let several people use it, give each
their own tunnel. A shared `https://` address is not possible on the office
network until the office can reach staging over https (see the limits at the top).

If the browser later shows a blank payment window with a "refused to connect"
message, the computer cannot reach `http://192.168.8.160:8082`; open that address
in a tab to check.

---

## 6G. Path G: a public name through the office gateway

For `zamdemo.techween.net` pointing at the demo on the dev server (192.168.8.170).
The office already has a gateway, **qema-dev at 192.168.8.100**, that receives the
`techween.net` names (`37.34.255.170`), holds their Let's Encrypt certificates and
proxies inward. The demo's site goes there too, so nothing changes on the router.

```
browser ── https://zamdemo.techween.net ──▶ gateway 192.168.8.100 ──▶ demo 192.168.8.170:8090
browser ── https://zam.techween.net (the pay page) ──▶ gateway ──▶ ZAM 192.168.8.160
demo server ── http://192.168.8.160:8082 ──▶ ZAM          (server to server, inside the office)
```

**G1. DNS.** At GoDaddy, in the `techween.net` zone, add an `A` record: name
`zamdemo`, value `37.34.255.170`. Check it from any computer (it can take a few
minutes):

```sh
dig +short zamdemo.techween.net        # 37.34.255.170
```

**G2. The demo server (192.168.8.170).** Two settings change from path L: the pay
page now opens from the public name, and the gateway must be able to reach the demo.

```sh
sudo nano /etc/zam-demo.env
```
```ini
ZAM_BASE_URL=http://192.168.8.160:8082
ZAM_PAY_BASE=https://zam.techween.net
HOST=0.0.0.0
```

`ZAM_BASE_URL` stays on the LAN address (the demo calls ZAM from inside the
office). `ZAM_PAY_BASE` is what the visitor's browser opens, so it must be the
public https name. Then restart and open port 8090 to the gateway only:

```sh
sudo systemctl restart zam-demo
curl -s localhost:8090/api/config            # "zam_reachable":true
sudo ufw allow from 192.168.8.100 to any port 8090 proto tcp     # if the server uses ufw
```

If the server uses ufw, remove any broader rule for 8090 (`sudo ufw status numbered`).
The SSH tunnel of path L keeps working, since it connects from the server itself.

**G3. The gateway (192.168.8.100).** Get the site file from this repository (it is
`deploy/zamdemo.techween.net.conf`; after a `git pull` on the demo server it is in
`/opt/zam-demo/deploy/`), put it on the gateway, and enable it. Enabling means a
link in `sites-enabled` that points at the file in `sites-available`; use full paths.

```sh
# 1. the file, from the demo server to the gateway
scp 192.168.8.170:/opt/zam-demo/deploy/zamdemo.techween.net.conf /tmp/     # or copy it any way you like
sudo cp /tmp/zamdemo.techween.net.conf /etc/nginx/sites-available/zamdemo.techween.net

# 2. the link
sudo ln -s /etc/nginx/sites-available/zamdemo.techween.net /etc/nginx/sites-enabled/zamdemo.techween.net
ls -l /etc/nginx/sites-enabled/       # the new line ends  -> /etc/nginx/sites-available/zamdemo.techween.net
                                      # ("File exists" means a link is already there: do not repeat the ln)

# 3. test before applying. A mistake here can take down every other techween.net site
sudo nginx -t                         # both lines: "syntax is ok" and "test is successful"

# 4. apply: reload, not restart, so live connections are not dropped
sudo systemctl reload nginx
systemctl is-active nginx             # active

# 5. nginx now serves the new name on port 80, before any certificate exists
curl -s -H 'Host: zamdemo.techween.net' http://localhost/api/config    # JSON with "zam_reachable":true
```

A `502 Bad Gateway`, or nginx's default page, in step 5 means the gateway cannot
reach `192.168.8.170:8090`: check `curl -s http://192.168.8.170:8090/health` from the
gateway and the `ufw` rule from G2.

To undo it at any time, remove the link and reload (the file in `sites-available` stays):

```sh
sudo rm /etc/nginx/sites-enabled/zamdemo.techween.net && sudo nginx -t && sudo systemctl reload nginx
```

The file is plain http on port 80. It proxies the demo, allows at most 10 new
orders a minute per visitor (status checks and pages are not limited), and has an
optional password (commented out).

**G4. The certificate.** On the gateway, the same way the other names got theirs:

```sh
sudo certbot --nginx -d zamdemo.techween.net
```

Certbot adds the https server and the redirect from http, and installs its renewal
timer. `sudo certbot certificates` shows the other names' certificates and their
expiry. This needs the DNS record from G1 to be live, and port 80 on the gateway to
be reachable from the internet (it already is for the other names).

**G5. Register the name on each POS.** On every store's POS, under Web addresses,
add `https://zamdemo.techween.net`. If people will also reach the demo through the
tunnel, keep `http://localhost:8090` registered too.

**G6. Try it from outside the office.** On a phone using mobile data (not the
office Wi-Fi), or from home:

```
https://zamdemo.techween.net/api/config      # "zam_reachable":true and the stores true
https://zamdemo.techween.net/talabat/        # the store; Pay opens the payment window
```

**From inside the office this name does not work**: the office network refuses
connections to its own public address (no hairpin), so a computer on the office
network that opens `https://zamdemo.techween.net` gets nothing. Inside the office,
use path L (the tunnel and `http://localhost:8090`).

---

## 7. Register the demo's address on each POS

Back in the merchant portal, on each store's **Checkout Keys** page, under
**Web addresses**, add the address from step 6:

| Setup | Register |
|---|---|
| Path L (tunnel) | `http://localhost:8090` |
| Path C (cloud VM) | `https://YOUR.DOMAIN` |
| Path G (office gateway) | `https://zamdemo.techween.net` |

It takes effect within 30 seconds. Without it the payment window stays blank.

---

## 8. Try it

Open a store, add items, press **Pay with ZAM**. The ZAM Cards wallet scans the
QR code, or hears the sound if you press "Send code by sound" (use the computer's
own speakers: Bluetooth speakers cut the ultrasound). When the payment is
approved the window shows the confirmation, plays a short chime, and the server
log says `order … paid`:

```sh
sudo journalctl -u zam-demo -f
```

---

## Adding or replacing a store's key

Each store has its own key, from its own POS. They go into `/etc/zam-demo.env`:

| Store | Variable | Key comes from the POS named |
|---|---|---|
| Xcite Electronics | `ZAM_KEY_XCITE` | Xcite |
| Kuwait Travel | `ZAM_KEY_TRAVEL` | Kuwait Travel |
| Talabat | `ZAM_KEY_TALABAT` | Talabat |

A store whose key is empty still loads, but cannot take payments.

**1. Get the key (merchant portal, once per store).**
Open the store's online POS, then its **Checkout Keys** page, and choose
**Generate new key → Secret key**. Copy the key at once (`zam_sk_live_…`): it is
shown once. While you are there, check the page's two other settings: the
**session limit** (for example `500`) and the demo's address under **Web
addresses** (step 7).

**2. Put it in the env file, on the VM.**
The commands below ask for the key without showing it and without leaving it in
your shell history. Run one block per store, changing the name in the first line
(`XCITE`, `TRAVEL` or `TALABAT`):

```sh
STORE=XCITE
read -rsp "Paste the $STORE key, then Enter: " K; echo
sudo sed -i "s|^ZAM_KEY_$STORE=.*|ZAM_KEY_$STORE=$K|" /etc/zam-demo.env; unset K
```

Or edit the file by hand: `sudo nano /etc/zam-demo.env`, and set the line to
`ZAM_KEY_XCITE=zam_sk_live_…` with nothing else on it: no quotes, no spaces.
The same commands replace a key that is already there.

**3. Restart and check.** The service reads the file only when it starts.

```sh
sudo systemctl restart zam-demo
systemctl is-active zam-demo                                   # active
curl -s localhost:8090/api/config                              # every store you set shows true
grep -E '^ZAM_KEY_[A-Z]+=.' /etc/zam-demo.env | cut -d= -f1    # names of the keys that are set; never shows the keys
sudo journalctl -u zam-demo -n 8 --no-pager                    # a "ZAM_KEY_… is not set" line for each store still without one
```

**4. Prove the key works.** Create a small order; ZAM answers with a payment
address if it accepts the key (the amount is 2.500 KWD):

```sh
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"items":[{"id":3,"qty":1}]}' localhost:8090/api/orders/talabat
```

Use `/api/orders/xcite` with `{"items":[{"id":10,"qty":1}]}` or
`/api/orders/travel` with `{"tripId":1,"cls":1,"pax":1}` for the other two. An
`Authentication failed` style error means the key was copied wrongly or has been
revoked; create another one.

**Replacing a key you no longer want.** Set the new key as above first, check it,
then revoke the old one on the POS's Checkout Keys page. A revoked key stops
working within a second.

**If a key leaks** (pasted in a chat, committed, shown on a screen): revoke it on
the POS's Checkout Keys page straight away, then create and install a new one.

---

## When something goes wrong

| You see | It means | Do |
|---|---|---|
| "The store's server could not be reached" | The page was not served by `server.js` (a static host, or the wrong address), or the server is down | Open the demo at the address from step 6; `systemctl status zam-demo` |
| "The demo server had a problem" | `server.js` hit an error | `sudo journalctl -u zam-demo -n 40` |
| "This store is not connected to ZAM on this server" | That store's key is missing | Add `ZAM_KEY_<STORE>` to `/etc/zam-demo.env`, restart |
| "ZAM could not be reached: …" | The demo server cannot reach `ZAM_BASE_URL`; the message says why | `curl -s localhost:8090/api/config` shows `zam_url` and `zam_error`. The usual causes: the placeholder `https://zam-staging.example` was never replaced; the port is the demo's own `8090` instead of ZAM's `8082`; the port is missing (it is `:8082`); the public name `zam.techween.net` is used from inside the office, which refuses it. Fix `ZAM_BASE_URL`, then `sudo systemctl restart zam-demo` |
| An error from ZAM, such as the amount being over the POS's limit | ZAM refused the order | Raise the session limit on that POS, or order less |
| The payment window is blank | The address is not registered on that POS, or the browser cannot reach ZAM's pay page | Step 7 (it must match exactly, scheme and port included); open the pay page's address in a tab. A cloud demo's pay page (`https://zam.techween.net`) is refused from inside the office |
| The wallet says "Error loading payment request" | The order carries no note, which the wallet requires | Update the demo (`git pull`): it sends a note. ZAM v1.5.0-rc3 or later fills one in too |
| No chime | The browser blocked audio, or the sound output is Bluetooth | Open the browser console; a warning says so |
| QR works, ultrasound is not heard | Bluetooth or a speaker that cannot play above 18 kHz | Use the computer's own speakers, near the phone |

## Keeping it safe

- The three keys live only in `/etc/zam-demo.env` (readable by root and the
  `zamdemo` user). Never put them in a page, a repository or a chat.
- Keep each POS's session limit low. If a key leaks, revoke it on the Checkout
  Keys page and create another.
- Leave `HOST=127.0.0.1` on whenever nginx or a tunnel is in front.
- A demo is not a shop: orders are held in memory and lost on restart.
