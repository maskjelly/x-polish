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
  labels.js            custom people labels (storage + colour palette), shared with the popup
  settings.js          toggle list + defaults (shared by popup and content script)
  page/
    adblock.js         MAIN-world filter: removes promoted entries from X's API responses
    hook.js            MAIN-world reader: collects follows-you / you-follow flags
  content/
    selectors.js       stable X selectors (data-testid), all in one place
    xapi.js            X's internal GraphQL API (same requests x.com makes)
    api.js             content-side data layer (messages background, harvests on-page profiles)
    ads.js             DOM fallback: marks promoted tweets, trends and users
    chips.js           $cashtag and @mention badges
    hovercard.js       finds the profile hover card
    people.js          follow rings, tags, post tint, label buttons
    label-editor.js    popover for setting a person's colour + tag
    surfaces.js        marks sidebar boxes, the composer, notification rows; tracks the current page
    dom.js             shared helpers (find the element that draws a box, mark it)
    content.js         applies settings as <html> classes, tags tweets as they load
  styles/
    base.css           design tokens (radius, colors, fonts) + layout tweaks
    tweets.css         tweet styling
    chips.css          badge styling
    hovercard.css      profile hover card styling (also defines the shared metal/glass tokens)
    people.css         rings, tags, tint, label editor
    surfaces.css       sidebar boxes, post composer, notifications (flat, hairline style)
  popup/               toolbar popup, built from settings.js
icons/
```

## How it works

- Every setting becomes a class on `<html>`: `xp-<key>` (e.g. `xp-tweetCards`). CSS rules are scoped
  under those classes, so toggling is instant and needs no reload.
- Each tweet gets `data-xp-tweet` (plus `data-xp-media`), and promoted tweets / trends / users are marked with
  `data-xp-ad` (on the cell or row) for CSS to hide. Ads are also filtered from X's API, see below.
  Never add classes to X's own elements: X's React code rewrites `class` on hover and wipes them.
  Per-tweet JS goes in `processTweet()` in `content.js`.

## Ads

X serves Promoted tweets, trends and users from its own GraphQL API, mixed into normal timeline payloads,
so domain blocklists never touch them. `src/page/adblock.js` runs in the page's MAIN world at
`document_start` and wraps `fetch`/XHR. Responses are scanned for X's ad markers — an `entryId` starting
with `promoted`, a `promotedMetadata` object, or `__typename: "PromotedTweet"` — and those entries are
dropped before X's client can render them. Everything else passes through untouched.

The **Block ads (Promoted)** toggle (default on) is mirrored as `xp-blockAds` on `<html>`; turning it off
lets responses through unmodified. `src/content/ads.js` is the DOM fallback: it labels promoted
trends/users (and any ad that still renders) with `data-xp-ad`, which CSS hides instantly.

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

## People: follow rings and labels

- Avatar ring everywhere: gold = you follow them, green = they follow you, gold inside green = mutual.
- Tweets get a small "Follows you" tag on the ring and a faint tint in the same colour.
- Your own labels (colour + optional tag) override the follow colours. Set them from the tag icon that
  appears next to the name when you hover a post, or the "Label" button on a profile. Manage them in the popup.
- Relationship flags come from X's own API responses, read by `src/page/hook.js` (page world). Labels are
  stored in `chrome.storage.sync` as `lbl:<handle>`.

## Adding a feature

1. Add an entry to `XP_SETTINGS` in `src/settings.js`
2. Write CSS under `:root.xp-<yourKey>` (and/or JS in `processTweet`)
