/**
 * KeyHaven vault content model (the decrypted entries + settings).
 *
 * Persistence, record formats, migration and backups live in `src/lib/store/`:
 * only ciphertext is ever written to disk (see docs/security-model.md).
 *
 * All page agents: import from `@/lib/vault` — signatures are stable.
 */

/* ------------------------------------------------------------------ */
/* content model (design.md §7)                                        */
/* ------------------------------------------------------------------ */

export type VaultCategory = 'social' | 'finance' | 'work' | 'shopping' | 'streaming' | 'other';

export interface VaultEntry {
  id: string;
  title: string;
  url: string;
  username: string;
  /** secret — rendered masked in UI; strength derived via zxcvbn (0–4) */
  password: string;
  category: VaultCategory;
  favorite: boolean;
  notes?: string;
  /** has a 2FA/TOTP code stored for this login */
  totp?: boolean;
  /** ISO timestamps */
  updatedAt: string;
  lastUsedAt: string;
  /** flagged by local breach-style scan */
  breached?: boolean;
  /**
   * the {@link Account} this login belongs to. The link lives on the child, so
   * deleting a login (even in an older build) never leaves a broken list behind.
   */
  accountId?: string;
}

/* ------------------------------------------------------------------ */
/* accounts & subscriptions                                            */
/* ------------------------------------------------------------------ */

/**
 * A calendar day as typed into a date field: `'YYYY-MM-DD'`. Never converted
 * to a `Date` (that would shift it by the time zone) — see `src/lib/billing/dates.ts`.
 */
export type CalendarDate = string;

/**
 * One account at one service. Two accounts at the same service (personal and
 * work ChatGPT, say) are separate records. Logins and subscriptions point to
 * their account via `accountId`; an account never lists them.
 */
export interface Account {
  id: string;
  /** service name as shown, e.g. "ChatGPT" */
  service: string;
  /** preset key when created from a preset (`src/lib/servicePresets.ts`) */
  serviceKey?: string;
  /** tells accounts at the same service apart, e.g. "Work" */
  label?: string;
  email?: string;
  website?: string;
  category: VaultCategory;
  notes?: string;
  /** ISO timestamps */
  createdAt: string;
  updatedAt: string;
}

export type BillingUnit = 'day' | 'week' | 'month' | 'year';
/** monthly = `{ unit: 'month', count: 1 }`, annual = `{ unit: 'year', count: 1 }` */
export interface BillingInterval {
  unit: BillingUnit;
  count: number;
}

/** who charges you — and therefore where the subscription is managed */
export type BillingProvider = 'website' | 'apple' | 'google-play' | 'other';

/**
 * What the user recorded. What is shown ("renews in 5 days", "trial ends…",
 * "access until…", "ended") is derived from it — see `src/lib/billing/status.ts`.
 */
export type SubscriptionStatus = 'active' | 'trial' | 'canceled';

export interface Subscription {
  id: string;
  accountId: string;
  /** plan name, e.g. "Plus" (may be empty) */
  plan: string;
  /** price in the currency's minor unit (cents); user-entered, never fetched */
  amountMinor: number;
  /** ISO 4217 code, e.g. "USD" */
  currency: string;
  interval: BillingInterval;
  /** a known billing date; later ones are computed from it, it is never rewritten */
  billingAnchor?: CalendarDate;
  status: SubscriptionStatus;
  /** when status is 'trial': the first charge after the trial */
  trialEndsOn?: CalendarDate;
  /** when status is 'canceled': the last day of paid access */
  accessEndsOn?: CalendarDate;
  provider: BillingProvider;
  /** provider name when `provider` is 'other' */
  providerOther?: string;
  notes?: string;
  /** ISO timestamps */
  createdAt: string;
  updatedAt: string;
}

export interface VaultSettings {
  /** minutes of inactivity before the vault auto-locks (default 5) */
  autoLockMinutes: number;
  /** seconds before a copied secret is wiped from the clipboard (default 20) */
  clipboardClearSeconds: number;
  /** reveal secrets auto-remask after N seconds (default 15) */
  remaskSeconds: number;
}

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 20,
  remaskSeconds: 15,
};
