import { describe, expect, it } from 'vitest';
import {
  addMonthsClamped,
  dayNumber,
  daysBetween,
  formatCalendarDate,
  fromDayNumber,
  isCalendarDate,
  nextOnOrAfter,
  occurrence,
  parseCalendarDate,
  relativeDays,
  toCalendarDate,
  todayLocal,
} from '@/lib/billing/dates';
import type { BillingInterval } from '@/lib/vault';

const MONTHLY: BillingInterval = { unit: 'month', count: 1 };
const ANNUAL: BillingInterval = { unit: 'year', count: 1 };
const ymd = (s: string) => parseCalendarDate(s)!;
const occ = (anchor: string, interval: BillingInterval, k: number) => toCalendarDate(occurrence(ymd(anchor), interval, k));

describe('calendar dates', () => {
  it('accepts only real, zero-padded YYYY-MM-DD days', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    for (const bad of ['2027-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '2026-04-31', '26-04-01', '2026-04-01T00:00', '', null, 20260401]) {
      expect(isCalendarDate(bad)).toBe(false);
    }
  });

  it('day numbers round-trip across centuries, leap days and the epoch', () => {
    expect(dayNumber(ymd('1970-01-01'))).toBe(0);
    for (let n = -800_000; n <= 800_000; n += 997) {
      expect(dayNumber(fromDayNumber(n))).toBe(n);
    }
    expect(toCalendarDate(fromDayNumber(dayNumber(ymd('2000-02-29')) + 1))).toBe('2000-03-01');
    expect(toCalendarDate(fromDayNumber(dayNumber(ymd('2100-02-28')) + 1))).toBe('2100-03-01'); // 2100 is not leap
  });

  it('"today" is the local calendar day, even late in the evening', () => {
    expect(todayLocal(new Date(2026, 9, 2, 23, 30))).toBe('2026-10-02');
    expect(todayLocal(new Date(2026, 9, 3, 0, 5))).toBe('2026-10-03');
  });
});

describe('month-end and leap-year billing', () => {
  it('a Jan 31 monthly plan bills on the last day of short months, then the 31st again', () => {
    expect([1, 2, 3, 4].map((k) => occ('2027-01-31', MONTHLY, k))).toEqual([
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
    ]);
    expect(occ('2028-01-31', MONTHLY, 1)).toBe('2028-02-29');
    expect(toCalendarDate(addMonthsClamped(ymd('2027-12-31'), 2))).toBe('2028-02-29');
  });

  it('a Feb 29 annual plan bills Feb 28 in common years and Feb 29 in leap years', () => {
    expect([1, 2, 3, 4].map((k) => occ('2028-02-29', ANNUAL, k))).toEqual([
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('next billing date on or after today', () => {
    expect(nextOnOrAfter('2027-01-31', MONTHLY, '2027-03-01')).toBe('2027-03-31');
    expect(nextOnOrAfter('2027-01-31', MONTHLY, '2027-02-28')).toBe('2027-02-28'); // due today
    expect(nextOnOrAfter('2027-01-31', MONTHLY, '2027-03-31')).toBe('2027-03-31');
    expect(nextOnOrAfter('2028-02-29', ANNUAL, '2029-03-01')).toBe('2030-02-28');
    expect(nextOnOrAfter('2028-02-29', ANNUAL, '2031-03-01')).toBe('2032-02-29');
    expect(nextOnOrAfter('2026-12-15', MONTHLY, '2026-10-02')).toBe('2026-12-15'); // future anchor as is
  });

  it('custom intervals: every 2 weeks, every 6 months, every 10 days', () => {
    expect(nextOnOrAfter('2026-09-01', { unit: 'week', count: 2 }, '2026-10-02')).toBe('2026-10-13');
    expect(nextOnOrAfter('2026-09-01', { unit: 'week', count: 2 }, '2026-09-29')).toBe('2026-09-29');
    expect(nextOnOrAfter('2025-08-31', { unit: 'month', count: 6 }, '2026-10-02')).toBe('2027-02-28');
    expect(nextOnOrAfter('2026-09-25', { unit: 'day', count: 10 }, '2026-10-02')).toBe('2026-10-05');
  });

  it('matches stepping one occurrence at a time, for every day of four years', () => {
    const anchors = ['2027-01-31', '2027-01-30', '2028-02-29', '2027-08-31', '2027-03-15'];
    const intervals: BillingInterval[] = [MONTHLY, ANNUAL, { unit: 'month', count: 3 }, { unit: 'week', count: 1 }];
    for (const anchor of anchors) {
      for (const interval of intervals) {
        for (let n = dayNumber(ymd(anchor)) - 3; n < dayNumber(ymd(anchor)) + 4 * 366; n += 1) {
          const today = toCalendarDate(fromDayNumber(n));
          let k = 0;
          while (occ(anchor, interval, k) < today) k++;
          expect(nextOnOrAfter(anchor, interval, today)).toBe(occ(anchor, interval, k));
        }
      }
    }
  });

  it('rejects invalid input instead of guessing', () => {
    expect(nextOnOrAfter('2027-02-29', MONTHLY, '2027-03-01')).toBeNull();
    expect(nextOnOrAfter('2027-01-31', { unit: 'month', count: 0 }, '2027-03-01')).toBeNull();
    expect(nextOnOrAfter('2027-01-31', { unit: 'fortnight', count: 1 } as unknown as BillingInterval, '2027-03-01')).toBeNull();
  });
});

describe('days and labels', () => {
  it('counts days across a year boundary and a leap day', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-15', '2026-10-02')).toBe(-13);
    expect(relativeDays(0)).toBe('today');
    expect(relativeDays(1)).toBe('tomorrow');
    expect(relativeDays(13)).toBe('in 13 days');
    expect(relativeDays(-3)).toBe('3 days ago');
  });

  it('shows the stored day in every time zone', () => {
    // formatting goes through the UTC day number, so the zone of the machine doesn't matter
    expect(formatCalendarDate('2027-01-31', 'en-US')).toBe('Jan 31, 2027');
    expect(formatCalendarDate('2028-02-29', 'en-US')).toBe('Feb 29, 2028');
  });
});
