// Small popover to set a person's colour + tag. One instance, built lazily.

const xpLabelEditor = (() => {
  let el = null;
  let handle = null;
  let color = null;
  let anchorEl = null; // focus returns here on close

  function build() {
    el = document.createElement("div");
    el.className = "xp-editor";
    el.setAttribute("role", "dialog");
    el.innerHTML = `
      <div class="xp-editor-head"><span class="xp-editor-title"></span><span class="xp-ptag xp-editor-preview" aria-hidden="true"></span><button class="xp-editor-x" type="button" aria-label="Close">×</button></div>
      <div class="xp-editor-swatches" role="radiogroup" aria-label="Colour"></div>
      <input class="xp-editor-input" type="text" placeholder="Tag (optional)" />
      <div class="xp-editor-actions">
        <button class="xp-editor-remove" type="button">Remove</button>
        <button class="xp-editor-save" type="button">Save</button>
      </div>`;
    const sw = el.querySelector(".xp-editor-swatches");
    for (const c of XP_LABEL_COLORS) {
      const s = document.createElement("button");
      s.type = "button";
      s.className = "xp-swatch";
      s.dataset.color = c.id;
      s.style.setProperty("--sw", c.hex);
      s.setAttribute("role", "radio");
      s.setAttribute("aria-label", c.name);
      s.title = c.name;
      sw.appendChild(s);
    }
    el.querySelector(".xp-editor-input").maxLength = XP_LABEL_MAX;

    el.addEventListener("click", (e) => {
      const s = e.target.closest(".xp-swatch");
      if (s) return pick(s.dataset.color);
      if (e.target.closest(".xp-editor-x")) return close();
      if (e.target.closest(".xp-editor-remove")) { xpLabels.remove(handle); return close(); }
      if (e.target.closest(".xp-editor-save")) return save();
    });
    el.querySelector(".xp-editor-input").addEventListener("input", preview);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Enter" && e.target.matches(".xp-editor-input")) save();
      // Arrow keys move through the colour swatches (radio group behaviour)
      if (e.target.matches(".xp-swatch") && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        e.preventDefault();
        const all = [...el.querySelectorAll(".xp-swatch")];
        const step = /Left|Up/.test(e.key) ? -1 : 1;
        const next = all[(all.indexOf(e.target) + step + all.length) % all.length];
        next.focus();
        pick(next.dataset.color);
      }
      e.stopPropagation(); // keep X's keyboard shortcuts out of the editor
    });
    document.body.appendChild(el);
  }

  function pick(id) {
    color = id;
    el.querySelectorAll(".xp-swatch").forEach((s) => {
      s.setAttribute("aria-checked", String(s.dataset.color === id));
      s.tabIndex = s.dataset.color === (id || XP_LABEL_COLORS[0].id) ? 0 : -1; // one tab stop
    });
    el.querySelector(".xp-editor-save").disabled = !color;
    preview();
  }

  // Shows the tag as it will look on posts (colour + text, or just colour).
  function preview() {
    const p = el.querySelector(".xp-editor-preview");
    const text = el.querySelector(".xp-editor-input").value.trim();
    p.textContent = color ? text || "Colour only" : "";
    p.dataset.kind = color ? `c-${color}` : "";
  }

  function save() {
    if (!color) return;
    xpLabels.set(handle, color, el.querySelector(".xp-editor-input").value);
    close();
  }

  function onOutside(e) {
    if (el && !el.contains(e.target) && !e.target.closest?.(".xp-label-btn")) close(false);
  }

  function open(anchor, h, current) {
    if (!el) build();
    anchorEl = anchor;
    handle = h;
    el.querySelector(".xp-editor-title").textContent = `Label @${h}`;
    el.querySelector(".xp-editor-input").value = current?.text || "";
    el.querySelector(".xp-editor-remove").hidden = !current;
    pick(current?.color || null);

    el.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth, hgt = el.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + hgt > innerHeight - 8) top = Math.max(8, r.top - hgt - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.querySelector(".xp-editor-input").focus();
    document.addEventListener("pointerdown", onOutside, true);
    removeEventListener("scroll", onScroll);
    addEventListener("scroll", onScroll, { passive: true });
  }

  const onScroll = () => close(false);

  function close(restoreFocus = true) {
    if (!el || el.hidden) return;
    el.hidden = true;
    document.removeEventListener("pointerdown", onOutside, true);
    removeEventListener("scroll", onScroll);
    if (restoreFocus && anchorEl?.isConnected) anchorEl.focus({ preventScroll: true });
  }

  return { open, close };
})();
