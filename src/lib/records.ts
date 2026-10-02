/**
 * Accounts & subscriptions inside the decrypted vault payload — pure functions,
 * `VaultPayload → VaultPayload` (or `null` when the change is refused).
 *
 * Rules (see docs/security-model.md, "Accounts and subscriptions"):
 * - The collections are optional; reading an absent one gives `[]`, and nothing
 *   is written until the user creates something.
 * - Malformed items (not an object with a string `id`; for accounts also a
 *   text `service` and text optional fields) are hidden from lists and
 *   carried through every save verbatim. A collection that is present but
 *   not an array is never overwritten: changes to it are refused.
 * - Links live on the child (`entry.accountId`, `subscription.accountId`).
 *   Removing a subscription never touches a login; removing a login leaves its
 *   account and subscriptions in place; an account with subscriptions can't be
 *   removed, and removing one only unlinks its logins.
 * - Updates merge into the stored item, so fields this build doesn't know
 *   survive.
 */

import type { VaultPayload } from './store/format';
import type { Account, Subscription, VaultEntry } from './vault';

export type CollectionKey = 'accounts' | 'subscriptions';

type Item = { id: string } & Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isItem = (v: unknown): v is Item => isObject(v) && typeof v.id === 'string';
const ACCOUNT_TEXT_FIELDS = ['serviceKey', 'label', 'email', 'website', 'notes'] as const;
/** an account the UI can show: a text service name, and text (or absent) optional fields */
const isAccount = (v: unknown): v is Item =>
  isItem(v) &&
  typeof v.service === 'string' &&
  ACCOUNT_TEXT_FIELDS.every((k) => v[k] === undefined || typeof v[k] === 'string');

