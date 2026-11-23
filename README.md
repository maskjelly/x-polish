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
  background.js        network requests + caching (quotes, logos, profiles)
  settings.js          toggle list + defaults (shared by popup and content script)
  content/
    selectors.js       stable X selectors (data-testid), all in one place
    xapi.js            X's internal GraphQL API (same requests x.com makes)
    api.js             content-side data layer (messages background, harvests on-page profiles)
    chips.js           $cashtag and @mention badges
    hovercard.js       finds the profile hover card
    content.js         applies settings as <html> classes, tags tweets as they load
  styles/
    base.css           design tokens (radius, colors, fonts) + layout tweaks
    tweets.css         tweet styling
    chips.css          badge styling
    hovercard.css      profile hover card styling
  popup/               toolbar popup, built from settings.js
icons/
```

## How it works

- Every setting becomes a class on `<html>`: `xp-<key>` (e.g. `xp-tweetCards`). CSS rules are scoped
  under those classes, so toggling is instant and needs no reload.
- Each tweet gets `data-xp-tweet` (plus `data-xp-media`, and its cell gets `data-xp-promoted` when it's an ad).
  Never add classes to X's own elements: X's React code rewrites `class` on hover and wipes them.
  Per-tweet JS goes in `processTweet()` in `content.js`.

## Badges

- `$TICKER` becomes a round pill with logo, ticker and live price (green up / red down, hover for % change).
  Prices + logos come from X itself (`smartTagHoverCardQuery`, the same request as X's cashtag hover card),
  sent from the x.com tab with your session. If that fails (logged out, rate limited, X changed the query id
  in `src/content/xapi.js`), it falls back to Yahoo Finance + financialmodelingprep via the background worker.
- `@user` becomes a square chip with avatar, display name and verified badge (blue / gold / grey).
  Profiles come from tweets already on the page first, otherwise from api.fxtwitter.com.
- All network calls go through `src/background.js` (x.com's CSP blocks them from the page) and are cached:
  prices 1 min, profiles 6 h, logos 7 days.

## Profile hover card

`src/content/hovercard.js` finds X's profile hover card (classic `data-testid="HoverCard"` or the new client's
Base UI popup) and marks the box that paints it with `data-xp-hovercard`. `src/styles/hovercard.css` adds the
brushed-metal border (rotating conic gradient masked to a ring), a one-time light sweep on open, a glass body,
stat pills and glossy buttons. Cashtag hover cards are left alone.

## Adding a feature

1. Add an entry to `XP_SETTINGS` in `src/settings.js`
2. Write CSS under `:root.xp-<yourKey>` (and/or JS in `processTweet`)
