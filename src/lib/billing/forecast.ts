/**
 * The Phase-4 overview — what the recorded subscriptions add up to, derived
 * on the fly (nothing is stored, viewing never writes).
 *
 * Rules (see docs/security-model.md, "Totals"):
 * - Amounts are only ever added within one currency. No conversion.
 * - A subscription that needs attention (an unusable price, currency,
 *   interval, status or date) is counted, never added up.
 * - Canceled subscriptions have no future charges.
 * - A trial's first charge is its end date (renewalAnchor), so trials show up
 *   in the month and 12-month figures; the averages say how many trials they
 *   include.
 * - "This month" and "next 12 months" are the charges actually scheduled; the
 *   monthly average is a separate estimate.
 */

import type { BillingInterval, CalendarDate, Subscription } from '../vault';
import { addDays, addMonthsClamped, isValidInterval, monthBounds, occurrencesBetween, parseCalendarDate, toCalendarDate, daysBetween } from './dates';
import { renewalAnchor, subscriptionState } from './status';
import type { SubscriptionState } from './status';

/** "next 30 days": today … today + 30, both included */
export const UPCOMING_DAYS = 30;
/** "trials ending soon": ends within 0 … 14 days */
export const TRIAL_SOON_DAYS = 14;
/** mean Gregorian year (146097 days / 400 years) — how often day/week plans bill over time */
export const DAYS_PER_YEAR = 365.2425;

export interface Charge {
  sub: Subscription;
  date: CalendarDate;
}

export interface CurrencyTotal {
  currency: string;
  totalMinor: number;
  charges: number;
}

export interface MonthTotal extends CurrencyTotal {
  /** charged before today */
  earlierMinor: number;
  /** today or later */
  remainingMinor: number;
}

export interface CurrencyAverage {
  currency: string;
  /** fractional minor units; round only for display */
  monthlyMinor: number;
  subscriptions: number;
  trials: number;
}

export interface UpcomingCharge {
  sub: Subscription;
  date: CalendarDate;
  daysLeft: number;
  /** 'trial': the trial ends and the first charge falls on this day */
  kind: 'renews' | 'trial';
}

export interface Overview {
  month: { start: CalendarDate; end: CalendarDate; totals: MonthTotal[] };
  upcoming: UpcomingCharge[];
  trials: UpcomingCharge[];
  averages: CurrencyAverage[];
  yearAhead: { start: CalendarDate; end: CalendarDate; totals: CurrencyTotal[] };
  /** billable, but no billing date to count from */
  undated: number;
  /** some field can't be used as stored */
  needsAttention: number;
}

/** counted in the figures: nothing unusable, and still renewing or in a trial */
export function isBillable(state: SubscriptionState): boolean {
  return state.problems.length === 0 && (state.kind === 'renews' || state.kind === 'trial');
}

/** what one charge every `interval` costs per month, on average (fractional) */
export function monthlyEquivalent(amountMinor: number, interval: BillingInterval): number | null {
  if (!isValidInterval(interval)) return null;
  switch (interval.unit) {
    case 'month':
      return amountMinor / interval.count;
    case 'year':
      return amountMinor / (12 * interval.count);
    case 'week':
      return (amountMinor * DAYS_PER_YEAR) / (84 * interval.count);
    case 'day':
      return (amountMinor * DAYS_PER_YEAR) / (12 * interval.count);
  }
}

/** every scheduled charge of the billable subscriptions from `from` to `to` (both included) */
export function chargesBetween(subs: readonly Subscription[], from: CalendarDate, to: CalendarDate, today: CalendarDate): Charge[] {
  const out: Charge[] = [];
  for (const sub of subs) {
    if (!isBillable(subscriptionState(sub, today))) continue;
    const anchor = renewalAnchor(sub);
    if (!anchor) continue;
    for (const date of occurrencesBetween(anchor, sub.interval, from, to)) out.push({ sub, date });
  }
  return out;
}

/** sums per currency, sorted by currency code */
export function totalsByCurrency(charges: readonly Charge[]): CurrencyTotal[] {
  const by = new Map<string, CurrencyTotal>();
  for (const { sub } of charges) {
    const t = by.get(sub.currency) ?? { currency: sub.currency, totalMinor: 0, charges: 0 };
    t.totalMinor += sub.amountMinor;
    t.charges += 1;
    by.set(sub.currency, t);
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

export function subscriptionOverview(subs: readonly Subscription[], today: CalendarDate): Overview {
  const month = monthBounds(today)!;
  const t = parseCalendarDate(today)!;
  const yearEnd = addDays(toCalendarDate(addMonthsClamped(t, 12)), -1)!;
  const upcomingEnd = addDays(today, UPCOMING_DAYS)!;

  let undated = 0;
  let needsAttention = 0;
  const upcoming: UpcomingCharge[] = [];
  const averages = new Map<string, CurrencyAverage>();
  for (const sub of subs) {
    const state = subscriptionState(sub, today);
    if (state.problems.length > 0) {
      needsAttention++;
      continue;
    }
    if (!isBillable(state)) continue;
    const avg = averages.get(sub.currency) ?? { currency: sub.currency, monthlyMinor: 0, subscriptions: 0, trials: 0 };
    avg.monthlyMinor += monthlyEquivalent(sub.amountMinor, sub.interval) ?? 0;
    avg.subscriptions += 1;
    if (state.kind === 'trial') avg.trials += 1;
    averages.set(sub.currency, avg);

    const anchor = renewalAnchor(sub);
    if (!anchor) {
      undated++;
      continue;
    }
    const [next] = occurrencesBetween(anchor, sub.interval, today, upcomingEnd, 1);
    if (next) upcoming.push({ sub, date: next, daysLeft: daysBetween(today, next)!, kind: state.kind === 'trial' ? 'trial' : 'renews' });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'trial' ? -1 : 1) || a.sub.id.localeCompare(b.sub.id));

  const monthCharges = chargesBetween(subs, month.start, month.end, today);
  const monthTotals: MonthTotal[] = totalsByCurrency(monthCharges).map((total) => {
    const earlierMinor = monthCharges
      .filter((c) => c.sub.currency === total.currency && c.date < today)
      .reduce((sum, c) => sum + c.sub.amountMinor, 0);
    return { ...total, earlierMinor, remainingMinor: total.totalMinor - earlierMinor };
  });

  return {
    month: { ...month, totals: monthTotals },
    upcoming,
    trials: upcoming.filter((u) => u.kind === 'trial' && u.daysLeft <= TRIAL_SOON_DAYS),
    averages: [...averages.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    yearAhead: { start: today, end: yearEnd, totals: totalsByCurrency(chargesBetween(subs, today, yearEnd, today)) },
    undated,
    needsAttention,
  };
}
