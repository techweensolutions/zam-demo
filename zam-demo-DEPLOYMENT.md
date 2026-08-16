# Zam Demo Stores - Deployment Guide

## Overview

Three demo online stores showcasing Zam Checkout integration:

| Store | Description | Path |
|-------|-------------|------|
| **Xcite Electronics** | Smartphones, laptops, gaming gear | `/xcite/` |
| **Kuwait Travel** | Flight and travel package booking | `/travel/` |
| **Talabat** | Light healthy meals delivery | `/talabat/` |

The landing page (`/`) lets users choose a store and configure shared fallback API settings.

## Prerequisites

- A Zam POS Acquirer account with **merchant API keys** (one per store, or a shared key)
- A web server or static hosting provider (Nginx, Apache, Netlify, Vercel, Cloudflare Pages, etc.)

## Directory Structure

```
zam-demo/
├── index.html              # Landing page (store selector + fallback API config)
├── zam-checkout.js         # Zam Checkout SDK (bundled)
├── xcite/
│   └── index.html          # Xcite Electronics store
├── travel/
│   └── index.html          # Kuwait Travel store
├── pick/
│   └── index.html          # Pick healthy meals store
└── zam-demo-DEPLOYMENT.md  # This file
```

## Step 1: Configure Merchant API Keys

Each store has its own `STORE_CONFIG` at the top of its JavaScript section. Set the API key and base URL per store:

### Xcite Electronics — `xcite/index.html`

```js
var STORE_CONFIG = {
    apiKey:  'xcite-merchant-api-key-here',
    baseURL: 'https://zam-api.your-domain.com',
};
```

### Kuwait Travel — `travel/index.html`

```js
var STORE_CONFIG = {
    apiKey:  'kuwait-travel-merchant-api-key-here',
    baseURL: 'https://zam-api.your-domain.com',
};
```

### Pick — `pick/index.html`

```js
var STORE_CONFIG = {
    apiKey:  'pick-merchant-api-key-here',
    baseURL: 'https://zam-api.your-domain.com',
};
```

> **Fallback:** If `STORE_CONFIG` values are left empty, the stores fall back to the shared settings entered via the landing page (stored in `localStorage`).

## Step 2: Deploy to Your Domain

### Using Nginx

```nginx
server {
    listen 80;
    server_name demo.your-domain.com;

    root /var/www/zam-demo;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

```bash
# Copy files to server
scp -r zam-demo/* user@server:/var/www/zam-demo/
```

### Using Netlify

```bash
cd zam-demo
npx netlify-cli deploy --prod --dir=.
```

Set the custom domain in Netlify dashboard under **Site settings > Domain management**.

### Using Vercel

```bash
cd zam-demo
npx vercel --prod
```

Then assign your domain in the Vercel dashboard.

### Using Cloudflare Pages

1. Push the `zam-demo` directory to a Git repository
2. Connect the repo in Cloudflare Pages dashboard
3. Set build output directory to `zam-demo`
4. Assign your custom domain

### Using GitHub Pages

1. Push the `zam-demo` directory to a `gh-pages` branch
2. In repo **Settings > Pages**, select the `gh-pages` branch
3. Optionally configure a custom domain

## Step 3: Set Up the Zam API Backend

Ensure your Zam POS Acquirer API is accessible at the configured `baseURL`. The SDK calls these endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/checkout/sessions` | Create a payment session |
| `GET` | `/api/checkout/sessions/:id` | Poll session status |
| `POST` | `/api/checkout/sessions/:id/cancel` | Cancel a session |

### CORS Configuration

If the demo site and API are on different domains, configure CORS on the API server:

```
Access-Control-Allow-Origin: https://demo.your-domain.com
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Methods: GET, POST, OPTIONS
```

## Quick Local Testing

```bash
cd zam-demo
python3 -m http.server 8080
```

Open `http://localhost:8080` in your browser. The SDK is bundled at `zam-checkout.js` so no extra path configuration is needed.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Call configure() first" | Set the API key in `STORE_CONFIG` or via the landing page |
| CORS errors | Add your demo domain to the API's allowed origins |
| SDK not loading | Verify `zam-checkout.js` exists in the `zam-demo/` root |
| Payment stuck on "Waiting" | Check that the API base URL is correct and reachable |
