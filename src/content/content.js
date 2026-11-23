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

  // X has light / dim / lights-out themes. Expose dark vs light on <html>
  // as xp-dark so badges can use matching colors.
  function detectTheme() {
    if (!document.body) return;
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!m) return;
    const [r, g, b, a = 1] = m.map(Number);
    if (a === 0) return; // not painted yet
    root.classList.toggle("xp-dark", 0.2126 * r + 0.7152 * g + 0.0722 * b < 128);
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

    if (tweet.querySelector(XP_SEL.media)) tweet.setAttribute("data-xp-media", "");

    xpAds.tweet(tweet);
    xpApi.harvestAuthor(tweet);
  }

  // ---- Enhancers -------------------------------------------------------------
  // Each enhancer runs on every matching element as it appears. Each `run`
  // must be idempotent: X re-renders nodes and we may see them again.
  const ENHANCERS = [
    { selector: XP_SEL.tweet, run: processTweet },
    { selector: XP_SEL.adRows, run: xpAds.module },
    { selector: "h2", run: xpAds.heading },
    { selector: XP_SEL.cashtag, run: xpChips.cashtag },
    { selector: XP_SEL.mention, run: xpChips.mention },
    { selector: XP_SEL.hoverCard, run: xpHoverCard.mark },
    { selector: XP_SEL.sidebarSection, run: xpSurfaces.sidebarPanel },
    { selector: XP_SEL.composerToolbar, run: xpSurfaces.composer },
    { selector: XP_SEL.notification, run: xpSurfaces.notification },
    { selector: xpPeople.AVATAR, run: xpPeople.avatar },
    { selector: XP_SEL.tweet, run: xpPeople.tweet },
    { selector: XP_SEL.tweet, run: xpPaid.tweet },
    { selector: XP_SEL.tweet, run: xpShare.tweet },
    { selector: XP_SEL.tweet, run: xpRatio.tweet },
    { selector: XP_SEL.tweet, run: xpAccounts.tweet },
    { selector: XP_SEL.profileName, run: xpAccounts.profile },
    { selector: XP_SEL.tweet, run: xpShield.tweet },
    { selector: XP_SEL.profileName, run: xpPeople.profileHeader },
  ];

  function scan(node = document) {
    if (node.nodeType !== 1 && node !== document) return;
    if (node.classList?.contains("xp-chip-inner") || node.classList?.contains("xp-orig")) return;
    for (const { selector, run } of ENHANCERS) {
      if (node.matches?.(selector)) run(node);
      node.querySelectorAll?.(selector).forEach(run);
    }
    // X may add the "Ad" label after the tweet/row itself is in the DOM.
    const tweet = node.closest?.(XP_SEL.tweet);
    if (tweet) xpAds.tweet(tweet);
    const row = node.closest?.(XP_SEL.adRows);
    if (row) xpAds.module(row);
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
      xpSurfaces.updateRoute(); // SPA navigation shows up as DOM changes
      xpNotifSummary.ensure();
      const nodes = pending;
      pending = new Set();
      nodes.forEach((n) => n.isConnected && scan(n));
    });
  });

  function start() {
    detectTheme();
    xpSurfaces.updateRoute();
    // X switches theme by restyling <body>; re-check when that happens.
    new MutationObserver(detectTheme).observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
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
