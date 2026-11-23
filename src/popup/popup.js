// Builds the popup UI from XP_SETTINGS and saves changes to chrome.storage.
// The content script listens for storage changes, so updates apply live.
const container = document.getElementById("toggles");
document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

xpLoadSettings().then((settings) => {
  for (const { key, label } of XP_SETTINGS) {
    const row = document.createElement("label");
    row.className = "row" + (key === "enabled" ? " master" : "");
    row.innerHTML = `<span></span><span class="switch"><input type="checkbox"><span></span></span>`;
    row.firstChild.textContent = label;

    const input = row.querySelector("input");
    input.checked = !!settings[key];
    input.addEventListener("change", () => {
      chrome.storage.sync.set({ [key]: input.checked });
      if (key === "enabled") container.classList.toggle("off", !input.checked);
    });

    container.appendChild(row);
  }
  container.classList.toggle("off", !settings.enabled);
});

// ---- My labels -----------------------------------------------------------
const list = document.getElementById("people-list");
const empty = document.getElementById("people-empty");
const hex = Object.fromEntries(XP_LABEL_COLORS.map((c) => [c.id, c.hex]));

function renderPeople() {
  xpLabels.loadAll().then((map) => {
    list.textContent = "";
    empty.hidden = map.size > 0;
    const people = [...map.values()].sort((a, b) => a.handle.localeCompare(b.handle));
    for (const p of people) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="dot"></span><a target="_blank" rel="noopener"></a><span class="tag"></span><button aria-label="Remove label">×</button>`;
      li.querySelector(".dot").style.background = hex[p.color] || "#999";
      const a = li.querySelector("a");
      a.href = `https://x.com/${encodeURIComponent(p.handle)}`;
      a.textContent = `@${p.handle}`;
      li.querySelector(".tag").textContent = p.text || "";
      li.querySelector("button").addEventListener("click", () => xpLabels.remove(p.handle));
      list.appendChild(li);
    }
  });
}
renderPeople();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.keys(changes).some((k) => k.startsWith(XP_LABEL_PREFIX))) renderPeople();
});
