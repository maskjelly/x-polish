// Small DOM helpers shared by the content-script features.

const xpDom = (() => {
  function isTransparent(color) {
    return !color || color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(color);
  }

  // Does this element visibly draw a box (rounded + background or border)?
  function drawsBox(el) {
    const cs = getComputedStyle(el);
    if (!(parseFloat(cs.borderTopLeftRadius) > 0)) return false;
    return !isTransparent(cs.backgroundColor) || parseFloat(cs.borderTopWidth) > 0;
  }

  // The element itself or the nearest ancestor (up to `depth`) that draws a box.
  function findBox(el, depth = 5) {
    for (let n = el, i = 0; n && n !== document.body && i < depth; n = n.parentElement, i++) {
      if (drawsBox(n)) return n;
    }
    return null;
  }

  // Mark an element for styling. Pseudo-element layers need a positioned box;
  // only flag static ones so we never override X's own positioning.
  function mark(el, name, value = "") {
    el.setAttribute(`data-xp-${name}`, value);
    if (getComputedStyle(el).position === "static") el.setAttribute("data-xp-pos", "");
  }

  return { isTransparent, drawsBox, findBox, mark };
})();
