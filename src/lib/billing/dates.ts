/**
 * Calendar dates for billing — `'YYYY-MM-DD'` strings, exactly as a native
 * `<input type="date">` reports them in `.value`.
 *
 * A calendar date is never turned into a `Date`: parsed by the Date
 * constructor, "2027-01-31" is midnight UTC, which is still January 30th west
 * of Greenwich. All arithmetic
 * here is integer day numbers (days since 1970-01-01 in the proleptic
 * Gregorian calendar), so no time zone or daylight-saving change can move a
 * renewal by a day. The only `Date` used is "now", to find today's local day.
 */

import type { BillingInterval, CalendarDate } from '../vault';

export interface Ymd {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return m === 2 ? (isLeapYear(y) ? 29 : 28) : [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** strict: zero-padded `YYYY-MM-DD`, a real day, years 1000–9999 */
export function parseCalendarDate(value: unknown): Ymd | null {
  if (typeof value !== 'string') return null;
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export function isCalendarDate(value: unknown): value is CalendarDate {
  return parseCalendarDate(value) !== null;
}

export function toCalendarDate({ y, m, d }: Ymd): CalendarDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** days since 1970-01-01 (H. Hinnant's days_from_civil) */
export function dayNumber({ y, m, d }: Ymd): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** inverse of {@link dayNumber} (civil_from_days) */
export function fromDayNumber(n: number): Ymd {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** the user's current calendar day where they are (local clock) */
export function todayLocal(now: Date): CalendarDate {
  return toCalendarDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

/**
 * `n` months after `anchor`, keeping the anchor's day where the month has it
 * and the month's last day where it doesn't. Always computed from the
 * original anchor, so Jan 31 → Feb 28 (or 29) → Mar 31, never Mar 28.
 */
export function addMonthsClamped(anchor: Ymd, n: number): Ymd {
  const total = anchor.y * 12 + (anchor.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return { y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
}

export function isValidInterval(interval: unknown): interval is BillingInterval {
  if (typeof interval !== 'object' || interval === null) return false;
  const { unit, count } = interval as Record<string, unknown>;
  return (
    (unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year') &&
    typeof count === 'number' &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 1000
  );
}

/** the k-th billing date counted from the anchor (k = 0 is the anchor itself) */
export function occurrence(anchor: Ymd, interval: BillingInterval, k: number): Ymd {
  switch (interval.unit) {
    case 'day':
      return fromDayNumber(dayNumber(anchor) + k * interval.count);
    case 'week':
      return fromDayNumber(dayNumber(anchor) + k * interval.count * 7);
    case 'month':
      return addMonthsClamped(anchor, k * interval.count);
    case 'year':
      return addMonthsClamped(anchor, k * interval.count * 12);
  }
}

/**
 * The first billing date on or after `today`, counted from a known billing
 * date. An anchor in the future is returned as is. `null` for invalid input.
 */
export function nextOnOrAfter(anchor: CalendarDate, interval: BillingInterval, today: CalendarDate): CalendarDate | null {
  const a = parseCalendarDate(anchor);
  const t = parseCalendarDate(today);
  if (!a || !t || !isValidInterval(interval)) return null;
  const target = dayNumber(t);
  if (dayNumber(a) >= target) return toCalendarDate(a);

  let k: number;
  if (interval.unit === 'day' || interval.unit === 'week') {
    const step = interval.count * (interval.unit === 'week' ? 7 : 1);
    k = Math.ceil((target - dayNumber(a)) / step);
  } else {
    const stepMonths = interval.count * (interval.unit === 'year' ? 12 : 1);
    const monthsApart = t.y * 12 + t.m - (a.y * 12 + a.m);
    k = Math.max(0, Math.floor(monthsApart / stepMonths));
    // month-end clamping can leave k one or two steps short of today
    while (dayNumber(occurrence(a, interval, k)) < target) k++;
  }
  return toCalendarDate(occurrence(a, interval, k));
}

/** whole days from `from` to `to` (negative when `to` is earlier); `null` for invalid input */
export function daysBetween(from: CalendarDate, to: CalendarDate): number | null {
  const a = parseCalendarDate(from);
  const b = parseCalendarDate(to);
  return a && b ? dayNumber(b) - dayNumber(a) : null;
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0; // zero-padded ISO strings sort by date
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago" */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * "Oct 15, 2026" in the user's locale. Formats the calendar day itself (as a
 * UTC day number), so the shown day is the stored day in every time zone.
 */
export function formatCalendarDate(value: CalendarDate, locale?: string): string {
  const p = parseCalendarDate(value);
  if (!p) return value;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    dayNumber(p) * 86_400_000,
  );
}
