// Small popover to set a person's colour + tag. One instance, built lazily.

const xpLabelEditor = (() => {
  let el = null;
  let handle = null;
  let color = null;

  function build() {
    el = document.createElement("div");
    el.className = "xp-editor";
    el.setAttribute("role", "dialog");
    el.innerHTML = `
      <div class="xp-editor-head"><span class="xp-editor-title"></span><button class="xp-editor-x" aria-label="Close">×</button></div>
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
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Enter" && e.target.matches(".xp-editor-input")) save();
      e.stopPropagation(); // keep X's keyboard shortcuts out of the input
    });
    document.body.appendChild(el);
  }

  function pick(id) {
    color = id;
    el.querySelectorAll(".xp-swatch").forEach((s) => s.setAttribute("aria-checked", String(s.dataset.color === id)));
    el.querySelector(".xp-editor-save").disabled = !color;
  }

  function save() {
    if (!color) return;
    xpLabels.set(handle, color, el.querySelector(".xp-editor-input").value);
    close();
  }

  function onOutside(e) {
    if (el && !el.contains(e.target) && !e.target.closest?.(".xp-label-btn")) close();
  }

  function open(anchor, h, current) {
    if (!el) build();
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
    addEventListener("scroll", close, { once: true, passive: true });
  }

  function close() {
    if (!el) return;
    el.hidden = true;
    document.removeEventListener("pointerdown", onOutside, true);
  }

  return { open, close };
})();
