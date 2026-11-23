// "Follows you" / "You follow" badges under tweet authors.
// Relationship data comes from X's own API responses (see src/page/hook.js).

const xpRelations = (() => {
  const rel = new Map(); // lowercase handle -> { following, followedBy }

  function authorHandle(userName) {
    const tweet = userName.closest(XP_SEL.tweet);
    const avatar = tweet?.querySelector('[data-testid^="UserAvatar-Container-"]');
    if (avatar) return avatar.dataset.testid.slice("UserAvatar-Container-".length);
    const link = userName.querySelector('a[href^="/"]');
    return link?.getAttribute("href").slice(1).split("/")[0] || null;
  }

  function label(r) {
    if (r.followedBy && r.following) return "Follows you · You follow";
    if (r.followedBy) return "Follows you";
    if (r.following) return "You follow";
    return null;
  }

  // Runs on each tweet's User-Name block (header with name + handle).
  function badge(userName) {
    // Only the tweet's own header, not quoted tweets inside it.
    const tweet = userName.closest(XP_SEL.tweet);
    if (!tweet || tweet.querySelector(XP_SEL.userName) !== userName) return;

    const handle = authorHandle(userName);
    const r = handle && rel.get(handle.toLowerCase());
    const text = r && label(r);
    let el = userName.querySelector(":scope > .xp-rel");

    if (!text) { el?.remove(); return; }
    if (el?.textContent === text) return;
    if (!el) {
      // Full-width line (forces a wrap below the name) holding the pill.
      el = document.createElement("span");
      el.className = "xp-rel";
      el.appendChild(document.createElement("span")).className = "xp-rel-pill";
      userName.appendChild(el);
    }
    el.firstChild.textContent = text;
    el.dataset.kind = r.followedBy ? "follows-you" : "you-follow";
    userName.setAttribute("data-xp-has-rel", "");
  }

  function refreshAll() {
    document.querySelectorAll(`${XP_SEL.tweet} ${XP_SEL.userName}`).forEach(badge);
  }

  let refreshQueued = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "xp-hook" || e.data.type !== "relations") return;
    for (const [h, r] of Object.entries(e.data.users || {})) rel.set(h, r);
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; refreshAll(); });
  });

  return { badge };
})();
