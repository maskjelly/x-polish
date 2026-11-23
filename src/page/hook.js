// Runs in the page's own JS world (manifest "world": "MAIN").
// Reads X's own API responses (never modifies them) and pulls out the
// viewer's relationship with each user: `following` (you follow them) and
// `followed_by` (they follow you). Sends a compact map to the content script.
(() => {
  const API = /\/(i\/api\/)?graphql\/|\/i\/api\/|api\.x\.com\/|api\.twitter\.com\//;

  function collect(json) {
    const out = {};
    const stack = [json];
    let guard = 0;
    while (stack.length && guard++ < 200000) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) {
        for (const v of o) stack.push(v);
        continue;
      }
      if (o.__typename === "User") {
        const handle = o.core?.screen_name || o.legacy?.screen_name;
        const rp = o.relationship_perspectives || {};
        const following = rp.following ?? o.legacy?.following;
        const followedBy = rp.followed_by ?? o.legacy?.followed_by;
        if (handle && (typeof following === "boolean" || typeof followedBy === "boolean")) {
          out[handle.toLowerCase()] = { following: !!following, followedBy: !!followedBy };
        }
      }
      for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return out;
  }

  function publish(json) {
    try {
      const users = collect(json);
      if (Object.keys(users).length) window.postMessage({ source: "xp-hook", type: "relations", users }, location.origin);
    } catch {}
  }

  // fetch (new client)
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (API.test(url)) {
        p.then((res) => {
          if ((res.headers.get("content-type") || "").includes("json")) res.clone().json().then(publish, () => {});
        }, () => {});
      }
    } catch {}
    return p;
  };

  // XMLHttpRequest (classic client)
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (API.test(String(url))) {
        this.addEventListener("load", function () {
          try {
            if (this.responseType === "json") publish(this.response);
            else if (this.responseType === "" || this.responseType === "text") {
              const t = this.responseText;
              if (t && (t[0] === "{" || t[0] === "[")) publish(JSON.parse(t));
            }
          } catch {}
        });
      }
    } catch {}
    return origOpen.apply(this, arguments);
  };
})();
