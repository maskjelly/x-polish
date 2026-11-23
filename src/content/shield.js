// Spoiler shield: posts that mention a word or phrase from the user's list
// (chrome.storage.sync "shieldWords") have their body blurred behind a small
// "Hidden · matches “word” · Show" bar. The author header and action bar stay
// visible. Show reveals that post for the rest of the browser session.
//
// JS always marks matching posts; CSS (:root.xp-spoilerShield) decides whether
// the blur and bar are shown, so the setting toggles instantly.

const xpShield = (() => {
  const KEY = "shieldWords";
  const REVEALED_KEY = "xpShieldRevealed";
  const BODY = [
    '[data-testid="tweetText"]',
    '[data-testid="tweetPhoto"]',
    '[data-testid="videoPlayer"]',
    '[data-testid="videoComponent"]',
    '[data-testid="card.wrapper"]',
  ].join(", ");

  let matchers = []; // [{ word, re }]

  // ---- Revealed posts (per browser session) -------------------------------------
  const revealed = new Set();
  try {
    for (const id of JSON.parse(sessionStorage.getItem(REVEALED_KEY) || "[]")) revealed.add(id);
  } catch {}
  function remember(id) {
    revealed.add(id);
    try { sessionStorage.setItem(REVEALED_KEY, JSON.stringify([...revealed].slice(-500))); } catch {}
  }

  // ---- Matching ----------------------------------------------------------------------
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const EDGE_BEFORE = "(?<![\\p{L}\\p{N}_])";
  const EDGE_AFTER = "(?![\\p{L}\\p{N}_])";

  // Single words also match as #word / $word; "#word" or "$word" match exactly;
  // phrases match with any whitespace between their words. Always whole words.
  function compile(word) {
    const w = word.trim();
    if (!w) return null;
    let body;
    if (/^[#$]/.test(w)) body = esc(w);
    else if (/\s/.test(w)) body = w.split(/\s+/).map(esc).join("\\s+");
    else body = `[#$]?${esc(w)}`;
    try {
      return { word: w, re: new RegExp(`${EDGE_BEFORE}${body}${EDGE_AFTER}`, "iu") };
    } catch {
      return null;
    }
  }

  // Text of the post as written: our badge overlays are left out, X's original
  // link text (kept inside .xp-orig) stays in.
  function textOf(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".xp-chip-inner").forEach((n) => n.remove());
    return clone.textContent || "";
  }

  function postText(article) {
    const parts = [];
    article.querySelectorAll('[data-testid="tweetText"]').forEach((t) => parts.push(textOf(t)));
    article.querySelectorAll('[data-testid="card.wrapper"]').forEach((c) => parts.push(c.textContent || ""));
    return parts.join("\n");
  }

  function firstMatch(article) {
    if (!matchers.length) return null;
    const text = postText(article);
    if (!text) return null;
    for (const m of matchers) if (m.re.test(text)) return m.word;
    return null;
  }

  function statusId(article) {
    const link = article.querySelector('a[href*="/status/"] time')?.closest("a");
    const m = /\/status\/(\d+)/.exec(link?.getAttribute("href") || "");
    return m ? m[1] : null;
  }

  // ---- Apply / clear ------------------------------------------------------------------
  function clear(article) {
    article.querySelectorAll(".xp-shield-bar").forEach((b) => b.closest("article") === article && b.remove());
    article.querySelectorAll("[data-xp-shield-blur]").forEach((el) => {
      if (el.closest("article") !== article) return;
      el.removeAttribute("data-xp-shield-blur");
      el.removeAttribute("aria-hidden");
    });
    article.removeAttribute("data-xp-shielded");
  }

  function bar(word, id, article) {
    const el = document.createElement("div");
    el.className = "xp-shield-bar";
    el.setAttribute("role", "note");
    el.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 8.6 4.3 9.6 6.2a1.7 1.7 0 0 1 0 1.6 15 15 0 0 1-3.1 3.9M6.3 6.4A15.2 15.2 0 0 0 2.4 11.2a1.7 1.7 0 0 0 0 1.6C3.4 14.7 7 19 12 19a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
      <span class="xp-shield-text">Hidden · matches <b></b></span>
      <button type="button" class="xp-shield-show">Show</button>`;
    el.querySelector("b").textContent = `“${word}”`;
    const btn = el.querySelector("button");
    btn.setAttribute("aria-label", `Show post hidden for “${word}”`);
    // Clicks / keys inside a post open it or trigger X shortcuts; keep ours local.
    const stop = (e) => { e.stopPropagation(); };
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (id) remember(id);
      article.setAttribute("data-xp-shield-revealed", "");
      clear(article);
    });
    btn.addEventListener("keydown", stop);
    btn.addEventListener("pointerdown", stop);
    btn.addEventListener("mousedown", stop);
    el.addEventListener("click", stop);
    return el;
  }

  function tweet(article) {
    if (!article?.isConnected) return;
    // Never touch our own UI (e.g. a post preview inside the share-image modal).
    if (article.closest("[data-xp-ui], .xp-share-modal, .xp-share")) return;

    const id = statusId(article);
    const word = id && revealed.has(id) ? null : firstMatch(article);
    if (article.getAttribute("data-xp-shielded") === word) return; // unchanged
    clear(article);
    if (!word) return;

    // Quoted posts are inside the same <article>, so they are covered too.
    const targets = [...article.querySelectorAll(BODY)].filter((el) => el.closest("article") === article);
    if (!targets.length) return;
    for (const el of targets) {
      el.setAttribute("data-xp-shield-blur", "");
      el.setAttribute("aria-hidden", "true");
    }
    article.setAttribute("data-xp-shielded", word);
    const first = targets[0];
    first.parentElement.insertBefore(bar(word, id, article), first);
  }

  function refreshAll() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
      a.removeAttribute("data-xp-shielded"); // force re-evaluation
      clear(a);
      tweet(a);
    });
  }

  function setWords(list) {
    matchers = (Array.isArray(list) ? list : []).map(compile).filter(Boolean);
    refreshAll();
  }

  try {
    chrome.storage.sync.get({ [KEY]: [] }, (v) => setWords(v?.[KEY]));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[KEY]) setWords(changes[KEY].newValue);
    });
  } catch {}

  return { tweet };
})();
