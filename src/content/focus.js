// Focus mode: a distraction-free X. The look lives in src/styles/focus.css
// (driven by the xp-focusMode class on <html>); this file adds the keyboard
// shortcut (Alt+Shift+F) and a small confirmation toast.

const xpFocus = (() => {
  let toast = null;
  let hideTimer = 0;

  function show(on) {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "xp-focus-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = on ? "Focus mode on" : "Focus mode off";
    toast.dataset.on = String(on);
    toast.classList.add("xp-show");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast.classList.remove("xp-show"), 1600);
  }

  function typing(target) {
    return !!target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"]');
  }

  document.addEventListener(
    "keydown",
    (e) => {
      // e.code, not e.key: on macOS Alt+Shift+F types a special character.
      if (!(e.altKey && e.shiftKey && !e.metaKey && !e.ctrlKey && e.code === "KeyF")) return;
      if (typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      chrome.storage.sync.get({ focusMode: false }, (v) => {
        const on = !v.focusMode;
        chrome.storage.sync.set({ focusMode: on });
        show(on);
      });
    },
    true
  );

  return { show };
})();
