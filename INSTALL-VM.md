# Install the ZAM demo stores on a VM

Two ways to run the three demo stores (Xcite, Kuwait Travel, Talabat) on a Linux
machine of your own:

- **A. A cloud VM** with a domain name and a real certificate.
- **B. The dev server at 192.168.8.100** on the office network.

Both use the same program (`server.js`, Node, no dependencies) and the same
steps 1 to 5. They differ only in step 6, how the browser reaches the demo over
https.

> **Why https matters.** The demo shows ZAM's pay page inside the store page,
> and ZAM lets only web addresses registered for the store's POS do that. The
> portal accepts only `https://…` addresses, plus `http://localhost` for
> development. So the address you open the demo at must be one of those.

How it works, in short: the pages never hold a key. `server.js` holds one secret
key per store, prices each order itself, creates the payment at ZAM, and marks an
order paid only when ZAM says it is approved for the amount, currency and order
reference it asked for. See `zam-demo-DEPLOYMENT.md`.

---

## 0. What you need before you start

| | |
|---|---|
| A Linux VM | Ubuntu 24.04 LTS or newer, 1 vCPU, 1 GB RAM, 5 GB disk. SSH access with sudo. |
| ZAM's address | The ZAM Service the stores pay through. For staging, `https://zam.techween.net`. The VM must be able to reach it (step 5 checks). |
| Three POS secret keys | One per store. Create them in the merchant portal (step 1). |
| A domain name (option A only) | For example `demo.example.com`, with an `A` record pointing at the VM's public IP. |

---

## 1. In the merchant portal, once per store

For Xcite, Kuwait Travel and Talabat (one merchant can hold all three):

1. **POS Terminals → create**, type **Online**, named after the store. A POS
   created now uses checkout v2: it takes a secret key and refuses browser-side
   creation.
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

Node 20 or newer is needed. Ubuntu 26.04's own package is Node 22:

```sh
sudo apt-get install -y nodejs
node --version          # v20 or newer
```

On Ubuntu 24.04 the package is too old. Use NodeSource:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

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

Set these (the file lists the rest as comments):

```ini
ZAM_BASE_URL=https://zam.techween.net
ZAM_KEY_XCITE=zam_sk_live_…
ZAM_KEY_TRAVEL=zam_sk_live_…
ZAM_KEY_TALABAT=zam_sk_live_…
PORT=8090
HOST=127.0.0.1
```

`HOST=127.0.0.1` makes the demo reachable only through the web server you set up
in step 6. Do **not** set `ZAM_PAY_BASE` when `ZAM_BASE_URL` is the public https
address: ZAM's pay-page address is then resolved against it.

The service:

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
sudo systemctl daemon-reload
sudo systemctl enable --now zam-demo
systemctl is-active zam-demo                       # active
curl -s localhost:8090/api/config                  # {"zam":true,"stores":{"xcite":true,…}}
```

A store shows `false` until its key is in the env file (then
`sudo systemctl restart zam-demo`).

---

## 5. Check that the VM can reach ZAM

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://zam.techween.net/api/checkout/sessions/x
```

`401` is the right answer: ZAM is reachable and wants a key. Anything else
(`000`, a timeout, a certificate error) means the VM cannot reach ZAM yet, and
no payment will work until it can. A cloud VM can reach staging only because
`zam.techween.net` is a public name; a private address like `192.168.8.160` is
not reachable from the cloud.

---

## 6A. Cloud VM: nginx and a Let's Encrypt certificate

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

## 6B. The dev server at 192.168.8.100

There is no public name here, so there is no public certificate. Pick one.

### B1. An SSH tunnel: simplest, one person at a time

Nothing to install on the server beyond steps 1 to 5. On your Mac:

```sh
ssh -L 8090:localhost:8090 <user>@192.168.8.100
```

Leave it open and use **`http://localhost:8090`** in the browser. `http://localhost`
is the one plain-http address the portal accepts, so register
**`http://localhost:8090`** in step 7.

With the tunnel, keep `HOST=127.0.0.1` in the env file.

### B2. A self-signed certificate: anyone on the office network

Gives `https://192.168.8.100` to every browser on the network, after each person
accepts the certificate warning once.

```sh
sudo apt-get install -y nginx openssl
sudo mkdir -p /etc/ssl/zam-demo
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout /etc/ssl/zam-demo/key.pem -out /etc/ssl/zam-demo/cert.pem \
  -subj "/CN=192.168.8.100" -addext "subjectAltName=IP:192.168.8.100"
sudo chgrp www-data /etc/ssl/zam-demo/key.pem && sudo chmod 640 /etc/ssl/zam-demo/key.pem

sudo tee /etc/nginx/sites-available/zam-demo >/dev/null <<'EOF'
server {
    listen 443 ssl;
    server_name 192.168.8.100;
    ssl_certificate     /etc/ssl/zam-demo/cert.pem;
    ssl_certificate_key /etc/ssl/zam-demo/key.pem;
    client_max_body_size 16k;
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
server { listen 80; server_name 192.168.8.100; return 301 https://$host$request_uri; }
EOF
sudo ln -sf /etc/nginx/sites-available/zam-demo /etc/nginx/sites-enabled/zam-demo
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Open `https://192.168.8.100/`, accept the warning, and register
**`https://192.168.8.100`** in step 7. The pay page inside it comes from
`https://zam.techween.net`, which has a real certificate, so only the demo page
itself shows the warning. (If you would rather avoid the warning, use B1.)

If the server cannot resolve or reach `zam.techween.net`, nothing will work; run
the check in step 5 from the server.

---

## 7. Register the demo's address on each POS

Back in the merchant portal, on each store's **Checkout Keys** page, under
**Web addresses**, add the address from step 6:

| Setup | Register |
|---|---|
| Cloud VM | `https://YOUR.DOMAIN` |
| Dev server, tunnel (B1) | `http://localhost:8090` |
| Dev server, self-signed (B2) | `https://192.168.8.100` |

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

## When something goes wrong

| You see | It means | Do |
|---|---|---|
| "The store's server could not be reached" | The page was not served by `server.js` (a static host, or the wrong address), or the server is down | Open the demo at the address from step 6; `systemctl status zam-demo` |
| "The demo server had a problem" | `server.js` hit an error | `sudo journalctl -u zam-demo -n 40` |
| "This store is not connected to ZAM on this server" | That store's key is missing | Add `ZAM_KEY_<STORE>` to `/etc/zam-demo.env`, restart |
| "ZAM could not be reached" | The VM cannot reach `ZAM_BASE_URL` | Step 5 |
| An error from ZAM, such as the amount being over the POS's limit | ZAM refused the order | Raise the session limit on that POS, or order less |
| The payment window is blank | The address is not registered on that POS | Step 7; check it matches exactly, scheme and port included |
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
