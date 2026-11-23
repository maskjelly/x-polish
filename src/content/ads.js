// DOM-side ad fallback. The page-world filter (src/page/adblock.js) drops
// promoted entries before X renders them; this catches promoted tweets that
// still slip through and the promoted trends / users X renders separately.
// Markers are data-xp-ad attributes: X rewrites class on its own elements.

const xpAds = (() => {
  // X localizes these labels. The network filter is language-independent; this
  // list covers the main UI languages and is easy to extend.
  const LABELS = new Set([
    "ad", "ads", "promoted", "promoted tweet", "sponsored",
    "anzeige", "gesponsert", "werbung",
    "publicidad", "promocionado", "patrocinado",
    "sponsorisé", "sponsorisée", "promu", "promue",
    "pubblicità", "sponsorizzato",
    "advertentie", "gesponsord",
    "annons", "annonse", "reclame",
    "reklama", "reklam",
    "mainos",
    "广告", "推广", "廣告", "推廣",
    "広告", "プロモーション",
    "광고", "홍보",
    "إعلان", "مُموَّل",
    "реклама", "продвигается",
    "sponsorlu",
    "được tài trợ", "quảng cáo",
  ]);

  const TREND_LABEL = /^(promoted|sponsored)\s+by\b/i;
  const text = (el) => (el.textContent || "").trim().toLowerCase();

  // Labels live in <span>s. Skip tweet bodies (including quoted tweets) and
  // profile-name links so a tweet saying "Ad" or a user named "Promoted" isn't
  // hidden.
  function hasLabel(root, allowTrendLabel) {
    for (const span of root.querySelectorAll("span")) {
      if (span.closest(XP_SEL.tweetText)) continue;
      const link = span.closest("a");
      // Name/handle links point at /<handle>; an "Ad" label link doesn't.
      if (link && span.closest(XP_SEL.userName) && /^\/[A-Za-z0-9_]+$/.test(link.getAttribute("href") || "")) continue;
      const value = text(span);
      if (LABELS.has(value) || (allowTrendLabel && TREND_LABEL.test(value))) return true;
    }
    return false;
  }

  function ariaLabelled(root) {
    const ids = (root.getAttribute("aria-labelledby") || "").split(/\s+/);
    for (const id of ids) {
      const node = id && document.getElementById(id);
      if (!node) continue;
      const value = text(node);
      if (value.length <= 40 && LABELS.has(value)) return true;
    }
    return false;
  }

  function mark(el) {
    el.setAttribute("data-xp-ad", "");
  }

  function tweet(article) {
    if (article.hasAttribute("data-xp-ad")) return;
    if (ariaLabelled(article) || hasLabel(article, false)) {
      mark(article.closest(XP_SEL.cellInner) || article);
    }
  }

  function module(row) {
    if (row.hasAttribute("data-xp-ad")) return;
    if (hasLabel(row, row.matches?.(XP_SEL.trend))) {
      mark(row.closest(XP_SEL.cellInner) || row);
    }
  }

  // Occasionally X renders a plain "Promoted Tweet" / "Ad" section heading.
  function heading(h2) {
    if (!LABELS.has(text(h2))) return;
    mark(h2.closest(XP_SEL.cellInner) || h2.parentElement?.parentElement || h2);
  }

  return { tweet, module, heading };
})();
