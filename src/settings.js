// Shared settings: used by both the content script and the popup.
// Add a new toggle here and it shows up in the popup automatically.
const XP_SETTINGS = [
  { key: "enabled",        label: "Enable X Polish",          default: true },
  { key: "tweetCards",     label: "Card-style tweets",        default: true },
  { key: "roundedMedia",   label: "Rounded media",            default: true },
  { key: "betterType",     label: "Nicer typography",         default: true },
  { key: "hideMetrics",    label: "Hide view counts",         default: false },
  { key: "hidePromoted",   label: "Hide promoted tweets",     default: true },
  { key: "hideSidebar",    label: "Hide right sidebar",       default: false },
];

const XP_DEFAULTS = Object.fromEntries(XP_SETTINGS.map((s) => [s.key, s.default]));

function xpLoadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(XP_DEFAULTS, (stored) => resolve({ ...XP_DEFAULTS, ...stored }));
  });
}
