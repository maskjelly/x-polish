// Marks people so you can recognise them while scrolling:
//   - ring around their avatar: gold = you follow them, green = they follow
//     you, both rings = mutual; or the colour of your own label for them
//   - a small tag attached under the ring ("Follows you" or your label text)
//   - a faint tint on their tweets in the same colour
//   - a label button on tweets and profiles to set your own colour + tag
//
// Relationship flags come from X's own API responses (src/page/hook.js).

const xpPeople = (() => {
  const rel = new Map();    // handle(lower) -> { following, followedBy }
  let labels = new Map();   // handle(lower) -> { handle, color, text }

  const AVATAR = '[data-testid^="UserAvatar-Container-"]';
  const handleOfAvatar = (el) => el.dataset.testid.slice("UserAvatar-Container-".length);

  // What to show for a person, or null.
  function lookFor(handle) {
    if (!handle) return null;
    const h = handle.toLowerCase();
    const l = labels.get(h);
    if (l) return { ring: `c-${l.color}`, tag: l.text || null, tagKind: `c-${l.color}` };
    const r = rel.get(h);
    if (!r) return null;
    if (r.following && r.followedBy) return { ring: "mutual", tag: "Mutual", tagKind: "mutual" };
    if (r.followedBy) return { ring: "followed", tag: "Follows you", tagKind: "followed" };
    if (r.following) return { ring: "following", tag: "Following", tagKind: "following" };
    return null;
  }

  function setAttr(el, name, value) {
    if (value == null) el.removeAttribute(name);
    else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  // ---- Avatars everywhere (tweets, hover cards, sidebar, notifications) -----
  // The ring is drawn INSIDE the element that gives the photo its shape
  // (rounded + clipped for people, clip-path square for organisations), so
  // it follows the real shape and can't be cut off by X's surrounding layout.
  function shapeOf(container) {
    if (container.__xpShape?.isConnected) return container.__xpShape;
    let found = null;
    const walk = (el, depth) => {
      if (found || depth > 6) return;
      for (const child of el.children) {
        const cs = getComputedStyle(child);
        const clips = cs.overflow === "hidden" || cs.clipPath !== "none";
        if (clips && (parseFloat(cs.borderTopLeftRadius) > 0 || cs.clipPath !== "none")) {
          found = child;
          return;
        }
        walk(child, depth + 1);
      }
    };
    walk(container, 0);
    container.__xpShape = found;
    return found;
  }

  // Ring weight follows the photo size: xs <= 24px, s <= 36px, l >= 80px.
  function sizeClass(px) {
    if (!px) return null;
    if (px <= 24) return "xs";
    if (px <= 36) return "s";
    if (px >= 80) return "l";
    return null;
  }

  function avatar(el) {
    const look = lookFor(handleOfAvatar(el));
    setAttr(el, "data-xp-ring", look?.ring ?? null);
    if (!look) return;
    setAttr(el, "data-xp-avsize", sizeClass(el.offsetWidth));
    const shape = shapeOf(el);
    if (shape && !shape.hasAttribute("data-xp-avshape")) xpDom.mark(shape, "avshape");
  }

  // ---- Tweets: tag under the avatar, tint, label button ---------------------
  function tweet(article) {
    const avatarEl = article.querySelector(AVATAR);
    if (!avatarEl) return;
    const handle = handleOfAvatar(avatarEl);
    const look = lookFor(handle);

    setAttr(article, "data-xp-hl", look?.ring ?? null);

    // Tag hangs off the bottom of the ring
    const col = article.querySelector('[data-testid="Tweet-User-Avatar"]') || avatarEl.parentElement;
    let tag = col.querySelector(":scope > .xp-ptag");
    if (look?.tag) {
      if (!tag) {
        if (getComputedStyle(col).position === "static") col.setAttribute("data-xp-pos", "");
        tag = document.createElement("span");
        tag.className = "xp-ptag";
        col.appendChild(tag);
      }
      if (tag.textContent !== look.tag) tag.textContent = look.tag;
      tag.dataset.kind = look.tagKind;
      // Hang the tag off the photo's real bottom edge (sizes vary by layout).
      // Layout offsets, not screen rects, so page zoom/scaling can't shift it.
      const bottom = offsetWithin(avatarEl, col);
      if (bottom != null) tag.style.setProperty("--xp-tag-top", `${bottom - 7}px`);
    } else {
      tag?.remove();
    }

    // Label button in the header (shown on hover)
    const header = article.querySelector(XP_SEL.userName);
    if (header) {
      const btn = header.querySelector(":scope > .xp-label-btn") || header.appendChild(labelButton(handle));
      syncButton(btn, handle);
    }
  }

  // Bottom edge of `el` measured from the top of `ancestor` (a positioned box).
  function offsetWithin(el, ancestor) {
    if (!el.offsetHeight) return null;
    let y = 0;
    for (let n = el; n && n !== ancestor; n = n.offsetParent) {
      if (!ancestor.contains(n)) return null;
      y += n.offsetTop;
    }
    return y + el.offsetHeight;
  }

  // An already-labelled person: the button wears the label colour and says so.
  function syncButton(btn, handle) {
    const l = labels.get(handle.toLowerCase());
    setAttr(btn, "data-labelled", l ? "" : null);
    setAttr(btn, "data-xp-hl", l ? `c-${l.color}` : null);
    const name = l ? "Edit label" : "Label this person";
    btn.setAttribute("aria-label", name);
    btn.title = name;
    const text = btn.querySelector("span");
    if (text) text.textContent = l ? "Edit label" : "Label";
  }

  // ---- Profile page header: tag + label button next to the name -------------
  function profileHeader(el) {
    const handle = location.pathname.split("/")[1];
    if (!handle) return;
    let row = el.querySelector(":scope > .xp-profile-row");
    if (!row) {
      row = document.createElement("div");
      row.className = "xp-profile-row";
      row.append(document.createElement("span"), labelButton(handle, true));
      row.firstChild.className = "xp-ptag xp-ptag-inline";
      el.appendChild(row);
    }
    const btn = row.querySelector(".xp-label-btn");
    btn.dataset.handle = handle;
    syncButton(btn, handle);
    const look = lookFor(handle);
    const tag = row.firstChild;
    tag.hidden = !look?.tag;
    tag.textContent = look?.tag || "";
    tag.dataset.kind = look?.tagKind || "";
    setAttr(row, "data-xp-ring", look?.ring ?? null);
  }

  // ---- Label button + editor ---------------------------------------------------
  const TAG_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12.6V4.5C3 3.67 3.67 3 4.5 3h8.1c.4 0 .78.16 1.06.44l7.4 7.4a1.5 1.5 0 0 1 0 2.12l-8.1 8.1a1.5 1.5 0 0 1-2.12 0l-7.4-7.4A1.5 1.5 0 0 1 3 12.6Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>';

  function labelButton(handle, withText = false) {
    const b = document.createElement("span");
    b.className = "xp-label-btn" + (withText ? " xp-label-btn-text" : "");
    b.setAttribute("role", "button");
    b.setAttribute("tabindex", "0");
    b.setAttribute("aria-label", "Label this person");
    b.title = "Label this person";
    b.dataset.handle = handle;
    b.innerHTML = TAG_ICON + (withText ? "<span>Label</span>" : "");
    return b;
  }

  // Clicks inside tweets navigate; catch ours first (capture phase).
  function onButton(e) {
    const b = e.target.closest?.(".xp-label-btn");
    if (!b) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "click" || e.type === "keydown") xpLabelEditor.open(b, b.dataset.handle, labels.get(b.dataset.handle.toLowerCase()));
  }
  for (const t of ["click", "keydown", "mousedown", "pointerdown"]) {
    document.addEventListener(t, onButton, true);
  }

  // ---- Page colour ------------------------------------------------------------------
  // The ring's separator line and the tag cut-out use --xp-page. Take it from
  // X's real background so Dim (dark blue) matches as well as Light / Lights out.
  function syncPageColour() {
    if (!document.body) return;
    const bg = getComputedStyle(document.body).backgroundColor;
    if (bg && !/rgba\([^)]*,\s*0\)$/.test(bg) && bg !== "transparent") {
      document.documentElement.style.setProperty("--xp-page", bg);
    }
  }
  function watchPageColour() {
    syncPageColour();
    new MutationObserver(syncPageColour).observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
  }
  if (document.body) watchPageColour();
  else document.addEventListener("DOMContentLoaded", watchPageColour, { once: true });

  // ---- Refresh -------------------------------------------------------------------
  function refreshAll() {
    syncPageColour();
    document.querySelectorAll(AVATAR).forEach(avatar);
    document.querySelectorAll(XP_SEL.tweet).forEach(tweet);
    document.querySelectorAll(XP_SEL.profileName).forEach(profileHeader);
  }
  let queued = false;
  function queueRefresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; refreshAll(); });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "xp-hook" || e.data.type !== "relations") return;
    for (const [h, r] of Object.entries(e.data.users || {})) rel.set(h, r);
    queueRefresh();
  });

  xpLabels.loadAll().then((m) => { labels = m; queueRefresh(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !Object.keys(changes).some((k) => k.startsWith(XP_LABEL_PREFIX))) return;
    xpLabels.loadAll().then((m) => { labels = m; queueRefresh(); });
  });

  return { avatar, tweet, profileHeader, AVATAR };
})();
