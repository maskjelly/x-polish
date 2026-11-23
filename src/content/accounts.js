// Account age & bot signals.
//   - Posts: a small "New · 12d" tag after the author's handle for accounts
//     younger than 30 days, or a muted "Possible bot" tag when several strong
//     signals stack up (never for verified accounts).
//   - Profile pages: one compact line under the name, e.g.
//     "Joined 3y 2m ago · 2.1 posts/day · 1.2 followers per following".
// Data: public account facts from X's own API responses (src/page/hook.js).

const xpAccounts = (() => {
  const DAY = 24 * 60 * 60 * 1000;
  const NEW_DAYS = 30;
  const BOT_MAX_DAYS = 90;
  const accounts = new Map(); // handle(lower) -> facts

  const AVATAR = '[data-testid^="UserAvatar-Container-"]';
  const num1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

  function ageDays(a) {
    return Math.max(0, Math.floor((Date.now() - a.createdAt) / DAY));
  }

  // "3y 2m", "5m", "12d"
  function ageText(days) {
    if (days < 31) return `${days}d`;
    const months = Math.floor(days / 30.44);
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (!y) return `${m}m`;
    return m ? `${y}y ${m}m` : `${y}y`;
  }

  function postsPerDay(a, days) {
    if (a.posts == null) return null;
    return a.posts / Math.max(1, days);
  }

  const fmtRate = (n) => (n >= 1000 ? compact.format(n) : n >= 10 ? Math.round(n).toLocaleString() : num1.format(n));

  // Returns the reasons when strong signals stack, else null.
  function botReasons(a, days) {
    if (a.verified || days >= BOT_MAX_DAYS || !a.defaultAvatar) return null;
    const reasons = [`Account is ${ageText(days)} old`, "Default profile photo"];
    const ppd = postsPerDay(a, days);
    const heavyPoster = ppd != null && ppd > 50;
    const followSpam = a.following != null && a.followers != null && a.following > 500 && a.following > 10 * a.followers;
    if (!heavyPoster && !followSpam) return null;
    if (heavyPoster) reasons.push(`${fmtRate(ppd)} posts per day`);
    if (followSpam) reasons.push(`Follows ${compact.format(a.following)}, followed by ${compact.format(a.followers)}`);
    return reasons;
  }

  // ---- Posts ------------------------------------------------------------------
  function tweet(article) {
    const avatar = article.querySelector(AVATAR);
    const header = article.querySelector(XP_SEL.userName);
    if (!avatar || !header || header.closest(XP_SEL.tweet) !== article) return;
    const handle = avatar.dataset.testid.slice("UserAvatar-Container-".length);
    const a = accounts.get(handle.toLowerCase());

    let tag = header.querySelector(":scope > .xp-acct-tag");
    let text = null, kind = null, title = null;
    if (a) {
      const days = ageDays(a);
      const bot = botReasons(a, days);
      if (bot) {
        text = "Possible bot";
        kind = "bot";
        title = `Possible bot account:\n• ${bot.join("\n• ")}`;
      } else if (days < NEW_DAYS) {
        text = `New · ${days}d`;
        kind = "new";
        title = `New account: created ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`;
      }
    }

    if (!text) { tag?.remove(); return; }
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "xp-acct-tag";
      // Right after X's own name/handle, before our other additions
      // (e.g. the label button), so the tag hugs the handle.
      header.insertBefore(tag, header.querySelector(":scope > .xp-label-btn"));
    }
    if (tag.textContent !== text) tag.textContent = text;
    tag.dataset.kind = kind;
    tag.title = title;
  }

  // ---- Profile page --------------------------------------------------------------
  function profile(el) {
    const handle = location.pathname.split("/")[1];
    let line = el.querySelector(":scope > .xp-acct-line");
    const a = handle && accounts.get(handle.toLowerCase());
    if (!a) { line?.remove(); return; }

    const days = ageDays(a);
    const parts = [];
    const joined = new Date(a.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    parts.push({ text: `Joined ${ageText(days)} ago`, title: `Account created ${joined}` });
    const ppd = postsPerDay(a, days);
    if (ppd != null) {
      parts.push({ text: `${fmtRate(ppd)} posts/day`, title: `${a.posts.toLocaleString()} posts over ${days.toLocaleString()} days` });
    }
    if (a.followers != null && a.following != null) {
      const ratio = a.following ? a.followers / a.following : null;
      parts.push(
        ratio == null
          ? { text: "Follows no one", title: `${a.followers.toLocaleString()} followers, following 0` }
          : { text: `${fmtRate(ratio)} followers per following`, title: `${a.followers.toLocaleString()} followers · following ${a.following.toLocaleString()}` }
      );
    }
    const bot = botReasons(a, days);

    const key = JSON.stringify([parts, bot]);
    if (line?.dataset.key === key) return;
    if (!line) {
      line = document.createElement("div");
      line.className = "xp-acct-line";
      // Facts first, then our label row (if present).
      el.insertBefore(line, el.querySelector(":scope > .xp-profile-row"));
    }
    line.dataset.key = key;
    line.textContent = "";
    parts.forEach((p, i) => {
      if (i) line.appendChild(document.createElement("span")).className = "xp-acct-sep";
      const s = line.appendChild(document.createElement("span"));
      s.textContent = p.text;
      s.title = p.title;
    });
    if (bot) {
      const t = line.appendChild(document.createElement("span"));
      t.className = "xp-acct-tag";
      t.dataset.kind = "bot";
      t.textContent = "Possible bot";
      t.title = `Possible bot account:\n• ${bot.join("\n• ")}`;
    }
  }

  // ---- Data ------------------------------------------------------------------------
  let queued = false;
  function refresh() {
    queued = false;
    document.querySelectorAll(XP_SEL.tweet).forEach(tweet);
    document.querySelectorAll(XP_SEL.profileName).forEach(profile);
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "xp-hook" || e.data.type !== "accounts") return;
    for (const [h, a] of Object.entries(e.data.accounts || {})) {
      if (a && Number.isFinite(a.createdAt)) accounts.set(h, a);
    }
    if (!queued) {
      queued = true;
      requestAnimationFrame(refresh);
    }
  });

  return { tweet, profile };
})();
