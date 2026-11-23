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
  trend: '[data-testid="trend"]',
  userCell: '[data-testid="UserCell"]',
  adRows: '[data-testid="trend"], [data-testid="UserCell"]',
  sidebar: '[data-testid="sidebarColumn"]',
  primaryColumn: '[data-testid="primaryColumn"]',
  // Badges apply to post text and to bios (profile page and hover card).
  cashtag: '[data-testid="tweetText"] a[href*="cashtag_click"], [data-testid="UserDescription"] a[href*="cashtag_click"]',
  mention: '[data-testid="tweetText"] a[href^="/"], [data-testid="UserDescription"] a[href^="/"]',
  sidebarSection: '[data-testid="sidebarColumn"] section, [data-testid="sidebarColumn"] aside',
  composerToolbar: '[data-testid="toolBar"]',
  composerText: '[data-testid^="tweetTextarea_"]',
  notification: 'article[data-testid="notification"]',
  communityNote: '[data-testid="birdwatch-pivot"]',
  profileName: '[data-testid="primaryColumn"] [data-testid="UserName"]',
  // Classic client testid, and the new client's popup classes (Tailwind).
  hoverCard: '[data-testid="HoverCard"], [class~="w-[320px]"][class~="min-h-[130px]"]',
};
