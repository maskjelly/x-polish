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

  // The signed-in user's id, from X's "twid" cookie (u=<id>).
  function viewerId() {
    const m = document.cookie.match(/(?:^|;\s*)twid=([^;]+)/);
    return m ? (decodeURIComponent(m[1]).match(/u=(\d+)/) || [])[1] || null : null;
  }

  // Only the real notification feeds. Excludes e.g. /2/notifications/device_follow.json
  // (posts from accounts you turned on post notifications for), badge counts, etc.
  function notifFeed(url) {
    if (/device_follow|badge_count|last_seen/i.test(url)) return null;
    let m = /\/2\/notifications\/(all|mentions|verified)\b/i.exec(url);
    if (m) return m[1].toLowerCase();
    m = /\/graphql\/[^/?]+\/(Notifications[A-Za-z]*)/.exec(url);
    if (m && !/device/i.test(m[1])) return /mention/i.test(m[1]) ? "mentions" : /verified/i.test(m[1]) ? "verified" : "all";
    return null;
  }

  // A post only counts as a mention/reply if it is addressed to you.
  function aboutMe(legacy, authorId, me, feed) {
    if (!me) return feed === "mentions";
    if (authorId === me) return false;
    if (legacy.in_reply_to_user_id_str === me) return true;
    return (legacy.entities?.user_mentions || []).some((u) => u.id_str === me);
  }

  function parseNotifications(json, feed) {
    const me = viewerId();
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
          if (!t || !aboutMe(t, t.user_id_str, me, feed)) continue;
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
        const authorId = t?.legacy.user_id_str || null;
        if (t && aboutMe(t.legacy, authorId, me, feed)) {
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
      const feed = notifFeed(url || "");
      if (feed) {
        const events = parseNotifications(json, feed).filter((e) => Number.isFinite(e.ts));
        noteNotifPage(json, events, url, feed);
        if (events.length) window.postMessage({ source: "xp-hook", type: "notifications", events }, location.origin);
        const byType = events.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + e.count), a), {});
        console.debug("[X Polish] notifications", feed, byType);
      }
    } catch {}
  }

  // ---- Backfill: load older notification pages until we cover 24 hours --------
  // Replays X's own "All notifications" request with the bottom cursor, like
  // scrolling the list. Falls back to the classic v2 endpoint if X served the
  // page from memory and we never saw a request to copy.
  const DAY = 24 * 60 * 60 * 1000;
  const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  let template = null;   // { url, headers } of X's last "all" request
  let bottomCursor = null;
  let oldestTs = Infinity;
  let backfilling = false;

  function findBottomCursor(json) {
    const stack = [json];
    let guard = 0;
    while (stack.length && guard++ < 100000) {
      const o = stack.pop();
      if (!o || typeof o !== "object") continue;
      if (typeof o.entryId === "string" && /^cursor-bottom/.test(o.entryId)) {
        return o.content?.value || o.content?.operation?.cursor?.value || o.content?.itemContent?.value || null;
      }
      for (const k in o) { const v = o[k]; if (v && typeof v === "object") stack.push(v); }
    }
    return null;
  }

  function noteNotifPage(json, events, url, feed) {
    if (feed !== "all") return;
    const pageOldest = events.length ? Math.min(...events.map((e) => e.ts)) : Infinity;
    const cursor = findBottomCursor(json);
    // The bottom cursor that reaches furthest back is the one to continue from.
    if (cursor && (pageOldest <= oldestTs || !bottomCursor)) bottomCursor = cursor;
    oldestTs = Math.min(oldestTs, pageOldest);
  }

  function rememberTemplate(url, headers) {
    if (notifFeed(url) !== "all") return;
    template = { url: new URL(url, location.href).href, headers: { ...headers } };
  }

  function pageUrl(cursor) {
    if (template) {
      const u = new URL(template.url);
      const vars = u.searchParams.get("variables");
      if (vars) {
        const v = JSON.parse(vars);
        if (cursor) v.cursor = cursor; else delete v.cursor;
        u.searchParams.set("variables", JSON.stringify(v));
      } else if (cursor) u.searchParams.set("cursor", cursor);
      else u.searchParams.delete("cursor");
      return u.href;
    }
    const u = new URL("/i/api/2/notifications/all.json", location.origin);
    u.searchParams.set("count", "40");
    u.searchParams.set("tweet_mode", "extended");
    u.searchParams.set("include_entities", "true");
    if (cursor) u.searchParams.set("cursor", cursor);
    return u.href;
  }

  function pageHeaders(withTransactionId) {
    const csrf = (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1];
    const h = template ? { ...template.headers } : {
      authorization: `Bearer ${BEARER}`,
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-active-user": "yes",
    };
    if (csrf) h["x-csrf-token"] = csrf;
    if (!withTransactionId) for (const k of Object.keys(h)) if (/transaction-id/i.test(k)) delete h[k];
    return h;
  }

  async function getPage(cursor) {
    const url = pageUrl(cursor);
    for (const withTid of [true, false]) {
      const res = await origFetch(url, { credentials: "include", headers: pageHeaders(withTid) });
      if (res.ok) return { json: await res.json(), url };
      if (res.status === 429) throw new Error("rate limited");
    }
    throw new Error("request refused");
  }

  async function backfill() {
    if (backfilling) return;
    backfilling = true;
    const status = (state, extra) => window.postMessage({ source: "xp-hook", type: "notif-backfill", state, ...extra }, location.origin);
    status("running");
    let pages = 0;
    try {
      while (pages < 8 && oldestTs > Date.now() - DAY) {
        const before = bottomCursor;
        // No cursor yet: X showed the list from memory, so load the first page ourselves.
        const { json, url } = await getPage(pages === 0 && !before ? null : before);
        pages++;
        publish(json, url);
        if (bottomCursor === before && before) break; // no further pages
      }
      status("done", { pages });
    } catch (err) {
      console.debug("[X Polish] notifications backfill stopped:", err.message);
      status("done", { pages, error: err.message });
    } finally {
      backfilling = false;
    }
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "xp-cs") return;
    if (e.data.type === "notif-backfill") backfill();
  });

  // fetch (new client)
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (notifFeed(url) === "all") {
        const h = {};
        new Headers(init?.headers || (typeof input === "object" ? input.headers : undefined)).forEach((v, k) => (h[k] = v));
        rememberTemplate(url, h);
      }
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
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__xpHeaders) this.__xpHeaders[String(k).toLowerCase()] = v; } catch {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (API.test(String(url))) {
        const u = String(url);
        if (notifFeed(u) === "all") {
          this.__xpHeaders = {};
          this.addEventListener("loadstart", () => rememberTemplate(u, this.__xpHeaders));
        }
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
