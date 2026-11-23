// Shared settings: used by both the content script and the popup.
// Add a new toggle here and it shows up in the popup automatically.
const XP_SETTINGS = [
  { key: "enabled",        label: "Enable X Polish",          default: true },
  { key: "tweetCards",     label: "Card-style tweets",        default: false },
  { key: "roundedMedia",   label: "Rounded media",            default: false },
  { key: "cashtagBadges",  label: "Stock badges ($TICKER)",   default: true },
  { key: "mentionBadges",  label: "Profile badges (@user)",   default: true },
  { key: "peopleRings",    label: "Follow rings & highlights", default: true },
  { key: "customLabels",   label: "My labels for people",      default: true },
  { key: "profileCards",   label: "Polished profile cards",   default: true },
  { key: "sidebarPanels",  label: "Polished sidebar boxes",   default: true },
  { key: "composerPolish", label: "Polished post composer",   default: true },
  { key: "notifSummary",   label: "Notifications 24h summary", default: true },
  { key: "notifPolish",    label: "Polished notifications",   default: true },
  { key: "betterType",     label: "Nicer typography",         default: false },
  { key: "hideMetrics",    label: "Hide view counts",         default: false },
  { key: "noteGlimmer",    label: "Glimmer on Community Notes", default: true },
  { key: "sponsoredRing",  label: "Gold ring on sponsored & paid posts", default: true },
  { key: "blockAds",       label: "Block ads (Promoted)",     default: true },
  { key: "hideSidebar",    label: "Hide right sidebar",       default: false },
  { key: "shareImage",     label: "Share post as image",      default: true },
  { key: "ratioMeter",     label: "Ratio meter",              default: true },
  { key: "accountAge",     label: "Account age & bot signals", default: true },
  { key: "spoilerShield",  label: "Spoiler shield",           default: true },
  { key: "focusMode",      label: "Focus mode",               default: false },
];

const XP_DEFAULTS = Object.fromEntries(XP_SETTINGS.map((s) => [s.key, s.default]));

function xpLoadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(XP_DEFAULTS, (stored) => resolve({ ...XP_DEFAULTS, ...stored }));
  });
}
