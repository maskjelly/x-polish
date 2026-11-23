// Content script: applies settings as classes on <html> and tags tweets
// as they stream in, so CSS (and future JS features) can target them.
(() => {
  const root = document.documentElement;
  let settings = { ...XP_DEFAULTS };

  // Each setting becomes a class: xp-<key>  (e.g. xp-tweetCards)
  function applySettings() {
    for (const { key } of XP_SETTINGS) {
      root.classList.toggle(`xp-${key}`, settings.enabled && !!settings[key]);
    }
    root.classList.toggle("xp-on", !!settings.enabled);
  }

  // NOTE: never add classes to X's own elements. X's React code rewrites
  // their `class` attribute (e.g. on hover) and wipes ours. Use data-xp-*
  // attributes instead; classes are fine on <html> and on elements we create.

  // ---- Per-tweet processing ----------------------------------------------
  // Add tweet-level enhancements inside processTweet. It runs once per tweet.
  function processTweet(tweet) {
    if (tweet.dataset.xpDone) return;
    tweet.dataset.xpDone = "1";
    tweet.setAttribute("data-xp-tweet", "");

    // Mark promoted tweets (X labels them with an "Ad"/"Promoted" span)
    const isPromoted = [...tweet.querySelectorAll("span")].some(
      (s) => s.textContent === "Ad" || s.textContent === "Promoted"
    );
    if (isPromoted) tweet.closest(XP_SEL.cellInner)?.setAttribute("data-xp-promoted", "");

    if (tweet.querySelector(XP_SEL.media)) tweet.setAttribute("data-xp-media", "");

    xpApi.harvestAuthor(tweet);
  }

  // ---- Enhancers -------------------------------------------------------------
  // Each enhancer runs on every matching element as it appears. Each `run`
  // must be idempotent: X re-renders nodes and we may see them again.
  const ENHANCERS = [
    { selector: XP_SEL.tweet, run: processTweet },
    { selector: XP_SEL.cashtag, run: xpChips.cashtag },
    { selector: XP_SEL.mention, run: xpChips.mention },
  ];

  function scan(node = document) {
    if (node.nodeType !== 1 && node !== document) return;
    if (node.classList?.contains("xp-chip-inner") || node.classList?.contains("xp-orig")) return;
    for (const { selector, run } of ENHANCERS) {
      if (node.matches?.(selector)) run(node);
      node.querySelectorAll?.(selector).forEach(run);
    }
  }

  // X is a SPA with infinite scroll: watch for new nodes and batch per frame.
  let pending = new Set();
  let scheduled = false;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((n) => pending.add(n));
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const nodes = pending;
      pending = new Set();
      nodes.forEach((n) => n.isConnected && scan(n));
    });
  });

  function start() {
    scan();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---- Boot -----------------------------------------------------------------
  applySettings(); // defaults immediately to avoid a flash of unstyled X
  xpLoadSettings().then((s) => {
    settings = s;
    applySettings();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    applySettings();
  });

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
