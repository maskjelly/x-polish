// Custom people labels, shared by the content script and the popup.
// Stored in chrome.storage.sync as one key per person: "lbl:<handle>" ->
// { handle, color, text } so labels follow you across Chrome profiles.

const XP_LABEL_COLORS = [
  { id: "red", name: "Red", hex: "#ef4444" },
  { id: "orange", name: "Orange", hex: "#f97316" },
  { id: "yellow", name: "Yellow", hex: "#eab308" },
  { id: "green", name: "Green", hex: "#22c55e" },
  { id: "teal", name: "Teal", hex: "#14b8a6" },
  { id: "blue", name: "Blue", hex: "#3b82f6" },
  { id: "purple", name: "Purple", hex: "#a855f7" },
  { id: "pink", name: "Pink", hex: "#ec4899" },
  { id: "gray", name: "Gray", hex: "#94a3b8" },
];

const XP_LABEL_PREFIX = "lbl:";
const XP_LABEL_MAX = 16; // characters in a tag

const xpLabels = {
  key: (handle) => XP_LABEL_PREFIX + handle.toLowerCase(),

  loadAll() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(null, (all) => {
        const map = new Map();
        for (const [k, v] of Object.entries(all || {})) {
          if (k.startsWith(XP_LABEL_PREFIX) && v?.color) map.set(k.slice(XP_LABEL_PREFIX.length), v);
        }
        resolve(map);
      });
    });
  },

  set(handle, color, text) {
    const clean = (text || "").trim().slice(0, XP_LABEL_MAX);
    return chrome.storage.sync.set({ [xpLabels.key(handle)]: { handle, color, text: clean } });
  },

  remove(handle) {
    return chrome.storage.sync.remove(xpLabels.key(handle));
  },
};
