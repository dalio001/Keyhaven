import { describe, expect, it } from 'vitest';
import { SaveError } from '@/lib/store/errors';
import { parseBackupFile } from '@/lib/store/format';
import type { VaultRecordV2 } from '@/lib/store/format';
import { PW, addEntry, entry, freshVault, makeController, readStoredPayload, started } from './helpers/controller';

describe('save lifecycle', () => {
  it('edit then immediate lock: the edit is sealed before the key is dropped and lands afterwards', async () => {
    const { c, storage, factory } = await freshVault();
    const gate = storage.gate('commit');
    expect(addEntry(c, entry('just-before-lock'))).toBe(true);
    await gate.reached; // the write is in flight…
    const locking = c.lock(); // …when the user locks
    await locking;
    expect(c.getSnapshot().status).toBe('locked');
    expect(c.getSnapshot().data).toBeNull();
    expect(c.getSnapshot().save.unsaved).toBe(true);
    gate.release();
    await c.flush();
    expect(c.getSnapshot().save).toMatchObject({ state: 'saved', unsaved: false });

    // a brand-new session (e.g. after reload) sees the edit
    const fresh = makeController({ factory });
    await fresh.c.start();
    expect(await fresh.c.unlock(PW)).toBe('ok');
    expect(fresh.c.getSnapshot().data?.entries.map((e) => e.id)).toContain('just-before-lock');
  });

  it('edit made after a write started, then lock: both edits are stored', async () => {
    const { c, storage } = await freshVault();
    const gate = storage.gate('commit');
    addEntry(c, entry('first'));
    await gate.reached;
    addEntry(c, entry('second'));
    await c.lock();
    gate.release();
    await c.flush();
    const stored = await readStoredPayload(storage);
    expect(stored.entries.map((e) => e.id)).toEqual(['second', 'first']);
  });

  it('edit then immediate export: the backup contains the edit and equals what is stored', async () => {
    const { c, storage } = await freshVault();
    addEntry(c, entry('just-before-export'));
    const res = await c.exportBackup();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const file = parseBackupFile(res.text);
    expect(file.record).toEqual(await storage.inner.readCurrent());
    expect(res.text).not.toContain('synthetic-secret-just-before-export'); // still ciphertext

    // restore the export on a "new device"
    const other = await started();
    expect(await other.c.importBackup(res.text, PW)).toMatchObject({ ok: true, unlocked: true });
    expect(other.c.getSnapshot().data?.entries.map((e) => e.id)).toContain('just-before-export');
  });

  it('100 rapid edits: writes never overlap, revisions only increase, final state is stored', async () => {
    const { c, storage } = await freshVault();
    for (let i = 0; i < 100; i++) addEntry(c, entry(`rapid-${i}`));
    await c.flush();
    expect(storage.maxConcurrentWrites).toBe(1);
    const revs = storage.committed.map((r) => (r as VaultRecordV2).revision);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(new Set(revs).size).toBe(revs.length);
    expect(storage.committed.length).toBeLessThanOrEqual(101);
    const stored = await readStoredPayload(storage);
    expect(stored.entries).toHaveLength(100);
    expect(stored.entries[0].id).toBe('rapid-99');
  });

  it('a storage failure is reported (never a false "saved") and can be retried', async () => {
    const { c, storage } = await freshVault();
    storage.failNext('commit');
    addEntry(c, entry('needs-retry'));
    await expect(c.flush()).rejects.toBeInstanceOf(SaveError);
    expect(c.getSnapshot().save).toMatchObject({ state: 'error', unsaved: true });
    expect((await readStoredPayload(storage)).entries).toHaveLength(0);

    c.retrySave();
    await c.flush();
    expect(c.getSnapshot().save).toMatchObject({ state: 'saved', unsaved: false });
    expect((await readStoredPayload(storage)).entries.map((e) => e.id)).toEqual(['needs-retry']);
  });

  it('storage failing across a lock: only ciphertext is kept, downloadable, and unlock waits for it', async () => {
    const { c, storage, factory } = await freshVault();
    storage.failAllWrites = true;
    addEntry(c, entry('stuck'));
    await c.lock();
    await expect(c.flush()).rejects.toBeInstanceOf(SaveError);
    expect(c.getSnapshot()).toMatchObject({ status: 'locked', data: null, save: { unsaved: true } });

    // the pending change can be rescued as an ENCRYPTED backup
    const text = c.unsavedBackupText();
    expect(text).not.toBeNull();
    expect(text).not.toContain('synthetic-secret-stuck');
    const rescue = await started();
    expect(await rescue.c.importBackup(text!, PW)).toMatchObject({ ok: true });
    expect(rescue.c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['stuck']);

    // unlocking this tab would read the older stored record — refuse until resolved
    expect(await c.unlock(PW)).toBe('unsaved-pending');
    storage.failAllWrites = false;
    c.retrySave();
    await c.flush();
    expect(await c.unlock(PW)).toBe('ok');
    expect(c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['stuck']);
    void factory;
  });

  it('refuses edits while locked and shares one lock across concurrent callers', async () => {
    const { c } = await freshVault();
    addEntry(c, entry('x'));
    const a = c.lock();
    const b = c.lock();
    expect(a).toBe(b);
    await Promise.all([a, b, c.lock()]);
    expect(addEntry(c, entry('after-lock'))).toBe(false);
    await c.flush();
  });

  it('adopts a write that reported a failure but actually landed (no false conflict)', async () => {
    const { c, storage } = await freshVault();
    storage.landThenFail('commit');
    addEntry(c, entry('landed'));
    await expect(c.flush()).rejects.toBeInstanceOf(SaveError);
    c.retrySave();
    await c.flush();
    expect(c.getSnapshot().save.state).toBe('saved');
    const stored = await readStoredPayload(storage);
    expect(stored.entries.map((e) => e.id)).toEqual(['landed']);
  });

  it('locking during a password change seals with the NEW key; every edit survives', async () => {
    const { c, storage } = await freshVault();
    addEntry(c, entry('before-change'));
    const change = c.changePassword(PW, 'brand-new-synthetic-Password-9');
    addEntry(c, entry('during-change'));
    const lock = c.lock();
    expect(await change).toBe('ok');
    await lock;
    await c.flush();
    await expect(readStoredPayload(storage, PW)).rejects.toThrow();
    const stored = await readStoredPayload(storage, 'brand-new-synthetic-Password-9');
    expect(stored.entries.map((e) => e.id)).toEqual(['during-change', 'before-change']);
  });

  it('never creates over an existing vault', async () => {
    const { factory, storage } = await freshVault();
    const before = await storage.inner.readCurrent();
    const second = makeController({ factory });
    await second.c.start();
    expect(await second.c.createVault('another-password')).toBe('exists');

    // even if this tab still believes there is no vault
    const blind = makeController({ factory });
    expect(await blind.c.createVault('another-password')).toBe('exists');
    expect(await storage.inner.readCurrent()).toEqual(before);
  });
});
