/**
 * ZAM Pay Button — Standard payment button for web and mobile
 *
 * Drop-in component that renders a branded "ZAM Pay" button following
 * the same conventions as Apple Pay / Google Pay buttons.
 *
 * Usage (HTML attribute API):
 *   <div class="zam-pay-button" data-type="pay" data-style="dark" data-size="default"></div>
 *   <script src="zam-pay-button.js"></script>
 *
 * Usage (JavaScript API):
 *   ZamPayButton.render(containerEl, {
 *     type:    'pay',        // 'pay' | 'buy' | 'checkout' | 'plain'
 *     style:   'dark',       // 'dark' | 'light' | 'outline'
 *     size:    'default',    // 'small' | 'default' | 'large'
 *     locale:  'en',         // 'en' | 'ar'
 *     onClick: function() {}
 *   });
 *
 * CSS custom properties (override from outside):
 *   --zam-btn-radius:     12px
 *   --zam-btn-min-width:  200px
 *   --zam-btn-height:     48px
 */
(function (root) {
  "use strict";

  // ── Brand constants ──────────────────────────────────────────────────

  var ORANGE   = "#F5A623";
  var DARK     = "#4A4A4A";
  var WHITE    = "#FFFFFF";
  var BLACK    = "#1A1A1A";
  var BORDER   = "#D5D5D5";

  // ── Inline SVG logo ──────────────────────────────────────────────────
  // Reproduces the ZAM brand mark: two orange diagonal stripes + ZAM text

  function zamLogo(stripeColor, textColor, height) {
    height = height || 22;
    var w = Math.round(height * 3.2);
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 50" ' +
      'width="' + w + '" height="' + height + '" aria-hidden="true">' +
      // Two diagonal stripes
      '<line x1="8" y1="42" x2="22" y2="6" stroke="' + stripeColor + '" stroke-width="7" stroke-linecap="round"/>' +
      '<line x1="20" y1="42" x2="34" y2="6" stroke="' + stripeColor + '" stroke-width="7" stroke-linecap="round"/>' +
      // ZAM text
      '<text x="42" y="40" font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif" ' +
      'font-size="42" font-weight="800" fill="' + textColor + '" letter-spacing="1">ZAM</text>' +
      "</svg>"
    );
  }

  // ── Label text by type & locale ──────────────────────────────────────

  var LABELS = {
    en: { pay: "Pay with", buy: "Buy with", checkout: "Check out with", plain: "" },
    ar: { pay: "\u0627\u062F\u0641\u0639 \u0628\u0640", buy: "\u0627\u0634\u062A\u0631\u064A \u0628\u0640", checkout: "\u0623\u062A\u0645\u0645 \u0627\u0644\u0634\u0631\u0627\u0621 \u0628\u0640", plain: "" },
  };

  // ── Size presets ─────────────────────────────────────────────────────

  var SIZES = {
    small:   { height: 36, fontSize: 13, logoH: 16, pad: "0 20px" },
    default: { height: 48, fontSize: 15, logoH: 22, pad: "0 28px" },
    large:   { height: 56, fontSize: 17, logoH: 26, pad: "0 36px" },
  };

  // ── Style sheet (injected once) ──────────────────────────────────────

  var CSS_ID = "zam-pay-btn-styles";

  var CSS =
    // Reset & base
    ".zam-pay-btn{" +
      "display:inline-flex;align-items:center;justify-content:center;gap:8px;" +
      "border:none;outline:none;cursor:pointer;position:relative;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      "font-weight:600;line-height:1;white-space:nowrap;text-decoration:none;" +
      "border-radius:var(--zam-btn-radius,12px);" +
      "min-width:var(--zam-btn-min-width,200px);" +
      "height:var(--zam-btn-height,48px);" +
      "padding:0 28px;" +
      "transition:transform .12s ease,box-shadow .12s ease,opacity .12s ease;" +
      "-webkit-tap-highlight-color:transparent;" +
      "user-select:none;-webkit-user-select:none;" +
    "}" +

    // Hover / Active
    ".zam-pay-btn:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.18)}" +
    ".zam-pay-btn:active{transform:translateY(0);box-shadow:none;opacity:.85}" +

    // Focus visible ring
    ".zam-pay-btn:focus-visible{outline:3px solid " + ORANGE + ";outline-offset:2px}" +

    // ── Dark style (default) ──
    ".zam-pay-btn--dark{background:" + BLACK + ";color:" + WHITE + "}" +

    // ── Light style ──
    ".zam-pay-btn--light{background:" + WHITE + ";color:" + BLACK + ";box-shadow:0 1px 4px rgba(0,0,0,.08)}" +

    // ── Outline style ──
    ".zam-pay-btn--outline{background:transparent;color:" + BLACK + ";border:2px solid " + BORDER + "}" +
    ".zam-pay-btn--outline:hover{border-color:" + ORANGE + "}" +

    // ── Orange style (brand) ──
    ".zam-pay-btn--orange{background:linear-gradient(135deg," + ORANGE + ",#FF8C00);color:" + WHITE + "}" +

    // ── Size overrides ──
    ".zam-pay-btn--small{height:36px;font-size:13px;min-width:160px;padding:0 20px;border-radius:8px;gap:6px}" +
    ".zam-pay-btn--large{height:56px;font-size:17px;min-width:240px;padding:0 36px;border-radius:14px;gap:10px}" +

    // ── RTL support ──
    ".zam-pay-btn[dir='rtl']{direction:rtl}" +

    // ── Disabled ──
    ".zam-pay-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}" +

    // Label span
    ".zam-pay-btn__label{font-weight:500}" +

    // Loading spinner
    ".zam-pay-btn__spinner{display:none;width:18px;height:18px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:zam-spin .6s linear infinite}" +
    ".zam-pay-btn--light .zam-pay-btn__spinner{border-color:rgba(0,0,0,.15);border-top-color:" + BLACK + "}" +
    ".zam-pay-btn--outline .zam-pay-btn__spinner{border-color:rgba(0,0,0,.15);border-top-color:" + BLACK + "}" +
    ".zam-pay-btn.zam-pay-btn--loading .zam-pay-btn__spinner{display:block}" +
    ".zam-pay-btn.zam-pay-btn--loading .zam-pay-btn__label," +
    ".zam-pay-btn.zam-pay-btn--loading .zam-pay-btn__logo{opacity:0}" +
    "@keyframes zam-spin{to{transform:rotate(360deg)}}";

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    var el = document.createElement("style");
    el.id = CSS_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ── Render a single button ───────────────────────────────────────────

  function renderButton(container, opts) {
    opts = opts || {};
    var type   = opts.type   || "pay";      // pay | buy | checkout | plain
    var style  = opts.style  || "dark";     // dark | light | outline | orange
    var size   = opts.size   || "default";  // small | default | large
    var locale = opts.locale || "en";
    var disabled = !!opts.disabled;

    injectCSS();

    var sizeData = SIZES[size] || SIZES["default"];
    var labelText = (LABELS[locale] || LABELS.en)[type] || "";
    var isRTL = locale === "ar";

    // Determine logo colors based on button style
    var stripeColor = ORANGE;
    var textColor = style === "dark" || style === "orange" ? WHITE : DARK;

    var btn = document.createElement("button");
    btn.className = "zam-pay-btn zam-pay-btn--" + style +
                    (size !== "default" ? " zam-pay-btn--" + size : "");
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", (labelText ? labelText + " " : "") + "ZAM");
    if (isRTL) btn.setAttribute("dir", "rtl");
    if (disabled) btn.disabled = true;

    // Set CSS custom properties for size
    btn.style.setProperty("--zam-btn-height", sizeData.height + "px");
    btn.style.fontSize = sizeData.fontSize + "px";

    // Build inner HTML
    var logo = '<span class="zam-pay-btn__logo">' + zamLogo(stripeColor, textColor, sizeData.logoH) + "</span>";
    var label = labelText
      ? '<span class="zam-pay-btn__label">' + labelText + "</span>"
      : "";
    var spinner = '<span class="zam-pay-btn__spinner"></span>';

    if (isRTL) {
      btn.innerHTML = spinner + logo + label;
    } else {
      btn.innerHTML = spinner + label + logo;
    }

    // Click handler
    if (opts.onClick) {
      btn.addEventListener("click", function (e) {
        if (!btn.disabled) opts.onClick(e);
      });
    }

    container.innerHTML = "";
    container.appendChild(btn);

    return btn;
  }

  // ── Auto-init from HTML attributes ───────────────────────────────────

  function autoInit() {
    var els = document.querySelectorAll(".zam-pay-button");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.getAttribute("data-zam-rendered")) continue;
      el.setAttribute("data-zam-rendered", "1");
      renderButton(el, {
        type:   el.getAttribute("data-type")   || "pay",
        style:  el.getAttribute("data-style")  || "dark",
        size:   el.getAttribute("data-size")   || "default",
        locale: el.getAttribute("data-locale") || "en",
      });
    }
  }

  // Run auto-init when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoInit);
  } else {
    autoInit();
  }

  // ── Public API ───────────────────────────────────────────────────────

  var ZamPayButton = {
    render: renderButton,

    /**
     * Show loading state on a previously rendered button.
     * @param {HTMLElement} btn - The button element returned by render()
     */
    setLoading: function (btn, loading) {
      if (loading) {
        btn.classList.add("zam-pay-btn--loading");
        btn.disabled = true;
      } else {
        btn.classList.remove("zam-pay-btn--loading");
        btn.disabled = false;
      }
    },

    /** Re-scan the DOM for any new .zam-pay-button containers */
    init: autoInit,
  };

  root.ZamPayButton = ZamPayButton;
})(typeof window !== "undefined" ? window : this);
