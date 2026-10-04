/**
 * Links out of KeyHaven. Opening a stored website is navigation the user
 * chooses; KeyHaven itself never contacts the site.
 */

/** an http(s) address to open for a stored website, or `null` — never `javascript:`, `data:` or other schemes */
export function safeExternalUrl(website: string | undefined): string | null {
  const raw = (website ?? '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    const web = url.protocol === 'https:' || url.protocol === 'http:';
    return web && url.hostname && !url.username && !url.password ? url.href : null; // never a user:pass@ address
  } catch {
    return null;
  }
}

/** "chatgpt.com" for display */
export function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The app stores' own subscription pages, for subscriptions billed through
 * them — where you manage or cancel. Fixed, official addresses; nothing is
 * fetched, the user opens them.
 */
export const STORE_SUBSCRIPTION_PAGES = {
  apple: { label: 'Manage in the App Store', href: 'https://apps.apple.com/account/subscriptions' },
  'google-play': { label: 'Manage in Google Play', href: 'https://play.google.com/store/account/subscriptions' },
} as const;
