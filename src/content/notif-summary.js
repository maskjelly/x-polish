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
  const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
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
      const i = Math.min(23, Math.max(0, 23 - Math.floor((now - e.ts) / HOUR)));
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

  const hourStart = (m, i) => m.now - (24 - i) * HOUR;

  // ---- Render pieces -------------------------------------------------------------
  function tilesHtml(m) {
    return KINDS.map(
      (k) => `
      <div class="xp-ns-tile" data-kind="${k.key}">
        <div class="xp-ns-tile-label">${icon(k.key)}<span>${k.label}</span></div>
        <div class="xp-ns-num">${compact.format(m.totals[k.key])}</div>
      </div>`
    ).join("");
  }

  function chartHtml(m) {
    const max = Math.max(1, ...m.hourTotals);
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
            <span data-kind="like">${icon("like")}${compact.format(m.top.like)}</span>
            <span data-kind="repost">${icon("repost")}${compact.format(m.top.repost)}</span>
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
            .map((u) => `<a href="/${esc(u.handle)}" title="${esc(u.name)} @${esc(u.handle)}"><img src="${esc((u.avatar || "").replace("_normal.", "_bigger."))}" alt="${esc(u.name || u.handle)}" referrerpolicy="no-referrer"></a>`)
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
    const note = m.coverage < DAY - HOUR
      ? `Based on the last ${hours}h loaded so far. Scroll the list to load more.`
      : `Based on ${m.loaded.toLocaleString()} loaded notifications.`;

    panel.innerHTML = `
      <header class="xp-ns-head">
        <div class="xp-ns-title">
          <span class="xp-ns-eyebrow">Last 24 hours</span>
          <span class="xp-ns-headline">${headline}</span>
        </div>
        <div class="xp-ns-actions">
          ${m.total ? peak : ""}
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

  // Keep the panel directly above the notifications list while on that page.
  function ensure() {
    if (!/^\/notifications(\/|$)/.test(location.pathname)) { panel?.remove(); return; }
    const list = document.querySelector('[data-testid="primaryColumn"] section[role="region"]');
    if (!list?.parentElement) return;
    if (!panel) build();
    if (panel.nextElementSibling !== list) list.parentElement.insertBefore(panel, list);
  }

  let queued = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "xp-hook" || e.data.type !== "notifications") return;
    for (const ev of e.data.events || []) events.set(ev.id, ev);
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; ensure(); render(); });
  });

  // Keep the "last 24h" window honest while the page stays open.
  setInterval(() => panel?.isConnected && render(), 5 * 60 * 1000);

  return { ensure };
})();
