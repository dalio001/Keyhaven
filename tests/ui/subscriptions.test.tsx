// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VaultProvider } from '@/providers/VaultProvider';
import Subscriptions from '@/pages/Subscriptions';
import Vault from '@/pages/Vault';
import { listSubscriptions } from '@/lib/records';
import { addEntry, entry, freshVault, readStoredPayload } from '../helpers/controller';

type Controller = Awaited<ReturnType<typeof freshVault>>['c'];

function renderAt(c: Controller, path: string) {
  return render(
    <VaultProvider controller={c}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/unlock" element={<p>unlock page</p>} />
        </Routes>
      </MemoryRouter>
    </VaultProvider>,
  );
}

async function openAddForm() {
  fireEvent.click(await screen.findByRole('button', { name: /Add subscription/ }));
  return screen.findByRole('dialog');
}

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function addChatGpt(opts: { label: string; amount: string; date?: string; login?: string; newAccount?: boolean }) {
  const dialog = await openAddForm();
  fireEvent.click(within(dialog).getByRole('radio', { name: 'ChatGPT' }));
  if (opts.newAccount) fireEvent.click(within(dialog).getByRole('radio', { name: 'New account' }));
  fill('Account label', opts.label);
  if (opts.login) fill('Link a saved login (optional)', opts.login);
  fill('Price', opts.amount);
  if (opts.date) fill('Next billing date', opts.date);
  fireEvent.click(screen.getByRole('button', { name: 'Save subscription' }));
}

