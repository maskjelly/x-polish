// "Last 24 hours" summary panel at the top of the Notifications page.
// Data: notification events parsed from X's own responses (src/page/hook.js).
//
// Layout: header (total + peak hour) -> four metric tiles (they double as the
// chart legend) -> one stacked hourly activity chart -> top post / new
// followers -> coverage note. The panel only appears once real data exists.

const xpNotifSummary = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const events = new Map(); // id -> event, deduped across pages / refetches
  let panel = null;
  let collapsed = false;
  let model = null; // last computed summary, used by the tooltip
  // Loading older pages (see backfill in src/page/hook.js)
  const fill = { running: false, done: false, error: null, lastAsk: 0 };

  // Fixed order: also the stacking order (bottom -> top) and legend order.
  const KINDS = [
    { key: "like", label: "Likes", types: ["like"], one: "like", many: "likes" },
    { key: "follow", label: "Followers", types: ["follow"], one: "follower", many: "followers" },
    { key: "repost", label: "Reposts", types: ["repost"], one: "repost", many: "reposts" },
    { key: "reply", label: "Mentions", types: ["reply", "mention"], one: "mention", many: "mentions" },
  ];

  const ICONS = {
    like: '<path d="M12 20.5s-7.5-4.6-9.3-9.1C1.5 8.3 3.4 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5c3.2 0 5.1 3.3 3.9 6.4-1.8 4.5-9.3 9.1-9.3 9.1Z"/>',
    follow: '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 19.5c.8-3.4 3.4-5.3 6.5-5.3s5.7 1.9 6.5 5.3M18.5 8v6M15.5 11h6"/>',
    repost: '<path d="M4.5 10V8.5A2.5 2.5 0 0 1 7 6h11l-3-3M19.5 14v1.5A2.5 2.5 0 0 1 17 18H6l3 3"/>',
    reply: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5v-8Z"/>',
    chevron: '<path d="M6 9.5l6 6 6-6"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  // Clock-hour labels: "10 PM" where people use 12-hour time, "22:00" otherwise.
  const uses24h = /h2[34]/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle || "");
  const hourFmt = new Intl.DateTimeFormat(undefined, uses24h ? { hour: "2-digit", minute: "2-digit" } : { hour: "numeric" });
  const floorHour = (t) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };
  const plural = (n, k) => `${n.toLocaleString()} ${n === 1 ? k.one : k.many}`;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- Data -------------------------------------------------------------------
  function summarize() {
    const now = Date.now();
    const start = now - DAY;
    const all = [...events.values()];
    const recent = all.filter((e) => e.ts >= start && e.ts <= now + 60_000);

    // hours[i][kind] for i = 0 (24h ago) .. 23 (this hour)
    const hours = Array.from({ length: 24 }, () => ({ like: 0, follow: 0, repost: 0, reply: 0 }));
    const totals = { like: 0, follow: 0, repost: 0, reply: 0 };
    for (const e of recent) {
      const kind = KINDS.find((k) => k.types.includes(e.type));
      if (!kind) continue;
      const i = Math.min(23, Math.max(0, 23 - Math.round((floorHour(now) - floorHour(e.ts)) / HOUR)));
      hours[i][kind.key] += e.count;
      totals[kind.key] += e.count;
    }
    const hourTotals = hours.map((h) => h.like + h.follow + h.repost + h.reply);
    const total = hourTotals.reduce((a, b) => a + b, 0);
    const peak = total ? hourTotals.indexOf(Math.max(...hourTotals)) : -1;

    // Top post: most likes + reposts on one of your posts
    const posts = new Map();
    for (const e of recent) {
      if ((e.type !== "like" && e.type !== "repost") || !e.target) continue;
      const p = posts.get(e.target.id) || { id: e.target.id, text: e.target.text, like: 0, repost: 0 };
      p[e.type] += e.count;
      posts.set(p.id, p);
    }
    const top = [...posts.values()].sort((a, b) => b.like + b.repost - (a.like + a.repost))[0] || null;

    // New followers we have details for, newest first
    const seen = new Set();
    const followers = [];
    for (const e of recent.filter((e) => e.type === "follow").sort((a, b) => b.ts - a.ts)) {
      for (const u of e.users || []) {
        if (!u?.handle || seen.has(u.handle)) continue;
        seen.add(u.handle);
        followers.push(u);
      }
    }

    const oldest = all.length ? Math.min(...all.map((e) => e.ts)) : now;
    return {
      now, hours, hourTotals, totals, total, peak, top, followers,
      coverage: Math.min(DAY, now - oldest),
      loaded: all.length,
    };
  }

  const hourStart = (m, i) => floorHour(m.now) - (23 - i) * HOUR;

  // ---- Render pieces -------------------------------------------------------------
  function tilesHtml(m) {
    return KINDS.map(
      (k) => `
      <div class="xp-ns-tile" data-kind="${k.key}"${m.totals[k.key] ? "" : " data-zero"}>
        <div class="xp-ns-tile-label">${icon(k.key)}<span>${k.label}</span></div>
        <div class="xp-ns-num">${compact.format(m.totals[k.key])}</div>
      </div>`
    ).join("");
  }

  function chartHtml(m) {
    // Floor of 5 so a single like on a quiet day doesn't fill the chart.
    const max = Math.max(5, ...m.hourTotals);
    const cols = m.hours
      .map((h, i) => {
        const segs = KINDS.filter((k) => h[k.key] > 0)
          .map((k) => {
            // Proportional height; a non-zero value never drops below 3px so
            // small categories stay visible (exact values are in the tooltip).
            const pct = (h[k.key] / max) * 100;
            return `<i data-kind="${k.key}" style="height:max(3px, ${pct.toFixed(2)}%)"></i>`;
          })
          .join("");
        return `<span class="xp-ns-col" data-i="${i}">${segs}</span>`;
      })
      .join("");

    const ticks = [0, 6, 12, 18, 24]
      .map((i) => {
        const label = i === 24 ? "Now" : i === 0 ? "24h ago" : `${24 - i}h`;
        return `<span style="left:${(i / 24) * 100}%">${label}</span>`;
      })
      .join("");

    const parts = KINDS.filter((k) => m.totals[k.key]).map((k) => plural(m.totals[k.key], k));
    const aria = `Activity per hour over the last 24 hours: ${parts.join(", ")}.`;
    return `
      <div class="xp-ns-chart" role="img" aria-label="${esc(aria)}">
        <div class="xp-ns-plot">${cols}</div>
        <div class="xp-ns-axis">${ticks}</div>
      </div>`;
  }

  function cardsHtml(m) {
    const top = m.top
      ? `<a class="xp-ns-card xp-ns-top" href="/i/web/status/${esc(m.top.id)}">
          <span class="xp-ns-card-label">Top post</span>
          <span class="xp-ns-top-text">${esc(m.top.text.replace(/https:\/\/t\.co\/\S+/g, "").trim() || "Your post")}</span>
          <span class="xp-ns-top-stats">
            ${m.top.like ? `<span data-kind="like">${icon("like")}${compact.format(m.top.like)}</span>` : ""}
            ${m.top.repost ? `<span data-kind="repost">${icon("repost")}${compact.format(m.top.repost)}</span>` : ""}
          </span>
        </a>`
      : "";

    const shown = m.followers.slice(0, 5);
    const more = Math.max(0, m.totals.follow - shown.length);
    let names = "";
    if (shown.length) {
      const n = shown.slice(0, 2).map((u) => `<b>${esc(u.name || "@" + u.handle)}</b>`);
      names = more > 0 ? `${n.join(", ")} and ${compact.format(more)} more`
        : n.length === 2 ? `${n[0]} and ${n[1]}` : n[0];
    }
    const followers = shown.length
      ? `<div class="xp-ns-card xp-ns-followers">
          <span class="xp-ns-card-label">New followers</span>
          <span class="xp-ns-faces">${shown
            .map((u) => {
              const initial = esc((u.name || u.handle || "?").trim().charAt(0).toUpperCase());
              const face = u.avatar
                ? `<img src="${esc(u.avatar.replace("_normal.", "_bigger."))}" alt="" data-initial="${initial}" referrerpolicy="no-referrer">`
                : `<span class="xp-ns-face-letter" aria-hidden="true">${initial}</span>`;
              return `<a href="/${esc(u.handle)}" title="${esc(u.name || "")} @${esc(u.handle)}" aria-label="${esc(u.name || u.handle)}">${face}</a>`;
            })
            .join("")}${more ? `<span class="xp-ns-more">+${compact.format(more)}</span>` : ""}</span>
          <span class="xp-ns-follower-names">${names}</span>
        </div>`
      : "";

    if (!top && !followers) return "";
    return `<div class="xp-ns-cards${top && followers ? "" : " xp-ns-cards-single"}">${top}${followers}</div>`;
  }

  function render() {
    if (!panel) return;
    const m = (model = summarize());
    panel.hidden = m.loaded === 0; // no data yet: show nothing rather than a stuck loader
    panel.classList.toggle("xp-ns-collapsed", collapsed);
    panel.classList.toggle("xp-ns-quiet", m.total === 0);

    const peak = m.peak >= 0
      ? `<span class="xp-ns-peak">Peak ${esc(hourFmt.format(hourStart(m, m.peak)))}</span>`
      : "";
    const headline = m.total
      ? `<span class="xp-ns-total">${m.total.toLocaleString()}</span> interactions`
      : "Quiet day. Nothing new in the last 24 hours.";

    const hours = Math.max(1, Math.round(m.coverage / HOUR));
    const full = m.coverage >= DAY - HOUR;
    const note = fill.running
      ? `<span class="xp-ns-spinner" aria-hidden="true"></span>Loading earlier activity…`
      : full
      ? `Covers the full 24 hours · ${m.loaded.toLocaleString()} notifications`
      : fill.error
      ? `Covers the last ${hours}h. Couldn't load older notifications (${esc(fill.error)}).`
      : fill.done
      ? `Covers the last ${hours}h. X returned no older notifications.`
      : `Covers the last ${hours}h so far.`;

    panel.innerHTML = `
      <header class="xp-ns-head">
        <div class="xp-ns-title">
          <span class="xp-ns-eyebrow">Last 24 hours</span>
          <span class="xp-ns-headline">${headline}</span>
        </div>
        <div class="xp-ns-actions">
          ${m.total ? peak : ""}
          ${m.total ? `<button type="button" class="xp-ns-share" aria-label="Share as image" title="Share as image"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10.5" r="1.8"/><path d="M20.5 15.5l-4.6-4.6L7 19"/></svg></button>` : ""}
          ${m.total ? `<button type="button" class="xp-ns-toggle" aria-expanded="${!collapsed}" aria-label="${collapsed ? "Show" : "Hide"} details">${icon("chevron")}</button>` : ""}
        </div>
      </header>
      ${m.total ? `
      <div class="xp-ns-body">
        <div class="xp-ns-tiles">${tilesHtml(m)}</div>
        ${chartHtml(m)}
        ${cardsHtml(m)}
        <p class="xp-ns-note">${note}</p>
      </div>` : ""}
      <div class="xp-ns-tip" role="tooltip" hidden></div>`;

    panel.querySelectorAll(".xp-ns-faces img").forEach((img) => {
      img.addEventListener("error", () => {
        const letter = document.createElement("span");
        letter.className = "xp-ns-face-letter";
        letter.setAttribute("aria-hidden", "true");
        letter.textContent = img.dataset.initial || "?";
        img.replaceWith(letter);
      }, { once: true });
    });
  }

  // ---- Tooltip -------------------------------------------------------------------
  function showTip(col) {
    const tip = panel.querySelector(".xp-ns-tip");
    if (!tip || !model) return;
    const i = Number(col.dataset.i);
    const h = model.hours[i];
    const from = hourStart(model, i);
    const rows = KINDS.filter((k) => h[k.key])
      .map((k) => `<span class="xp-ns-tip-row" data-kind="${k.key}"><i></i>${esc(k.label)}<b>${h[k.key].toLocaleString()}</b></span>`)
      .join("");
    tip.innerHTML = `<span class="xp-ns-tip-time">${esc(hourFmt.format(from))} – ${esc(hourFmt.format(from + HOUR))}</span>${rows || '<span class="xp-ns-tip-empty">No activity</span>'}`;
    tip.hidden = false;

    const pr = panel.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    const plot = col.parentElement.getBoundingClientRect();
    const half = tip.offsetWidth / 2;
    const x = Math.min(Math.max(cr.left + cr.width / 2 - pr.left, half + 8), pr.width - half - 8);
    tip.style.left = `${x}px`;
    tip.style.top = `${plot.top - pr.top - 8}px`;
    panel.querySelector(".xp-ns-plot")?.setAttribute("data-hover", "");
    col.setAttribute("data-on", "");
  }

  function hideTip() {
    panel.querySelector(".xp-ns-tip")?.setAttribute("hidden", "");
    panel.querySelector(".xp-ns-plot")?.removeAttribute("data-hover");
    panel.querySelectorAll(".xp-ns-col[data-on]").forEach((c) => c.removeAttribute("data-on"));
  }

  function build() {
    panel = document.createElement("section");
    panel.className = "xp-ns";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Notifications summary, last 24 hours");

    panel.addEventListener("click", (e) => {
      const share = e.target.closest(".xp-ns-share");
      if (share && model) {
        xpShare.summary({ ...model, peakLabel: model.peak >= 0 ? hourFmt.format(hourStart(model, model.peak)) : null }, share);
        return;
      }
      if (!e.target.closest(".xp-ns-toggle")) return;
      collapsed = !collapsed;
      try { chrome.storage.local.set({ xpNotifSummaryCollapsed: collapsed }); } catch {}
      render();
    });
    panel.addEventListener("pointermove", (e) => {
      const col = e.target.closest?.(".xp-ns-col");
      if (!col) return hideTip();
      if (!col.hasAttribute("data-on")) { hideTip(); showTip(col); }
    });
    panel.addEventListener("pointerleave", hideTip);

    try {
      chrome.storage.local.get("xpNotifSummaryCollapsed", (v) => {
        collapsed = !!v?.xpNotifSummaryCollapsed;
        render();
      });
    } catch {}
    render();
  }

  // ---- Local cache ----------------------------------------------------------------
  // Events are kept in chrome.storage.local per account, so opening the page
  // shows the summary at once and only the gap since the last visit is loaded.
  const KEEP = 26 * HOUR;
  const MAX_STORED = 2000;
  const viewer = (document.cookie.match(/(?:^|;\s*)twid=([^;]+)/) || [])[1];
  const storeKey = `xpNotifEvents:${viewer ? decodeURIComponent(viewer).replace(/\D/g, "") : "anon"}`;
  let hydrated = false;
  let storedNewest = null; // newest event we had before this page session
  let sessionOldest = Infinity; // oldest event X delivered during this session

  function hydrate() {
    try {
      chrome.storage.local.get(storeKey, (v) => {
        const cutoff = Date.now() - KEEP;
        for (const ev of v?.[storeKey] || []) {
          if (ev.ts >= cutoff && !events.has(ev.id)) events.set(ev.id, ev);
        }
        storedNewest = events.size ? Math.max(...[...events.values()].map((e) => e.ts)) : null;
        hydrated = true;
        ensure();
        render();
      });
    } catch {
      hydrated = true;
    }
  }

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const cutoff = Date.now() - KEEP;
      const keep = [...events.values()].filter((e) => e.ts >= cutoff).sort((a, b) => b.ts - a.ts).slice(0, MAX_STORED);
      try { chrome.storage.local.set({ [storeKey]: keep }); } catch {}
    }, 1000);
  }

  // Load only what's missing:
  //  - nothing stored: page back until the last 24h are covered
  //  - stored data: page back only until we reach the newest stored event,
  //    and not at all if X's own first page already reaches it
  let pageSeenAt = 0;
  let recheck = 0;
  function maybeBackfill() {
    if (!hydrated || fill.running || Date.now() - fill.lastAsk < 60_000) return;
    // Give X's own first load a chance before deciding anything; if it shows
    // the list from memory and loads nothing, decide after 3 seconds.
    if (sessionOldest === Infinity && Date.now() - pageSeenAt < 3000) {
      clearTimeout(recheck);
      recheck = setTimeout(maybeBackfill, 3000 - (Date.now() - pageSeenAt));
      return;
    }
    const dayAgo = Date.now() - DAY;
    let until;
    if (storedNewest && storedNewest > dayAgo) {
      if (sessionOldest <= storedNewest) return; // gap already closed by X's own load
      until = storedNewest;
    } else {
      const oldest = events.size ? Math.min(...[...events.values()].map((e) => e.ts)) : Infinity;
      if (oldest <= dayAgo + HOUR) return;
      until = dayAgo;
    }
    fill.lastAsk = Date.now();
    window.postMessage({ source: "xp-cs", type: "notif-backfill", until }, location.origin);
  }

  // Keep the panel directly above the notifications list while on that page.
  function ensure() {
    if (!/^\/notifications(\/|$)/.test(location.pathname)) { panel?.remove(); pageSeenAt = 0; return; }
    if (!pageSeenAt) pageSeenAt = Date.now();
    const list = document.querySelector('[data-testid="primaryColumn"] section[role="region"]');
    if (!list?.parentElement) return;
    if (!panel) build();
    if (panel.nextElementSibling !== list) list.parentElement.insertBefore(panel, list);
    maybeBackfill();
  }

  let queued = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "xp-hook") return;
    if (e.data.type === "notif-backfill") {
      fill.running = e.data.state === "running";
      fill.done = e.data.state === "done";
      fill.error = e.data.error || null;
      render();
      return;
    }
    if (e.data.type !== "notifications") return;
    for (const ev of e.data.events || []) {
      events.set(ev.id, ev);
      sessionOldest = Math.min(sessionOldest, ev.ts);
    }
    persist();
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; ensure(); render(); });
  });

  // Keep the "last 24h" window honest while the page stays open.
  setInterval(() => panel?.isConnected && render(), 5 * 60 * 1000);

  hydrate();

  return { ensure };
})();
