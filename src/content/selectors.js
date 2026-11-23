// X's DOM uses hashed class names that change often, so we target
// stable data-testid / role attributes instead. Keep all of them here.
const XP_SEL = {
  tweet: 'article[data-testid="tweet"]',
  tweetText: '[data-testid="tweetText"]',
  userName: '[data-testid="User-Name"]',
  media: '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]',
  actionBar: '[role="group"]',
  viewCount: 'a[href$="/analytics"]',
  cellInner: '[data-testid="cellInnerDiv"]',
  sidebar: '[data-testid="sidebarColumn"]',
  primaryColumn: '[data-testid="primaryColumn"]',
  cashtag: '[data-testid="tweetText"] a[href*="cashtag_click"]',
  mention: '[data-testid="tweetText"] a[href^="/"]',
};