describe('Subscriptions page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 2, 12, 0) }); // today: Oct 2, 2026 (local)
  });
  afterEach(() => vi.useRealTimers());

  it('adds a ChatGPT "Work" subscription and shows its price and next renewal', async () => {
    const { c, storage } = await freshVault();
    renderAt(c, '/subscriptions?tab=subscriptions');
    await screen.findByText('No subscriptions yet');
    await addChatGpt({ label: 'Work', amount: '20', date: '2026-10-15' });

    expect(await screen.findByText('ChatGPT · Work')).toBeTruthy();
    expect(screen.getByText('$20.00 / month')).toBeTruthy();
    expect(screen.getByText('Renews Oct 15, 2026 · in 13 days')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await act(() => c.flush());
    const stored = listSubscriptions(await readStoredPayload(storage));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ amountMinor: 2000, currency: 'USD', billingAnchor: '2026-10-15', status: 'active' });
  });

  it('a personal ChatGPT account stays distinct from the work one', async () => {
    const { c } = await freshVault();
    renderAt(c, '/subscriptions?tab=subscriptions');
    await addChatGpt({ label: 'Work', amount: '20' });
    await screen.findByText('ChatGPT · Work');
    await addChatGpt({ label: 'Personal', amount: '20', newAccount: true });
    await screen.findByText('ChatGPT · Personal');
    expect(screen.getByText('ChatGPT · Work')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Accounts/ }));
    expect(screen.getByRole('tab', { name: 'Accounts (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit account ChatGPT · Work' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit account ChatGPT · Personal' })).toBeTruthy();
  });

  it('deleting a subscription keeps its account and login; Undo brings it back', async () => {
    const { c } = await freshVault();
    addEntry(c, entry('cg', { title: 'ChatGPT login', username: 'me@example.test' }));
    renderAt(c, '/subscriptions?tab=subscriptions');
    await addChatGpt({ label: 'Work', amount: '20', login: 'cg' });
    fireEvent.click(await screen.findByRole('button', { name: /^Edit ChatGPT · Work/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete this subscription/ }));
    expect(screen.getByText('Deletes this subscription only. The account and login stay.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete subscription' }));

    await screen.findByText('No subscriptions yet');
    const data = c.getSnapshot().data!;
    expect(data.entries.map((e) => [e.id, e.password])).toEqual([['cg', 'synthetic-secret-cg']]);
    expect(data.entries[0].accountId).toBeTruthy();
    expect((data.accounts as unknown[]).length).toBe(1);

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('ChatGPT · Work')).toBeTruthy();
  });

  it('KH-04: a billing date filled in without an input event (autofill, scripts) is saved and shown', async () => {
    const { c, storage } = await freshVault();
    renderAt(c, '/subscriptions?tab=subscriptions');
    const dialog = await openAddForm();
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Service' })).getByRole('radio', { name: 'Custom' }));
    fill('Service name', 'QA Service');
    fill('Price', '12.34');
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Billing cycle' })).getByRole('radio', { name: 'Custom' }));
    fill('Repeat every', '2');
    fill('Repeat unit', 'week');
    // set the field the way autofill or a script does: the value changes, no input event fires
    const date = screen.getByLabelText('Next billing date') as HTMLInputElement;
    date.value = '2026-10-05';
    // the page re-renders (e.g. the auto-lock countdown ticks every second) before Save is clicked
    fill('Plan', 'Team');
    expect(date.value).toBe('2026-10-05');
    fireEvent.click(screen.getByRole('button', { name: 'Save subscription' }));

    expect(await screen.findByText('Renews Oct 5, 2026 · in 3 days')).toBeTruthy();
    await act(() => c.flush());
    const [sub] = listSubscriptions(await readStoredPayload(storage));
    expect(sub).toMatchObject({ billingAnchor: '2026-10-05', interval: { unit: 'week', count: 2 }, amountMinor: 1234 });

    // reopening shows the saved date
    fireEvent.click(screen.getByRole('button', { name: /^Edit QA Service/ }));
    expect(((await screen.findByLabelText('Next billing date')) as HTMLInputElement).value).toBe('2026-10-05');
  });

  it('KH-04: a date set without an event and then blurred updates the form before saving', async () => {
    const { c } = await freshVault();
    renderAt(c, '/subscriptions?tab=subscriptions');
    const dialog = await openAddForm();
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Service' })).getByRole('radio', { name: 'Claude' }));
    fill('Price', '18');
    const date = screen.getByLabelText('Next billing date') as HTMLInputElement;
    date.value = '2026-10-05';
    fireEvent.blur(date);
    fill('Plan', 'Pro'); // another field re-renders the form: the date must survive
    expect((screen.getByLabelText('Next billing date') as HTMLInputElement).value).toBe('2026-10-05');
  });

  it('shows what is wrong instead of saving', async () => {
    const { c } = await freshVault();
    renderAt(c, '/subscriptions?tab=subscriptions');
    const dialog = await openAddForm();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Free trial' }));
    fill('Price', '20.999');
    fireEvent.click(screen.getByRole('button', { name: 'Save subscription' }));
    expect(await screen.findByText('Choose a service or type its name.')).toBeTruthy();
    expect(screen.getByText('Enter the price like 20 or 20.00.')).toBeTruthy();
    expect(screen.getByText('When does the trial end?')).toBeTruthy();
    expect(c.getSnapshot().data?.subscriptions).toBeUndefined(); // nothing written
  });

  it("the login's detail drawer shows its account and subscription", async () => {
    const { c } = await freshVault();
    addEntry(c, entry('cg', { title: 'ChatGPT login' }));
    const view = renderAt(c, '/subscriptions?tab=subscriptions');
    await addChatGpt({ label: 'Work', amount: '20', date: '2026-10-15', login: 'cg' });
    await screen.findByText('ChatGPT · Work');
    view.unmount();

    renderAt(c, '/vault?entry=cg');
    const section = await screen.findByRole('region', { name: 'Account and subscriptions' });
    expect(within(section).getByText('ChatGPT · Work')).toBeTruthy();
    expect(within(section).getByText('$20.00 / month')).toBeTruthy();
    expect(within(section).getByText('Renews Oct 15, 2026 · in 13 days')).toBeTruthy();
  });
});

