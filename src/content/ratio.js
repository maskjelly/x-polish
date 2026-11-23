// Ratio meter: engagement rate on each post, read from the post's own action
// bar. X labels the bar for screen readers, e.g.
//   "36 replies, 4 reposts, 483 likes, 2 bookmarks, 19037 views"
// We parse that (English; other languages simply show nothing) and show ONE
// small pill in the post header after the time: "2.8%", "Hot · 13%" or
// "Ratioed · 1.7%". Nothing is ever inserted into X's action bar, whose
// spacing X controls precisely.
//
//   rate    = (likes + reposts + replies + bookmarks) / views
//   Ratioed = replies > likes and replies >= 20
//   Hot     = rate >= 5% and views >= 1000

const xpRatio = (() => {
  const watched = new WeakSet();

  function num(s) {
    // A K/M/B suffix only counts when it is glued to the number and not the
    // start of a word ("2 bookmarks" is 2, not 2 billion).
    const m = /(\d[\d.,]*)([KkMmBb])?(?![A-Za-z])/.exec(s);
    if (!m) return null;
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    const unit = (m[2] || "").toLowerCase();
    if (unit === "k") n *= 1e3;
    else if (unit === "m") n *= 1e6;
    else if (unit === "b") n *= 1e9;
    return Math.round(n);
  }

  function parse(label) {
    const out = { replies: 0, reposts: 0, likes: 0, bookmarks: 0, views: null };
    let any = false;
    // Items are comma-separated; a comma followed by a digit is a thousands
    // separator inside a number ("1,204 likes").
    for (const part of String(label || "").split(/,\s*(?=\D)/)) {
      const p = part.trim().toLowerCase();
      const n = num(p);
      if (n == null) continue;
      if (/\bviews?\b/.test(p)) { out.views = n; any = true; }
      else if (/\brepl(y|ies)\b/.test(p)) { out.replies = n; any = true; }
      else if (/\b(reposts?|retweets?)\b/.test(p)) { out.reposts = n; any = true; }
      else if (/\blikes?\b/.test(p)) { out.likes = n; any = true; }
      else if (/\bbookmarks?\b/.test(p)) { out.bookmarks = n; any = true; }
    }
    return any ? out : null;
  }

  // The post's own action bar: a labelled [role=group] belonging to this
  // article (not a nested quoted post), the last one in the article.
  function mainBar(article) {
    const groups = [...article.querySelectorAll('[role="group"][aria-label]')].filter(
      (g) => g.closest('article[data-testid="tweet"]') === article && /\d/.test(g.getAttribute("aria-label"))
    );
    return groups[groups.length - 1] || null;
  }

  const fmt = new Intl.NumberFormat("en-US");

  // The post's own header line (name · handle · time), not a quoted post's.
  function headerOf(article) {
    const h = article.querySelector('[data-testid="User-Name"]');
    return h && h.closest('article[data-testid="tweet"]') === article ? h : null;
  }

  // Order in the header: time → account tag (accounts.js) → ratio pill →
  // label button. Re-applied whenever the header's children change.
  // Only moves the pill when it is out of place, so the header observer
  // below never loops.
  function place(header, pill) {
    const acct = header.querySelector(":scope > .xp-acct-tag");
    if (acct) {
      if (pill.parentNode !== header || pill.previousSibling !== acct) acct.after(pill);
      return;
    }
    const btn = header.querySelector(":scope > .xp-label-btn");
    if (pill.parentNode === header && (btn ? pill.nextSibling === btn : !pill.nextSibling)) return;
    if (btn) header.insertBefore(pill, btn);
    else header.appendChild(pill);
  }

  function render(article, bar) {
    const header = headerOf(article);
    if (!header) return;
    let pill = header.querySelector(":scope > .xp-ratio-pill");
    const m = parse(bar.getAttribute("aria-label"));
    if (!m || !m.views) { pill?.remove(); return; }

    const engaged = m.likes + m.reposts + m.replies + m.bookmarks;
    const rate = (engaged / m.views) * 100;
    const ratioed = m.replies > m.likes && m.replies >= 20;
    const hot = !ratioed && rate >= 5 && m.views >= 1000;
    const level = ratioed ? "ratioed" : hot ? "hot" : "normal";
    const pct = rate >= 100 ? "100%+" : `${rate < 10 ? rate.toFixed(1) : Math.round(rate)}%`;
    const text = level === "hot" ? `Hot · ${pct}` : level === "ratioed" ? `Ratioed · ${pct}` : pct;

    if (!pill) {
      pill = document.createElement("span");
      pill.className = "xp-ratio-pill";
    }
    place(header, pill);
    if (pill.textContent !== text) pill.textContent = text;
    pill.dataset.level = level;
    pill.title =
      `Engagement rate ${rate.toFixed(2)}%\n` +
      `${fmt.format(engaged)} interactions / ${fmt.format(m.views)} views\n` +
      `${fmt.format(m.likes)} likes · ${fmt.format(m.reposts)} reposts · ` +
      `${fmt.format(m.replies)} replies · ${fmt.format(m.bookmarks)} bookmarks` +
      (ratioed ? "\nRatioed: more replies than likes" : hot ? "\nHot: 5%+ of viewers engaged" : "");
    pill.setAttribute("aria-label", `Engagement rate ${pct}${ratioed ? ", ratioed" : hot ? ", hot" : ""}`);
  }

  function tweet(article) {
    if (article.closest(".xp-share-modal, .xp-share")) return; // never inside share images
    const bar = mainBar(article);
    if (!bar) return;
    render(article, bar);
    // X updates the bar's label in place when counts change.
    if (!watched.has(bar)) {
      watched.add(bar);
      new MutationObserver(() => render(article, bar)).observe(bar, { attributes: true, attributeFilter: ["aria-label"] });
    }
    // Keep the pill after the account tag if that tag arrives later.
    const header = headerOf(article);
    if (header && !watched.has(header)) {
      watched.add(header);
      new MutationObserver(() => {
        const pill = header.querySelector(":scope > .xp-ratio-pill");
        if (pill) place(header, pill);
      }).observe(header, { childList: true });
    }
  }

  return { tweet, parse };
})();
