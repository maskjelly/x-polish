// Ratio meter: engagement rate on each post, read from the post's own action
// bar. X labels the bar for screen readers, e.g.
//   "36 replies, 4 reposts, 483 likes, 2 bookmarks, 19037 views"
// We parse that (English; other languages simply show nothing), then show the
// percentage next to the views count with a 2px meter under it (no extra
// width, so the bar never crowds), and a "Ratioed" / "Hot" badge in the
// post's header after the time, where there is room.
//
//   rate    = (likes + reposts + replies + bookmarks) / views
//   Ratioed = replies > likes and replies >= 20
//   Hot     = rate >= 5% and views >= 1000

const xpRatio = (() => {
  const FULL_AT = 10; // percent that fills the meter
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

  function build() {
    const el = document.createElement("span");
    el.className = "xp-ratio";
    el.innerHTML =
      '<span class="xp-ratio-pct"></span>' +
      '<span class="xp-ratio-meter" aria-hidden="true"><i></i></span>';
    return el;
  }

  // "Hot" / "Ratioed" badge at the end of the post's header line.
  function setBadge(article, level) {
    const header = article.querySelector('[data-testid="User-Name"]');
    if (!header || header.closest('article[data-testid="tweet"]') !== article) return;
    let b = header.querySelector(":scope > .xp-ratio-badge");
    if (level === "normal") { b?.remove(); return; }
    if (!b) {
      b = document.createElement("span");
      b.className = "xp-ratio-badge";
      header.appendChild(b);
    }
    b.dataset.level = level;
    b.textContent = level === "hot" ? "Hot" : "Ratioed";
    b.title = level === "hot" ? "Hot: 5%+ of viewers engaged" : "Ratioed: more replies than likes";
  }

  function render(article, bar) {
    const m = parse(bar.getAttribute("aria-label"));
    let el = bar.querySelector(".xp-ratio");
    if (!m || !m.views) { el?.remove(); setBadge(article, "normal"); return; }

    const engaged = m.likes + m.reposts + m.replies + m.bookmarks;
    const rate = (engaged / m.views) * 100;
    const ratioed = m.replies > m.likes && m.replies >= 20;
    const hot = !ratioed && rate >= 5 && m.views >= 1000;

    if (!el) {
      el = build();
      // Next to the views count when the bar has one, else at the end.
      const views = bar.querySelector('a[href$="/analytics"]');
      const slot = views?.parentElement && views.parentElement !== bar ? views.parentElement : null;
      if (slot) {
        slot.setAttribute("data-xp-ratio-slot", "");
        slot.appendChild(el);
      } else {
        bar.appendChild(el);
      }
    }

    const pct = rate >= 100 ? "100%+" : `${rate < 10 ? rate.toFixed(1) : Math.round(rate)}%`;
    el.querySelector(".xp-ratio-pct").textContent = pct;
    el.querySelector(".xp-ratio-meter i").style.width = `${Math.min(100, (rate / FULL_AT) * 100).toFixed(1)}%`;

    el.dataset.level = ratioed ? "ratioed" : hot ? "hot" : "normal";
    setBadge(article, el.dataset.level);

    el.title =
      `Engagement rate ${rate.toFixed(2)}%\n` +
      `${fmt.format(engaged)} interactions / ${fmt.format(m.views)} views\n` +
      `${fmt.format(m.likes)} likes · ${fmt.format(m.reposts)} reposts · ` +
      `${fmt.format(m.replies)} replies · ${fmt.format(m.bookmarks)} bookmarks` +
      (ratioed ? "\nRatioed: more replies than likes" : hot ? "\nHot: 5%+ engagement" : "");
    el.setAttribute("aria-label", `Engagement rate ${pct}${ratioed ? ", ratioed" : hot ? ", hot" : ""}`);
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
  }

  return { tweet, parse };
})();
