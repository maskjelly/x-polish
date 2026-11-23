// Talks to X's own internal GraphQL API from the x.com tab, using the user's
// logged-in session (same-origin cookies + the ct0 CSRF cookie). These are the
// same requests x.com makes itself, e.g. for the cashtag hover card.
//
// Query ids come from X's web bundle and change when X ships a new client.
// If a request starts failing, update the id here (search the bundle for the
// operation name, e.g. "smartTagHoverCardQuery").

const xpX = (() => {
  const BEARER =
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

  const OPS = {
    assetQuote: { id: "foX3C6-uluC-QSwC7WsYBQ", name: "smartTagHoverCardQuery" },
  };

  // After repeated failures (stale query id, rate limit, logged out) stop
  // hitting X for this page load and let callers use their fallback.
  let failures = 0;
  let successes = 0;
  let disabled = false;
  const MAX_FAILURES = 3;

  function csrf() {
    return document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] || null;
  }

  async function query(op, variables) {
    if (disabled) return null;
    const token = csrf();
    if (!token) {
      disabled = true; // not logged in
      return null;
    }
    const url =
      `${location.origin}/i/api/graphql/${op.id}/${op.name}` +
      `?variables=${encodeURIComponent(JSON.stringify(variables))}`;
    try {
      const res = await fetch(url, {
        credentials: "include",
        headers: {
          authorization: `Bearer ${BEARER}`,
          "x-csrf-token": token,
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-active-user": "yes",
          "content-type": "application/json",
        },
      });
      if (res.status === 429) throw new Error("rate limited");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      successes++;
      return json.data ?? null;
    } catch (err) {
      failures++;
      if (err.message === "rate limited" || (successes === 0 && failures >= MAX_FAILURES)) {
        disabled = true;
        console.info("[X Polish] X API unavailable, using fallback:", err.message);
      }
      return null;
    }
  }

  const money = (m) => (m ? Number(m.units || 0) + (m.nanos || 0) / 1e9 : null);

  // Same shape as the background (Yahoo) quote, plus logo/marketCap/exchange.
  async function quote(ticker) {
    const data = await query(OPS.assetQuote, { assetSymbol: ticker });
    const a = data?.finance_asset_data?.asset;
    const price = money(a?.quote?.price);
    if (!a || price == null || !Number.isFinite(price)) return null;
    return {
      source: "x",
      symbol: a.ticker || ticker,
      name: a.name || ticker,
      price,
      changePct: typeof a.quote.change_24h_percent === "number" ? a.quote.change_24h_percent : null,
      currency: a.quote.price.currency_code || a.stock?.currency || "USD",
      marketCap: money(a.quote.market_cap),
      exchange: a.stock?.exchange_short_name || (a.crypto ? "Crypto" : null),
      logo: a.logo_url || null,
    };
  }

  return { quote };
})();
