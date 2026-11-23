// Shared settings: used by both the content script and the popup.
// Add a new toggle here and it shows up in the popup automatically.
const XP_SETTINGS = [
  { key: "enabled",        label: "Enable X Polish",          default: true },
  { key: "tweetCards",     label: "Card-style tweets",        default: false },
  { key: "roundedMedia",   label: "Rounded media",            default: false },
  { key: "cashtagBadges",  label: "Stock badges ($TICKER)",   default: true },
  { key: "mentionBadges",  label: "Profile badges (@user)",   default: true },
  { key: "relationBadges", label: "Follows you / You follow", default: true },
  { key: "profileCards",   label: "Polished profile cards",   default: true },
  { key: "sidebarPanels",  label: "Polished sidebar boxes",   default: true },
  { key: "composerPolish", label: "Polished post composer",   default: true },
  { key: "notifPolish",    label: "Polished notifications",   default: true },
  { key: "betterType",     label: "Nicer typography",         default: false },
  { key: "hideMetrics",    label: "Hide view counts",         default: false },
  { key: "blockAds",       label: "Block ads (Promoted)",     default: true },
  { key: "hideSidebar",    label: "Hide right sidebar",       default: false },
];

const XP_DEFAULTS = Object.fromEntries(XP_SETTINGS.map((s) => [s.key, s.default]));

function xpLoadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(XP_DEFAULTS, (stored) => resolve({ ...XP_DEFAULTS, ...stored }));
  });
}
