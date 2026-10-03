// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Subscriptions from '@/pages/Subscriptions';
import type { Account, Subscription } from '@/lib/vault';
import { freshVault } from '../helpers/controller';

type Controller = Awaited<ReturnType<typeof freshVault>>['c'];
const T = '2026-01-01T00:00:00.000Z';

const acct = (id: string, service: string, label?: string): Account => ({ id, service, ...(label ? { label } : {}), category: 'other', createdAt: T, updatedAt: T });
const sub = (id: string, accountId: string, extra: Partial<Subscription>): Subscription => ({
  id, accountId, plan: '', amountMinor: 2000, currency: 'USD', interval: { unit: 'month', count: 1 }, status: 'active', provider: 'website', createdAt: T, updatedAt: T, ...extra,
});

const ACCOUNTS = [acct('a-cg', 'ChatGPT', 'Work'), acct('a-dom', 'Domain'), acct('a-gem', 'Gemini'), acct('a-cl', 'Claude'), acct('a-gym', 'Gym'), acct('a-old', 'Old')];
const SUBS = [
  sub('chatgpt', 'a-cg', { amountMinor: 2000, billingAnchor: '2026-10-15', plan: 'Team' }),
  sub('domain', 'a-dom', { amountMinor: 12000, interval: { unit: 'year', count: 1 }, billingAnchor: '2027-01-31' }),
  sub('gemini', 'a-gem', { amountMinor: 1000, billingAnchor: '2026-01-31' }),
  sub('claude', 'a-cl', { amountMinor: 1800, currency: 'EUR', status: 'trial', trialEndsOn: '2026-10-09' }),
  sub('gym', 'a-gym', { amountMinor: 1500, currency: 'JPY', interval: { unit: 'week', count: 2 }, billingAnchor: '2026-09-25' }),
  sub('old', 'a-old', { amountMinor: 999, status: 'canceled', billingAnchor: '2026-01-20', accessEndsOn: '2026-10-20' }),
];

async function seeded(extra: Subscription[] = [], autoLockMinutes?: number) {
  const x = await freshVault();
  x.c.mutate((p) => ({
    ...p,
    accounts: ACCOUNTS,
    subscriptions: [...SUBS, ...extra],
    settings: autoLockMinutes === undefined ? p.settings : { ...p.settings, autoLockMinutes },
  }));
  await x.c.flush();
  return x;
}

function renderAt(c: Controller, path: string) {
  return render(
    <VaultProvider controller={c}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/subscriptions" element={<Subscriptions />} />
        </Routes>
      </MemoryRouter>
    </VaultProvider>,
  );
}

/** visible text with a space at every element boundary (jsdom has no innerText) */
function text(el: Node): string {
  const parts: string[] = [];
  const walk = (n: Node) => (n.nodeType === Node.TEXT_NODE ? parts.push(n.textContent ?? '') : n.childNodes.forEach(walk));
  walk(el);
  return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

afterEach(() => vi.useRealTimers());

describe('Subscriptions Overview (Phase 4)', () => {
  it('is the default view: this month per currency, next 30 days, trials, estimates', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
    const { c } = await seeded();
    renderAt(c, '/subscriptions');
    expect((await screen.findByRole('tab', { name: 'Overview' })).getAttribute('aria-selected')).toBe('true');

    const month = screen.getByRole('list', { name: 'Expected in October 2026' });
    expect(within(month).getAllByRole('listitem').map(text)).toEqual([
      '€18.00 1 charge · €18.00 still to come',
      '¥3,000 2 charges · ¥3,000 still to come',
      '$30.00 2 charges · $30.00 still to come',
    ]);

    const upcoming = within(screen.getByRole('list', { name: 'Upcoming renewals' })).getAllByRole('listitem').map(text);
    expect(upcoming.map((r) => r.split(' · ')[0].split(' in ')[0])).toEqual(['Oct 9, 2026', 'Oct 9, 2026', 'Oct 15, 2026', 'Oct 31, 2026']);
    expect(upcoming[2]).toBe('Oct 15, 2026 in 13 days C ChatGPT · Work Team $20.00 / month');
    expect(upcoming[0]).toContain('Claude');
    expect(upcoming[0]).toContain('Trial ends');
    expect(upcoming.join(' ')).not.toContain('Old'); // canceled: no charges

    expect(text(screen.getByRole('list', { name: 'Trials ending soon' }))).toBe('Claude trial ends Oct 9, 2026 · in 7 days, then €18.00 / month');

    const est = within(screen.getByRole('list', { name: 'Estimates' })).getAllByRole('listitem').map(text);
    expect(est).toEqual([
      '≈ €18.00 a month on average · incl. 1 trial €216.00 in the next 12 months',
      '≈ ¥3,261 a month on average ¥39,000 in the next 12 months',
      '≈ $40.00 a month on average $480.00 in the next 12 months',
    ]);
    expect(screen.getByText(/Currencies are never combined or converted/)).toBeTruthy();
  });

  it('subscriptions that need attention are counted, not added up; Review opens the list', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
    const { c } = await seeded([sub('broken', 'a-cg', { amountMinor: -1, billingAnchor: '2026-10-10' })]);
    renderAt(c, '/subscriptions');
    expect(await screen.findByText(/1 subscription needs attention and isn't counted below\./)).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Expected in October 2026' })).getByText('$30.00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect((await screen.findByRole('tab', { name: /Subscriptions/ })).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText(/Needs attention/)).toBeTruthy();
  });

  it('viewing it writes nothing to the vault', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
    const { c, storage } = await seeded();
    const before = storage.committed.length;
    renderAt(c, '/subscriptions');
    await screen.findByRole('list', { name: 'Upcoming renewals' });
    fireEvent.click(screen.getByRole('tab', { name: /Accounts/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await screen.findByRole('list', { name: 'Estimates' });
    expect(storage.committed.length).toBe(before);
    expect(c.getSnapshot().save.unsaved).toBe(false);
  });

  it('choosing an upcoming renewal opens its account page', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
    const { c } = await seeded();
    renderAt(c, '/subscriptions');
    const rows = within(await screen.findByRole('list', { name: 'Upcoming renewals' })).getAllByRole('button');
    fireEvent.click(rows[2]);
    expect(await screen.findByRole('heading', { name: 'ChatGPT · Work' })).toBeTruthy();
    expect((screen.getByRole('tab', { name: /Accounts/ })).getAttribute('aria-selected')).toBe('true');
  });

  it('the month rolls over at midnight with auto-lock off', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(2026, 9, 31, 23, 59, 50) });
    const { c } = await seeded([], 0);
    renderAt(c, '/subscriptions');
    expect(await screen.findByRole('heading', { name: 'Expected in October 2026' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(30_000));
    expect(await screen.findByRole('heading', { name: 'Expected in November 2026' })).toBeTruthy();
  });

  it('no subscriptions yet: the familiar empty state; only canceled ones: nothing to pay', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
    const empty = await freshVault();
    const view = renderAt(empty.c, '/subscriptions');
    expect(await screen.findByText('No subscriptions yet')).toBeTruthy();
    view.unmount();

    const x = await freshVault();
    x.c.mutate((p) => ({ ...p, accounts: ACCOUNTS, subscriptions: [SUBS[5]] }));
    renderAt(x.c, '/subscriptions');
    expect(await screen.findByText('Nothing to pay right now')).toBeTruthy();
  });
});
