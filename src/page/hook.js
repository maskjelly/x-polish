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

  // ---- Notifications --------------------------------------------------------
  // Normalises both X formats (classic v2 "globalObjects" and GraphQL
  // NotificationsTimeline) into compact events:
  //   { id, type: like|repost|follow|reply|mention|other, ts, count,
  //     users: [{ handle, name, avatar }], target: { id, text } | null }
  const ICON_TYPE = { heart_icon: "like", retweet_icon: "repost", person_icon: "follow" };

  function actorCount(text, shown) {
    const m = /and ([\d,.]+)([KkMm]?) others?/.exec(text || "");
    if (!m) return Math.max(shown, 1);
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (/k/i.test(m[2])) n *= 1e3;
    if (/m/i.test(m[2])) n *= 1e6;
    const named = (text.slice(0, m.index).match(/,/g) || []).length + 1;
    return Math.round(n) + named;
  }

  function gqlUser(r) {
    const u = r?.user_results?.result || r?.result || r;
    if (!u || u.__typename !== "User") return null;
    return {
      handle: u.core?.screen_name || u.legacy?.screen_name,
      name: u.core?.name || u.legacy?.name,
      avatar: u.avatar?.image_url || u.legacy?.profile_image_url_https,
    };
  }

  function gqlTweet(r) {
    const t = r?.tweet_results?.result || r?.result || r;
    const tw = t?.tweet || t; // TweetWithVisibilityResults
    if (!tw?.legacy) return null;
    return { id: tw.rest_id || tw.legacy.id_str, text: tw.legacy.full_text || "", legacy: tw.legacy, user: gqlUser(tw.core) };
  }

  function parseNotifications(json) {
    const events = [];
    // Classic v2
    const g = json?.globalObjects;
    if (g?.notifications) {
      const users = g.users || {};
      const tweets = g.tweets || {};
      const U = (id) => {
        const u = users[id];
        return u ? { handle: u.screen_name, name: u.name, avatar: u.profile_image_url_https } : null;
      };
      for (const n of Object.values(g.notifications)) {
        const agg = n.template?.aggregateUserActionsV1 || {};
        const from = (agg.fromUsers || []).map((f) => U(f.user?.id)).filter(Boolean);
        const tid = agg.targetObjects?.[0]?.tweet?.id;
        events.push({
          id: "n" + n.id,
          type: ICON_TYPE[n.icon?.id] || "other",
          ts: Number(n.timestampMs),
          count: actorCount(n.message?.text, from.length),
          users: from.slice(0, 8),
          target: tid && tweets[tid] ? { id: tid, text: tweets[tid].full_text || tweets[tid].text || "" } : null,
        });
      }
      // Mentions / replies arrive as tweet entries
      for (const ins of json.timeline?.instructions || []) {
        for (const e of ins.addEntries?.entries || []) {
          const tid = e.content?.item?.content?.tweet?.id;
          const t = tid && tweets[tid];
          if (!t) continue;
          events.push({
            id: "t" + tid,
            type: t.in_reply_to_status_id_str ? "reply" : "mention",
            ts: Date.parse(t.created_at),
            count: 1,
            users: [U(t.user_id_str)].filter(Boolean),
            target: { id: tid, text: t.full_text || t.text || "" },
          });
        }
      }
      return events;
    }

    // GraphQL: walk for timeline items
    const stack = [json];
    let guard = 0;
    while (stack.length && guard++ < 200000) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) { for (const v of o) stack.push(v); continue; }
      if (o.itemType === "TimelineNotification") {
        const from = (o.template?.from_users || []).map(gqlUser).filter(Boolean);
        const target = gqlTweet(o.template?.target_objects?.[0]);
        events.push({
          id: "n" + o.id,
          type: ICON_TYPE[o.notification_icon] || "other",
          ts: Number(o.timestamp_ms),
          count: actorCount(o.rich_message?.text, from.length),
          users: from.slice(0, 8),
          target: target ? { id: target.id, text: target.text } : null,
        });
        continue;
      }
      if (o.itemType === "TimelineTweet") {
        const t = gqlTweet(o.tweet_results);
        if (t) {
          events.push({
            id: "t" + t.id,
            type: t.legacy.in_reply_to_status_id_str ? "reply" : "mention",
            ts: Date.parse(t.legacy.created_at),
            count: 1,
            users: [t.user].filter(Boolean),
            target: { id: t.id, text: t.text },
          });
        }
        continue;
      }
      for (const k in o) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
    }
    return events;
  }

  function publish(json, url) {
    try {
      const users = collect(json);
      if (Object.keys(users).length) window.postMessage({ source: "xp-hook", type: "relations", users }, location.origin);
    } catch {}
    try {
      if (/notifications/i.test(url)) {
        const events = parseNotifications(json).filter((e) => Number.isFinite(e.ts));
        if (events.length) window.postMessage({ source: "xp-hook", type: "notifications", events }, location.origin);
      }
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
          if ((res.headers.get("content-type") || "").includes("json")) res.clone().json().then((j) => publish(j, url), () => {});
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
        const u = String(url);
        this.addEventListener("load", function () {
          try {
            if (this.responseType === "json") publish(this.response, u);
            else if (this.responseType === "" || this.responseType === "text") {
              const t = this.responseText;
              if (t && (t[0] === "{" || t[0] === "[")) publish(JSON.parse(t), u);
            }
          } catch {}
        });
      }
    } catch {}
    return origOpen.apply(this, arguments);
  };
})();
