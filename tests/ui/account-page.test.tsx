// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Subscriptions from '@/pages/Subscriptions';
import type { Account, Subscription } from '@/lib/vault';
import { entry, freshVault } from '../helpers/controller';

type Controller = Awaited<ReturnType<typeof freshVault>>['c'];
const T = '2026-01-01T00:00:00.000Z';
const WORK: Account = { id: 'a-work', service: 'ChatGPT', serviceKey: 'chatgpt', label: 'Work', email: 'work@example.test', website: 'chatgpt.com', notes: 'Team seat', category: 'work', createdAt: T, updatedAt: T };
const OTHER: Account = { id: 'a-x', service: 'Synthetic Cloud', website: 'javascript:alert(1)', category: 'other', createdAt: T, updatedAt: T };
const sub = (id: string, accountId: string, extra: Partial<Subscription>): Subscription => ({
  id, accountId, plan: '', amountMinor: 2000, currency: 'USD', interval: { unit: 'month', count: 1 }, status: 'active', provider: 'website', createdAt: T, updatedAt: T, ...extra,
});

const visited: string[] = [];
function Where() {
  const loc = useLocation();
  visited.push(loc.pathname + loc.search);
  return null;
}
const where = () => visited.at(-1);

async function seeded() {
  const x = await freshVault();
  x.c.mutate((p) => ({
    ...p,
    entries: [entry('cg-login', { title: 'ChatGPT', username: 'work@example.test', accountId: 'a-work' }), ...p.entries],
    accounts: [WORK, OTHER],
    subscriptions: [
      sub('team', 'a-work', { plan: 'Team', billingAnchor: '2026-10-15' }),
      sub('ios', 'a-work', { plan: 'Plus', amountMinor: 1999, provider: 'apple', billingAnchor: '2026-10-20' }),
      sub('cloud', 'a-x', { billingAnchor: '2026-10-05' }),
    ],
  }));
  await x.c.flush();
  return x;
}

function renderAt(c: Controller, path: string) {
  return render(
    <VaultProvider controller={c}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <Routes>
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/vault" element={<p>vault page</p>} />
        </Routes>
      </MemoryRouter>
    </VaultProvider>,
  );
}

beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) }));
afterEach(() => vi.useRealTimers());

describe('account pages (Phase 4)', () => {
  it('shows the account, what it costs, its subscriptions, where they are managed and its logins', async () => {
    const { c, storage } = await seeded();
    const before = storage.committed.length;
    renderAt(c, '/subscriptions?account=a-work');
    expect(await screen.findByRole('heading', { name: 'ChatGPT · Work' })).toBeTruthy();
    expect(screen.getByText('work@example.test')).toBeTruthy();
    expect(screen.getByText('Team seat')).toBeTruthy();
    expect(screen.getByText(/≈ \$39\.99/)).toBeTruthy(); // 20.00 + 19.99 a month
    expect(screen.getByText(/Next charge/).textContent).toContain('Oct 15, 2026');
    expect(within(screen.getByRole('list', { name: 'Subscriptions' })).getAllByRole('listitem')).toHaveLength(2);

    const manage = screen.getByRole('link', { name: /Manage at chatgpt\.com/ }) as HTMLAnchorElement;
    expect(manage.href).toBe('https://chatgpt.com/');
    expect(manage.target).toBe('_blank');
    expect(manage.rel).toBe('noopener noreferrer');
    expect(screen.getByText(/Billed through Apple/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: "Where it's managed" })).getAllByRole('link')).toHaveLength(1); // the Apple hint is text, not a link

    fireEvent.click(within(screen.getByRole('list', { name: 'Linked logins' })).getByRole('button', { name: /ChatGPT — work@example\.test/ }));
    expect(await screen.findByText('vault page')).toBeTruthy();
    expect(where()).toBe('/vault?entry=cg-login');
    expect(storage.committed.length).toBe(before); // viewing writes nothing
  });

  it('never links an unsafe website', async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions?account=a-x');
    expect(await screen.findByRole('heading', { name: 'Synthetic Cloud' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Manage at/ })).toBeNull();
  });

  it('adding a subscription from the page pre-selects the account', async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions?account=a-work');
    fireEvent.click(await screen.findByRole('button', { name: /Add subscription for this account/ }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('radio', { name: /Work/ }) as HTMLInputElement).checked).toBe(true);
    expect(where()).toContain('account=a-work');
  });

  it('opened from the Accounts tab; the pencil still edits in place', async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions?tab=accounts');
    fireEvent.click(await screen.findByRole('button', { name: 'Open account ChatGPT · Work' }));
    expect(await screen.findByRole('heading', { name: 'ChatGPT · Work' })).toBeTruthy();
    expect(where()).toBe('/subscriptions?account=a-work');
    fireEvent.click(screen.getByRole('button', { name: /All accounts/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit account ChatGPT · Work' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('an unknown account says so', async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions?account=nope');
    expect(await screen.findByText(/This account isn't in your vault/)).toBeTruthy();
  });
});
