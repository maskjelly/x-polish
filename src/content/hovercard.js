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
//
// X inserts the card before it has a size, so measuring is retried for a
// few frames; if no frame can be identified we style the card itself, so a
// card is never left unstyled.

const xpHoverCard = (() => {
  const MAX_TRIES = 30; // ~0.5s of animation frames

  function paints(el) {
    const cs = getComputedStyle(el);
    return (
      !xpDom.isTransparent(cs.backgroundColor) ||
      cs.boxShadow !== "none" ||
      parseFloat(cs.borderTopWidth) > 0 ||
      parseFloat(cs.borderTopLeftRadius) > 0
    );
  }

  function frameFor(card) {
    const width = card.getBoundingClientRect().width;
    if (!width) return null;
    const layers = [];
    for (let el = card, i = 0; el && el !== document.body && i < 6; el = el.parentElement, i++) {
      if (Math.abs(el.getBoundingClientRect().width - width) > 4) break;
      if (paints(el)) layers.push(el);
    }
    return { frame: layers.length ? layers[layers.length - 1] : card, inner: layers.slice(0, -1) };
  }

  function apply(card, tries = 0) {
    if (!card.isConnected) return;
    if (card.closest("[data-xp-hovercard]") || card.querySelector("[data-xp-hovercard]")) return;
    const found = frameFor(card);
    if (!found) {
      if (tries < MAX_TRIES) requestAnimationFrame(() => apply(card, tries + 1));
      else xpDom.mark(card, "hovercard"); // never leave it unstyled
      return;
    }
    for (const el of found.inner) el.setAttribute("data-xp-hc-layer", "");
    xpDom.mark(found.frame, "hovercard");
  }

  return { mark: (card) => apply(card) };
})();
