import { describe, expect, it } from 'vitest';
import { monthlyEquivalent, subscriptionOverview } from '@/lib/billing/forecast';
import type { Subscription } from '@/lib/vault';

const TODAY = '2026-10-02';
const NOW = '2026-01-01T00:00:00.000Z';

function sub(id: string, extra: Partial<Subscription>): Subscription {
  return {
    id,
    accountId: `acct-${id}`,
    plan: '',
    amountMinor: 2000,
    currency: 'USD',
    interval: { unit: 'month', count: 1 },
    status: 'active',
    provider: 'website',
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

// the same set the browser E2E enters by hand
const FIXTURE: Subscription[] = [
  sub('chatgpt', { amountMinor: 2000, billingAnchor: '2026-10-15' }),
  sub('domain', { amountMinor: 12000, interval: { unit: 'year', count: 1 }, billingAnchor: '2027-01-31' }),
  sub('gemini', { amountMinor: 1000, billingAnchor: '2026-01-31' }),
  sub('claude', { amountMinor: 1800, currency: 'EUR', status: 'trial', trialEndsOn: '2026-10-09' }),
  sub('gym', { amountMinor: 1500, currency: 'JPY', interval: { unit: 'week', count: 2 }, billingAnchor: '2026-09-25' }),
  sub('old', { amountMinor: 999, status: 'canceled', billingAnchor: '2026-01-20', accessEndsOn: '2026-10-20' }),
];

describe('subscription overview (Phase 4)', () => {
  const o = subscriptionOverview(FIXTURE, TODAY);

  it('expected this month: per currency, never added together; canceled not counted', () => {
    expect(o.month.start).toBe('2026-10-01');
    expect(o.month.end).toBe('2026-10-31');
    expect(o.month.totals).toEqual([
      { currency: 'EUR', totalMinor: 1800, charges: 1, earlierMinor: 0, remainingMinor: 1800 },
      { currency: 'JPY', totalMinor: 3000, charges: 2, earlierMinor: 0, remainingMinor: 3000 },
      { currency: 'USD', totalMinor: 3000, charges: 2, earlierMinor: 0, remainingMinor: 3000 },
    ]);
  });

  it('charges earlier this month are split from those still to come', () => {
    const r = subscriptionOverview([sub('a', { billingAnchor: '2026-09-01' }), sub('b', { billingAnchor: '2026-09-20', amountMinor: 500 })], TODAY);
    expect(r.month.totals).toEqual([{ currency: 'USD', totalMinor: 2500, charges: 2, earlierMinor: 2000, remainingMinor: 500 }]);
  });

  it('next 30 days: one row per subscription, its next charge, soonest first', () => {
    expect(o.upcoming.map((u) => [u.sub.id, u.date, u.daysLeft, u.kind])).toEqual([
      ['claude', '2026-10-09', 7, 'trial'],
      ['gym', '2026-10-09', 7, 'renews'],
      ['chatgpt', '2026-10-15', 13, 'renews'],
      ['gemini', '2026-10-31', 29, 'renews'],
    ]);
  });

  it('trials ending within two weeks', () => {
    expect(o.trials.map((t) => [t.sub.id, t.date, t.daysLeft])).toEqual([['claude', '2026-10-09', 7]]);
    expect(subscriptionOverview([sub('t', { status: 'trial', trialEndsOn: '2026-10-20' })], TODAY).trials).toHaveLength(0);
  });

  it('monthly averages per currency, trials included and counted', () => {
    expect(o.averages.map((a) => a.currency)).toEqual(['EUR', 'JPY', 'USD']);
    const [eur, jpy, usd] = o.averages;
    expect(usd.monthlyMinor).toBeCloseTo(4000, 6); // 20 + 120/12 + 10
    expect(usd).toMatchObject({ subscriptions: 3, trials: 0 });
    expect(eur).toMatchObject({ monthlyMinor: 1800, subscriptions: 1, trials: 1 });
    expect(jpy.monthlyMinor).toBeCloseTo((1500 * 365.2425) / 168, 6); // ≈ ¥3,261
  });

  it('next 12 months: the charges actually scheduled, not the average × 12', () => {
    expect(o.yearAhead.start).toBe('2026-10-02');
    expect(o.yearAhead.end).toBe('2027-10-01');
    expect(o.yearAhead.totals).toEqual([
      { currency: 'EUR', totalMinor: 21600, charges: 12 },
      { currency: 'JPY', totalMinor: 39000, charges: 26 },
      { currency: 'USD', totalMinor: 48000, charges: 25 },
    ]);
  });

  it('subscriptions that need attention are counted, never added up', () => {
    const r = subscriptionOverview(
      [
        sub('ok', { billingAnchor: '2026-10-10' }),
        sub('noprice', { amountMinor: -5, billingAnchor: '2026-10-10' }),
        sub('nocur', { currency: 'dollars', billingAnchor: '2026-10-10' }),
        sub('nointerval', { interval: { unit: 'fortnight', count: 1 } as never, billingAnchor: '2026-10-10' }),
        sub('baddate', { billingAnchor: '2026-02-30' }),
      ],
      TODAY,
    );
    expect(r.needsAttention).toBe(4);
    expect(r.month.totals).toEqual([{ currency: 'USD', totalMinor: 2000, charges: 1, earlierMinor: 0, remainingMinor: 2000 }]);
    expect(r.averages).toEqual([{ currency: 'USD', monthlyMinor: 2000, subscriptions: 1, trials: 0 }]);
  });

  it('without a billing date: in the averages, not in anything dated', () => {
    const r = subscriptionOverview([sub('nodate', {})], TODAY);
    expect(r.undated).toBe(1);
    expect(r.month.totals).toEqual([]);
    expect(r.upcoming).toEqual([]);
    expect(r.averages).toEqual([{ currency: 'USD', monthlyMinor: 2000, subscriptions: 1, trials: 0 }]);
  });

  it('nothing at all, or only canceled: empty figures', () => {
    for (const subs of [[], [FIXTURE[5]]]) {
      const r = subscriptionOverview(subs, TODAY);
      expect([r.month.totals, r.upcoming, r.trials, r.averages, r.yearAhead.totals]).toEqual([[], [], [], [], []]);
      expect(r.needsAttention + r.undated).toBe(0);
    }
  });

  it('leap day: a 12-month window from Feb 29 and a yearly plan anchored there', () => {
    const r = subscriptionOverview(
      [sub('y', { interval: { unit: 'year', count: 1 }, billingAnchor: '2028-02-29' }), sub('m', { billingAnchor: '2028-01-31' })],
      '2028-02-29',
    );
    expect(r.yearAhead.end).toBe('2029-02-27');
    expect(r.month).toMatchObject({ start: '2028-02-01', end: '2028-02-29' });
    expect(r.month.totals[0]).toMatchObject({ charges: 2, totalMinor: 4000 }); // yearly Feb 29 + monthly Feb 29
    expect(r.yearAhead.totals[0].charges).toBe(1 + 12);
  });

  it('a daily plan stays bounded and huge prices never crash', () => {
    const r = subscriptionOverview([sub('d', { interval: { unit: 'day', count: 1 }, billingAnchor: '2020-01-01', amountMinor: Number.MAX_SAFE_INTEGER })], TODAY);
    expect(r.yearAhead.totals[0].charges).toBe(365);
    expect(r.month.totals[0].charges).toBe(31);
  });
});

describe('monthly equivalent', () => {
  it('per billing unit', () => {
    expect(monthlyEquivalent(2000, { unit: 'month', count: 1 })).toBe(2000);
    expect(monthlyEquivalent(3000, { unit: 'month', count: 3 })).toBe(1000);
    expect(monthlyEquivalent(12000, { unit: 'year', count: 1 })).toBe(1000);
    expect(monthlyEquivalent(700, { unit: 'week', count: 1 })).toBeCloseTo((700 * 365.2425) / 84, 9);
    expect(monthlyEquivalent(100, { unit: 'day', count: 1 })).toBeCloseTo((100 * 365.2425) / 12, 9);
    expect(monthlyEquivalent(100, { unit: 'month', count: 0 } as never)).toBeNull();
  });
});
