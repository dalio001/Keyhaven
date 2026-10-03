/**
 * Renewal reminders (Phase 5) — which renewals and trial ends are close
 * enough to mention, derived on the fly like the rest of the overview.
 *
 * KeyHaven has no server, so it can only remind you while it is open; the
 * calendar file (./ics.ts) carries the same reminders into your calendar app.
 * The settings live in the encrypted vault settings, never in localStorage:
 * - `renewalReminderDays`: how many days ahead (0 = off, default 3);
 * - `dismissedReminders`: "Hide until next time" keys, `subscriptionId:YYYY-MM-DD`.
 */

import type { CalendarDate, Subscription, VaultSettings } from '../vault';
import { addDays, daysBetween, occurrencesBetween } from './dates';
import { compareUpcoming, isBillable } from './forecast';
import type { UpcomingCharge } from './forecast';
import { renewalAnchor, subscriptionState } from './status';

export const DEFAULT_REMINDER_DAYS = 3;
/** the choices offered in Settings; any whole number up to MAX_REMINDER_DAYS is honoured */
export const REMINDER_DAY_CHOICES = [0, 1, 3, 7] as const;
export const MAX_REMINDER_DAYS = 30;
export const MAX_DISMISSED_REMINDERS = 500;

export interface DueReminder extends UpcomingCharge {
  /** what "Hide until next time" remembers: this subscription's charge on this day */
  key: string;
}

const KEY_RE = /:\d{4}-\d{2}-\d{2}$/;

export function reminderKey(subscriptionId: string, date: CalendarDate): string {
  return `${subscriptionId}:${date}`;
}

/** days ahead to remind; an unusable stored value falls back to the default */
export function reminderDays(settings: Partial<VaultSettings>): number {
  const v = settings.renewalReminderDays;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_REMINDER_DAYS ? v : DEFAULT_REMINDER_DAYS;
}

/** the hidden reminders, well-formed keys only */
export function dismissedReminders(settings: Partial<VaultSettings>): string[] {
  const v = settings.dismissedReminders;
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)) : [];
}

/**
 * The list to store after hiding `key`: keys for days before today can't
 * come back, so they are dropped; no duplicates; at most
 * MAX_DISMISSED_REMINDERS (the newest kept).
 */
export function withDismissed(list: readonly string[], key: string, today: CalendarDate): string[] {
  const keep = list.filter((k) => k !== key && k.slice(-10) >= today);
  return [...keep, key].slice(-MAX_DISMISSED_REMINDERS);
}

/**
 * Each billable subscription's next charge (a renewal, or the first charge
 * when a trial ends) from today to `daysBefore` days ahead, both included —
 * soonest first. Only the next charge counts: once it is hidden, the
 * subscription stays quiet until that day has passed. Same rules as the
 * overview: canceled, undated and needs-attention subscriptions are skipped.
 */
export function remindersDue(
  subs: readonly Subscription[],
  today: CalendarDate,
  daysBefore: number,
  dismissed: readonly string[] = [],
): DueReminder[] {
  if (!(daysBefore >= 1)) return [];
  const end = addDays(today, Math.floor(daysBefore));
  if (!end) return [];
  const hidden = new Set(dismissed);
  const out: DueReminder[] = [];
  for (const sub of subs) {
    const state = subscriptionState(sub, today);
    if (!isBillable(state)) continue;
    const anchor = renewalAnchor(sub);
    if (!anchor) continue;
    const [date] = occurrencesBetween(anchor, sub.interval, today, end, 1);
    if (!date) continue;
    const key = reminderKey(sub.id, date);
    if (hidden.has(key)) continue;
    out.push({ sub, date, daysLeft: daysBetween(today, date)!, kind: state.kind === 'trial' ? 'trial' : 'renews', key });
  }
  return out.sort(compareUpcoming);
}
