/**
 * What a subscription means today — derived from what the user recorded,
 * never stored (viewing a subscription never writes to the vault).
 */

import type { BillingInterval, CalendarDate, Subscription } from '../vault';
import { daysBetween, isCalendarDate, isValidInterval, nextOnOrAfter } from './dates';
import { isCurrencyCode } from './money';

export type SubscriptionStateKind =
  /** active: renews on `date` (null when no billing date was entered) */
  | 'renews'
  /** in a trial that ends on `date` */
  | 'trial'
  /** canceled, paid access lasts until `date` */
  | 'access-until'
  /** canceled and access has ended (on `date`, when known) */
  | 'ended';

export interface SubscriptionState {
  kind: SubscriptionStateKind;
  date: CalendarDate | null;
  /** days from today to `date` */
  daysLeft: number | null;
  /** fields that can't be used as stored — shown as "needs attention" */
  problems: string[];
}

export function subscriptionState(sub: Subscription, today: CalendarDate): SubscriptionState {
  const problems: string[] = [];
  if (!isValidInterval(sub.interval)) problems.push('billing interval');
  if (!Number.isSafeInteger(sub.amountMinor) || sub.amountMinor < 0) problems.push('price');
  if (!isCurrencyCode(sub.currency)) problems.push('currency');
  for (const k of ['billingAnchor', 'trialEndsOn', 'accessEndsOn'] as const) {
    if (sub[k] !== undefined && !isCalendarDate(sub[k])) problems.push(DATE_LABELS[k]);
  }
  const at = (kind: SubscriptionStateKind, date: CalendarDate | null): SubscriptionState => ({
    kind,
    date,
    daysLeft: date ? daysBetween(today, date) : null,
    problems,
  });

  if (sub.status === 'canceled') {
    if (!isCalendarDate(sub.accessEndsOn)) return at('ended', null);
    return at(sub.accessEndsOn >= today ? 'access-until' : 'ended', sub.accessEndsOn);
  }
  if (sub.status === 'trial' && isCalendarDate(sub.trialEndsOn) && sub.trialEndsOn >= today) {
    return at('trial', sub.trialEndsOn);
  }
  if (sub.status !== 'active' && sub.status !== 'trial') problems.push('status');
  const anchor = renewalAnchor(sub);
  return at('renews', anchor && isValidInterval(sub.interval) ? nextOnOrAfter(anchor, sub.interval, today) : null);
}

/**
 * The date renewals are counted from. Active: the billing date. A trial's
 * first charge is its end date, so a trial (running or over) counts from
 * there even if an older billing date is stored; the billing date is only a
 * fallback. Canceled subscriptions don't renew: `null`.
 */
export function renewalAnchor(sub: Subscription): CalendarDate | null {
  if (sub.status === 'canceled') return null;
  if (sub.status === 'trial' && isCalendarDate(sub.trialEndsOn)) return sub.trialEndsOn;
  return isCalendarDate(sub.billingAnchor) ? sub.billingAnchor : null;
}

const DATE_LABELS = {
  billingAnchor: 'billing date',
  trialEndsOn: 'trial end date',
  accessEndsOn: 'access end date',
} as const;

const KIND_ORDER: Record<SubscriptionStateKind, number> = { trial: 0, renews: 0, 'access-until': 0, ended: 1 };

/** list order: soonest date first, undated after, ended last */
export function compareStates(a: SubscriptionState, b: SubscriptionState): number {
  if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.kind === 'ended') return (b.date ?? '').localeCompare(a.date ?? ''); // most recently ended first
  if (a.date && b.date) return a.date.localeCompare(b.date);
  return a.date ? -1 : b.date ? 1 : 0;
}

const UNIT_WORD = { day: 'day', week: 'week', month: 'month', year: 'year' } as const;

/** "/ month", "/ year", "every 2 weeks" */
export function formatInterval(interval: BillingInterval): string {
  if (!isValidInterval(interval)) return '';
  return interval.count === 1 ? `/ ${UNIT_WORD[interval.unit]}` : `every ${interval.count} ${UNIT_WORD[interval.unit]}s`;
}
