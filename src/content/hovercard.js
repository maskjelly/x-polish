// Finds X's profile hover card (the popup when you hover an @user) and marks
// its visible box with data-xp-hovercard so hovercard.css can style it.
//
// Works with both X web clients:
//   - classic: [data-testid="HoverCard"]
//   - new (x-web): a Base UI popup with Tailwind classes w-[320px] min-h-[130px]
// The element we style is the nearest one that actually paints the card
// (has a background and rounded corners), so popup positioning is untouched.

const xpHoverCard = (() => {
  function paintsCard(el) {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const hasBg = bg && bg !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(bg);
    return hasBg && parseFloat(cs.borderTopLeftRadius) > 0;
  }

  function mark(card) {
    if (card.closest("[data-xp-hovercard]") || card.querySelector("[data-xp-hovercard]")) return;

    // Look at the card itself, then a few ancestors, for the painted box.
    let box = null;
    for (let el = card, i = 0; el && el !== document.body && i < 5; el = el.parentElement, i++) {
      if (paintsCard(el)) { box = el; break; }
    }
    box ||= card;

    box.setAttribute("data-xp-hovercard", "");
    // Pseudo-element layers need a positioned box. Only touch static ones,
    // so we never override the popup's own absolute/fixed positioning.
    if (getComputedStyle(box).position === "static") box.setAttribute("data-xp-hovercard-pos", "");
  }

  return { mark };
})();
