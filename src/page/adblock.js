// Page-world ad filter for X (Twitter).
//
// Promoted tweets, trends and users come from x.com's own GraphQL API mixed
// into normal timeline payloads, so blocking domains can't remove them. This
// wraps fetch/XHR before X's bundle loads and drops entries that carry X's ad
// markers; everything else passes through untouched.
//
// Runs in the MAIN world (see manifest.json), where there is no chrome.*
// access. The "Block ads" toggle is mirrored by content.js as the xp-blockAds
// class on <html>; when that class is absent this script does nothing.

(() => {
  const ON_CLASS = "xp-blockAds";
  const MAX_DEPTH = 12;    // X's payloads are deep but finite
  const MAX_VISITS = 8000; // cap the marker search on huge entries

  const isOn = () => !!document.documentElement?.classList.contains(ON_CLASS);

  function urlOf(input) {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input?.url;
  }

  function isApiCall(url) {
    if (!url) return false;
    try {
      const u = new URL(url, location.href);
      return /(^|\.)(x|twitter)\.com$/.test(u.hostname) && u.pathname.startsWith("/i/api/");
    } catch {
      return false;
    }
  }

  const isJson = (res) => (res.headers?.get("content-type") || "").includes("json");

  // ---- Detecting promoted data ---------------------------------------------
  // X marks ads in a few different ways depending on the payload:
  //  - entryId starts with "promoted" (e.g. promoted-tweet-123)
  //  - a promotedMetadata object is attached to the tweet / trend / user
  //  - __typename is "PromotedTweet"
  function hasMarker(node, depth, budget) {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return false;
    if (++budget.n > MAX_VISITS) return false;
    if (Array.isArray(node)) {
      for (const value of node) if (hasMarker(value, depth + 1, budget)) return true;
      return false;
    }
    if (node.__typename === "PromotedTweet" || node.promotedMetadata) return true;
    for (const value of Object.values(node)) {
      if (hasMarker(value, depth + 1, budget)) return true;
    }
    return false;
  }

  function isPromoted(entry) {
    if (!entry || typeof entry !== "object") return false;
    const id = entry.entryId ?? entry.entry_id;
    if (typeof id === "string" && /^promoted/i.test(id)) return true;
    return hasMarker(entry, 0, { n: 0 });
  }

  // ---- Filtering ------------------------------------------------------------
  let removed = 0;

  function cleanEntries(entries) {
    const kept = [];
    for (const entry of entries) {
      if (isPromoted(entry)) {
        removed++;
        continue;
      }
      // Modules (e.g. a row of suggested users) need their items filtered too.
      const items = entry?.content?.items;
      if (Array.isArray(items)) {
        const filtered = items.filter((item) => !isPromoted(item?.item ?? item));
        removed += items.length - filtered.length;
        if (items.length > 0 && filtered.length === 0) continue; // module was all ads
        entry.content.items = filtered;
      }
      kept.push(entry);
    }
    return kept;
  }

  const ENTRY_KEYS = new Set(["entries", "moduleItems"]);

  // X nests instructions differently per endpoint, so walk generically and
  // filter every array that holds timeline entries or module items.
  function walk(node, depth) {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      for (const value of node) walk(value, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value) && ENTRY_KEYS.has(key)) {
        const filtered = cleanEntries(value);
        if (filtered.length !== value.length) node[key] = filtered;
        walk(filtered, depth + 1);
      } else {
        walk(value, depth + 1);
      }
    }
  }

  function filterAds(data) {
    removed = 0;
    walk(data, 0);
    return removed;
  }

  // ---- fetch ------------------------------------------------------------------
  function rebuild(response, data) {
    const headers = new Headers(response.headers);
    // The body is re-serialized, so these no longer describe it.
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    const filtered = new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    try {
      Object.defineProperty(filtered, "url", { value: response.url });
    } catch {}
    return filtered;
  }

  function installFetch() {
    const nativeFetch = window.fetch;
    if (typeof nativeFetch !== "function") return;

    window.fetch = async function (input, init) {
      const response = await nativeFetch.call(this, input, init);
      try {
        if (!isOn() || !isApiCall(urlOf(input)) || !isJson(response)) return response;
        const data = await response.clone().json();
        if (!filterAds(data)) return response;
        return rebuild(response, data);
      } catch {
        return response; // never break X over a parsing/filtering hiccup
      }
    };
  }

  // ---- XMLHttpRequest (X mostly uses fetch; this is cheap insurance) ---------
  function override(xhr, key, value) {
    try {
      Object.defineProperty(xhr, key, { configurable: true, get: () => value });
    } catch {}
  }

  function installXhr() {
    const proto = XMLHttpRequest.prototype;
    const nativeOpen = proto.open;

    proto.open = function (method, url) {
      const href = typeof url === "string" ? url : String(url);
      if (isApiCall(href)) {
        // Registered during open(), before X attaches its own handlers, so
        // this listener runs first and can replace the response.
        this.addEventListener("readystatechange", function () {
          const xhr = this;
          if (xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300 || !isOn()) return;
          try {
            if (xhr.responseType === "json") {
              const data = xhr.response;
              if (!data || !filterAds(data)) return;
              override(xhr, "response", data);
            } else if (xhr.responseType === "" || xhr.responseType === "text") {
              const data = JSON.parse(xhr.responseText);
              if (!filterAds(data)) return;
              const text = JSON.stringify(data);
              override(xhr, "responseText", text);
              if (xhr.responseType === "") override(xhr, "response", text);
            }
          } catch {}
        });
      }
      return nativeOpen.apply(this, arguments);
    };
  }

  installFetch();
  installXhr();
})();
