import { afterAll, describe, expect, it } from 'vitest';
import { calendarFileName, escapeText, foldLine, renewalsCalendar } from '@/lib/billing/ics';
import { occurrencesBetween } from '@/lib/billing/dates';
import type { Account, Subscription } from '@/lib/vault';

const TODAY = '2026-10-02';
const NOW = new Date(Date.UTC(2026, 9, 2, 12, 0, 0));
const T = '2026-01-01T00:00:00.000Z';

const acct = (id: string, service: string, extra: Partial<Account> = {}): Account => ({ id, service, category: 'other', createdAt: T, updatedAt: T, ...extra });
const sub = (id: string, accountId: string, extra: Partial<Subscription>): Subscription => ({
  id, accountId, plan: '', amountMinor: 2000, currency: 'USD', interval: { unit: 'month', count: 1 }, status: 'active', provider: 'website', createdAt: T, updatedAt: T, ...extra,
});

const ACCOUNTS = [
  acct('a-cg', 'ChatGPT', { label: 'Work', email: 'synthetic-work@example.test', website: 'https://chatgpt.example.test', notes: 'synthetic-account-note' }),
  acct('a-cl', 'Claude'),
  acct('a-gym', 'Gym'),
  acct('a-dom', 'Domain'),
  acct('a-old', 'Old'),
];
const SUBS = [
  sub('chatgpt', 'a-cg', { billingAnchor: '2026-01-31', plan: 'Team', notes: 'synthetic-subscription-note', manageUrl: 'https://manage.example.test' } as Partial<Subscription>),
  sub('claude', 'a-cl', { amountMinor: 18000, currency: 'EUR', interval: { unit: 'year', count: 1 }, status: 'trial', trialEndsOn: '2026-10-09' }),
  sub('gym', 'a-gym', { amountMinor: 1500, currency: 'JPY', interval: { unit: 'week', count: 2 }, billingAnchor: '2026-09-25' }),
  sub('domain', 'a-dom', { amountMinor: 12000, interval: { unit: 'year', count: 1 }, billingAnchor: '2027-01-31' }),
  sub('old', 'a-old', { status: 'canceled', billingAnchor: '2026-01-20', accessEndsOn: '2026-10-20' }),
  sub('broken', 'a-cg', { amountMinor: -1, billingAnchor: '2026-10-10' }),
  sub('undated', 'a-cg', {}),
];

const build = (subs: Subscription[] = SUBS, daysBefore = 3) =>
  renewalsCalendar({ subscriptions: subs, accounts: ACCOUNTS, today: TODAY, now: NOW, daysBefore, locale: 'en-US' });

/** unfold (RFC 5545 §3.1) and split into content lines */
const contentLines = (text: string) => text.replace(/\r\n[ \t]/g, '').split('\r\n').slice(0, -1);
const events = (text: string) =>
  text
    .replace(/\r\n[ \t]/g, '')
    .split('BEGIN:VEVENT\r\n')
    .slice(1)
    .map((e) => e.split('END:VEVENT')[0].split('\r\n').filter(Boolean));
const prop = (lines: string[], name: string) => lines.find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

