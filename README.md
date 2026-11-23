# X Polish

A Chrome extension (Manifest V3) that makes Twitter / X look cleaner.

## Load it

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked** and pick this folder
4. Open x.com. Click the extension icon to toggle features.

After editing files, hit the reload icon on the extension card and refresh x.com.

## Layout

```
manifest.json
src/
  settings.js          toggle list + defaults (shared by popup and content script)
  content/
    selectors.js       stable X selectors (data-testid), all in one place
    content.js         applies settings as <html> classes, tags tweets as they load
  styles/
    base.css           design tokens (radius, colors, fonts) + layout tweaks
    tweets.css         tweet styling
  popup/               toolbar popup, built from settings.js
icons/
```

## How it works

- Every setting becomes a class on `<html>`: `xp-<key>` (e.g. `xp-tweetCards`). CSS rules are scoped
  under those classes, so toggling is instant and needs no reload.
- Each tweet gets `.xp-tweet` (plus `.xp-has-media`, and its cell gets `.xp-promoted` when it's an ad).
  Per-tweet JS goes in `processTweet()` in `content.js`.

## Adding a feature

1. Add an entry to `XP_SETTINGS` in `src/settings.js`
2. Write CSS under `:root.xp-<yourKey>` (and/or JS in `processTweet`)
