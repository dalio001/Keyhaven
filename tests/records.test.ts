import { describe, expect, it } from 'vitest';
import {
  addAccount,
  canWrite,
  linkLogin,
  listAccounts,
  listSubscriptions,
  removeAccount,
  removeSubscription,
  saveSubscriptionBundle,
  updateAccount,
  upsertSubscription,
} from '@/lib/records';
import type { VaultPayload } from '@/lib/store/format';
import { DEFAULT_SETTINGS } from '@/lib/vault';
import type { Account, Subscription } from '@/lib/vault';
import { entry } from './helpers/controller';

const NOW = '2026-10-02T12:00:00.000Z';
const LATER = '2026-10-03T12:00:00.000Z';

function payload(extra: Partial<VaultPayload> = {}): VaultPayload {
  return {
    entries: [entry('gh'), entry('cg', { url: 'https://chatgpt.example.test' })],
    settings: { ...DEFAULT_SETTINGS },
    recoveryCodes: [],
    ...extra,
  };
}

function account(id: string, extra: Partial<Account> = {}): Account {
  return { id, service: 'ChatGPT', category: 'work', createdAt: NOW, updatedAt: NOW, ...extra };
}

function sub(id: string, accountId: string, extra: Partial<Subscription> = {}): Subscription {
  return {
    id,
    accountId,
    plan: 'Plus',
    amountMinor: 2000,
    currency: 'USD',
    interval: { unit: 'month', count: 1 },
    billingAnchor: '2026-10-15',
    status: 'active',
    provider: 'website',
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

describe('records: reading', () => {
  it('absent collections read as empty and the payload is untouched', () => {
    const p = payload();
    expect(listAccounts(p)).toEqual([]);
    expect(listSubscriptions(p)).toEqual([]);
    expect('accounts' in p).toBe(false);
    expect(canWrite(p, 'accounts')).toBe(true);
  });

  it('malformed items are hidden from lists', () => {
    const p = payload({ accounts: [account('a1'), null, 42, { service: 'no id' }, { id: 7 }] });
    expect(listAccounts(p).map((a) => a.id)).toEqual(['a1']);
  });
});

describe('records: accounts', () => {
  it('two accounts at the same service stay distinct', () => {
    let p = addAccount(payload(), account('work', { label: 'Work', email: 'w@example.test' }))!;
    p = addAccount(p, account('personal', { label: 'Personal', email: 'p@example.test' }))!;
    expect(listAccounts(p).map((a) => [a.id, a.label])).toEqual([
      ['work', 'Work'],
      ['personal', 'Personal'],
    ]);
    expect(addAccount(p, account('work'))).toBeNull(); // same id is refused, never overwritten
  });

  it('updates merge, so fields this build does not know survive', () => {
    const p = payload({ accounts: [{ ...account('a1'), futureField: { keep: true } }] });
    const next = updateAccount(p, 'a1', { email: 'new@example.test' }, LATER)!;
    expect((next.accounts as unknown[])[0]).toEqual({
      ...account('a1'),
      futureField: { keep: true },
      email: 'new@example.test',
      updatedAt: LATER,
    });
  });

  it('an account with subscriptions cannot be removed', () => {
    const p = payload({ accounts: [account('a1')], subscriptions: [sub('s1', 'a1')] });
    expect(removeAccount(p, 'a1')).toEqual({ ok: false, reason: 'has-subscriptions' });
  });

  it('removing an account unlinks its logins and keeps them (updatedAt untouched)', () => {
    let p = payload({ accounts: [account('a1')] });
    p = linkLogin(p, 'cg', 'a1')!;
    const r = removeAccount(p, 'a1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload.entries).toEqual(payload().entries); // same logins, link gone, timestamps untouched
    expect(listAccounts(r.payload)).toEqual([]);
  });

  it('linking a login does not bump its updatedAt (Watchtower reads it)', () => {
    const p = linkLogin(payload({ accounts: [account('a1')] }), 'cg', 'a1')!;
    const e = p.entries.find((x) => x.id === 'cg')!;
    expect(e.accountId).toBe('a1');
    expect(e.updatedAt).toBe(payload().entries[1].updatedAt);
    expect(linkLogin(p, 'cg', 'missing-account')).toBeNull();
    expect(linkLogin(p, 'missing-login', 'a1')).toBeNull();
  });
});

describe('records: subscriptions', () => {
  it('removing a subscription leaves accounts and logins exactly as they were', () => {
    let p = payload({ accounts: [account('a1')] });
    p = linkLogin(p, 'cg', 'a1')!;
    p = upsertSubscription(p, sub('s1', 'a1'))!;
    const next = removeSubscription(p, 's1')!;
    expect(next.entries).toEqual(p.entries);
    expect(next.accounts).toEqual(p.accounts);
    expect(listSubscriptions(next)).toEqual([]);
  });

  it('a subscription needs an existing account', () => {
    expect(upsertSubscription(payload(), sub('s1', 'nope'))).toBeNull();
  });

  it('editing merges unknown fields and drops optional fields that were cleared', () => {
    const stored = { ...sub('s1', 'a1', { status: 'trial', trialEndsOn: '2026-10-20' }), futureField: 1 };
    const p = payload({ accounts: [account('a1')], subscriptions: [stored] });
    const edited = sub('s1', 'a1', { status: 'active', plan: 'Pro', updatedAt: LATER });
    const next = upsertSubscription(p, edited)!;
    expect((next.subscriptions as unknown[])[0]).toEqual({ ...edited, futureField: 1 });
  });

  it('malformed items are carried through every save verbatim', () => {
    const junk = [null, { note: 'no id' }, 'text'];
    const p = payload({ accounts: [account('a1')], subscriptions: [...junk] });
    const next = upsertSubscription(p, sub('s1', 'a1'))!;
    expect(next.subscriptions).toEqual([...junk, sub('s1', 'a1')]);
    expect(removeSubscription(next, 's1')!.subscriptions).toEqual(junk);
  });

  it('a collection that is not an array is never overwritten', () => {
    const p = payload({ accounts: { not: 'an array' }, subscriptions: 'garbage' });
    expect(canWrite(p, 'accounts')).toBe(false);
    expect(addAccount(p, account('a1'))).toBeNull();
    expect(upsertSubscription(p, sub('s1', 'a1'))).toBeNull();
    expect(removeAccount(p, 'a1')).toEqual({ ok: false, reason: 'unwritable' });
    expect(listAccounts(p)).toEqual([]);
  });
});

describe('records: the subscription form saves one bundle', () => {
  it('new account + link to a login + subscription in one change', () => {
    const p = payload();
    const next = saveSubscriptionBundle(
      p,
      { newAccount: account('a1', { label: 'Work' }), linkEntryId: 'cg', subscription: sub('s1', 'a1') },
      NOW,
    )!;
    expect(listAccounts(next).map((a) => a.id)).toEqual(['a1']);
    expect(next.entries.find((e) => e.id === 'cg')!.accountId).toBe('a1');
    expect(listSubscriptions(next).map((s) => s.id)).toEqual(['s1']);
    expect(next.entries.find((e) => e.id === 'gh')).toEqual(p.entries[0]);
  });

  it('refuses the whole bundle when any part is invalid (nothing half-saved)', () => {
    const p = payload();
    expect(
      saveSubscriptionBundle(p, { newAccount: account('a1'), linkEntryId: 'missing', subscription: sub('s1', 'a1') }, NOW),
    ).toBeNull();
    expect(saveSubscriptionBundle(p, { newAccount: account('a2'), subscription: sub('s1', 'a1') }, NOW)).toBeNull();
  });

  it('an account patch from the form is merged into the existing account', () => {
    const p = payload({ accounts: [account('a1')] });
    const next = saveSubscriptionBundle(p, { accountPatch: { email: 'me@example.test' }, subscription: sub('s1', 'a1') }, LATER)!;
    expect(listAccounts(next)[0]).toEqual({ ...account('a1'), email: 'me@example.test', updatedAt: LATER });
  });
});
