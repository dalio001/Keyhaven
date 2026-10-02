// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { VaultProvider, useVault } from '@/providers/VaultProvider';
import type { SubscriptionFields } from '@/providers/VaultProvider';
import { entry, freshVault } from '../helpers/controller';

type Api = ReturnType<typeof useVault>;

async function harness() {
  const x = await freshVault();
  const ref: { current: Api | null } = { current: null };
  function Probe() {
    ref.current = useVault();
    return null;
  }
  render(
    <VaultProvider controller={x.c}>
      <Probe />
    </VaultProvider>,
  );
  return { ...x, api: () => ref.current! };
}

const FIELDS: SubscriptionFields = {
  plan: 'Plus',
  amountMinor: 2000,
  currency: 'USD',
  interval: { unit: 'month', count: 1 },
  billingAnchor: '2026-10-15',
  status: 'active',
  provider: 'website',
};

describe('VaultProvider accounts & subscriptions', () => {
  it('creates the account, links the login and saves the subscription as one change', async () => {
    const { api } = await harness();
    act(() => void api().addEntry({ ...entry('cg'), id: 'cg' }));
    let saved = null as ReturnType<Api['saveSubscription']>;
    act(() => {
      saved = api().saveSubscription({
        account: { create: { service: 'ChatGPT', serviceKey: 'chatgpt', label: 'Work', category: 'work' } },
        linkEntryId: 'cg',
        fields: FIELDS,
      });
    });
    expect(saved).not.toBeNull();
    expect(api().accounts).toHaveLength(1);
    expect(api().subscriptions).toEqual([saved]);
    expect(api().entries.find((e) => e.id === 'cg')?.accountId).toBe(api().accounts[0].id);
  });

  it('editing keeps the id and createdAt; deleting removes only the subscription; undo restores it', async () => {
    const { api } = await harness();
    act(() => void api().addEntry({ ...entry('cg'), id: 'cg' }));
    let first = null as ReturnType<Api['saveSubscription']>;
    act(() => {
      first = api().saveSubscription({
        account: { create: { service: 'ChatGPT', category: 'work' } },
        linkEntryId: 'cg',
        fields: FIELDS,
      });
    });
    const accountId = first!.accountId;
    let edited = null as ReturnType<Api['saveSubscription']>;
    act(() => {
      edited = api().saveSubscription({ id: first!.id, account: { id: accountId }, fields: { ...FIELDS, plan: 'Pro' } });
    });
    expect(edited).toMatchObject({ id: first!.id, createdAt: first!.createdAt, plan: 'Pro' });

    act(() => void api().removeSubscription(first!.id));
    expect(api().subscriptions).toEqual([]);
    expect(api().accounts.map((a) => a.id)).toEqual([accountId]);
    expect(api().entries.find((e) => e.id === 'cg')?.accountId).toBe(accountId);

    act(() => void api().restoreSubscription(edited!));
    expect(api().subscriptions).toEqual([edited]);
  });

  it('an account with subscriptions cannot be removed; without, its logins are unlinked and kept', async () => {
    const { api } = await harness();
    act(() => void api().addEntry({ ...entry('cg'), id: 'cg' }));
    let sub = null as ReturnType<Api['saveSubscription']>;
    act(() => {
      sub = api().saveSubscription({ account: { create: { service: 'ChatGPT', category: 'work' } }, linkEntryId: 'cg', fields: FIELDS });
    });
    expect(api().removeAccount(sub!.accountId)).toBe('has-subscriptions');
    act(() => void api().removeSubscription(sub!.id));
    let r = '';
    act(() => {
      r = api().removeAccount(sub!.accountId);
    });
    expect(r).toBe('ok');
    expect(api().accounts).toEqual([]);
    expect(api().entries.find((e) => e.id === 'cg')).toBeDefined();
    expect(api().entries.find((e) => e.id === 'cg')?.accountId).toBeUndefined();
  });

  it('undoing a login delete after its account was removed does not restore a dangling link', async () => {
    const { api } = await harness();
    let account = null as ReturnType<Api['addAccount']>;
    act(() => {
      account = api().addAccount({ service: 'Claude', category: 'work' });
    });
    act(() => void api().addEntry({ ...entry('cl'), id: 'cl', accountId: account!.id }));
    const removed = api().entries.find((e) => e.id === 'cl')!;
    act(() => void api().removeEntry('cl'));
    act(() => void api().removeAccount(account!.id));
    act(() => void api().addEntry(removed)); // the undo toast
    const restored = api().entries.find((e) => e.id === 'cl')!;
    expect(restored.accountId).toBeUndefined();
    expect(restored.password).toBe(removed.password);
  });

  it('refuses a subscription for an account that does not exist (nothing saved)', async () => {
    const { api, c } = await harness();
    const before = c.getSnapshot().data;
    let r = null as ReturnType<Api['saveSubscription']>;
    act(() => {
      r = api().saveSubscription({ account: { id: 'missing' }, fields: FIELDS });
    });
    expect(r).toBeNull();
    expect(c.getSnapshot().data).toBe(before);
  });
});