describe('malformed stored accounts', () => {
  it('the Accounts and Subscriptions tabs still render; the unusable account is hidden', async () => {
    const { c } = await freshVault();
    const NOW = '2026-10-02T12:00:00.000Z';
    c.mutate((p) => ({
      ...p,
      accounts: [
        { id: 'broken' }, // no service name
        { id: 'odd', service: 'Odd', email: 42 },
        { id: 'ok', service: 'Synthetic Cloud', category: 'other', createdAt: NOW, updatedAt: NOW },
      ],
      subscriptions: [
        { id: 's1', accountId: 'broken', plan: '', amountMinor: 500, currency: 'USD', interval: { unit: 'month', count: 1 }, status: 'active', provider: 'website', createdAt: NOW, updatedAt: NOW },
      ],
    }));
    renderAt(c, '/subscriptions?tab=accounts');
    expect(await screen.findByRole('button', { name: 'Edit account Synthetic Cloud' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Accounts (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Subscriptions/ }));
    expect(await screen.findByRole('button', { name: /^Edit Unknown account/ })).toBeTruthy();
  });
});

describe('date fields stay strings end to end', () => {
  const ORIGINAL_TZ = process.env.TZ;
  const RealDate = globalThis.Date;
  let parsed: string[] = [];

  beforeEach(() => {
    parsed = [];
    // a date field's value ('2027-01-31'); full ISO timestamps (save times) are instants and fine to parse
    const looksLikeDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
    // record every attempt to turn a calendar date string into a Date
    globalThis.Date = new Proxy(RealDate, {
      construct(target, args, newTarget) {
        if (looksLikeDay(args[0])) parsed.push(`new Date(${String(args[0])})`);
        return Reflect.construct(target, args, newTarget) as object;
      },
      get(target, prop, receiver) {
        if (prop === 'parse') {
          return (s: string) => {
            if (looksLikeDay(s)) parsed.push(`Date.parse(${s})`);
            return target.parse(s);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
  });
  afterEach(() => {
    globalThis.Date = RealDate;
    process.env.TZ = ORIGINAL_TZ;
  });

  it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])(
    'in %s: the typed day is stored, shown and re-edited unchanged, and never parsed as a Date',
    async (tz) => {
      process.env.TZ = tz;
      const { c, storage } = await freshVault();
      renderAt(c, '/subscriptions?tab=subscriptions');
      const dialog = await openAddForm();
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Claude' }));
      fill('Price', '18');
      fill('Next billing date', '2027-01-31');
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Free trial' }));
      fill('Trial ends on', '2026-12-31');
      fireEvent.click(screen.getByRole('button', { name: 'Save subscription' }));
      await screen.findByRole('button', { name: /^Edit Claude/ });
      await act(() => c.flush());

      let [sub] = listSubscriptions(await readStoredPayload(storage));
      expect(sub.trialEndsOn).toBe('2026-12-31');
      expect(sub.billingAnchor).toBeUndefined(); // the billing date hidden by "Free trial" is not saved

      // the edit form shows the same string back; switching to Active stores the newly typed day
      fireEvent.click(screen.getByRole('button', { name: /^Edit Claude/ }));
      expect((await screen.findByLabelText('Trial ends on') as HTMLInputElement).value).toBe('2026-12-31');
      fireEvent.click(screen.getByRole('radio', { name: 'Active' }));
      fill('Next billing date', '2027-01-31');
      fireEvent.click(screen.getByRole('button', { name: 'Save subscription' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await act(() => c.flush());
      [sub] = listSubscriptions(await readStoredPayload(storage));
      expect(sub).toMatchObject({ status: 'active', billingAnchor: '2027-01-31' });
      expect(sub.trialEndsOn).toBeUndefined();
      fireEvent.click(screen.getByRole('button', { name: /^Edit Claude/ }));
      expect((await screen.findByLabelText('Next billing date') as HTMLInputElement).value).toBe('2027-01-31');

      expect(parsed).toEqual([]);
    },
  );

  it('the billing and subscription code never parses dates (source check)', () => {
    const root = join(__dirname, '..', '..', 'src');
    const files = [
      ...readdirSync(join(root, 'lib', 'billing')).map((f) => join(root, 'lib', 'billing', f)),
      ...readdirSync(join(root, 'components', 'subscriptions')).map((f) => join(root, 'components', 'subscriptions', f)),
      join(root, 'pages', 'Subscriptions.tsx'),
      join(root, 'lib', 'records.ts'),
      join(root, 'hooks', 'useToday.ts'),
    ];
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '') // comments may name what is avoided
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/valueAsDate|Date\.parse\(|new Date\([^)]/);
    }
    expect(files.length).toBeGreaterThan(8);
  });
});
