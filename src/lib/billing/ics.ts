/**
 * Calendar file (Phase 5): the next 12 months of renewals as an iCalendar
 * (RFC 5545) file the user saves and imports into their own calendar app —
 * KeyHaven itself never sends it anywhere.
 *
 * - All-day events (`VALUE=DATE`): a date without a time zone, so it is the
 *   same calendar day wherever the calendar is opened.
 * - The dates are exactly KeyHaven's (`occurrencesBetween`, counted from the
 *   billing date). Day and week plans become one repeating event (`RRULE`),
 *   which every calendar app expands the same way. Month and year plans are
 *   one event per charge: KeyHaven's month-end rule (Jan 31 → Feb 28 →
 *   Mar 31) has no recurrence rule every app supports.
 * - Same rules as the overview: canceled, undated and needs-attention
 *   subscriptions are left out; a trial's end is its first charge.
 * - Stable UIDs, so apps that recognise them update events on a re-export.
 * - Contents: service and account names, plans and prices — the file is NOT
 *   encrypted (the UI says so before creating it). Never emails, websites,
 *   notes, links, usernames or passwords.
 */

import type { Account, CalendarDate, Subscription } from '../vault';
import { addDays, occurrencesBetween, relativeDays } from './dates';
import { isBillable, yearAheadEnd } from './forecast';
import { formatMoney } from './money';
import { formatInterval, renewalAnchor, subscriptionState } from './status';

export interface CalendarExport {
  text: string;
  /** subscriptions with at least one charge in the file */
  subscriptions: number;
  /** charges in the file (a repeating event counts each time it repeats) */
  charges: number;
  /** left out: canceled, no billing date, or a field that needs attention */
  skipped: number;
}

/** "keyhaven-renewals.ics", or "keyhaven-renewals-chatgpt-work.ics" for one account */
export function calendarFileName(name?: string): string {
  const slug = (name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug ? `keyhaven-renewals-${slug}.ics` : 'keyhaven-renewals.ics';
}

/** RFC 5545 TEXT: escape `\ ; ,` and line breaks; drop other control characters */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ''); // eslint-disable-line no-control-regex
}

const utf8Length = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

/** fold a content line at 75 octets (RFC 5545 §3.1), never inside a character */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = utf8Length(ch.codePointAt(0)!);
    if (size + n > limit) {
      out.push(current);
      current = '';
      size = 0;
      limit = 74; // a continuation line starts with one space
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

const icsDate = (d: CalendarDate) => d.replaceAll('-', '');

/** 9:00 local time `days` days before an all-day event: -P2DT15H for 3 days */
function alarmTrigger(days: number): string {
  return days === 1 ? '-PT15H' : `-P${days - 1}DT15H`;
}

function accountName(account: Account | undefined): string {
  if (!account) return 'Subscription';
  return account.label ? `${account.service} · ${account.label}` : account.service;
}

interface EventSpec {
  uid: string;
  start: CalendarDate;
  rrule?: string;
  summary: string;
  alarm?: string;
}

export function renewalsCalendar(opts: {
  subscriptions: readonly Subscription[];
  accounts: readonly Account[];
  today: CalendarDate;
  /** for DTSTAMP — when the file was created */
  now: Date;
  /** alarm this many days before, at 9:00; 0 = no alarms */
  daysBefore: number;
  locale?: string;
}): CalendarExport {
  const { today, locale } = opts;
  const end = yearAheadEnd(today);
  const byId = new Map(opts.accounts.map((a) => [a.id, a]));
  const alarmDays = Number.isInteger(opts.daysBefore) && opts.daysBefore > 0 ? opts.daysBefore : 0;
  const specs: EventSpec[] = [];
  let subscriptions = 0;
  let charges = 0;
  let skipped = 0;

  for (const sub of opts.subscriptions) {
    const state = subscriptionState(sub, today);
    const anchor = renewalAnchor(sub);
    if (!end || !isBillable(state) || !anchor) {
      skipped++;
      continue;
    }
    const dates = occurrencesBetween(anchor, sub.interval, today, end);
    if (dates.length === 0) continue;
    subscriptions++;
    charges += dates.length;

    const plan = typeof sub.plan === 'string' && sub.plan.trim() ? ` (${sub.plan.trim()})` : '';
    const name = `${accountName(byId.get(sub.accountId))}${plan}`;
    const price = `${formatMoney(sub.amountMinor, sub.currency, locale)} ${formatInterval(sub.interval)}`.trim();
    const when = alarmDays ? relativeDays(alarmDays) : '';
    const trial = (start: CalendarDate): EventSpec => ({
      uid: `${sub.id}-${icsDate(start)}`,
      start,
      summary: `${name} trial ends — then ${price}`,
      alarm: when && `${name} trial ends ${when} — then ${price}`,
    });
    const renewal = (start: CalendarDate, rrule?: string): EventSpec => ({
      uid: rrule ? `${sub.id}-series` : `${sub.id}-${icsDate(start)}`,
      start,
      rrule,
      summary: `${name} renews — ${price}`,
      alarm: when && `${name} renews ${when} — ${price}`,
    });

    let renewals = dates;
    if (state.kind === 'trial') {
      specs.push(trial(dates[0]));
      renewals = dates.slice(1);
    }
    if (renewals.length === 0) continue;
    if (sub.interval.unit === 'day' || sub.interval.unit === 'week') {
      const freq = sub.interval.unit === 'day' ? 'DAILY' : 'WEEKLY';
      specs.push(renewal(renewals[0], `FREQ=${freq};INTERVAL=${sub.interval.count};UNTIL=${icsDate(end)}`));
    } else {
      for (const d of renewals) specs.push(renewal(d));
    }
  }

  specs.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
  const stamp = opts.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//KeyHaven//Subscription renewals//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:KeyHaven renewals',
  ];
  for (const e of specs) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(e.uid)}@keyhaven.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.start, 1)!)}`,
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      `SUMMARY:${escapeText(e.summary)}`,
      'DESCRIPTION:Price and date as entered in KeyHaven.',
      'TRANSP:TRANSPARENT',
    );
    if (e.alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.alarm)}`, `TRIGGER:${alarmTrigger(alarmDays)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return { text: `${lines.map(foldLine).join('\r\n')}\r\n`, subscriptions, charges, skipped };
}
