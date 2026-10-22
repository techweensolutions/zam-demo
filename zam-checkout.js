/**
 * ZAM Checkout - Drop-in payment widget for online stores
 *
 * Usage:
 *   ZamCheckout.configure({ apiKey: 'your-key', baseURL: 'https://zam.example.com' });
 *   ZamCheckout.open({
 *     amount: '15.500',
 *     orderRef: 'ORDER-123',
 *     onSuccess: (result) => {},
 *     onCancel: () => {},
 *     onError: (err) => {}
 *   });
 */
(function (root) {
  "use strict";

  var config = {
    apiKey: null,
    baseURL: "",
    // Deprecated: the currency and timezone now arrive with every session
    // response (`currency`, `locale`). Set only to label amounts before the
    // first response, or to override a server that predates the field.
    currency: null,
    pollInterval: 3000,
  };

  // The locale of the ZAM service this widget is talking to, as sent with
  // the checkout session: { country_code, currency, currency_decimals,
  // timezone }. Amounts are shown exactly as the server formats them; dates
  // are shown in the service's timezone so the shopper, the merchant portal
  // and the receipt agree.
  var serviceLocale = null;

  function currencyLabel(data) {
    if (data && data.currency) return data.currency;
    if (serviceLocale && serviceLocale.currency) return serviceLocale.currency;
    return config.currency || "";
  }

  function rememberLocale(data) {
    if (data && data.locale && data.locale.currency) serviceLocale = data.locale;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var opts = { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
    if (serviceLocale && serviceLocale.timezone) opts.timeZone = serviceLocale.timezone;
    try {
      return new Intl.DateTimeFormat(undefined, opts).format(d);
    } catch (e) {
      return d.toLocaleString();
    }
  }

  var state = {
    overlay: null,
    pollTimer: null,
    sessionId: null,
    callbacks: {},
  };

  // ── Styles ──────────────────────────────────────────────────────────

  var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

  var STYLES =
    // Overlay
    ".zam-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(6px);opacity:0;transition:opacity .25s ease}" +
    ".zam-overlay.zam-visible{opacity:1}" +
    // Modal — larger, taller
    ".zam-modal{position:relative;width:96%;max-width:480px;height:90vh;max-height:780px;background:#fff;border-radius:20px;box-shadow:0 32px 100px rgba(0,0,0,.4);overflow:hidden;display:flex;flex-direction:column;transform:translateY(24px) scale(.96);transition:transform .3s cubic-bezier(.4,0,.2,1)}" +
    ".zam-overlay.zam-visible .zam-modal{transform:translateY(0) scale(1)}" +
    // Header — taller with amount display
    ".zam-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:linear-gradient(135deg,#FF8C00,#F5A623);color:#fff}" +
    ".zam-header-brand{display:flex;align-items:center;gap:10px;font:700 17px/1.2 " + FONT + ";color:#fff}" +
    ".zam-header-brand svg{width:26px;height:26px}" +
    ".zam-header-amount{font:700 18px/1 " + FONT + ";color:#fff;background:rgba(255,255,255,.2);padding:6px 14px;border-radius:10px}" +
    // Close
    ".zam-close{position:absolute;top:12px;right:14px;z-index:5;width:32px;height:32px;border:none;background:rgba(0,0,0,.08);border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}" +
    ".zam-close:hover{background:rgba(0,0,0,.15)}" +
    ".zam-close svg{width:14px;height:14px;stroke:#666;stroke-width:2.5}" +
    // Iframe
    ".zam-frame{flex:1;border:none;width:100%;min-height:460px}" +
    // Footer
    ".zam-footer{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid #eee;background:#fafafa}" +
    ".zam-footer-status{display:flex;align-items:center;gap:8px;font:500 13px/1 " + FONT + ";color:#666}" +
    ".zam-dot{width:9px;height:9px;border-radius:50%;background:#f59e0b;animation:zam-pulse 1.5s infinite}" +
    ".zam-dot.zam-approved{background:#22c55e;animation:none}" +
    ".zam-cancel-btn{padding:8px 18px;border:1px solid #ddd;border-radius:10px;background:#fff;color:#666;font:500 13px/1 " + FONT + ";cursor:pointer;transition:all .15s}" +
    ".zam-cancel-btn:hover{background:#f5f5f5;border-color:#ccc;color:#333}" +
    "@keyframes zam-pulse{0%,100%{opacity:1}50%{opacity:.4}}" +
    // Success overlay — full redesign
    ".zam-success-overlay{position:absolute;inset:0;z-index:10;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 32px;opacity:0;transition:opacity .4s;pointer-events:none}" +
    ".zam-success-overlay.zam-visible{opacity:1;pointer-events:auto}" +
    // Animated checkmark circle
    ".zam-success-icon{width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,#22c55e,#16a34a);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(34,197,94,.35);animation:zam-pop .4s cubic-bezier(.4,0,.2,1)}" +
    ".zam-success-icon svg{width:44px;height:44px;stroke:#fff;stroke-width:3;fill:none}" +
    "@keyframes zam-pop{0%{transform:scale(0)}60%{transform:scale(1.15)}100%{transform:scale(1)}}" +
    // Title & subtitle
    ".zam-success-title{margin-top:24px;font:800 24px/1.2 " + FONT + ";color:#1a1a1a;text-align:center}" +
    ".zam-success-subtitle{margin-top:6px;font:400 14px/1.4 " + FONT + ";color:#888;text-align:center}" +
    // Detail card
    ".zam-success-card{width:100%;max-width:340px;margin-top:24px;background:#f8faf9;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden}" +
    ".zam-success-amount-row{padding:16px 20px;text-align:center;border-bottom:1px solid #e5e7eb}" +
    ".zam-success-amount{font:800 32px/1.2 " + FONT + ";color:#1a1a1a}" +
    ".zam-success-currency{font:600 14px/1 " + FONT + ";color:#888;margin-left:4px}" +
    ".zam-success-rows{padding:4px 0}" +
    ".zam-success-row{display:flex;justify-content:space-between;padding:10px 20px;font:400 13px/1.3 " + FONT + "}" +
    ".zam-success-row-label{color:#888}" +
    ".zam-success-row-value{color:#1a1a1a;font-weight:600;text-align:right}" +
    // Done button
    ".zam-success-btn{margin-top:28px;width:100%;max-width:340px;padding:14px 28px;border:none;border-radius:14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font:600 16px/1 " + FONT + ";cursor:pointer;transition:transform .15s,box-shadow .15s;box-shadow:0 4px 16px rgba(34,197,94,.3)}" +
    ".zam-success-btn:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(34,197,94,.4)}" +
    // Powered-by footer in success
    ".zam-success-footer{margin-top:20px;font:400 11px/1 " + FONT + ";color:#bbb}" +
    ".zam-success-footer span{color:#f59e0b;font-weight:600}";

  function injectStyles() {
    if (document.getElementById("zam-checkout-styles")) return;
    var s = document.createElement("style");
    s.id = "zam-checkout-styles";
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // ── API helpers ─────────────────────────────────────────────────────

  function apiRequest(method, path, body, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, config.baseURL + path, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    if (config.apiKey) {
      xhr.setRequestHeader("Authorization", "Token " + config.apiKey);
    }
    xhr.onload = function () {
      var resp;
      try {
        resp = JSON.parse(xhr.responseText);
      } catch (e) {
        return cb({ error: "Invalid JSON response" });
      }
      if (xhr.status >= 200 && xhr.status < 300 && resp.success) {
        cb(null, resp.data);
      } else {
        cb({
          status: xhr.status,
          error: resp.error || resp.message || "Request failed",
          code: resp.error_code,
        });
      }
    };
    xhr.onerror = function () {
      cb({ error: "Network error" });
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }

  function createSession(opts, cb) {
    var payload = { amount: opts.amount };
    if (opts.orderRef) payload.order_ref = opts.orderRef;
    if (opts.callbackURL) payload.callback_url = opts.callbackURL;
    if (opts.note) payload.note = opts.note;
    apiRequest("POST", "/api/checkout/sessions", payload, cb);
  }

  function getSession(sessionId, cb) {
    apiRequest("GET", "/api/checkout/sessions/" + sessionId, null, cb);
  }

  function cancelSession(sessionId, cb) {
    apiRequest(
      "POST",
      "/api/checkout/sessions/" + sessionId + "/cancel",
      null,
      cb
    );
  }

  // ── Polling ─────────────────────────────────────────────────────────

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(function () {
      if (!state.sessionId) return;
      // A store that creates its sessions on its own server (openSession)
      // reads the status there too; the key stays on that server.
      var read = state.reader || function (cb) { getSession(state.sessionId, cb); };
      read(function (err, data) {
        if (err) { console.warn("ZamCheckout: could not read the payment status"); return; }
        rememberLocale(data);
        if (data && data.status === "approved") {
          showSuccess(data);
        } else if (
          data &&
          (data.status === "canceled" || data.status === "expired")
        ) {
          close();
          if (state.callbacks.onCancel) state.callbacks.onCancel();
        }
      });
    }, config.pollInterval);
  }

  // The pay page address must be a web address or a path on this site, never a
  // script URL.
  function isPayableURL(u) {
    return /^(https?:\/\/|\/(?!\/))/i.test(u || "");
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ── UI ──────────────────────────────────────────────────────────────

  function buildModal(paymentURL) {
    var overlay = document.createElement("div");
    overlay.className = "zam-overlay";
    overlay.innerHTML =
      '<div class="zam-modal">' +
      '  <button class="zam-close" aria-label="Close">' +
      '    <svg viewBox="0 0 14 14"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>' +
      "  </button>" +
      // autoplay: delegated so the payment page can play its ultrasound
      // beacon ("Send code by sound"). The page still waits for the payer to
      // tap; without the delegation a cross-origin frame cannot start audio
      // at all, and the control would fail silently.
      // sandbox: the pay page is ZAM's, not the store's, and gets only what it
      // uses: its own scripts and storage, a window for the wallet app link, and
      // a navigation of the store's page, when the shopper taps, to open the
      // ZAM Cards app.
      '  <iframe class="zam-frame" allow="web-share; clipboard-write; autoplay" sandbox="allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation"></iframe>' +
      '  <div class="zam-footer">' +
      '    <div class="zam-footer-status"><span class="zam-dot"></span>Waiting for payment</div>' +
      '    <button class="zam-cancel-btn">Cancel</button>' +
      "  </div>" +
      '  <div class="zam-success-overlay">' +
      '    <div class="zam-success-icon"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>' +
      '    <div class="zam-success-title">Payment Successful</div>' +
      '    <div class="zam-success-subtitle">Your transaction has been processed</div>' +
      '    <div class="zam-success-card">' +
      '      <div class="zam-success-amount-row"><span class="zam-success-amount"></span><span class="zam-success-currency"></span></div>' +
      '      <div class="zam-success-rows"></div>' +
      '    </div>' +
      '    <button class="zam-success-btn">Done</button>' +
      '    <div class="zam-success-footer">Secured by <span>Zam</span></div>' +
      "  </div>" +
      "</div>";

    // The address goes in as a property, never into the markup, and as a web address
    // or a path on this site.
    overlay.querySelector(".zam-frame").src = paymentURL;

    // Close button
    overlay.querySelector(".zam-close").addEventListener("click", function () {
      handleCancel();
    });

    // Cancel button
    overlay
      .querySelector(".zam-cancel-btn")
      .addEventListener("click", function () {
        handleCancel();
      });

    // Click outside modal (but not during success)
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && !state._approved) handleCancel();
    });

    // Escape key (but not during success)
    state._escHandler = function (e) {
      if (e.key === "Escape" && !state._approved) handleCancel();
    };
    document.addEventListener("keydown", state._escHandler);

    // Done button (success overlay)
    overlay
      .querySelector(".zam-success-btn")
      .addEventListener("click", function () {
        var cb = state.callbacks.onSuccess;
        var result = state._lastResult;
        close();
        if (cb) cb(result);
      });

    return overlay;
  }

  function handleCancel() {
    var cb = state.callbacks.onCancel;
    if (state.canceler) {
      state.canceler(function () {
        /* fire-and-forget */
      });
    } else if (state.sessionId) {
      cancelSession(state.sessionId, function () {
        /* fire-and-forget */
      });
    }
    close();
    if (cb) cb();
  }

  function showSuccess(data) {
    stopPolling();
    state._lastResult = data;
    state._approved = true;

    if (!state.overlay) return;
    var successEl = state.overlay.querySelector(".zam-success-overlay");
    var dot = state.overlay.querySelector(".zam-dot");
    var statusText = state.overlay.querySelector(".zam-footer-status");

    // Hide iframe so success overlay is fully visible
    var frame = state.overlay.querySelector(".zam-frame");
    if (frame) frame.style.display = "none";

    // Hide close button and cancel during success
    var closeBtn = state.overlay.querySelector(".zam-close");
    if (closeBtn) closeBtn.style.display = "none";
    var footer = state.overlay.querySelector(".zam-footer");
    if (footer) footer.style.display = "none";

    if (dot) dot.classList.add("zam-approved");
    if (statusText)
      statusText.innerHTML =
        '<span class="zam-dot zam-approved"></span>Payment approved';

    // Populate amount — exactly as the server formatted it, labelled with the
    // currency it sent.
    rememberLocale(data);
    var amountEl = successEl.querySelector(".zam-success-amount");
    if (amountEl && data.amount) amountEl.textContent = data.amount;
    var currencyEl = successEl.querySelector(".zam-success-currency");
    if (currencyEl) currencyEl.textContent = currencyLabel(data);

    // Populate detail rows
    var rowsEl = successEl.querySelector(".zam-success-rows");
    if (rowsEl) {
      var rows = [];
      if (data.session_id) rows.push(["Session", data.session_id]);
      if (data.order_ref) rows.push(["Order Reference", data.order_ref]);
      if (data.authorization_code) rows.push(["Auth Code", data.authorization_code]);
      if (data.card_number) rows.push(["Card", data.card_number]);
      if (data.card_holder) rows.push(["Card Holder", data.card_holder]);
      if (data.status) rows.push(["Status", data.status.charAt(0).toUpperCase() + data.status.slice(1)]);
      if (data.paid_on) rows.push(["Date", formatDate(data.paid_on)]);
      else if (data.paid_at) rows.push(["Date", formatDate(data.paid_at)]);
      else if (data.approved_at) rows.push(["Date", formatDate(data.approved_at)]);

      // Values come from the server and include the merchant's own order
      // reference, so they are set as text and never parsed as markup.
      rowsEl.textContent = "";
      rows.forEach(function (r) {
        var row = document.createElement("div");
        row.className = "zam-success-row";
        var label = document.createElement("span");
        label.className = "zam-success-row-label";
        label.textContent = r[0];
        var value = document.createElement("span");
        value.className = "zam-success-row-value";
        value.textContent = r[1];
        row.appendChild(label);
        row.appendChild(value);
        rowsEl.appendChild(row);
      });
    }

    successEl.classList.add("zam-visible");
  }

  function close() {
    stopPolling();
    if (state._escHandler) {
      document.removeEventListener("keydown", state._escHandler);
      state._escHandler = null;
    }
    if (state.overlay) {
      state.overlay.classList.remove("zam-visible");
      setTimeout(function () {
        if (state.overlay && state.overlay.parentNode) {
          state.overlay.parentNode.removeChild(state.overlay);
        }
        state.overlay = null;
      }, 300);
    }
    state.sessionId = null;
    state.reader = null;
    state.canceler = null;
    state.callbacks = {};
    state._approved = false;
  }

  // ── Public API ──────────────────────────────────────────────────────

  var ZamCheckout = {
    /**
     * Configure the widget (call once on page load).
     * @param {Object} opts
     * @param {string} opts.apiKey   - Device/checkout API key
     * @param {string} opts.baseURL  - Base URL of the ZAM POS API (e.g. https://zam.example.com)
     * @param {string} [opts.currency] - Deprecated. The currency arrives with every session response; set only to label amounts before the first response.
     * @param {number} [opts.pollInterval=3000] - Status poll interval in ms
     */
    configure: function (opts) {
      if (opts.apiKey) config.apiKey = opts.apiKey;
      if (opts.baseURL) config.baseURL = opts.baseURL.replace(/\/+$/, "");
      if (opts.currency) config.currency = opts.currency;
      if (opts.pollInterval) config.pollInterval = opts.pollInterval;
    },

    /**
     * Open the checkout modal.
     * @param {Object} opts
     * @param {string}   opts.amount       - Payment amount (required)
     * @param {string}   [opts.orderRef]   - Your order reference
     * @param {string}   [opts.callbackURL]- Server-side webhook URL
     * @param {string}   [opts.note]       - Payment note
     * @param {Function} [opts.onSuccess]  - Called with payment result on approval
     * @param {Function} [opts.onCancel]   - Called when user cancels
     * @param {Function} [opts.onError]    - Called on API/network errors
     */
    open: function (opts) {
      if (!config.apiKey) {
        console.error("ZamCheckout: call configure({ apiKey }) first");
        return;
      }
      if (!opts || !opts.amount) {
        console.error("ZamCheckout: amount is required");
        return;
      }
      // One checkout at a time: a second click on Pay while one is open or
      // being created must not start another session for the same order.
      if (state.overlay || state.opening) return;
      state.opening = true;

      injectStyles();

      state.callbacks = {
        onSuccess: opts.onSuccess,
        onCancel: opts.onCancel,
        onError: opts.onError,
      };

      createSession(opts, function (err, data) {
        state.opening = false;
        if (err) {
          console.error("ZamCheckout: session creation failed", err);
          if (state.callbacks.onError) state.callbacks.onError(err);
          return;
        }

        state.sessionId = data.session_id;
        rememberLocale(data);

        var paymentURL = data.payment_url;
        if (paymentURL && paymentURL.charAt(0) === "/" && config.baseURL) {
          paymentURL = config.baseURL + paymentURL;
        }
        if (!isPayableURL(paymentURL)) {
          console.error("ZamCheckout: the service returned no payment address");
          if (state.callbacks.onError) state.callbacks.onError(new Error("No payment address"));
          return;
        }
        state.overlay = buildModal(paymentURL);
        document.body.appendChild(state.overlay);

        // Trigger entrance animation
        requestAnimationFrame(function () {
          state.overlay.classList.add("zam-visible");
        });

        startPolling();
      });
    },

    /**
     * Open the checkout modal for a session your own server created.
     *
     * This is the server-side flow: your server creates the session with a
     * secret key and gives the page only the pay page address; the page never
     * holds a key. The widget shows the pay page and asks you for the status.
     * Mark the order paid on your server from its own check or the signed
     * webhook, never because this callback ran.
     *
     * @param {Object}   opts
     * @param {string}   opts.paymentURL - payment_url from your server's create call
     * @param {Function} opts.getStatus  - function (cb): ask your server for the
     *                                     session; cb(err, { status, amount, currency,
     *                                     order_ref, ... }) with status "pending",
     *                                     "approved", "canceled" or "expired"
     * @param {Function} [opts.cancel]   - function (cb): ask your server to cancel
     * @param {string}   [opts.sessionId]
     * @param {Function} [opts.onSuccess] - called with the status object once approved
     * @param {Function} [opts.onCancel]
     * @param {Function} [opts.onError]
     */
    openSession: function (opts) {
      if (!opts || !isPayableURL(opts.paymentURL) || typeof opts.getStatus !== "function") {
        console.error("ZamCheckout.openSession: paymentURL and getStatus are required");
        if (opts && opts.onError) opts.onError(new Error("paymentURL and getStatus are required"));
        return;
      }
      if (state.overlay || state.opening) return;

      injectStyles();

      state.callbacks = {
        onSuccess: opts.onSuccess,
        onCancel: opts.onCancel,
        onError: opts.onError,
      };
      state.sessionId = opts.sessionId || "external";
      state.reader = opts.getStatus;
      state.canceler = typeof opts.cancel === "function" ? opts.cancel : null;
      state.overlay = buildModal(opts.paymentURL);
      document.body.appendChild(state.overlay);
      requestAnimationFrame(function () {
        state.overlay.classList.add("zam-visible");
      });
      startPolling();
    },

    /**
     * Programmatically close the widget.
     */
    close: close,
  };

  // Export
  root.ZamCheckout = ZamCheckout;
})(typeof window !== "undefined" ? window : this);
