// Background service worker: does all network requests for the content script
// (x.com's CSP blocks third-party fetches/images from the page) and caches them.

const TTL = {
  quote: 60 * 1000,             // prices: 1 minute
  profile: 6 * 60 * 60 * 1000,  // profiles: 6 hours
  logo: 7 * 24 * 60 * 60 * 1000 // logos: 7 days
};

const memory = new Map();
const inflight = new Map();

// Cache helper. Loader returning null = "not found" (cached). Throwing = network error (not cached).
async function cached(key, ttl, persist, load) {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && now - hit.t < ttl) return hit.v;

  if (persist) {
    const stored = (await chrome.storage.local.get(key))[key];
    if (stored && now - stored.t < ttl) {
      memory.set(key, stored);
      return stored.v;
    }
  }

  if (inflight.has(key)) return inflight.get(key);
  const p = load()
    .then((v) => {
      const entry = { t: Date.now(), v };
      memory.set(key, entry);
      if (persist) chrome.storage.local.set({ [key]: entry });
      return v;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---- Quotes (Yahoo Finance) -------------------------------------------------
async function yahoo(symbol) {
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const meta = (await res.json()).chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") return null;
  return {
    symbol: meta.symbol,
    name: meta.shortName || meta.longName || symbol,
    price: meta.regularMarketPrice,
    changePct: typeof meta.regularMarketChangePercent === "number" ? meta.regularMarketChangePercent : null,
    currency: meta.currency || "USD",
    type: meta.instrumentType || null,
  };
}

// Try as a stock/ETF first, then as crypto ($BTC -> BTC-USD).
async function loadQuote(ticker) {
  return (await yahoo(ticker)) || (await yahoo(`${ticker}-USD`));
}

// ---- Logos (financialmodelingprep, returned as data: URLs) -----------------
async function toDataUrl(res) {
  const type = res.headers.get("content-type") || "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(bin)}`;
}

async function loadLogo(symbol) {
  const file = symbol.replace(/[^A-Z0-9.]/gi, ""); // BTC-USD -> BTCUSD
  const res = await fetch(`https://financialmodelingprep.com/image-stock/${file}.png`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`logo ${res.status}`);
  return toDataUrl(res);
}

// ---- Profiles (fxtwitter public API) ----------------------------------------
async function loadProfile(handle) {
  const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`profile ${res.status}`);
  const u = (await res.json().catch(() => null))?.user;
  if (!u) return null;
  return {
    handle: u.screen_name,
    name: u.name,
    avatar: u.avatar_url ? u.avatar_url.replace("_normal.", "_bigger.") : null,
    verified: u.verification?.verified ? u.verification.type || "individual" : null,
  };
}

// ---- Messaging --------------------------------------------------------------
const HANDLERS = {
  quote: (t) => cached(`q:${t}`, TTL.quote, false, () => loadQuote(t)),
  logo: (s) => cached(`l:${s}`, TTL.logo, true, () => loadLogo(s)),
  profile: (h) => cached(`p:${h}`, TTL.profile, true, () => loadProfile(h)),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler || typeof msg.key !== "string") return false;
  handler(msg.key).then(sendResponse, () => sendResponse(null));
  return true; // async response
});
