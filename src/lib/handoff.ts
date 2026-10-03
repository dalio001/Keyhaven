/**
 * Hand a generated secret from one page to another in memory only — never in
 * the URL, history state or storage (KH-01). One value at a time; it expires
 * after a minute and is cleared once the receiving page has taken it. A reload
 * loses it, which is the point.
 */

const TTL_MS = 60_000;
let pending: { value: string; at: number } | null = null;

export function offerSecret(value: string, now = Date.now()): void {
  pending = { value, at: now };
}

/** the waiting secret, or null; doesn't consume it (call clearSecret once used) */
export function peekSecret(now = Date.now()): string | null {
  if (!pending) return null;
  if (now - pending.at > TTL_MS) {
    pending = null;
    return null;
  }
  return pending.value;
}

/** older builds also kept the generated secret in this tab's sessionStorage */
const LEGACY_KEY = 'kh:generator-seed';

/** forget the waiting secret (and any copy an older build left behind) */
export function clearSecret(): void {
  pending = null;
  try {
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    /* no sessionStorage here (or it's blocked) — nothing was kept there either */
  }
}
