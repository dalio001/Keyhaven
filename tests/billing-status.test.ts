import { describe, expect, it } from 'vitest';
import { compareStates, formatInterval, subscriptionState } from '@/lib/billing/status';
import type { Subscription } from '@/lib/vault';

const TODAY = '2026-10-02';

function sub(extra: Partial<Subscription>): Subscription {
  return {
    id: 's',
    accountId: 'a',
    plan: '',
    amountMinor: 2000,
    currency: 'USD',
    interval: { unit: 'month', count: 1 },
    status: 'active',
    provider: 'website',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

describe('subscription state (derived, never stored)', () => {
  it('active: the next renewal is rolled forward from the known billing date', () => {
    expect(subscriptionState(sub({ billingAnchor: '2026-08-15' }), TODAY)).toEqual({
      kind: 'renews',
      date: '2026-10-15',
      daysLeft: 13,
      problems: [],
    });
    expect(subscriptionState(sub({ billingAnchor: '2026-10-02' }), TODAY).daysLeft).toBe(0);
  });

  it('active without a billing date still shows, just without a date', () => {
    expect(subscriptionState(sub({}), TODAY)).toMatchObject({ kind: 'renews', date: null, daysLeft: null });
  });

  it('trial: shows the trial end; once over it renews from the trial end', () => {
    expect(subscriptionState(sub({ status: 'trial', trialEndsOn: '2026-10-09' }), TODAY)).toMatchObject({
      kind: 'trial',
      date: '2026-10-09',
      daysLeft: 7,
    });
    expect(subscriptionState(sub({ status: 'trial', trialEndsOn: '2026-09-20' }), TODAY)).toMatchObject({
      kind: 'renews',
      date: '2026-10-20',
    });
  });

  it('an expired trial renews from its trial end, even if an older billing date is stored', () => {
    expect(
      subscriptionState(sub({ status: 'trial', trialEndsOn: '2026-09-20', billingAnchor: '2026-08-03' }), TODAY),
    ).toMatchObject({ kind: 'renews', date: '2026-10-20' });
  });

  it('canceled: access until the end date, then ended', () => {
    expect(subscriptionState(sub({ status: 'canceled', accessEndsOn: '2026-10-31' }), TODAY)).toMatchObject({
      kind: 'access-until',
      date: '2026-10-31',
      daysLeft: 29,
    });
    expect(subscriptionState(sub({ status: 'canceled', accessEndsOn: TODAY }), TODAY).kind).toBe('access-until');
    expect(subscriptionState(sub({ status: 'canceled', accessEndsOn: '2026-10-01' }), TODAY).kind).toBe('ended');
    expect(subscriptionState(sub({ status: 'canceled' }), TODAY)).toMatchObject({ kind: 'ended', date: null });
  });

  it('reports fields it cannot use instead of crashing', () => {
    const odd = sub({
      billingAnchor: '2026-02-30',
      currency: 'dollars',
      amountMinor: -1,
      interval: { unit: 'month', count: 0 },
    });
    const s = subscriptionState(odd, TODAY);
    expect(s.kind).toBe('renews');
    expect(s.date).toBeNull();
    expect(s.problems).toEqual(['billing interval', 'price', 'currency', 'billing date']);
  });

  it('orders soonest first, undated after, ended last', () => {
    const states = [
      subscriptionState(sub({ status: 'canceled', accessEndsOn: '2026-09-01' }), TODAY),
      subscriptionState(sub({}), TODAY),
      subscriptionState(sub({ billingAnchor: '2026-10-20' }), TODAY),
      subscriptionState(sub({ status: 'trial', trialEndsOn: '2026-10-05' }), TODAY),
    ];
    expect([...states].sort(compareStates).map((s) => [s.kind, s.date])).toEqual([
      ['trial', '2026-10-05'],
      ['renews', '2026-10-20'],
      ['renews', null],
      ['ended', '2026-09-01'],
    ]);
  });

  it('formats intervals', () => {
    expect(formatInterval({ unit: 'month', count: 1 })).toBe('/ month');
    expect(formatInterval({ unit: 'year', count: 1 })).toBe('/ year');
    expect(formatInterval({ unit: 'week', count: 2 })).toBe('every 2 weeks');
  });
});
