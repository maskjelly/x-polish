// Finds X's profile hover card (the popup when you hover an @user) and marks
// its OUTER frame with data-xp-hovercard so hovercard.css can style it.
//
// Works with both X web clients:
//   - classic: [data-testid="HoverCard"]
//   - new (x-web): a Base UI popup with Tailwind classes w-[320px] min-h-[130px]
//
// X paints the card in layers (an outer frame with the shadow, and inner
// layers with their own background / radius). Styling only an inner layer
// leaves X's frame showing around it as a double edge, so we style the
// outermost layer that is still the card's size, and flatten the layers
// inside it (data-xp-hc-layer).

const xpHoverCard = (() => {
  function paints(el) {
    const cs = getComputedStyle(el);
    return (
      !xpDom.isTransparent(cs.backgroundColor) ||
      cs.boxShadow !== "none" ||
      parseFloat(cs.borderTopWidth) > 0 ||
      parseFloat(cs.borderTopLeftRadius) > 0
    );
  }

  function mark(card) {
    if (card.closest("[data-xp-hovercard]") || card.querySelector("[data-xp-hovercard]")) return;
    const width = card.getBoundingClientRect().width;
    if (!width) return;

    // Walk up while ancestors are still the card's width (not the page layer).
    const layers = [];
    for (let el = card, i = 0; el && el !== document.body && i < 6; el = el.parentElement, i++) {
      if (Math.abs(el.getBoundingClientRect().width - width) > 4) break;
      if (paints(el)) layers.push(el);
    }
    if (!layers.length) return;

    const frame = layers[layers.length - 1];
    for (const el of layers.slice(0, -1)) el.setAttribute("data-xp-hc-layer", "");
    xpDom.mark(frame, "hovercard");
  }

  return { mark };
})();
