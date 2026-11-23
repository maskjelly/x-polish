// Content-side data layer: asks the background worker for data, dedupes
// requests per page, and harvests profiles already visible on the page.

const xpApi = (() => {
  const memo = new Map(); // "type:key" -> { t, p }
  const MEMO_TTL = { quote: 60 * 1000, logo: Infinity, profile: Infinity };

  function request(type, key) {
    const id = `${type}:${key}`;
    const hit = memo.get(id);
    if (hit && Date.now() - hit.t < MEMO_TTL[type]) return hit.p;
    const p = new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, key }, (res) => {
          void chrome.runtime.lastError; // extension reloaded / no response
          resolve(res ?? null);
        });
      } catch {
        resolve(null); // extension context invalidated after a reload
      }
    });
    memo.set(id, { t: Date.now(), p });
    return p;
  }

  // Profiles of tweet authors are already in the DOM: reuse them for free.
  const domProfiles = new Map(); // lowercase handle -> profile

  function harvestAuthor(tweet) {
    const avatarBox = tweet.querySelector('[data-testid^="UserAvatar-Container-"]');
    const nameBox = tweet.querySelector(XP_SEL.userName);
    if (!avatarBox || !nameBox) return;
    const handle = avatarBox.dataset.testid.slice("UserAvatar-Container-".length);
    const key = handle.toLowerCase();
    if (!handle || domProfiles.has(key)) return;

    const avatar = avatarBox.querySelector("img")?.src;
    const name = nameBox.querySelector("a")?.textContent?.trim();
    if (!avatar || !name) return;

    const icon = nameBox.querySelector('[data-testid="icon-verified"]');
    let verified = null;
    if (icon) {
      if (icon.querySelector("linearGradient")) verified = "business";
      else {
        const fill = getComputedStyle(icon).color + getComputedStyle(icon).fill;
        verified = /130,\s*154,\s*171/.test(fill) ? "government" : "individual";
      }
    }
    domProfiles.set(key, { handle, name, avatar: avatar.replace("_normal.", "_bigger."), verified });
  }

  async function profile(handle) {
    return domProfiles.get(handle.toLowerCase()) || request("profile", handle);
  }

  // Prices: X's own data first (same as its hover cards), Yahoo as fallback.
  const quoteMemo = new Map(); // ticker -> { t, p }
  function quote(ticker) {
    const hit = quoteMemo.get(ticker);
    if (hit && Date.now() - hit.t < MEMO_TTL.quote) return hit.p;
    const p = xpX.quote(ticker).then((q) => q || request("quote", ticker));
    quoteMemo.set(ticker, { t: Date.now(), p });
    return p;
  }

  return {
    quote,
    logo: (symbol) => request("logo", symbol),
    profile,
    harvestAuthor,
  };
})();
