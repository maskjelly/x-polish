// Marks larger X surfaces for styling: sidebar boxes, the post composer and
// notification rows. Styles live in src/styles/surfaces.css.

const xpSurfaces = (() => {
  // "What's happening", "Who to follow", etc. are <section>/<aside> inside the
  // sidebar column; the box that draws the border is the section or an ancestor.
  function sidebarPanel(section) {
    if (section.closest("[data-xp-panel]")) return;
    const box = xpDom.findBox(section, 4);
    if (!box || !box.closest(XP_SEL.sidebar)) return;
    xpDom.mark(box, "panel");
  }

  // Composer = closest ancestor of the toolbar that also holds the text box
  // and the user's avatar (inline composer on Home, or the compose dialog).
  function composer(toolbar) {
    if (toolbar.closest("[data-xp-composer]")) return;
    let el = toolbar.parentElement;
    for (let i = 0; el && el !== document.body && i < 12; el = el.parentElement, i++) {
      if (el.querySelector(XP_SEL.composerText) && el.querySelector('[data-testid^="UserAvatar-Container"]')) {
        xpDom.mark(el, "composer");
        return;
      }
    }
  }

  // Notification rows: tag the row, and unread rows. X tints unread rows on
  // the article or a full-width wrapper; we mark that wrapper so CSS can move
  // the tint into the rounded row.
  function notification(article) {
    if (article.hasAttribute("data-xp-notif")) return;
    article.setAttribute("data-xp-notif", "");

    const pageBg = getComputedStyle(document.body).backgroundColor;
    for (let n = article, i = 0; n && i < 4; n = n.parentElement, i++) {
      const bg = getComputedStyle(n).backgroundColor;
      if (!xpDom.isTransparent(bg) && bg !== pageBg) {
        article.setAttribute("data-xp-unread", "");
        if (n !== article) n.setAttribute("data-xp-unread-bg", "");
        break;
      }
    }
  }

  // Expose the current page on <html> (xp-page-home, xp-page-notifications...)
  let lastPage = null;
  function updateRoute() {
    const page = location.pathname.split("/")[1] || "home";
    if (page === lastPage) return;
    const root = document.documentElement;
    if (lastPage) root.classList.remove(`xp-page-${lastPage}`);
    root.classList.add(`xp-page-${page}`);
    lastPage = page;
  }

  return { sidebarPanel, composer, notification, updateRoute };
})();
