// The demo stores' side of ZAM Checkout v2.
//
// A page never holds a ZAM key. It tells this site's own server what is being
// bought; the server prices the order itself, creates the session at ZAM with a
// secret key, and answers with the address of the pay page. The page shows that
// page in the ZAM Checkout widget and asks the server how the order stands.
(function (root) {
  "use strict";

  function json(method, url, body) {
    return fetch(url, {
      method: method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (j) { return { ok: res.ok, status: res.status, body: j }; });
    });
  }

  /**
   * @param {string} store     "xcite", "travel" or "talabat"
   * @param {Object} order     what the store's server needs to price the order
   * @param {Object} cb        { onSuccess(result), onCancel(), onError(err), onEnd() }
   *                           onEnd runs once the widget is done in any way.
   */
  function pay(store, order, cb) {
    var ended = false;
    function end() { if (!ended) { ended = true; if (cb.onEnd) cb.onEnd(); } }

    json("POST", "/api/orders/" + store, order).then(function (r) {
      if (!r.ok) {
        end();
        if (cb.onError) cb.onError({ error: r.body && r.body.error });
        return;
      }
      var ref = r.body.order_ref;
      root.ZamCheckout.openSession({
        paymentURL: r.body.payment_url,
        getStatus: function (done) {
          json("GET", "/api/orders/" + ref + "/status").then(
            function (s) { done(s.ok ? null : { error: "status" }, s.body); },
            function (e) { done(e); }
          );
        },
        cancel: function (done) {
          json("POST", "/api/orders/" + ref + "/cancel").then(function () { done(); }, function () { done(); });
        },
        onSuccess: function (result) { end(); if (cb.onSuccess) cb.onSuccess(result); },
        onCancel: function () { end(); if (cb.onCancel) cb.onCancel(); },
        onError: function (e) { end(); if (cb.onError) cb.onError(e); },
      });
    }, function () {
      end();
      if (cb.onError) cb.onError({ error: "The store's server could not be reached." });
    });
  }

  root.ZamDemo = { pay: pay };
})(typeof window !== "undefined" ? window : this);
