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
