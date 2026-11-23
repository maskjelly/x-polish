// Share a post, or the notifications summary, as a polished PNG card.
//
// - A share button in each post's action bar opens a modal with a live
//   preview, theme picker, metrics / watermark toggles, Copy and Download.
// - Cards are drawn on a <canvas> at 2x. X's images are fetched through the
//   background worker as data: URLs (type "image") so the canvas stays
//   exportable; anything that fails falls back gracefully.

const xpShare = (() => {
  const SCALE = 2;
  const FRAME_W = 640; // logical px; exported at 2x
  const PAD = 44; // frame padding around the card
  const FONT =
    '"TwitterChirp", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';

  // ---- Themes -------------------------------------------------------------------
  // bg: canvas fill for the frame; card: "light" | "dark" surface.
  const THEMES = [
    { id: "light", name: "Light", bg: ["#eef2f6", "#e3e9f0"], card: "light", swatch: "linear-gradient(135deg,#f4f7fa,#dfe6ee)" },
    { id: "dark", name: "Dark", bg: ["#0b0d10", "#14171c"], card: "dark", swatch: "linear-gradient(135deg,#1a1d22,#050607)" },
    { id: "midnight", name: "Midnight", bg: ["#312e81", "#0f172a"], card: "dark", swatch: "linear-gradient(135deg,#4338ca,#0f172a)" },
    { id: "sunset", name: "Sunset", bg: ["#ff8a65", "#f6c177"], card: "light", swatch: "linear-gradient(135deg,#ff8a65,#f6c177)" },
    { id: "ocean", name: "Ocean", bg: ["#1d8fd6", "#67d4e8"], card: "light", swatch: "linear-gradient(135deg,#1d8fd6,#67d4e8)" },
    { id: "paper", name: "Paper", bg: ["#f3eee3", "#e9e1d0"], card: "paper", swatch: "linear-gradient(135deg,#f7f2e7,#e6dcc7)" },
  ];

  const SURFACE = {
    light: { card: "#ffffff", ink: "#0f1419", ink2: "#536471", line: "rgba(15,20,25,0.08)", tile: "#f5f7f9" },
    dark: { card: "#16181c", ink: "#e7e9ea", ink2: "#8b98a5", line: "rgba(255,255,255,0.08)", tile: "#1e2126" },
    paper: { card: "#fffdf8", ink: "#2a2620", ink2: "#7a7062", line: "rgba(60,45,20,0.10)", tile: "#f6f0e4" },
  };

  // Validated activity colours (same as the notifications summary).
  const KIND_COLORS = {
    light: { like: "#e0156f", follow: "#1a8cd8", repost: "#00865a", reply: "#6b4ce6" },
    dark: { like: "#f91880", follow: "#1d9bf0", repost: "#00a36c", reply: "#7856ff" },
  };

  // ---- Settings (per viewer, convenience only) ------------------------------------
  const prefs = { theme: "midnight", metrics: true, watermark: true };
  try {
    chrome.storage.local.get("xpSharePrefs", (v) => Object.assign(prefs, v?.xpSharePrefs || {}));
  } catch {}
  function savePrefs() {
    try { chrome.storage.local.set({ xpSharePrefs: { ...prefs } }); } catch {}
  }

  // ---- Helpers ------------------------------------------------------------------------
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

  function getDataUrl(url) {
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "image", key: url }, (res) => {
          void chrome.runtime.lastError;
          resolve(typeof res === "string" ? res : null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  const fetchImg = async (url) => loadImg(await getDataUrl(url));

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function graphemes(s) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment);
    }
    return [...s];
  }

  // Word wrap that keeps explicit line breaks and splits over-long words safely.
  function wrap(ctx, text, maxW) {
    const lines = [];
    for (const para of String(text).split("\n")) {
      if (!para.trim()) { lines.push(""); continue; }
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        if (!word) continue;
        const test = line + word;
        if (ctx.measureText(test).width <= maxW) { line = test; continue; }
        if (line.trim()) { lines.push(line.trimEnd()); line = ""; }
        if (/^\s+$/.test(word)) continue;
        if (ctx.measureText(word).width <= maxW) { line = word; continue; }
        for (const g of graphemes(word)) {
          if (ctx.measureText(line + g).width > maxW && line) { lines.push(line); line = ""; }
          line += g;
        }
      }
      if (line.trim()) lines.push(line.trimEnd());
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const gs = graphemes(text);
    while (gs.length && ctx.measureText(gs.join("") + "…").width > maxW) gs.pop();
    return gs.join("").trimEnd() + "…";
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  // Simple 24px stroke icons drawn with Path2D.
  const ICON_PATHS = {
    reply: "M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5v-8Z",
    repost: "M4.5 10V8.5A2.5 2.5 0 0 1 7 6h11l-3-3M19.5 14v1.5A2.5 2.5 0 0 1 17 18H6l3 3",
    like: "M12 20.5s-7.5-4.6-9.3-9.1C1.5 8.3 3.4 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5c3.2 0 5.1 3.3 3.9 6.4-1.8 4.5-9.3 9.1-9.3 9.1Z",
    views: "M5 20V12M10 20V6M15 20v-9M20 20V9",
    follow: "M10 11.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM3.5 19.5c.8-3.4 3.4-5.3 6.5-5.3s5.7 1.9 6.5 5.3M18.5 8v6M15.5 11h6",
  };
  function drawIcon(ctx, name, x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(new Path2D(ICON_PATHS[name]));
    ctx.restore();
  }

  function drawSeal(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const rr = i % 2 ? r * 0.84 : r;
      const a = (Math.PI * 2 * i) / 24;
      const px = cx + rr * Math.cos(a), py = cy + rr * Math.sin(a);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = r * 0.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.38, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.3);
    ctx.lineTo(cx + r * 0.42, cy - r * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  function drawAvatar(ctx, img, x, y, size, name, surface, square) {
    ctx.save();
    roundRect(ctx, x, y, size, size, square ? size * 0.18 : size / 2);
    ctx.clip();
    if (img) {
      ctx.drawImage(img, x, y, size, size);
    } else {
      ctx.fillStyle = "#8b98a5";
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${size * 0.42}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((graphemes(name || "?")[0] || "?").toUpperCase(), x + size / 2, y + size / 2 + 1);
    }
    ctx.restore();
    ctx.save();
    roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, square ? size * 0.18 : size / 2);
    ctx.strokeStyle = surface.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Frame background + card shell; returns ctx for drawing card contents.
  function frame(cardH, theme) {
    const surface = SURFACE[theme.card];
    const W = FRAME_W;
    const H = cardH + PAD * 2 + (prefs.watermark ? 26 : 0);
    const canvas = document.createElement("canvas");
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);

    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, theme.bg[0]);
    g.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const cx = PAD, cy = PAD, cw = W - PAD * 2;
    ctx.save();
    ctx.shadowColor = theme.card === "dark" ? "rgba(0,0,0,0.55)" : "rgba(15,20,25,0.18)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    roundRect(ctx, cx, cy, cw, cardH, 22);
    ctx.fillStyle = surface.card;
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, cx + 0.5, cy + 0.5, cw - 1, cardH - 1, 22);
    ctx.strokeStyle = surface.line;
    ctx.stroke();
    ctx.restore();

    if (prefs.watermark) {
      const light = luminance(theme.bg[1]) > 0.6;
      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = light ? "rgba(15,20,25,0.45)" : "rgba(255,255,255,0.6)";
      const label = "made with X Polish";
      ctx.fillText(label, W - PAD, H - PAD + 14);
      const tw = ctx.measureText(label).width;
      ctx.beginPath();
      ctx.arc(W - PAD - tw - 9, H - PAD + 10, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return { canvas, ctx, surface, x: cx, y: cy, w: cw };
  }

  // ---- Post data from the DOM ----------------------------------------------------------
  // A post can contain a quoted post with its own name, text, media and time.
  // Everything is read from the post's OWN area only (the quoted post's area
  // is excluded), and the quoted post is read separately into data.quote.

  // The quoted post's root: the nearest ancestor of the 2nd User-Name block
  // that doesn't also contain the main one.
  function quoteRoot(article) {
    const names = [...article.querySelectorAll(XP_SEL.userName)].filter((n) => n.closest(XP_SEL.tweet) === article);
    if (names.length < 2) return null;
    let el = names[1];
    while (el.parentElement && el.parentElement !== article && !el.parentElement.contains(names[0])) el = el.parentElement;
    return el.contains(names[0]) ? null : el;
  }

  // querySelectorAll limited to `root`, excluding anything inside `exclude`.
  function own(root, sel, exclude) {
    return [...root.querySelectorAll(sel)].filter((n) => !(exclude && exclude.contains(n)));
  }

  function readText(textEl) {
    if (!textEl) return "";
    // innerText, but use original link text for our badges (keep $TICKER / @user readable)
    const clone = textEl.cloneNode(true);
    clone.querySelectorAll(".xp-chip-inner").forEach((n) => n.remove());
    clone.querySelectorAll("img[alt]").forEach((img) => img.replaceWith(document.createTextNode(img.alt)));
    return (clone.innerText ?? clone.textContent ?? "").trim();
  }

  function readAuthor(root, exclude) {
    const nameBox = own(root, XP_SEL.userName, exclude)[0];
    let name = "", handle = "";
    if (nameBox) {
      const links = [...nameBox.querySelectorAll("a")];
      name = (links[0]?.innerText || "").replace(/\s+/g, " ").trim();
      handle = [...nameBox.querySelectorAll("span")].map((s) => s.textContent.trim()).find((t) => /^@\w{1,15}$/.test(t)) || "";
      if (!name) name = (nameBox.innerText.split("\n")[0] || "").trim();
    }
    const avatarBox = own(root, '[data-testid^="UserAvatar-Container-"]', exclude)[0];
    if (!handle && avatarBox) handle = "@" + avatarBox.dataset.testid.slice("UserAvatar-Container-".length);
    const avatarUrl = avatarBox?.querySelector("img")?.src?.replace(/_(normal|bigger|mini|x96)\./, "_400x400.") || null;
    const squareAvatar = !!avatarBox?.querySelector('[style*="clip-path"]');
    const verified = !!nameBox?.querySelector('[data-testid="icon-verified"], svg[aria-label*="erified"]');
    return { name, handle, avatarUrl, squareAvatar, verified };
  }

  // Up to 4 photos; otherwise a video poster; otherwise a link-card image.
  function readMedia(root, exclude) {
    const photos = own(root, '[data-testid="tweetPhoto"] img', exclude).map((i) => i.src).filter(Boolean);
    if (photos.length) return { kind: "photos", urls: [...new Set(photos)].slice(0, 4) };
    const poster = own(root, '[data-testid="videoPlayer"] video[poster]', exclude)[0]?.getAttribute("poster")
      || own(root, '[data-testid="videoPlayer"] img', exclude)[0]?.src;
    if (poster) return { kind: "video", urls: [poster] };
    const card = own(root, '[data-testid="card.wrapper"] img', exclude)[0]?.src;
    if (card) return { kind: "card", urls: [card] };
    return null;
  }

  function readTime(root, exclude) {
    const t = own(root, "time[datetime]", exclude)[0];
    return t ? new Date(t.getAttribute("datetime")) : null;
  }

  function postData(article) {
    const qRoot = quoteRoot(article);
    const author = readAuthor(article, qRoot);

    // "Name reposted" / "Pinned" line above the post
    const ctxEl = own(article, '[data-testid="socialContext"]', qRoot)[0];
    const context = ctxEl ? (ctxEl.innerText || ctxEl.textContent || "").replace(/\s+/g, " ").trim() : "";

    const metrics = {};
    const group = own(article, '[role="group"][aria-label]', qRoot)[0];
    const label = group?.getAttribute("aria-label") || "";
    for (const [k, re] of [
      ["reply", /([\d,.]+\s*[KkMm]?)\s+repl/i],
      ["repost", /([\d,.]+\s*[KkMm]?)\s+(?:repost|retweet)/i],
      ["like", /([\d,.]+\s*[KkMm]?)\s+like/i],
      ["views", /([\d,.]+\s*[KkMm]?)\s+view/i],
    ]) {
      const m = re.exec(label);
      if (m) metrics[k] = parseCount(m[1]);
    }

    let quote = null;
    if (qRoot) {
      quote = {
        ...readAuthor(qRoot, null),
        text: readText(qRoot.querySelector(XP_SEL.tweetText)),
        media: readMedia(qRoot, null),
        date: readTime(qRoot, null),
      };
    }

    return {
      ...author,
      context,
      text: readText(own(article, XP_SEL.tweetText, qRoot)[0]),
      date: readTime(article, qRoot),
      media: readMedia(article, qRoot),
      metrics,
      quote,
    };
  }

  function parseCount(s) {
    const m = /([\d.,]+)\s*([KkMm]?)/.exec(s);
    if (!m) return 0;
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (/k/i.test(m[2])) n *= 1e3;
    if (/m/i.test(m[2])) n *= 1e6;
    return Math.round(n);
  }

  // ---- Post card ------------------------------------------------------------------------
  // Media grid like X's: 1 = full, 2 = side by side, 3 = one tall + two
  // stacked, 4 = 2x2. Each tile is cropped to fill, with a 2px gap.
  function mediaHeight(imgs, w, maxH) {
    if (!imgs.length) return 0;
    if (imgs.length === 1) {
      const r = imgs[0].naturalHeight / imgs[0].naturalWidth || 0.5625;
      return Math.min(Math.round(w * r), maxH);
    }
    return Math.min(Math.round(w * 0.5625), maxH);
  }

  function drawTile(ctx, img, x, y, w, h) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * r, dh = img.naturalHeight * r;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  function drawMedia(ctx, imgs, kind, x, y, w, h, radius, surface) {
    const gap = 2;
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = surface.line;
    ctx.fillRect(x, y, w, h);
    const half = (w - gap) / 2, halfH = (h - gap) / 2;
    if (imgs.length === 1) drawTile(ctx, imgs[0], x, y, w, h);
    else if (imgs.length === 2) { drawTile(ctx, imgs[0], x, y, half, h); drawTile(ctx, imgs[1], x + half + gap, y, half, h); }
    else if (imgs.length === 3) {
      drawTile(ctx, imgs[0], x, y, half, h);
      drawTile(ctx, imgs[1], x + half + gap, y, half, halfH);
      drawTile(ctx, imgs[2], x + half + gap, y + halfH + gap, half, halfH);
    } else {
      imgs.slice(0, 4).forEach((im, i) => drawTile(ctx, im, x + (i % 2) * (half + gap), y + Math.floor(i / 2) * (halfH + gap), half, halfH));
    }
    ctx.restore();
    // Play badge for videos
    if (kind === "video") {
      const r = Math.min(30, h / 5);
      const cx = x + w / 2, cy = y + h / 2;
      ctx.save();
      ctx.fillStyle = "rgba(15,20,25,0.62)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.3, cy - r * 0.42);
      ctx.lineTo(cx + r * 0.48, cy);
      ctx.lineTo(cx - r * 0.3, cy + r * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
    ctx.strokeStyle = surface.line;
    ctx.stroke();
    ctx.restore();
  }

  function fmtDate(d, withTime = true) {
    if (!d || isNaN(d)) return "";
    const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return withTime ? `${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${day}` : day;
  }

  async function renderPost(data, themeId) {
    const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
    const q = data.quote;
    const [avatar, mainImgs, qAvatar, qImgs] = await Promise.all([
      fetchImg(data.avatarUrl),
      Promise.all((data.media?.urls || []).map(fetchImg)).then((l) => l.filter(Boolean)),
      q ? fetchImg(q.avatarUrl) : null,
      q ? Promise.all((q.media?.urls || []).slice(0, 1).map(fetchImg)).then((l) => l.filter(Boolean)) : [],
    ]);

    // ---- Measure ----
    const scratch = document.createElement("canvas").getContext("2d");
    const inner = 28; // card padding
    const cw = FRAME_W - PAD * 2;
    const textW = cw - inner * 2;
    const textSize = data.text.length > 280 ? 18 : 20;
    const lineH = Math.round(textSize * 1.42);
    scratch.font = `400 ${textSize}px ${FONT}`;
    const lines = data.text ? wrap(scratch, data.text, textW) : [];
    const mediaH = mediaHeight(mainImgs, textW, 420);

    // Quoted post block
    const qPad = 16, qTextSize = 16, qLineH = 23, qMaxLines = 6;
    let qLines = [], qMediaH = 0, qH = 0;
    if (q) {
      scratch.font = `400 ${qTextSize}px ${FONT}`;
      qLines = q.text ? wrap(scratch, q.text, textW - qPad * 2) : [];
      if (qLines.length > qMaxLines) {
        qLines = qLines.slice(0, qMaxLines);
        qLines[qMaxLines - 1] = ellipsize(scratch, qLines[qMaxLines - 1] + " …", textW - qPad * 2);
      }
      qMediaH = mediaHeight(qImgs, textW - qPad * 2, 220);
      qH = qPad + 24 + (qLines.length ? 10 + qLines.length * qLineH : 0) + (qMediaH ? 12 + qMediaH : 0) + qPad;
    }

    const metricKeys = ["reply", "repost", "like", "views"].filter((k) => data.metrics[k] != null);
    const showMetrics = prefs.metrics && metricKeys.length > 0;
    const contextH = data.context ? 28 : 0;
    const headH = 52;
    const cardH =
      inner + contextH + headH +
      (lines.length ? 16 + lines.length * lineH : 0) +
      (mediaH ? 16 + mediaH : 0) +
      (q ? 16 + qH : 0) +
      20 + 18 +
      (showMetrics ? 16 + 1 + 16 + 20 : 0) +
      inner;

    const { canvas, ctx, surface, x, y, w } = frame(cardH, theme);
    const left = x + inner;
    let cy = y + inner;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // ---- "Name reposted" / "Pinned" context line ----
    if (data.context) {
      const isRepost = /repost|retweet/i.test(data.context);
      if (isRepost) drawIcon(ctx, "repost", left + 52 - 18, cy - 1, 16, surface.ink2);
      ctx.font = `600 14px ${FONT}`;
      ctx.fillStyle = surface.ink2;
      ctx.fillText(ellipsize(ctx, data.context, textW - 66), left + 66, cy + 12);
      cy += contextH;
    }

    // ---- Header: avatar, name, seal, handle ----
    drawAvatar(ctx, avatar, left, cy, 52, data.name, surface, data.squareAvatar);
    const nx = left + 52 + 14;
    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = surface.ink;
    const nameText = ellipsize(ctx, data.name || data.handle, w - inner * 2 - 52 - 14 - (data.verified ? 26 : 0));
    ctx.fillText(nameText, nx, cy + 22);
    if (data.verified) drawSeal(ctx, nx + ctx.measureText(nameText).width + 13, cy + 16, 9, "#1d9bf0");
    ctx.font = `400 15.5px ${FONT}`;
    ctx.fillStyle = surface.ink2;
    ctx.fillText(data.handle, nx, cy + 44);
    cy += headH;

    // ---- Text ----
    if (lines.length) {
      cy += 16;
      ctx.font = `400 ${textSize}px ${FONT}`;
      ctx.fillStyle = surface.ink;
      for (const line of lines) {
        ctx.fillText(line, left, cy + textSize);
        cy += lineH;
      }
    }

    // ---- Media ----
    if (mediaH) {
      cy += 16;
      drawMedia(ctx, mainImgs, data.media.kind, left, cy, textW, mediaH, 16, surface);
      cy += mediaH;
    }

    // ---- Quoted post ----
    if (q) {
      cy += 16;
      ctx.save();
      roundRect(ctx, left + 0.5, cy + 0.5, textW - 1, qH - 1, 16);
      ctx.strokeStyle = surface.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      const qx = left + qPad;
      let qy = cy + qPad;
      drawAvatar(ctx, qAvatar, qx, qy, 24, q.name, surface, q.squareAvatar);
      const qnx = qx + 24 + 8;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillStyle = surface.ink;
      const meta = [q.handle, fmtDate(q.date, false)].filter(Boolean).join(" · ");
      ctx.font = `400 14px ${FONT}`;
      const metaW = Math.min(ctx.measureText(meta).width, (textW - qPad * 2) * 0.45);
      ctx.font = `700 15px ${FONT}`;
      const qName = ellipsize(ctx, q.name || q.handle, textW - qPad * 2 - 32 - metaW - (q.verified ? 22 : 0) - 8);
      ctx.fillText(qName, qnx, qy + 17);
      let mx = qnx + ctx.measureText(qName).width;
      if (q.verified) { drawSeal(ctx, mx + 10, qy + 12, 7.5, "#1d9bf0"); mx += 20; }
      ctx.font = `400 14px ${FONT}`;
      ctx.fillStyle = surface.ink2;
      ctx.fillText(ellipsize(ctx, meta, metaW), mx + 6, qy + 17);
      qy += 24;
      if (qLines.length) {
        qy += 10;
        ctx.font = `400 ${qTextSize}px ${FONT}`;
        ctx.fillStyle = surface.ink;
        for (const line of qLines) {
          ctx.fillText(line, qx, qy + qTextSize);
          qy += qLineH;
        }
      }
      if (qMediaH) {
        qy += 12;
        drawMedia(ctx, qImgs, q.media.kind, qx, qy, textW - qPad * 2, qMediaH, 12, surface);
      }
      cy += qH;
    }

    // ---- Date ----
    cy += 20;
    const when = fmtDate(data.date);
    if (when) {
      ctx.font = `400 14.5px ${FONT}`;
      ctx.fillStyle = surface.ink2;
      ctx.fillText(when, left, cy + 14);
    }
    cy += 18;

    // ---- Metrics ----
    if (showMetrics) {
      cy += 16;
      ctx.fillStyle = surface.line;
      ctx.fillRect(left, cy, textW, 1);
      cy += 17;
      const colors = KIND_COLORS[theme.card === "dark" ? "dark" : "light"];
      const tint = { reply: surface.ink2, repost: colors.repost, like: colors.like, views: surface.ink2 };
      const labels = { reply: "Replies", repost: "Reposts", like: "Likes", views: "Views" };
      const slot = textW / metricKeys.length;
      metricKeys.forEach((k, i) => {
        const mx = left + slot * i;
        drawIcon(ctx, k, mx, cy, 18, tint[k]);
        ctx.font = `700 15px ${FONT}`;
        ctx.fillStyle = surface.ink;
        const num = compact.format(data.metrics[k]);
        ctx.fillText(num, mx + 26, cy + 14);
        ctx.font = `400 13.5px ${FONT}`;
        ctx.fillStyle = surface.ink2;
        ctx.fillText(labels[k], mx + 26 + ctx.measureText(num).width + 14, cy + 14);
      });
    }
    return canvas;
  }

  // ---- Summary card ------------------------------------------------------------------------
  const SUMMARY_KINDS = [
    { key: "like", label: "Likes" },
    { key: "follow", label: "Followers" },
    { key: "repost", label: "Reposts" },
    { key: "reply", label: "Mentions" },
  ];

  async function renderSummary(m, themeId) {
    const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
    const inner = 30;
    const cw = FRAME_W - PAD * 2;
    const iw = cw - inner * 2;
    const scratch = document.createElement("canvas").getContext("2d");
    scratch.font = `400 15px ${FONT}`;
    const topText = m.top?.text ? m.top.text.replace(/https:\/\/t\.co\/\S+/g, "").replace(/\s+/g, " ").trim() : "";
    const topLines = topText ? wrap(scratch, topText, iw - 32).slice(0, 2) : [];
    if (topText && wrap(scratch, topText, iw - 32).length > 2) {
      topLines[1] = ellipsize(scratch, topLines[1] + " …", iw - 32);
    }

    const chartH = 96;
    const topH = topLines.length ? 18 + 14 + 18 + topLines.length * 22 + 10 + 18 + 16 : 0;
    const cardH = inner + 20 + 8 + 56 + 24 + 78 + 22 + chartH + 26 + (topH ? 18 + topH : 0) + inner;

    const { canvas, ctx, surface, x, y } = frame(cardH, theme);
    const colors = KIND_COLORS[theme.card === "dark" ? "dark" : "light"];
    const left = x + inner;
    let cy = y + inner;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // Eyebrow + peak
    ctx.font = `700 12.5px ${FONT}`;
    ctx.fillStyle = surface.ink2;
    ctx.fillText("MY LAST 24 HOURS ON X", left, cy + 14);
    if (m.peakLabel) {
      ctx.font = `600 13px ${FONT}`;
      const label = `Peak ${m.peakLabel}`;
      const tw = ctx.measureText(label).width;
      roundRect(ctx, left + iw - tw - 22, cy - 2, tw + 22, 24, 12);
      ctx.strokeStyle = surface.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = surface.ink2;
      ctx.fillText(label, left + iw - tw - 11, cy + 14);
    }
    cy += 20 + 8;

    // Hero number
    ctx.font = `800 52px ${FONT}`;
    ctx.fillStyle = surface.ink;
    const total = (m.total || 0).toLocaleString();
    ctx.fillText(total, left, cy + 46);
    const tw = ctx.measureText(total).width;
    ctx.font = `500 18px ${FONT}`;
    ctx.fillStyle = surface.ink2;
    ctx.fillText("interactions", left + tw + 12, cy + 46);
    cy += 56 + 24;

    // Tiles
    const gap = 10;
    const tileW = (iw - gap * 3) / 4;
    SUMMARY_KINDS.forEach((k, i) => {
      const tx = left + i * (tileW + gap);
      roundRect(ctx, tx, cy, tileW, 78, 14);
      ctx.fillStyle = surface.tile;
      ctx.fill();
      drawIcon(ctx, k.key === "reply" ? "reply" : k.key, tx + 12, cy + 12, 16, colors[k.key]);
      ctx.font = `600 12.5px ${FONT}`;
      ctx.fillStyle = surface.ink2;
      ctx.fillText(k.label, tx + 34, cy + 25);
      ctx.font = `800 26px ${FONT}`;
      const v = m.totals?.[k.key] || 0;
      ctx.fillStyle = v ? surface.ink : surface.ink2;
      ctx.fillText(compact.format(v), tx + 12, cy + 62);
    });
    cy += 78 + 22;

    // Mini stacked hourly chart
    const hours = m.hours || [];
    const max = Math.max(5, ...hours.map((h) => (h.like || 0) + (h.follow || 0) + (h.repost || 0) + (h.reply || 0)));
    const colGap = 3;
    const colW = (iw - colGap * 23) / 24;
    hours.forEach((h, i) => {
      let base = cy + chartH;
      const segs = SUMMARY_KINDS.filter((k) => h[k.key] > 0);
      segs.forEach((k, si) => {
        const hh = Math.max(3, (h[k.key] / max) * (chartH - 4));
        const top = si === segs.length - 1;
        ctx.fillStyle = colors[k.key];
        roundRect(ctx, left + i * (colW + colGap), base - hh, colW, hh, top ? [3, 3, 0, 0] : 0);
        ctx.fill();
        base -= hh + 2;
      });
    });
    ctx.fillStyle = surface.line;
    ctx.fillRect(left, cy + chartH, iw, 1);
    ctx.font = `500 11.5px ${FONT}`;
    ctx.fillStyle = surface.ink2;
    ctx.fillText("24h ago", left, cy + chartH + 18);
    ctx.textAlign = "center";
    ctx.fillText("12h", left + iw / 2, cy + chartH + 18);
    ctx.textAlign = "right";
    ctx.fillText("Now", left + iw, cy + chartH + 18);
    ctx.textAlign = "left";
    cy += chartH + 26;

    // Top post
    if (topH) {
      cy += 18;
      roundRect(ctx, left, cy, iw, topH, 14);
      ctx.fillStyle = surface.tile;
      ctx.fill();
      let ty = cy + 18;
      ctx.font = `600 12.5px ${FONT}`;
      ctx.fillStyle = surface.ink2;
      ctx.fillText("Top post", left + 16, ty + 10);
      ty += 14 + 18;
      ctx.font = `400 15px ${FONT}`;
      ctx.fillStyle = surface.ink;
      for (const l of topLines) { ctx.fillText(l, left + 16, ty + 4); ty += 22; }
      ty += 10;
      let sx = left + 16;
      for (const k of ["like", "repost"]) {
        const v = m.top?.[k] || 0;
        if (!v) continue;
        drawIcon(ctx, k, sx, ty - 2, 16, colors[k]);
        ctx.font = `700 13.5px ${FONT}`;
        ctx.fillStyle = surface.ink2;
        const s = compact.format(v);
        ctx.fillText(s, sx + 22, ty + 11);
        sx += 22 + ctx.measureText(s).width + 18;
      }
    }
    return canvas;
  }

  // ---- Modal -------------------------------------------------------------------------------
  let modal = null;
  let current = null; // { kind: "post"|"summary", data }
  let lastFocus = null;
  let renderToken = 0;
  let lastCanvas = null;

  const ICON_SHARE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10.5" r="1.8"/><path d="M20.5 15.5l-4.6-4.6L7 19"/></svg>';

  function buildModal() {
    modal = document.createElement("div");
    modal.className = "xp-share-backdrop";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="xp-share" role="dialog" aria-modal="true" aria-labelledby="xp-share-title">
        <header class="xp-share-head">
          <h2 id="xp-share-title" class="xp-share-title">Share as image</h2>
          <button type="button" class="xp-share-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </header>
        <div class="xp-share-preview" aria-live="polite">
          <div class="xp-share-loading" aria-hidden="true"></div>
          <img class="xp-share-img" alt="Preview of the image to share">
        </div>
        <div class="xp-share-controls">
          <div class="xp-share-themes" role="radiogroup" aria-label="Background"></div>
          <div class="xp-share-toggles">
            <label class="xp-share-check"><input type="checkbox" data-pref="metrics"><span>Metrics</span></label>
            <label class="xp-share-check"><input type="checkbox" data-pref="watermark"><span>Watermark</span></label>
          </div>
        </div>
        <footer class="xp-share-actions">
          <span class="xp-share-status" role="status"></span>
          <button type="button" class="xp-share-btn-secondary" data-act="download">Download</button>
          <button type="button" class="xp-share-btn-secondary" data-act="copy">Copy image</button>
          <button type="button" class="xp-share-btn-primary" data-act="post">Post to X</button>
        </footer>
      </div>`;

    const themes = modal.querySelector(".xp-share-themes");
    for (const t of THEMES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "xp-share-theme";
      b.dataset.theme = t.id;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", t.name);
      b.title = t.name;
      b.style.setProperty("--sw", t.swatch);
      themes.appendChild(b);
    }

    modal.addEventListener("click", (e) => {
      if (e.target === modal) return close();
      const theme = e.target.closest(".xp-share-theme");
      if (theme) { prefs.theme = theme.dataset.theme; savePrefs(); syncControls(); return rerender(); }
      if (e.target.closest(".xp-share-x")) return close();
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "copy") return copy();
      if (act === "post") return postToX();
      if (act === "download") return download();
    });
    modal.addEventListener("change", (e) => {
      const key = e.target.dataset?.pref;
      if (!key) return;
      prefs[key] = e.target.checked;
      savePrefs();
      rerender();
    });
    modal.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep X's keyboard shortcuts out
      if (e.key === "Escape") return close();
      if (e.key === "Tab") trapFocus(e);
      if (e.target.closest?.(".xp-share-themes") && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        e.preventDefault();
        const i = THEMES.findIndex((t) => t.id === prefs.theme);
        const d = /Right|Down/.test(e.key) ? 1 : -1;
        prefs.theme = THEMES[(i + d + THEMES.length) % THEMES.length].id;
        savePrefs();
        syncControls();
        modal.querySelector(`.xp-share-theme[data-theme="${prefs.theme}"]`)?.focus();
        rerender();
      }
    });
    document.body.appendChild(modal);
  }

  function focusables() {
    return [...modal.querySelectorAll("button, input")].filter((el) => !el.disabled && el.offsetParent !== null && el.tabIndex !== -1);
  }
  function trapFocus(e) {
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function syncControls() {
    modal.querySelectorAll(".xp-share-theme").forEach((b) => {
      const on = b.dataset.theme === prefs.theme;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    modal.querySelectorAll("[data-pref]").forEach((i) => (i.checked = !!prefs[i.dataset.pref]));
    const metrics = modal.querySelector('[data-pref="metrics"]')?.closest("label");
    if (metrics) metrics.hidden = current?.kind === "summary";
    modal.querySelector(".xp-share-title").textContent = current?.kind === "summary" ? "Share your last 24 hours" : "Share as image";
  }

  function status(text) {
    const s = modal.querySelector(".xp-share-status");
    s.textContent = text;
    clearTimeout(status.t);
    if (text) status.t = setTimeout(() => (s.textContent = ""), 2400);
  }

  async function rerender() {
    const token = ++renderToken;
    const preview = modal.querySelector(".xp-share-preview");
    preview.classList.add("xp-share-busy");
    let canvas = null;
    try {
      canvas = current.kind === "summary" ? await renderSummary(current.data, prefs.theme) : await renderPost(current.data, prefs.theme);
    } catch (err) {
      console.debug("[X Polish] share render failed:", err);
    }
    if (token !== renderToken) return;
    preview.classList.remove("xp-share-busy");
    lastCanvas = canvas;
    const img = modal.querySelector(".xp-share-img");
    if (canvas) {
      img.src = canvas.toDataURL("image/png");
      img.hidden = false;
    } else {
      img.hidden = true;
      status("Couldn't create the image");
    }
    modal.querySelectorAll("[data-act]").forEach((b) => (b.disabled = !canvas));
  }

  function blob() {
    return new Promise((resolve, reject) =>
      lastCanvas ? lastCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no blob"))), "image/png") : reject(new Error("no image"))
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob() })]);
      status("Copied to clipboard");
    } catch {
      status("Copy failed. Try Download.");
    }
  }

  function fileBase() {
    return current.kind === "summary" ? "my-24h-on-x" : `post-${(current.data.handle || "x").replace(/^@/, "")}`;
  }

  // Polls until `get()` returns something, or gives up after `ms`.
  function waitFor(get, ms) {
    return new Promise((resolve) => {
      const end = Date.now() + ms;
      (function tick() {
        const v = get();
        if (v || Date.now() > end) return resolve(v || null);
        setTimeout(tick, 60);
      })();
    });
  }

  // Small toast for messages after the modal has closed.
  let toastEl = null, toastTimer = 0;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "xp-share-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("xp-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("xp-show"), 2600);
  }

  // Post to X: open X's own composer and attach the image through its file
  // input (the same path as picking a photo). If the composer can't be found,
  // fall back to copying the image so the user can paste it.
  async function postToX() {
    let b;
    try { b = await blob(); } catch { return status("The image isn't ready yet"); }
    const copyFallback = async (msg) => {
      try { await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); toast(msg); }
      catch { toast("Couldn't open the composer. Use Download instead."); }
    };
    const openBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"], a[href="/compose/tweet"]');
    if (!openBtn) {
      try { await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]); status("Copied. Open a new post and paste."); }
      catch { status("Couldn't find X's composer. Use Download."); }
      return;
    }
    const file = new File([b], `${fileBase()}.png`, { type: "image/png" });
    close();
    openBtn.click();
    const input = await waitFor(
      () => document.querySelector('[role="dialog"] input[data-testid="fileInput"], [role="dialog"] input[type="file"][accept*="image"]'),
      5000
    );
    if (!input) return copyFallback("Image copied. Paste it into your post.");
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const box = await waitFor(() => document.querySelector('[role="dialog"] [data-testid^="tweetTextarea_"]'), 2000);
    box?.focus();
  }

  async function download() {
    try {
      const b = await blob();
      const a = document.createElement("a");
      a.download = `${fileBase()}.png`;
      a.href = URL.createObjectURL(b);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      status("Saved");
    } catch {
      status("Download failed");
    }
  }

  function open(kind, data, opener) {
    if (!modal) buildModal();
    current = { kind, data };
    lastFocus = opener || document.activeElement;
    syncControls();
    status("");
    modal.hidden = false;
    document.documentElement.classList.add("xp-share-open");
    rerender();
    requestAnimationFrame(() => modal.querySelector(".xp-share-btn-primary")?.focus());
  }

  function close() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.documentElement.classList.remove("xp-share-open");
    renderToken++;
    if (lastFocus?.isConnected) lastFocus.focus();
  }

  // ---- Entry points -----------------------------------------------------------------------
  function tweet(article) {
    const group = article.querySelector('[role="group"]');
    if (!group || group.closest(XP_SEL.tweet) !== article) return;
    if (group.querySelector(":scope > .xp-share-slot")) return;
    const slot = document.createElement("div");
    slot.className = "xp-share-slot";
    slot.innerHTML = `<button type="button" class="xp-share-trigger" aria-label="Share as image" title="Share as image">${ICON_SHARE}</button>`;
    group.appendChild(slot);
  }

  // Capture phase: the post itself navigates on click.
  function onTrigger(e) {
    const b = e.target.closest?.(".xp-share-trigger");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== "click") return;
    const article = b.closest(XP_SEL.tweet);
    if (article) open("post", postData(article), b);
  }
  for (const t of ["click", "mousedown", "pointerdown", "pointerup"]) document.addEventListener(t, onTrigger, true);

  function summary(model, opener) {
    if (!model) return;
    open("summary", model, opener);
  }

  return { tweet, summary };
})();
