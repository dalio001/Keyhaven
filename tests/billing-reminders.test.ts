import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_DAYS,
  MAX_DISMISSED_REMINDERS,
  dismissedReminders,
  reminderDays,
  reminderKey,
  remindersDue,
  withDismissed,
} from '@/lib/billing/reminders';
import { parsePayload } from '@/lib/store/format';
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

const rows = (r: ReturnType<typeof remindersDue>) => r.map((x) => [x.sub.id, x.date, x.daysLeft, x.kind]);

describe('renewal reminders (Phase 5)', () => {
  const SUBS = [
    sub('later', { billingAnchor: '2026-09-08' }), // next 2026-10-08, 6 days
    sub('tomorrow', { billingAnchor: '2026-09-03' }), // next 2026-10-03
    sub('trial', { status: 'trial', trialEndsOn: '2026-10-04', currency: 'EUR' }),
    sub('same-day', { billingAnchor: '2026-08-04' }), // next 2026-10-04
    sub('today', { billingAnchor: '2025-10-02', interval: { unit: 'year', count: 1 } }),
  ];

  it('renewals and trial ends from today to N days ahead, soonest first, trials first on a shared day', () => {
    expect(rows(remindersDue(SUBS, TODAY, 3))).toEqual([
      ['today', '2026-10-02', 0, 'renews'],
      ['tomorrow', '2026-10-03', 1, 'renews'],
      ['trial', '2026-10-04', 2, 'trial'],
      ['same-day', '2026-10-04', 2, 'renews'],
    ]);
  });

  it('the window ends exactly N days ahead', () => {
    expect(rows(remindersDue(SUBS, TODAY, 1)).map((r) => r[0])).toEqual(['today', 'tomorrow']);
    expect(rows(remindersDue(SUBS, TODAY, 5)).map((r) => r[0])).not.toContain('later');
    expect(rows(remindersDue(SUBS, TODAY, 6)).map((r) => r[0])).toContain('later');
  });

  it('off (0) or an unusable setting shows nothing', () => {
    expect(remindersDue(SUBS, TODAY, 0)).toEqual([]);
    expect(remindersDue(SUBS, TODAY, -1)).toEqual([]);
    expect(remindersDue(SUBS, TODAY, Number.NaN)).toEqual([]);
    expect(remindersDue(SUBS, 'not-a-date', 3)).toEqual([]);
  });

  it('canceled, needing attention, or without a billing date: no reminder', () => {
    const r = remindersDue(
      [
        sub('canceled', { status: 'canceled', billingAnchor: '2026-09-03', accessEndsOn: '2026-10-03' }),
        sub('bad-currency', { billingAnchor: '2026-09-03', currency: 'dollars' }),
        sub('bad-price', { billingAnchor: '2026-09-03', amountMinor: -5 }),
        sub('bad-date', { billingAnchor: '2026-02-30' }),
        sub('undated', {}),
      ],
      TODAY,
      7,
    );
    expect(r).toEqual([]);
  });

  it('a trial that is over counts its renewals from the trial end', () => {
    const r = remindersDue([sub('t', { status: 'trial', trialEndsOn: '2026-09-04', billingAnchor: '2026-01-01' })], TODAY, 3);
    expect(rows(r)).toEqual([['t', '2026-10-04', 2, 'renews']]);
  });

  it('month-end and leap-day billing dates match the rest of KeyHaven', () => {
    expect(rows(remindersDue([sub('m', { billingAnchor: '2027-01-31' })], '2027-02-26', 3))).toEqual([['m', '2027-02-28', 2, 'renews']]);
    expect(rows(remindersDue([sub('m', { billingAnchor: '2028-01-31' })], '2028-02-27', 3))).toEqual([['m', '2028-02-29', 2, 'renews']]);
    const leap = sub('y', { billingAnchor: '2024-02-29', interval: { unit: 'year', count: 1 } });
    expect(rows(remindersDue([leap], '2027-02-26', 3))).toEqual([['y', '2027-02-28', 2, 'renews']]);
    expect(rows(remindersDue([leap], '2028-02-27', 3))).toEqual([['y', '2028-02-29', 2, 'renews']]);
  });

  it('"Hide until next time" hides that renewal only; the next one is reminded again', () => {
    const daily = sub('d', { billingAnchor: '2026-10-01', interval: { unit: 'day', count: 2 } }); // 10-03, 10-05, …
    const hidden = [reminderKey('d', '2026-10-03')];
    // hidden now — and the later renewal inside the window doesn't pop up in its place
    expect(remindersDue([daily], TODAY, 7, hidden)).toEqual([]);
    // once that day has passed, the next renewal is the one reminded about
    expect(rows(remindersDue([daily], '2026-10-04', 7, hidden))).toEqual([['d', '2026-10-05', 1, 'renews']]);
    expect(remindersDue([daily], TODAY, 7)[0].key).toBe('d:2026-10-03');
  });
});

describe('reminder settings (stored in the encrypted vault settings)', () => {
  it('days before: default 3; any whole number 0–30 is kept; anything else falls back', () => {
    expect(DEFAULT_REMINDER_DAYS).toBe(3);
    expect(reminderDays({})).toBe(3);
    expect(reminderDays({ renewalReminderDays: 0 })).toBe(0);
    expect(reminderDays({ renewalReminderDays: 7 })).toBe(7);
    expect(reminderDays({ renewalReminderDays: 14 })).toBe(14); // a later version's choice is honoured
    for (const bad of [-1, 31, 2.5, '3', null, Number.NaN]) {
      expect(reminderDays({ renewalReminderDays: bad as never })).toBe(3);
    }
  });

  it('hidden reminders: only well-formed keys are read', () => {
    expect(dismissedReminders({})).toEqual([]);
    expect(dismissedReminders({ dismissedReminders: 'x' as never })).toEqual([]);
    expect(dismissedReminders({ dismissedReminders: ['a:2026-10-03', 5, 'nodate', 'b:2026-1-3'] as never })).toEqual(['a:2026-10-03']);
  });

  it('hiding drops keys for days that have passed, never duplicates, and stays bounded', () => {
    expect(withDismissed(['old:2026-10-01', 'keep:2026-10-02', 'x:2026-10-05'], 'x:2026-10-05', TODAY)).toEqual(['keep:2026-10-02', 'x:2026-10-05']);
    const many = Array.from({ length: MAX_DISMISSED_REMINDERS + 20 }, (_, i) => `s${i}:2026-12-01`);
    const out = withDismissed(many, 'new:2026-10-03', TODAY);
    expect(out).toHaveLength(MAX_DISMISSED_REMINDERS);
    expect(out.at(-1)).toBe('new:2026-10-03');
  });

  it('the new settings keys survive decoding next to unknown ones (older builds read settings the same way)', () => {
    const p = parsePayload(
      JSON.stringify({
        entries: [],
        settings: { autoLockMinutes: 5, renewalReminderDays: 7, dismissedReminders: ['s:2026-10-03'], fromTheFuture: true },
        recoveryCodes: [],
      }),
    );
    expect(p.settings).toMatchObject({ autoLockMinutes: 5, clipboardClearSeconds: 20, renewalReminderDays: 7, dismissedReminders: ['s:2026-10-03'], fromTheFuture: true });
  });
});
