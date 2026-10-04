// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Vault from '@/pages/Vault';
import Settings from '@/pages/Settings';
import Subscriptions from '@/pages/Subscriptions';
import type { Account, Subscription } from '@/lib/vault';
import { freshVault, readStoredPayload } from '../helpers/controller';

type Controller = Awaited<ReturnType<typeof freshVault>>['c'];
const T = '2026-01-01T00:00:00.000Z';

const acct = (id: string, service: string, label?: string): Account => ({ id, service, ...(label ? { label } : {}), category: 'other', createdAt: T, updatedAt: T });
const sub = (id: string, accountId: string, extra: Partial<Subscription>): Subscription => ({
  id, accountId, plan: '', amountMinor: 2000, currency: 'USD', interval: { unit: 'month', count: 1 }, status: 'active', provider: 'website', createdAt: T, updatedAt: T, ...extra,
});

const ACCOUNTS = [acct('a-cg', 'ChatGPT', 'Work'), acct('a-cl', 'Claude'), acct('a-gym', 'Gym'), acct('a-dom', 'Domain')];
const SUBS = [
  sub('chatgpt', 'a-cg', { billingAnchor: '2026-09-03' }), // renews tomorrow
  sub('claude', 'a-cl', { amountMinor: 1800, currency: 'EUR', status: 'trial', trialEndsOn: '2026-10-04' }), // in 2 days
  sub('gym', 'a-gym', { amountMinor: 1500, billingAnchor: '2026-09-07' }), // in 5 days
  sub('domain', 'a-dom', { status: 'canceled', billingAnchor: '2026-09-03', accessEndsOn: '2026-10-03' }),
];

async function seeded(settings: Record<string, unknown> = {}) {
  const x = await freshVault();
  x.c.mutate((p) => ({ ...p, accounts: ACCOUNTS, subscriptions: SUBS, settings: { ...p.settings, ...settings } }));
  await x.c.flush();
  return x;
}

function Where() {
  const { pathname, search } = useLocation();
  return <p>at {pathname + search}</p>;
}

function renderAt(c: Controller, path: string) {
  return render(
    <VaultProvider controller={c}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/vault" element={<Vault />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="*" element={<Where />} />
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
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const reminderRows = async () => within(await screen.findByRole('list', { name: 'Renewal reminders' })).getAllByRole('listitem');

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('renewal reminders in the app (Phase 5)', () => {
  it('the vault page lists what renews or ends within 3 days by default; a row opens the account', async () => {
    const { c } = await seeded();
    renderAt(c, '/vault');
    const rows = await reminderRows();
    expect(rows.map((r) => text(r).replace(/ Hide until next time$/, ''))).toEqual([
      'ChatGPT · Work renews tomorrow · Oct 3, 2026 — $20.00 / month',
      'Claude trial ends in 2 days · Oct 4, 2026 — then €18.00 / month',
    ]);
    fireEvent.click(within(rows[0]).getByRole('link'));
    expect(await screen.findByRole('heading', { name: 'ChatGPT · Work' })).toBeTruthy();
  });

  it('viewing the reminders writes nothing', async () => {
    const { c, storage } = await seeded();
    const before = storage.committed.length;
    renderAt(c, '/vault');
    await reminderRows();
    expect(storage.committed.length).toBe(before);
    expect(c.getSnapshot().save.unsaved).toBe(false);
  });

  it('"Hide until next time" hides that renewal, saved in the encrypted vault (not in localStorage)', async () => {
    const { c, storage } = await seeded();
    const view = renderAt(c, '/vault');
    const rows = await reminderRows();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Hide until next time' }));
    expect((await reminderRows()).map(text).join(' ')).not.toContain('ChatGPT');
    await c.flush();
    expect((await readStoredPayload(storage)).settings.dismissedReminders).toEqual(['chatgpt:2026-10-03']);
    expect(JSON.stringify({ ...localStorage })).not.toContain('chatgpt');

    view.unmount();
    renderAt(c, '/vault');
    expect((await reminderRows()).map(text).join(' ')).toContain('Claude');
    expect(screen.queryByText(/ChatGPT · Work renews/)).toBeNull();
  });

  it('hiding the last one removes the banner', async () => {
    const { c } = await seeded({ dismissedReminders: ['claude:2026-10-04'] });
    renderAt(c, '/vault');
    fireEvent.click(within((await reminderRows())[0]).getByRole('button', { name: 'Hide until next time' }));
    expect(screen.queryByRole('list', { name: 'Renewal reminders' })).toBeNull();
  });

  it('Settings → Preferences: "7 days" adds the renewal in 5 days; "Off" turns reminders off', async () => {
    const { c, storage } = await seeded();
    const settings = renderAt(c, '/settings?tab=preferences');
    const group = await screen.findByRole('radiogroup', { name: 'Remind me before renewals' });
    expect(within(group).getByRole('radio', { name: '3 days' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(group).getByRole('radio', { name: '7 days' }));
    await c.flush();
    expect((await readStoredPayload(storage)).settings.renewalReminderDays).toBe(7);
    settings.unmount();

    const vault = renderAt(c, '/vault');
    expect((await reminderRows()).map(text).join(' ')).toContain('Gym renews in 5 days');
    vault.unmount();

    renderAt(c, '/settings?tab=preferences');
    fireEvent.click(within(await screen.findByRole('radiogroup', { name: 'Remind me before renewals' })).getByRole('radio', { name: 'Off' }));
    await c.flush();
    expect((await readStoredPayload(storage)).settings.renewalReminderDays).toBe(0);
  });

  it('turned off: no banner on the vault page or the Overview', async () => {
    const { c } = await seeded({ renewalReminderDays: 0 });
    const vault = renderAt(c, '/vault');
    await screen.findByRole('button', { name: /New login|Add/ }).catch(() => undefined);
    expect(screen.queryByRole('list', { name: 'Renewal reminders' })).toBeNull();
    vault.unmount();
    renderAt(c, '/subscriptions');
    await screen.findByRole('list', { name: 'Upcoming renewals' });
    expect(screen.queryByRole('list', { name: 'Renewal reminders' })).toBeNull();
  });

  it('the Overview shows the same reminders at the top', async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions');
    const rows = await reminderRows();
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1]).getByRole('link'));
    expect(await screen.findByRole('heading', { name: 'Claude' })).toBeTruthy();
  });
});
