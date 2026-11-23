// Marks "Paid partnership" posts (creator disclosures X shows under a post,
// not ads) with data-xp-paid so tweets.css can ring them in gold.
// Only X's label line counts: text inside the post itself is ignored.

const xpPaid = (() => {
  const LABELS = new Set([
    "paid partnership",
    "paid promotion",
    "bezahlte partnerschaft",
    "partenariat rémunéré",
    "colaboración pagada",
    "colaboração paga",
    "partnership a pagamento",
    "betaald partnerschap",
  ]);

  function tweet(article) {
    if (article.hasAttribute("data-xp-paid")) return;
    for (const span of article.querySelectorAll("span")) {
      if (span.closest(XP_SEL.tweetText)) continue;          // the post's own words
      if (span.closest(XP_SEL.tweet) !== article) continue;  // a quoted post's label
      if (LABELS.has((span.textContent || "").trim().toLowerCase())) {
        article.setAttribute("data-xp-paid", "");
        return;
      }
    }
  }

  return { tweet };
})();
