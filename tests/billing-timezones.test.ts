import { afterAll, describe, expect, it } from 'vitest';
import { formatCalendarDate, formatMonthYear, nextOnOrAfter, occurrencesBetween, todayLocal } from '@/lib/billing/dates';
import { subscriptionOverview } from '@/lib/billing/forecast';

// Node applies a changed TZ immediately; this file runs in its own worker
const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe.each(['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Tokyo', 'Europe/Berlin', 'UTC'])(
  'billing dates in %s',
  (tz) => {
    it('never shift by a day', () => {
      process.env.TZ = tz;
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
      expect(formatCalendarDate('2027-01-31', 'en-US')).toBe('Jan 31, 2027');
      expect(formatCalendarDate('2026-03-29', 'en-US')).toBe('Mar 29, 2026'); // EU daylight-saving day
      expect(formatCalendarDate('2026-11-01', 'en-US')).toBe('Nov 1, 2026'); // US daylight-saving day
      expect(nextOnOrAfter('2027-01-31', { unit: 'month', count: 1 }, '2027-03-01')).toBe('2027-03-31');
      expect(todayLocal(new Date(2026, 9, 2, 0, 0))).toBe('2026-10-02');
      expect(todayLocal(new Date(2026, 9, 2, 23, 59))).toBe('2026-10-02');
      expect(formatMonthYear('2026-10-01', 'en-US')).toBe('October 2026');
      expect(formatMonthYear('2026-11-01', 'en-US')).toBe('November 2026');
      expect(occurrencesBetween('2027-01-31', { unit: 'month', count: 1 }, '2027-02-01', '2027-03-31')).toEqual(['2027-02-28', '2027-03-31']);
      const o = subscriptionOverview(
        [{ id: 's', accountId: 'a', plan: '', amountMinor: 1000, currency: 'USD', interval: { unit: 'month', count: 1 }, billingAnchor: '2026-01-31', status: 'active', provider: 'website', createdAt: '', updatedAt: '' }],
        todayLocal(new Date(2026, 9, 31, 23, 30)),
      );
      expect([o.month.start, o.month.end, o.upcoming[0]?.date, o.yearAhead.end]).toEqual(['2026-10-01', '2026-10-31', '2026-10-31', '2027-10-30']);
    });
  },
);
