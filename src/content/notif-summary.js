// "Last 24 hours" summary panel at the top of the Notifications page.
// Data: notification events parsed from X's own responses (src/page/hook.js).

const xpNotifSummary = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const HOUR = 60 * 60 * 1000;
  const events = new Map(); // id -> event (deduped across pages / refetches)
  let panel = null;
  let collapsed = false;

  const KINDS = [
    { key: "like", label: "Likes", types: ["like"], unit: ["like", "likes"] },
    { key: "follow", label: "New followers", types: ["follow"], unit: ["follower", "followers"] },
    { key: "repost", label: "Reposts", types: ["repost"], unit: ["repost", "reposts"] },
    { key: "reply", label: "Mentions", types: ["reply", "mention"], unit: ["reply or mention", "replies & mentions"] },
  ];

  const ICONS = {
    like: '<path d="M12 20.5s-7.5-4.6-9.3-9.1C1.5 8.3 3.4 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5c3.2 0 5.1 3.3 3.9 6.4-1.8 4.5-9.3 9.1-9.3 9.1Z"/>',
    follow: '<circle cx="10" cy="8" r="3.6"/><path d="M3.5 19.5c.8-3.4 3.4-5.3 6.5-5.3s5.7 1.9 6.5 5.3M18.5 8v6M15.5 11h6"/>',
    repost: '<path d="M4.5 10V8.5A2.5 2.5 0 0 1 7 6h11l-3-3M19.5 14v1.5A2.5 2.5 0 0 1 17 18H6l3 3"/>',
    reply: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17h0A2.5 2.5 0 0 1 4 14.5v-8Z"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

  const fmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- Data -------------------------------------------------------------------
  function summarize() {
    const now = Date.now();
    const start = now - DAY;
    const recent = [...events.values()].filter((e) => e.ts >= start && e.ts <= now + 60000);
    const oldest = Math.min(...[...events.values()].map((e) => e.ts));

    const kinds = KINDS.map((k) => {
      const bars = new Array(24).fill(0);
      let total = 0;
      for (const e of recent) {
        if (!k.types.includes(e.type)) continue;
        total += e.count;
        const i = Math.min(23, Math.max(0, 23 - Math.floor((now - e.ts) / HOUR)));
        bars[i] += e.count;
      }
      return { ...k, total, bars };
    });

    // Top post: most likes + reposts on one of your posts
    const posts = new Map();
    for (const e of recent) {
      if ((e.type !== "like" && e.type !== "repost") || !e.target) continue;
      const p = posts.get(e.target.id) || { id: e.target.id, text: e.target.text, like: 0, repost: 0 };
      p[e.type] += e.count;
      posts.set(p.id, p);
    }
    const top = [...posts.values()].sort((a, b) => b.like + b.repost - (a.like + a.repost))[0] || null;

    // New followers: unique people we have details for
    const seen = new Set();
    const followers = [];
    for (const e of recent.filter((e) => e.type === "follow").sort((a, b) => b.ts - a.ts)) {
      for (const u of e.users) {
        if (!u?.handle || seen.has(u.handle)) continue;
        seen.add(u.handle);
        followers.push(u);
      }
    }

    // Busiest hour across everything
    const all = new Array(24).fill(0);
    kinds.forEach((k) => k.bars.forEach((v, i) => (all[i] += v)));
    const peak = all.some(Boolean) ? all.indexOf(Math.max(...all)) : -1;

    return {
      now, kinds, top, followers,
      followerTotal: kinds[1].total,
      total: kinds.reduce((s, k) => s + k.total, 0),
      peakStart: peak >= 0 ? now - (24 - peak) * HOUR : null,
      coverage: Number.isFinite(oldest) ? Math.min(DAY, now - oldest) : 0,
    };
  }

  // ---- Render -----------------------------------------------------------------
  function bars(k, now) {
    const max = Math.max(1, ...k.bars);
    return k.bars
      .map((v, i) => {
        const h = v ? Math.max(3, Math.round((v / max) * 100)) : 0;
        const at = now - (24 - i) * HOUR;
        const tip = `${hourFmt.format(at)} · ${v.toLocaleString()} ${k.unit[v === 1 ? 0 : 1]}`;
        return `<span class="xp-ns-bar" data-tip="${esc(tip)}"><i style="height:${h}%"></i></span>`;
      })
      .join("");
  }

  function render() {
    if (!panel) return;
    const s = summarize();
    panel.classList.toggle("xp-ns-collapsed", collapsed);
    panel.classList.toggle("xp-ns-empty", events.size === 0);

    const headline =
      events.size === 0
        ? "Loading your activity…"
        : s.total === 0
        ? "Quiet day. Nothing new in the last 24 hours."
        : `<b>${s.total.toLocaleString()}</b> interactions`;

    const peak = s.peakStart ? `Busiest around ${esc(hourFmt.format(s.peakStart))}` : "";

    const tiles = s.kinds
      .map(
        (k) => `
      <div class="xp-ns-tile" data-kind="${k.key}">
        <div class="xp-ns-tile-head">${icon(k.key)}<span>${k.label}</span></div>
        <div class="xp-ns-num">${fmt.format(k.total)}</div>
        <div class="xp-ns-spark" role="img" aria-label="${esc(k.label)} per hour, last 24 hours">${bars(k, s.now)}</div>
      </div>`
      )
      .join("");

    const top = s.top
      ? `<a class="xp-ns-card xp-ns-top" href="/i/web/status/${esc(s.top.id)}">
          <div class="xp-ns-card-label">Top post</div>
          <div class="xp-ns-top-text">${esc(s.top.text.replace(/https:\/\/t\.co\/\S+/g, "").trim() || "Your post")}</div>
          <div class="xp-ns-top-stats">
            <span data-kind="like">${icon("like")}${fmt.format(s.top.like)}</span>
            <span data-kind="repost">${icon("repost")}${fmt.format(s.top.repost)}</span>
          </div>
        </a>`
      : "";

    const shown = s.followers.slice(0, 6);
    const more = Math.max(0, s.followerTotal - shown.length);
    const names = shown.slice(0, 2).map((u) => esc(u.name || "@" + u.handle));
    const followerText =
      names.length === 0 ? "" :
      more > 0 ? `${names.join(", ")} and ${fmt.format(more)} more` :
      names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
    const followers = shown.length
      ? `<div class="xp-ns-card xp-ns-followers">
          <div class="xp-ns-card-label">New followers</div>
          <div class="xp-ns-faces">${shown
            .map((u) => `<a href="/${esc(u.handle)}" title="${esc(u.name || "")} @${esc(u.handle)}"><img src="${esc((u.avatar || "").replace("_normal.", "_bigger."))}" alt="" referrerpolicy="no-referrer"></a>`)
            .join("")}${more ? `<span class="xp-ns-more">+${fmt.format(more)}</span>` : ""}</div>
          <div class="xp-ns-follower-names">${followerText}</div>
        </div>`
      : "";

    const coverageH = Math.round(s.coverage / HOUR);
    const note =
      events.size && s.coverage < DAY - HOUR
        ? `Covers the last ${Math.max(1, coverageH)}h so far · scroll to load more`
        : events.size ? `From ${events.size} loaded notifications` : "";

    panel.innerHTML = `
      <div class="xp-ns-head">
        <div class="xp-ns-title">
          <span class="xp-ns-eyebrow">Last 24 hours</span>
          <span class="xp-ns-headline">${headline}</span>
        </div>
        <div class="xp-ns-meta">${peak ? `<span>${peak}</span>` : ""}
          <button class="xp-ns-toggle" aria-expanded="${!collapsed}" aria-label="${collapsed ? "Expand" : "Collapse"} summary">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>
          </button>
        </div>
      </div>
      <div class="xp-ns-body">
        <div class="xp-ns-tiles">${tiles}</div>
        ${top || followers ? `<div class="xp-ns-cards">${top}${followers}</div>` : ""}
        ${note ? `<div class="xp-ns-note">${note}</div>` : ""}
      </div>
      <div class="xp-ns-tip" hidden></div>`;
  }

  function build() {
    panel = document.createElement("section");
    panel.className = "xp-ns";
    panel.setAttribute("aria-label", "Notifications summary, last 24 hours");

    panel.addEventListener("click", (e) => {
      if (!e.target.closest(".xp-ns-toggle")) return;
      collapsed = !collapsed;
      try { chrome.storage.local.set({ xpNotifSummaryCollapsed: collapsed }); } catch {}
      render();
    });

    // One tooltip for all bars; the hit target is the whole column.
    panel.addEventListener("pointerover", (e) => {
      const bar = e.target.closest(".xp-ns-bar");
      const tip = panel.querySelector(".xp-ns-tip");
      if (!bar || !tip) return;
      tip.textContent = bar.dataset.tip;
      tip.hidden = false;
      const pr = panel.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const x = Math.min(Math.max(br.left + br.width / 2 - pr.left, 60), pr.width - 60);
      tip.style.left = `${x}px`;
      tip.style.top = `${br.top - pr.top - 6}px`;
      bar.closest(".xp-ns-tile")?.setAttribute("data-hover", "");
      bar.setAttribute("data-on", "");
    });
    panel.addEventListener("pointerout", (e) => {
      const bar = e.target.closest(".xp-ns-bar");
      if (!bar) return;
      bar.removeAttribute("data-on");
      bar.closest(".xp-ns-tile")?.removeAttribute("data-hover");
      const tip = panel.querySelector(".xp-ns-tip");
      if (tip) tip.hidden = true;
    });

    try {
      chrome.storage.local.get("xpNotifSummaryCollapsed", (v) => {
        collapsed = !!v?.xpNotifSummaryCollapsed;
        render();
      });
    } catch {}
    render();
  }

  // Keep the panel just above the notifications list while on that page.
  function ensure() {
    const onPage = /^\/notifications(\/|$)/.test(location.pathname);
    if (!onPage) { panel?.remove(); return; }
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

  // Keep relative times honest while the page stays open.
  setInterval(() => panel?.isConnected && render(), 5 * 60 * 1000);

  return { ensure };
})();
