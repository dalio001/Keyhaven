import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getTotpCode } from '@/lib/totp';
import { FaultyStorage } from './helpers/faultyStorage';
import { PW, addEntry, entry, freshVault, makeController, memoryHub, readStoredPayload, until } from './helpers/controller';

async function twoTabs() {
  const hub = memoryHub();
  const factory = new IDBFactory();
  const a = await freshVault({ storage: new FaultyStorage(factory), channel: hub.channel(), tabId: 'tab-a' });
  const b = makeController({ storage: new FaultyStorage(factory), channel: hub.channel(), tabId: 'tab-b' });
  await b.c.start();
  return { hub, factory, a, b };
}

describe('multiple tabs', () => {
  it('unlocking in a second tab locks the first, whose pending edit is still saved', async () => {
    const { a, b } = await twoTabs();
    addEntry(a.c, entry('from-tab-a'));
    expect(await b.c.unlock(PW)).toBe('ok');
    await until(() => a.c.getSnapshot().status === 'locked');
    expect(a.c.getSnapshot().lockReason).toBe('other-tab');
    await a.c.flush();
    expect((await readStoredPayload(a.storage)).entries.map((e) => e.id)).toContain('from-tab-a');
  });

  it('simultaneous unlocks leave exactly one tab unlocked', async () => {
    const { a, b } = await twoTabs();
    await a.c.lock();
    await Promise.all([a.c.unlock(PW), b.c.unlock(PW)]);
    await until(() => [a, b].filter((t) => t.c.getSnapshot().status === 'unlocked').length === 1);
    await new Promise((r) => setTimeout(r, 30));
    expect([a, b].filter((t) => t.c.getSnapshot().status === 'unlocked')).toHaveLength(1);
  });

  it('locked tabs refresh what they show when another tab changes the vault', async () => {
    const { a, b } = await twoTabs();
    expect(b.c.getSnapshot().totpEnabled).toBe(false);
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    expect(await a.c.enableTotp(secret, (await getTotpCode(secret)).code)).toBe('ok');
    await until(() => b.c.getSnapshot().totpEnabled);
    await a.c.destroy();
    await until(() => b.c.getSnapshot().status === 'no-vault');
  });

  it('a lost message never causes an overwrite: the stale tab gets a conflict and keeps its edit encrypted', async () => {
    const { hub, a, b } = await twoTabs();
    hub.deliver = false; // e.g. a frozen/background tab
    expect(await b.c.unlock(PW)).toBe('ok');
    addEntry(a.c, entry('a-edit'));
    await a.c.flush();
    addEntry(b.c, entry('b-edit'));
    await expect(b.c.flush()).rejects.toMatchObject({ reason: 'conflict' });
    expect((await readStoredPayload(a.storage)).entries.map((e) => e.id)).toEqual(['a-edit']);
    expect(b.c.unsavedBackupText()).toBeTruthy();
    expect(addEntry(b.c, entry('blocked'))).toBe(false);
  });

  it('a clean tab that missed the unlock hint reloads another tab\'s commit in place', async () => {
    const { hub, a, b } = await twoTabs();
    hub.deliver = false;
    expect(await b.c.unlock(PW)).toBe('ok');
    hub.deliver = true;
    addEntry(a.c, entry('a-edit'));
    await a.c.flush();
    await until(() => (b.c.getSnapshot().data?.entries.length ?? 0) === 1);
    expect(b.c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['a-edit']);
    expect(b.c.getSnapshot().status).toBe('unlocked');
  });
});
