import { describe, expect, it } from 'vitest';
import {
  accountsForService,
  draftFromSubscription,
  duplicateAccount,
  newDraft,
  validateDraft,
} from '@/components/subscriptions/form-model';
import type { SubscriptionDraft } from '@/components/subscriptions/form-model';
import type { Account, Subscription } from '@/lib/vault';
import { entry } from './helpers/controller';

const NOW = '2026-10-02T12:00:00.000Z';
const work: Account = { id: 'w', service: 'ChatGPT', serviceKey: 'chatgpt', label: 'Work', email: 'w@example.test', category: 'work', createdAt: NOW, updatedAt: NOW };
const personal: Account = { id: 'p', service: 'ChatGPT', serviceKey: 'chatgpt', label: 'Personal', category: 'work', createdAt: NOW, updatedAt: NOW };
const custom: Account = { id: 'c', service: 'Synthetic Cloud', category: 'other', createdAt: NOW, updatedAt: NOW };
const ACCOUNTS = [work, personal, custom];

const draft = (extra: Partial<SubscriptionDraft> = {}): SubscriptionDraft => ({
  ...newDraft({ presetKey: 'chatgpt', currency: 'USD' }),
  amount: '20',
  ...extra,
});

describe('subscription form model', () => {
  it('a preset fills the service name and website; a login fills the email', () => {
    const login = entry('cg', { title: 'ChatGPT', username: 'me@example.test', url: 'https://chatgpt.com' });
    const d = newDraft({ presetKey: 'chatgpt', currency: 'EUR', login });
    expect(d).toMatchObject({ serviceKey: 'chatgpt', serviceName: 'ChatGPT', website: 'https://chatgpt.com', email: 'me@example.test', linkEntryId: 'cg', currency: 'EUR' });
  });

  it('valid input becomes a new account + subscription', () => {
    const r = validateDraft(draft({ label: 'Work', email: ' w2@example.test ', plan: ' Plus ', billingDate: '2026-10-15' }), ACCOUNTS);
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      account: { create: { service: 'ChatGPT', serviceKey: 'chatgpt', label: 'Work', email: 'w2@example.test', website: 'https://chatgpt.com', category: 'work' } },
      fields: {
        plan: 'Plus',
        amountMinor: 2000,
        currency: 'USD',
        interval: { unit: 'month', count: 1 },
        status: 'active',
        provider: 'website',
        billingAnchor: '2026-10-15',
      },
    });
  });

  it('keeps every date exactly as the date field reported it (a string, never a Date)', () => {
    for (const day of ['2027-01-31', '2028-02-29', '2026-03-29', '2026-11-01', '2026-12-31', '2027-01-01']) {
      const active = validateDraft(draft({ billingDate: day }), ACCOUNTS).value!;
      expect(active.fields.billingAnchor).toBe(day);
      const trial = validateDraft(draft({ status: 'trial', trialEndsOn: day }), ACCOUNTS).value!;
      expect(trial.fields.trialEndsOn).toBe(day);
      const canceled = validateDraft(draft({ status: 'canceled', accessEndsOn: day }), ACCOUNTS).value!;
      expect(canceled.fields.accessEndsOn).toBe(day);
      for (const v of [active, trial, canceled]) {
        for (const value of Object.values(v.fields)) expect(value instanceof Date).toBe(false);
      }
    }
    // and back into the edit form unchanged
    const sub = { ...validateDraft(draft({ billingDate: '2028-02-29' }), ACCOUNTS).value!.fields, id: 's', accountId: 'w', createdAt: NOW, updatedAt: NOW } as Subscription;
    expect(draftFromSubscription(sub, work).billingDate).toBe('2028-02-29');
  });

  it('a trial does not save the billing date hidden by switching to "Free trial"', () => {
    const v = validateDraft(draft({ billingDate: '2027-01-31', status: 'trial', trialEndsOn: '2026-12-31' }), ACCOUNTS).value!;
    expect(v.fields.trialEndsOn).toBe('2026-12-31');
    expect('billingAnchor' in v.fields).toBe(false);
    // a canceled subscription keeps it (renewal is off, but the history is still useful)
    const c = validateDraft(draft({ billingDate: '2027-01-31', status: 'canceled' }), ACCOUNTS).value!;
    expect(c.fields.billingAnchor).toBe('2027-01-31');
  });

  it('refuses dates that are not real days', () => {
    expect(validateDraft(draft({ billingDate: '2027-02-29' }), ACCOUNTS).errors.billingDate).toBeTruthy();
    expect(validateDraft(draft({ status: 'trial', trialEndsOn: '' }), ACCOUNTS).errors.trialEndsOn).toBe('When does the trial end?');
    expect(validateDraft(draft({ status: 'canceled', accessEndsOn: '2026-02-30' }), ACCOUNTS).errors.accessEndsOn).toBeTruthy();
  });

  it('shows errors for a missing service, bad price, bad interval and unnamed provider', () => {
    const r = validateDraft(
      draft({ serviceKey: null, serviceName: ' ', amount: '20.999', intervalPreset: 'custom', customCount: '0', provider: 'other' }),
      ACCOUNTS,
    );
    expect(Object.keys(r.errors).sort()).toEqual(['amount', 'interval', 'providerOther', 'service']);
    expect(r.value).toBeNull();
  });

  it('custom intervals, other currencies and providers', () => {
    const r = validateDraft(
      draft({ intervalPreset: 'custom', customCount: '2', customUnit: 'week', currency: 'JPY', amount: '1500', provider: 'other', providerOther: 'Synthetic Pay', notes: ' n ' }),
      ACCOUNTS,
    ).value!;
    expect(r.fields).toMatchObject({ interval: { unit: 'week', count: 2 }, amountMinor: 1500, currency: 'JPY', provider: 'other', providerOther: 'Synthetic Pay', notes: 'n' });
    expect(validateDraft(draft({ intervalPreset: 'year' }), ACCOUNTS).value!.fields.interval).toEqual({ unit: 'year', count: 1 });
  });

  it('accounts at the same service stay distinct; picking one uses it', () => {
    expect(accountsForService(ACCOUNTS, { serviceKey: 'chatgpt', serviceName: 'ChatGPT' }).map((a) => a.id)).toEqual(['w', 'p']);
    expect(accountsForService(ACCOUNTS, { serviceKey: null, serviceName: ' synthetic cloud ' }).map((a) => a.id)).toEqual(['c']);
    expect(validateDraft(draft({ accountChoice: 'p' }), ACCOUNTS).value!.account).toEqual({ id: 'p' });
    expect(validateDraft(draft({ accountChoice: 'gone' }), ACCOUNTS).errors.account).toBeTruthy();
  });

  it('warns (does not block) when a new account duplicates an existing one', () => {
    const dup = draft({ email: 'W@example.test', label: 'work' });
    expect(duplicateAccount(ACCOUNTS, dup)?.id).toBe('w');
    expect(validateDraft(dup, ACCOUNTS).value).not.toBeNull();
    expect(duplicateAccount(ACCOUNTS, draft({ label: 'Side project' }))).toBeUndefined();
  });

  it('editing round-trips a stored subscription', () => {
    const sub: Subscription = {
      id: 's1', accountId: 'w', plan: 'Team', amountMinor: 2500, currency: 'EUR', interval: { unit: 'month', count: 3 },
      billingAnchor: '2027-01-31', status: 'canceled', accessEndsOn: '2027-04-30', provider: 'apple', notes: 'x',
      createdAt: NOW, updatedAt: NOW,
    };
    const d = draftFromSubscription(sub, work);
    expect(d).toMatchObject({ accountChoice: 'w', amount: '25.00', intervalPreset: 'custom', customCount: '3', customUnit: 'month', status: 'canceled' });
    const { value } = validateDraft(d, ACCOUNTS);
    expect(value!.account).toEqual({ id: 'w' });
    expect(value!.fields).toEqual({
      plan: 'Team', amountMinor: 2500, currency: 'EUR', interval: { unit: 'month', count: 3 }, status: 'canceled',
      provider: 'apple', billingAnchor: '2027-01-31', accessEndsOn: '2027-04-30', notes: 'x',
    });
  });
});
