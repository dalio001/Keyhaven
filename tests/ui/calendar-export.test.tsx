// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { VaultProvider } from '@/providers/VaultProvider';
import Subscriptions from '@/pages/Subscriptions';
import { downloadTextFile } from '@/lib/download';
import type { Account, Subscription } from '@/lib/vault';
import { freshVault } from '../helpers/controller';

vi.mock('@/lib/download', () => ({ downloadTextFile: vi.fn(), downloadBackupFile: vi.fn() }));
const download = vi.mocked(downloadTextFile);

type Controller = Awaited<ReturnType<typeof freshVault>>['c'];
const T = '2026-01-01T00:00:00.000Z';

const acct = (id: string, service: string, extra: Partial<Account> = {}): Account => ({ id, service, category: 'other', createdAt: T, updatedAt: T, ...extra });
const sub = (id: string, accountId: string, extra: Partial<Subscription>): Subscription => ({
  id, accountId, plan: '', amountMinor: 2000, currency: 'USD', interval: { unit: 'month', count: 1 }, status: 'active', provider: 'website', createdAt: T, updatedAt: T, ...extra,
});

const ACCOUNTS = [acct('a-cg', 'ChatGPT', { label: 'Work', email: 'synthetic-work@example.test' }), acct('a-dom', 'Domain'), acct('a-old', 'Old')];
const SUBS = [
  sub('chatgpt', 'a-cg', { billingAnchor: '2026-09-15', notes: 'synthetic-subscription-note' }),
  sub('domain', 'a-dom', { amountMinor: 12000, interval: { unit: 'year', count: 1 }, billingAnchor: '2027-01-31' }),
  sub('old', 'a-old', { status: 'canceled', billingAnchor: '2026-01-20', accessEndsOn: '2026-10-20' }),
];

async function seeded(settings: Record<string, unknown> = {}) {
  const x = await freshVault();
  x.c.mutate((p) => ({ ...p, accounts: ACCOUNTS, subscriptions: SUBS, settings: { ...p.settings, ...settings } }));
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

beforeEach(() => {
  download.mockClear();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) });
});
afterEach(() => vi.useRealTimers());

describe('Add to calendar (Phase 5)', () => {
  it('warns that the file is not encrypted, then creates keyhaven-renewals.ics with every renewal', async () => {
    const { c, storage } = await seeded();
    const before = storage.committed.length;
    renderAt(c, '/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add renewals to your calendar' });
    expect(within(dialog).getByText(/This file is not encrypted/)).toBeTruthy();
    expect(within(dialog).getByText(/service and account names, plans and prices/)).toBeTruthy();
    expect(within(dialog).getByText(/13 charges from 2 subscriptions/)).toBeTruthy();
    expect(within(dialog).getByText(/1 canceled or incomplete subscription is left out/)).toBeTruthy();
    expect(within(dialog).getByText(/alarm 3 days before, at 9:00/)).toBeTruthy();
    expect(download).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create calendar file' }));
    expect(download).toHaveBeenCalledTimes(1);
    const [name, text, mime] = download.mock.calls[0];
    expect(name).toBe('keyhaven-renewals.ics');
    expect(mime).toBe('text/calendar;charset=utf-8');
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(13);
    expect(text).toContain('SUMMARY:ChatGPT · Work renews — $20.00 / month');
    expect(text).not.toContain('synthetic-work@example.test');
    expect(text).not.toContain('synthetic-subscription-note');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(storage.committed.length).toBe(before); // exporting never writes to the vault
  });

  it('Cancel creates nothing', async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(download).not.toHaveBeenCalled();
  });

  it('reminders off: the file has no alarms and the dialog says so', async () => {
    const { c } = await seeded({ renewalReminderDays: 0 });
    renderAt(c, '/subscriptions');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No alarms/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create calendar file' }));
    expect(download.mock.calls[0][1]).not.toContain('VALARM');
  });

  it("an account page exports that account's renewals only", async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions?account=a-dom');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 charge from 1 subscription/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create calendar file' }));
    const [name, text] = download.mock.calls[0];
    expect(name).toBe('keyhaven-renewals-domain.ics');
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(text).toContain('SUMMARY:Domain renews — $120.00 / year');
    expect(text).not.toContain('ChatGPT');
  });

  it('nothing to add: the dialog says so and creates no file', async () => {
    const { c } = await seeded();
    renderAt(c, '/subscriptions?account=a-old');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No renewals in the next 12 months/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Create calendar file' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