/** the stored collection (malformed items included); `[]` when absent; `null` when unusable */
function rawList(p: VaultPayload, key: CollectionKey): unknown[] | null {
  const v = p[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : null;
}

/** false when the collection is present but not an array (it is then left untouched) */
export function canWrite(p: VaultPayload, key: CollectionKey): boolean {
  return rawList(p, key) !== null;
}

/** usable accounts; anything else is hidden here and carried through every save verbatim */
export function listAccounts(p: VaultPayload): Account[] {
  return (rawList(p, 'accounts') ?? []).filter(isAccount) as unknown as Account[];
}

export function listSubscriptions(p: VaultPayload): Subscription[] {
  return (rawList(p, 'subscriptions') ?? []).filter(isItem) as unknown as Subscription[];
}

export function findAccount(p: VaultPayload, id: string): Account | undefined {
  return listAccounts(p).find((a) => a.id === id);
}

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */

export function addAccount(p: VaultPayload, account: Account): VaultPayload | null {
  const list = rawList(p, 'accounts');
  if (!list || list.some((a) => isItem(a) && a.id === account.id)) return null;
  return { ...p, accounts: [...list, account] };
}

/** merge `patch` into the stored account (unknown fields survive) */
export function updateAccount(
  p: VaultPayload,
  id: string,
  patch: Partial<Omit<Account, 'id' | 'createdAt'>>,
  now: string,
): VaultPayload | null {
  const list = rawList(p, 'accounts');
  if (!list || !list.some((a) => isItem(a) && a.id === id)) return null;
  return {
    ...p,
    accounts: list.map((a) => (isItem(a) && a.id === id ? { ...a, ...patch, id, updatedAt: now } : a)),
  };
}

export type RemoveAccountResult = { ok: true; payload: VaultPayload } | { ok: false; reason: 'has-subscriptions' | 'not-found' | 'unwritable' };

/** refused while a subscription uses the account; otherwise unlinks (keeps) its logins */
export function removeAccount(p: VaultPayload, id: string): RemoveAccountResult {
  const list = rawList(p, 'accounts');
  if (!list) return { ok: false, reason: 'unwritable' };
  if (!list.some((a) => isItem(a) && a.id === id)) return { ok: false, reason: 'not-found' };
  if ((rawList(p, 'subscriptions') ?? []).some((s) => isItem(s) && s.accountId === id)) {
    return { ok: false, reason: 'has-subscriptions' };
  }
  return {
    ok: true,
    payload: {
      ...p,
      accounts: list.filter((a) => !(isItem(a) && a.id === id)),
      entries: p.entries.map((e) => (e.accountId === id ? withoutAccount(e) : e)),
    },
  };
}

function withoutAccount(e: VaultEntry): VaultEntry {
  const next = { ...e };
  delete next.accountId;
  return next;
}

/**
 * Link a login to an account (or unlink with `null`). Does not touch the
 * login's `updatedAt` — Watchtower reads it as "password last changed".
 */
export function linkLogin(p: VaultPayload, entryId: string, accountId: string | null): VaultPayload | null {
  if (!p.entries.some((e) => e.id === entryId)) return null;
  if (accountId !== null && !findAccount(p, accountId)) return null;
  return {
    ...p,
    entries: p.entries.map((e) =>
      e.id !== entryId ? e : accountId === null ? withoutAccount(e) : { ...e, accountId },
    ),
  };
}

/** logins linked to an account */
export function loginsForAccount(p: VaultPayload, accountId: string): VaultEntry[] {
  return p.entries.filter((e) => e.accountId === accountId);
}

/* ------------------------------------------------------------------ */
/* subscriptions                                                       */
/* ------------------------------------------------------------------ */

/** insert, or merge into the stored subscription with the same id (unknown fields survive) */
export function upsertSubscription(p: VaultPayload, sub: Subscription): VaultPayload | null {
  const list = rawList(p, 'subscriptions');
  if (!list || !findAccount(p, sub.accountId)) return null;
  const exists = list.some((s) => isItem(s) && s.id === sub.id);
  return {
    ...p,
    subscriptions: exists
      ? list.map((s) => (isItem(s) && s.id === sub.id ? mergeSubscription(s, sub) : s))
      : [...list, sub],
  };
}

/** a merge that also clears optional fields the new version no longer has */
function mergeSubscription(stored: Item, next: Subscription): Item {
  const merged: Item = { ...stored, ...next };
  for (const k of OPTIONAL_SUBSCRIPTION_FIELDS) {
    if (!(k in next)) delete merged[k];
  }
  return merged;
}

const OPTIONAL_SUBSCRIPTION_FIELDS = [
  'billingAnchor',
  'trialEndsOn',
  'accessEndsOn',
  'providerOther',
  'notes',
] as const satisfies readonly (keyof Subscription)[];

/** removes only the subscription — never its account or login */
export function removeSubscription(p: VaultPayload, id: string): VaultPayload | null {
  const list = rawList(p, 'subscriptions');
  if (!list || !list.some((s) => isItem(s) && s.id === id)) return null;
  return { ...p, subscriptions: list.filter((s) => !(isItem(s) && s.id === id)) };
}

export interface SubscriptionBundle {
  /** a new account to create first (its id is what `subscription.accountId` uses) */
  newAccount?: Account;
  /** changes to the subscription's existing account, e.g. an email typed into the form */
  accountPatch?: Partial<Omit<Account, 'id' | 'createdAt'>>;
  /** link this login to the subscription's account; `undefined` leaves links alone */
  linkEntryId?: string;
  subscription: Subscription;
}

/** everything the subscription form saves, as one change (one encrypted save) */
export function saveSubscriptionBundle(p: VaultPayload, b: SubscriptionBundle, now: string): VaultPayload | null {
  let next: VaultPayload | null = p;
  if (b.newAccount) {
    if (b.newAccount.id !== b.subscription.accountId) return null;
    next = addAccount(next, b.newAccount);
  } else if (b.accountPatch && Object.keys(b.accountPatch).length > 0) {
    next = updateAccount(next, b.subscription.accountId, b.accountPatch, now);
  }
  if (next && b.linkEntryId !== undefined) next = linkLogin(next, b.linkEntryId, b.subscription.accountId);
  if (next) next = upsertSubscription(next, b.subscription);
  return next;
}
