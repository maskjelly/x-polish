// Finds X's profile hover card (the popup when you hover an @user) and marks
// its visible box with data-xp-hovercard so hovercard.css can style it.
//
// Works with both X web clients:
//   - classic: [data-testid="HoverCard"]
//   - new (x-web): a Base UI popup with Tailwind classes w-[320px] min-h-[130px]
// The element we style is the nearest one that actually paints the card,
// so popup positioning is untouched.

const xpHoverCard = (() => {
  function mark(card) {
    if (card.closest("[data-xp-hovercard]") || card.querySelector("[data-xp-hovercard]")) return;
    xpDom.mark(xpDom.findBox(card) || card, "hovercard");
  }
  return { mark };
})();
