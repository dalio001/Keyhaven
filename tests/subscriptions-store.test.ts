import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { listAccounts, listSubscriptions, saveSubscriptionBundle } from '@/lib/records';
import type { VaultPayload } from '@/lib/store/format';
import type { Account, Subscription } from '@/lib/vault';
import { fixtures } from './helpers/fixtures';
import { seedRaw } from './helpers/faultyStorage';
import { PW, addEntry, entry, freshVault, makeController, readStoredPayload, started } from './helpers/controller';

const NOW = '2026-10-02T12:00:00.000Z';
const SERVICE = 'SyntheticStream-Q7Z';

const account: Account = {
  id: 'acc-1',
  service: SERVICE,
  label: 'Work',
  email: 'work@example.test',
  category: 'work',
  createdAt: NOW,
  updatedAt: NOW,
};
const subscription: Subscription = {
  id: 'sub-1',
  accountId: 'acc-1',
  plan: 'Team',
  amountMinor: 2500,
  currency: 'EUR',
  interval: { unit: 'month', count: 1 },
  billingAnchor: '2027-01-31',
  status: 'active',
  provider: 'website',
  createdAt: NOW,
  updatedAt: NOW,
};

const bundle = (linkEntryId?: string) => (p: VaultPayload) =>
  saveSubscriptionBundle(p, { newAccount: account, linkEntryId, subscription }, NOW) ?? p;

describe('subscriptions in the encrypted vault', () => {
  it('are saved encrypted: the stored record never contains them in plain text', async () => {
    const { c, storage } = await freshVault();
    addEntry(c, entry('login-1'));
    c.mutate(bundle('login-1'));
    await c.flush();
    const raw = JSON.stringify(await storage.inner.readCurrent());
    expect(raw).not.toContain(SERVICE);
    expect(raw).not.toContain('work@example.test');
    expect(raw).not.toContain('2027-01-31');
    const stored = await readStoredPayload(storage);
    expect(listAccounts(stored)).toEqual([account]);
    expect(listSubscriptions(stored)).toEqual([subscription]);
    expect(stored.entries[0].accountId).toBe('acc-1');
  });

  it('survive lock and unlock exactly', async () => {
    const { c } = await freshVault();
    c.mutate(bundle());
    await c.lock();
    expect(await c.unlock(PW)).toBe('ok');
    expect(c.getSnapshot().data?.accounts).toEqual([account]);
    expect(c.getSnapshot().data?.subscriptions).toEqual([subscription]);
  });

  it('are in the encrypted backup and come back on import', async () => {
    const source = await freshVault();
    addEntry(source.c, entry('login-1'));
    source.c.mutate(bundle('login-1'));
    const r = await source.c.exportBackup();
    if (!r.ok) throw new Error('export failed');
    expect(r.text).not.toContain(SERVICE);

    const device = await started({ factory: new IDBFactory() });
    expect(await device.c.importBackup(r.text, PW)).toMatchObject({ ok: true, unlocked: true });
    const data = device.c.getSnapshot().data!;
    expect(listSubscriptions(data)).toEqual([subscription]);
    expect(listAccounts(data)).toEqual([account]);
    expect(data.entries.map((e) => [e.id, e.accountId])).toEqual([['login-1', 'acc-1']]);
  });

  it('an edit made the Phase-1 way (entries only) keeps accounts and subscriptions', async () => {
    const { c, storage } = await freshVault();
    addEntry(c, entry('login-1'));
    addEntry(c, entry('login-2'));
    c.mutate(bundle('login-1'));
    // exactly how the Phase-1 provider edits and deletes logins: spread the payload, replace entries
    c.mutate((p) => ({ ...p, entries: p.entries.map((e) => (e.id === 'login-1' ? { ...e, password: 'changed' } : e)) }));
    c.mutate((p) => ({ ...p, entries: p.entries.filter((e) => e.id !== 'login-2') }));
    await c.flush();
    const stored = await readStoredPayload(storage);
    expect(listSubscriptions(stored)).toEqual([subscription]);
    expect(listAccounts(stored)).toEqual([account]);
    expect(stored.entries.map((e) => [e.id, e.accountId, e.password])).toEqual([['login-1', 'acc-1', 'changed']]);
  });

  it('adding a subscription to an upgraded legacy vault leaves its logins exactly as they were', async () => {
    const fx = fixtures.plain();
    const factory = new IDBFactory();
    await seedRaw(factory, fx.record);
    const { c, storage } = makeController({ factory });
    await c.start();
    expect(await c.unlock(fx.password)).toBe('ok');
    c.mutate(bundle());
    await c.flush();
    const stored = await readStoredPayload(storage, fx.password);
    expect(stored.entries).toEqual(fx.payload.entries);
    expect(stored.futureField).toEqual(fx.payload.futureField);
    expect(listSubscriptions(stored)).toEqual([subscription]);
  });

  it('a vault that never uses them is stored without the new keys', async () => {
    const { c, storage } = await freshVault();
    addEntry(c, entry('login-1'));
    await c.flush();
    const stored = await readStoredPayload(storage);
    expect('accounts' in stored).toBe(false);
    expect('subscriptions' in stored).toBe(false);
  });
});
