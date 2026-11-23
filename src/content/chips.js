// Turns $CASHTAGS and @mentions inside tweet text into rich badges.
// The original link stays (so clicks / hover cards still work); its text is
// wrapped in .xp-orig and hidden by CSS, and the badge is added next to it.

const xpChips = (() => {
  const HANDLE_RE = /^\/([A-Za-z0-9_]{1,15})$/;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Wrap the link's original children so CSS can hide them when the badge is on.
  function prepare(link, kind) {
    if (link.querySelector(":scope > .xp-chip-inner")) return null; // already done
    const orig = el("span", "xp-orig");
    while (link.firstChild) orig.appendChild(link.firstChild);
    link.appendChild(orig);
    link.classList.add("xp-chip", `xp-${kind}`);
    const inner = el("span", `xp-chip-inner xp-${kind}-inner xp-loading`);
    link.appendChild(inner);
    return inner;
  }

  function letterAvatar(text, cls) {
    const a = el("span", `${cls} xp-letter`, (text || "?").replace(/^[$@]/, "").charAt(0).toUpperCase());
    return a;
  }

  // ---- Verified badge (scalloped seal + check), coloured by type ------------
  const SEAL = (() => {
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const r = i % 2 ? 9.2 : 11;
      const a = (Math.PI * 2 * i) / 24;
      pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12 + r * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(" ");
  })();

  function verifiedBadge(type) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", `xp-verified xp-verified-${type}`);
    svg.setAttribute("aria-label", "Verified");
    const seal = document.createElementNS(ns, "polygon");
    seal.setAttribute("points", SEAL);
    seal.setAttribute("stroke-linejoin", "round");
    const check = document.createElementNS(ns, "path");
    check.setAttribute("d", "M7.6 12.3l3 3 5.8-6.3");
    check.setAttribute("class", "xp-check");
    svg.append(seal, check);
    return svg;
  }

  // ---- $CASHTAG ----------------------------------------------------------------
  function formatPrice(q) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: q.currency,
        minimumFractionDigits: q.price < 1 ? 4 : 2,
        maximumFractionDigits: q.price < 1 ? 6 : 2,
      }).format(q.price);
    } catch {
      return q.price.toFixed(2);
    }
  }

  function cashtag(link) {
    const ticker = (link.textContent || "").trim().replace(/^\$/, "").toUpperCase();
    if (!/^[A-Z0-9.]{1,12}$/.test(ticker)) return;
    const inner = prepare(link, "cash");
    if (!inner) return;

    const logo = letterAvatar(ticker, "xp-logo");
    const price = el("span", "xp-price", "");
    inner.append(logo, el("span", "xp-ticker", ticker), price);
    link.title = `$${ticker}`;

    xpApi.quote(ticker).then((q) => {
      inner.classList.remove("xp-loading");
      if (!q) {
        inner.classList.add("xp-noquote");
        price.remove();
        return;
      }
      price.textContent = formatPrice(q);
      const dir = q.changePct == null ? "flat" : q.changePct >= 0 ? "up" : "down";
      price.classList.add(`xp-${dir}`);
      const pct = q.changePct == null ? "" : ` · ${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}% today`;
      link.title = `${q.name} (${q.symbol}) ${formatPrice(q)}${pct}`;

      xpApi.logo(q.symbol).then((src) => {
        if (!src) return;
        const img = el("img", "xp-logo");
        img.alt = "";
        img.src = src;
        img.onload = () => logo.replaceWith(img);
      });
    });
  }

  // ---- @mention ----------------------------------------------------------------
  function mention(link) {
    const text = (link.textContent || "").trim();
    const m = HANDLE_RE.exec(link.getAttribute("href") || "");
    if (!m || !text.startsWith("@")) return;
    const handle = m[1];
    const inner = prepare(link, "mention");
    if (!inner) return;

    const avatar = letterAvatar(handle, "xp-avatar");
    const name = el("span", "xp-name", `@${handle}`);
    inner.append(avatar, name);
    link.title = `@${handle}`;

    xpApi.profile(handle).then((p) => {
      inner.classList.remove("xp-loading");
      if (!p) return; // keep @handle fallback
      name.textContent = p.name || `@${handle}`;
      if (p.name) avatar.textContent = p.name.charAt(0).toUpperCase();
      link.title = `${p.name} @${p.handle}`;
      if (p.verified) inner.appendChild(verifiedBadge(p.verified));
      if (p.avatar) {
        const img = el("img", "xp-avatar");
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.src = p.avatar;
        img.onload = () => avatar.replaceWith(img);
      }
    });
  }

  return { cashtag, mention };
})();
