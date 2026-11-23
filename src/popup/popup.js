// Builds the popup UI from XP_SETTINGS and saves changes to chrome.storage.
// The content script listens for storage changes, so updates apply live.
// Settings are shown in sections; any key not listed in GROUPS still appears
// (under "Other"), so new settings never go missing.

const GROUPS = [
  { title: "Badges", keys: ["cashtagBadges", "mentionBadges"] },
  { title: "People", keys: ["peopleRings", "customLabels", "accountAge", "profileCards"] },
  { title: "Posts", keys: ["shareImage", "ratioMeter", "spoilerShield", "noteGlimmer", "sponsoredRing", "blockAds", "hideMetrics", "tweetCards", "roundedMedia", "betterType"] },
  { title: "Notifications", keys: ["notifSummary", "notifPolish"] },
  { title: "Layout", keys: ["focusMode", "sidebarPanels", "composerPolish", "hideSidebar"] },
];

// Shorter wording inside a section (the heading already gives context).
// Keys not listed use their label from settings.js.
const SHORT = {
  cashtagBadges: "Stock tickers ($TICKER)",
  mentionBadges: "Profiles (@user)",
  peopleRings: "Follow rings & tags",
  customLabels: "My labels",
  profileCards: "Profile hover card",
  noteGlimmer: "Community Notes glimmer",
  sponsoredRing: "Gold ring on paid posts",
  blockAds: "Block promoted ads",
  tweetCards: "Card-style posts",
  notifSummary: "24-hour summary",
  notifPolish: "Polished rows",
  sidebarPanels: "Sidebar boxes",
  composerPolish: "Post composer",
  shareImage: "Share post as image",
  ratioMeter: "Ratio meter",
  accountAge: "Account age & new-account tags",
  spoilerShield: "Spoiler shield",
  focusMode: "Focus mode (Alt+Shift+F)",
};

const container = document.getElementById("toggles");
const master = document.getElementById("master");
document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

function setOff(off) {
  document.body.classList.toggle("off", off);
  container.querySelectorAll("input").forEach((i) => (i.disabled = off));
}

function switchRow(key, label, checked) {
  const row = document.createElement("label");
  row.className = "row";
  row.innerHTML = `<span class="label"></span><span class="switch"><input type="checkbox" role="switch"><span aria-hidden="true"></span></span>`;
  row.querySelector(".label").textContent = label;
  const input = row.querySelector("input");
  input.checked = checked;
  input.addEventListener("change", () => chrome.storage.sync.set({ [key]: input.checked }));
  return row;
}

xpLoadSettings().then((settings) => {
  const byKey = new Map(XP_SETTINGS.map((s) => [s.key, s]));
  const placed = new Set(["enabled"]);
  const sections = GROUPS.map((g) => ({ title: g.title, items: g.keys.filter((k) => byKey.has(k)) }));
  const rest = XP_SETTINGS.map((s) => s.key).filter((k) => !placed.has(k) && !GROUPS.some((g) => g.keys.includes(k)));
  if (rest.length) sections.push({ title: "Other", items: rest });

  for (const sec of sections) {
    if (!sec.items.length) continue;
    const group = document.createElement("section");
    group.className = "group";
    const h = document.createElement("h2");
    h.textContent = sec.title;
    const card = document.createElement("div");
    card.className = "card";
    for (const key of sec.items) card.appendChild(switchRow(key, SHORT[key] || byKey.get(key).label, !!settings[key]));
    group.append(h, card);
    container.appendChild(group);
  }

  master.checked = !!settings.enabled;
  master.addEventListener("change", () => {
    chrome.storage.sync.set({ enabled: master.checked });
    setOff(!master.checked);
  });
  setOff(!settings.enabled);
});

// ---- My labels -----------------------------------------------------------
const list = document.getElementById("people-list");
const empty = document.getElementById("people-empty");
const count = document.getElementById("people-count");
const hex = Object.fromEntries(XP_LABEL_COLORS.map((c) => [c.id, c.hex]));

function renderPeople() {
  xpLabels.loadAll().then((map) => {
    list.textContent = "";
    empty.hidden = map.size > 0;
    list.hidden = map.size === 0;
    count.textContent = map.size ? String(map.size) : "";
    const people = [...map.values()].sort((a, b) => a.handle.localeCompare(b.handle));
    for (const p of people) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="dot" aria-hidden="true"></span><a target="_blank" rel="noopener"></a><span class="tag"></span><button type="button">×</button>`;
      li.querySelector(".dot").style.background = hex[p.color] || "#999";
      const a = li.querySelector("a");
      a.href = `https://x.com/${encodeURIComponent(p.handle)}`;
      a.textContent = `@${p.handle}`;
      li.querySelector(".tag").textContent = p.text || "";
      const btn = li.querySelector("button");
      btn.setAttribute("aria-label", `Remove label for @${p.handle}`);
      btn.title = "Remove label";
      btn.addEventListener("click", () => xpLabels.remove(p.handle));
      list.appendChild(li);
    }
  });
}
renderPeople();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.keys(changes).some((k) => k.startsWith(XP_LABEL_PREFIX))) renderPeople();
});