describe('calendar file (Phase 5)', () => {
  it('golden file: trial end, a 2-weekly plan as a repeating event, a yearly plan; alarms 3 days before at 9:00', () => {
    const r = build([SUBS[1], SUBS[2], SUBS[3]]);
    expect(r.text).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//KeyHaven//Subscription renewals//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:KeyHaven renewals',
        'BEGIN:VEVENT',
        'UID:claude-20261009@keyhaven.local',
        'DTSTAMP:20261002T120000Z',
        'DTSTART;VALUE=DATE:20261009',
        'DTEND;VALUE=DATE:20261010',
        'SUMMARY:Claude trial ends — then €180.00 / year',
        'DESCRIPTION:Price and date as entered in KeyHaven.',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Claude trial ends in 3 days — then €180.00 / year',
        'TRIGGER:-P2DT15H',
        'END:VALARM',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:gym-series@keyhaven.local',
        'DTSTAMP:20261002T120000Z',
        'DTSTART;VALUE=DATE:20261009',
        'DTEND;VALUE=DATE:20261010',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20271001',
        'SUMMARY:Gym renews — ¥1\\,500 every 2 weeks',
        'DESCRIPTION:Price and date as entered in KeyHaven.',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Gym renews in 3 days — ¥1\\,500 every 2 weeks',
        'TRIGGER:-P2DT15H',
        'END:VALARM',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:domain-20270131@keyhaven.local',
        'DTSTAMP:20261002T120000Z',
        'DTSTART;VALUE=DATE:20270131',
        'DTEND;VALUE=DATE:20270201',
        'SUMMARY:Domain renews — $120.00 / year',
        'DESCRIPTION:Price and date as entered in KeyHaven.',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Domain renews in 3 days — $120.00 / year',
        'TRIGGER:-P2DT15H',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
    expect(r).toMatchObject({ subscriptions: 3, charges: 1 + 26 + 1, skipped: 0 });
  });

  it('monthly plans are one event per charge, with the same month-end dates as the rest of KeyHaven', () => {
    const r = build([SUBS[0]]);
    const ev = events(r.text);
    const expected = occurrencesBetween('2026-01-31', { unit: 'month', count: 1 }, TODAY, '2027-10-01');
    expect(expected).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30', '2027-07-31', '2027-08-31', '2027-09-30']);
    expect(ev.map((e) => prop(e, 'DTSTART'))).toEqual(expected.map((d) => `DTSTART;VALUE=DATE:${d.replaceAll('-', '')}`));
    expect(ev.every((e) => !prop(e, 'RRULE'))).toBe(true);
    expect(prop(ev[0], 'SUMMARY')).toBe('SUMMARY:ChatGPT · Work (Team) renews — $20.00 / month');
    expect(prop(ev[4], 'DTEND')).toBe('DTEND;VALUE=DATE:20270301'); // the day after Feb 28
    expect(new Set(ev.map((e) => prop(e, 'UID'))).size).toBe(12);
  });

  it('a trial then renews from its end date; canceled, broken and undated subscriptions are left out', () => {
    const r = build();
    const ev = events(r.text);
    expect(ev.some((e) => prop(e, 'UID')!.includes('old'))).toBe(false);
    expect(ev.some((e) => /broken|undated/.test(prop(e, 'UID')!))).toBe(false);
    expect(r).toMatchObject({ subscriptions: 4, skipped: 3 });
    const monthlyTrial = build([sub('t', 'a-cl', { amountMinor: 1800, currency: 'EUR', status: 'trial', trialEndsOn: '2026-10-09' })]);
    const tev = events(monthlyTrial.text);
    expect(tev.map((e) => prop(e, 'SUMMARY'))).toEqual([
      'SUMMARY:Claude trial ends — then €18.00 / month',
      ...Array(11).fill('SUMMARY:Claude renews — €18.00 / month'),
    ]);
    // a daily trial: the trial end, then the renewals as one repeating event
    const daily = events(build([sub('d', 'a-cl', { status: 'trial', trialEndsOn: '2026-10-05', interval: { unit: 'day', count: 3 } })]).text);
    expect(daily.map((e) => [prop(e, 'DTSTART'), prop(e, 'RRULE') ?? null])).toEqual([
      ['DTSTART;VALUE=DATE:20261005', null],
      ['DTSTART;VALUE=DATE:20261008', 'RRULE:FREQ=DAILY;INTERVAL=3;UNTIL=20271001'],
    ]);
  });

  it('names and prices only — never emails, websites, notes, links, usernames or passwords', () => {
    const { text } = build();
    for (const secret of ['synthetic-work@example.test', 'chatgpt.example.test', 'synthetic-account-note', 'synthetic-subscription-note', 'manage.example.test']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/URL|ATTENDEE|ORGANIZER|LOCATION/);
  });

  it('alarms follow the setting: 1 day before is 9:00 the day before; off means no alarms', () => {
    const one = events(build([SUBS[3]], 1).text)[0];
    expect(prop(one, 'TRIGGER')).toBe('TRIGGER:-PT15H');
    expect(one).toContain('DESCRIPTION:Domain renews tomorrow — $120.00 / year');
    expect(prop(events(build([SUBS[3]], 7).text)[0], 'TRIGGER')).toBe('TRIGGER:-P6DT15H');
    expect(build([SUBS[3]], 0).text).not.toContain('VALARM');
  });

  it('is valid RFC 5545 text: CRLF only, lines folded at 75 octets without splitting characters, text escaped', () => {
    const long = acct('a-long', 'Ünïcødé Streaming Service; with, commas \\ and a very long name 🎉🎉🎉', { label: 'Family\nplan' });
    const r = renewalsCalendar({ subscriptions: [sub('long', 'a-long', { billingAnchor: '2026-10-20', interval: { unit: 'year', count: 1 } })], accounts: [long], today: TODAY, now: NOW, daysBefore: 3, locale: 'en-US' });
    expect(r.text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const physical = r.text.split('\r\n').slice(0, -1);
    for (const line of physical) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(physical.some((l) => l.startsWith(' '))).toBe(true);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(r.text))).toBe(r.text);
    expect(contentLines(r.text)).toContain(
      'SUMMARY:Ünïcødé Streaming Service\\; with\\, commas \\\\ and a very long name 🎉🎉🎉 · Family\\nplan renews — $20.00 / year',
    );
  });

  it('escapeText and foldLine', () => {
    expect(escapeText('a\\b;c,d\r\ne\nf\rg\u0007h')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ngh');
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
    expect(foldLine('x'.repeat(76))).toBe(`${'x'.repeat(75)}\r\n x`);
    // a 3-byte character never straddles a fold
    const folded = foldLine(`${'x'.repeat(74)}€tail`);
    expect(folded).toBe(`${'x'.repeat(74)}\r\n €tail`);
  });

  it('file names: one for everything, or named after the account (ASCII only)', () => {
    expect(calendarFileName()).toBe('keyhaven-renewals.ics');
    expect(calendarFileName('ChatGPT · Work')).toBe('keyhaven-renewals-chatgpt-work.ics');
    expect(calendarFileName('Crème Brûlée Club')).toBe('keyhaven-renewals-creme-brulee-club.ics');
    expect(calendarFileName('日本語')).toBe('keyhaven-renewals.ics');
    expect(calendarFileName('x'.repeat(80))).toBe(`keyhaven-renewals-${'x'.repeat(40)}.ics`);
  });

  it('nothing to add: a valid, empty calendar', () => {
    const r = build([SUBS[4]]);
    expect(r).toMatchObject({ subscriptions: 0, charges: 0, skipped: 1 });
    expect(r.text).toBe(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//KeyHaven//Subscription renewals//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:KeyHaven renewals\r\nEND:VCALENDAR\r\n',
    );
  });
});

describe.each(['America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Tokyo', 'Europe/Berlin', 'UTC'])('calendar file in %s', (tz) => {
  const ORIGINAL_TZ = process.env.TZ;
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('is byte-for-byte the same file (all-day dates have no time zone)', () => {
    process.env.TZ = 'UTC';
    const reference = build().text;
    process.env.TZ = tz;
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
    expect(build().text).toBe(reference);
  });
});
