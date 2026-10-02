import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getTotpCode } from '@/lib/totp';
import { parseStoredRecord, serializeBackupFile } from '@/lib/store/format';
import type { VaultRecordV2 } from '@/lib/store/format';
import { fixtures } from './helpers/fixtures';
import { FaultyStorage, seedRaw } from './helpers/faultyStorage';
import { PW, addEntry, entry, freshVault, makeController, memoryHub, readStoredPayload, started, until } from './helpers/controller';

async function exportText(c: Awaited<ReturnType<typeof freshVault>>['c']): Promise<string> {
  const r = await c.exportBackup();
  if (!r.ok) throw new Error('export failed');
  return r.text;
}

describe('import (restore an encrypted backup)', () => {
  it('a wrong backup password replaces nothing', async () => {
    const source = await freshVault();
    addEntry(source.c, entry('from-backup'));
    const text = await exportText(source.c);

    const target = await freshVault();
    addEntry(target.c, entry('keep-me'));
    await target.c.flush();
    const before = await target.storage.inner.readCurrent();
    expect(await target.c.importBackup(text, 'not-the-backup-password')).toEqual({ ok: false, reason: 'bad-password' });
    expect(await target.storage.inner.readCurrent()).toEqual(before);
    expect(await target.storage.inner.readPrevious()).toBeUndefined();
    expect(target.c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['keep-me']);
  });

  it('rejects malformed and newer-format files without touching the vault', async () => {
    const t = await freshVault();
    const before = await t.storage.inner.readCurrent();
    expect(await t.c.importBackup('{"nope":1}', PW)).toMatchObject({ ok: false, reason: 'invalid-file' });
    const newer = JSON.stringify({ app: 'keyhaven', kind: 'encrypted-vault-export', version: 9, record: before });
    expect(await t.c.importBackup(newer, PW)).toMatchObject({ ok: false, reason: 'unsupported-version' });
    expect(await t.storage.inner.readCurrent()).toEqual(before);
  });

  it('waits for an in-flight save, then keeps the replaced vault (with that save) in the previous slot', async () => {
    const source = await freshVault();
    const text = await exportText(source.c);

    const target = await freshVault();
    const gate = target.storage.gate('commit');
    addEntry(target.c, entry('in-flight'));
    await gate.reached;
    const importing = target.c.importBackup(text, PW);
    gate.release();
    expect(await importing).toMatchObject({ ok: true, unlocked: true });

    const previous = await readStoredPayload(target.storage, PW, 'previous');
    expect(previous.entries.map((e) => e.id)).toEqual(['in-flight']);
    expect((await readStoredPayload(target.storage)).entries).toEqual([]);
    expect(target.c.getSnapshot().previous).not.toBeNull();

    // the replaced vault can be restored
    expect(await target.c.restorePrevious()).toBe('ok');
    expect(target.c.getSnapshot().status).toBe('locked');
    expect(await target.c.unlock(PW)).toBe('ok');
    expect(target.c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['in-flight']);
  });

  it('a stale write from before the import cannot overwrite it (conflict, not overwrite)', async () => {
    const a = await freshVault();
    const backup = await exportText(a.c);
    const stale = makeController({ storage: new FaultyStorage(a.factory) });
    await stale.c.start();
    expect(await stale.c.unlock(PW)).toBe('ok'); // second tab, no channel → never told
    addEntry(a.c, entry('newer'));
    await a.c.flush();
    expect(await a.c.importBackup(backup, PW)).toMatchObject({ ok: true }); // restores the OLDER content
    const afterImport = await a.storage.inner.readCurrent();

    addEntry(stale.c, entry('stale-edit'));
    await expect(stale.c.flush()).rejects.toMatchObject({ reason: 'conflict' });
    expect(stale.c.getSnapshot().save.state).toBe('conflict');
    expect(await a.storage.inner.readCurrent()).toEqual(afterImport);
  });

  it('imports a legacy v1 backup as a migrated v2 vault (passkey wraps never stored)', async () => {
    const fx = fixtures.totpPasskey();
    const v1File = JSON.stringify({ app: 'keyhaven', kind: 'encrypted-vault-export', version: 1, exportedAt: 'x', record: fx.record });
    const t = await started();
    const r = await t.c.importBackup(v1File, fx.password);
    expect(r).toEqual({ ok: true, unlocked: false, migrated: true }); // authenticator still applies
    const stored = parseStoredRecord(await t.storage.inner.readCurrent()) as VaultRecordV2;
    expect(stored.version).toBe(2);
    expect(JSON.stringify(stored)).not.toContain('credentialId');
    expect(stored.salt).not.toBe(fx.record.salt);
    expect(await t.c.unlock(fx.password)).toBe('totp-required');
    expect(await t.c.unlock(fx.password, { totp: (await getTotpCode(fx.totpSecret!)).code })).toBe('ok');
    expect(t.c.getSnapshot().data).toEqual(fx.payload);
  });

  it('can restore a backup on a device with no vault', async () => {
    const source = await freshVault();
    addEntry(source.c, entry('portable'));
    const text = await exportText(source.c);
    const device = await started();
    expect(device.c.getSnapshot().status).toBe('no-vault');
    expect(await device.c.importBackup(text, PW)).toMatchObject({ ok: true, unlocked: true });
    expect(device.c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['portable']);
  });
});

describe('import racing a deletion', () => {
  // the 600k-iteration legacy fixture keeps verification + migration busy long
  // enough for a deletion to happen in between
  const slowBackup = () => {
    const fx = fixtures.passkey600k();
    return { fx, text: JSON.stringify({ app: 'keyhaven', kind: 'encrypted-vault-export', version: 1, record: fx.record }) };
  };

  it('a deletion in this tab while the backup is being verified cancels the import', async () => {
    const { c, storage } = await freshVault();
    const { fx, text } = slowBackup();
    const importing = c.importBackup(text, fx.password);
    await c.destroy();
    expect(await importing).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await storage.inner.readCurrent()).toBeUndefined();
    expect(c.getSnapshot().status).toBe('no-vault');
  });

  it('a deletion in another tab while the backup is being verified cancels the import', async () => {
    const hub = memoryHub();
    const factory = new IDBFactory();
    const a = await freshVault({ storage: new FaultyStorage(factory), channel: hub.channel(), tabId: 'tab-a' });
    const b = makeController({ storage: new FaultyStorage(factory), channel: hub.channel(), tabId: 'tab-b' });
    await b.c.start();
    const { fx, text } = slowBackup();
    const importing = a.c.importBackup(text, fx.password);
    await b.c.destroy();
    await until(() => a.c.getSnapshot().status === 'no-vault');
    expect(await importing).toMatchObject({ ok: false, reason: 'conflict' });
    expect(await a.storage.inner.readCurrent()).toBeUndefined();
  });
});

describe('delete', () => {
  it('a save still in flight cannot bring a deleted vault back', async () => {
    const { c, storage } = await freshVault();
    const gate = storage.gate('commit');
    addEntry(c, entry('doomed'));
    await gate.reached;
    const deleting = c.destroy();
    gate.release();
    await deleting;
    expect(c.getSnapshot().status).toBe('no-vault');
    expect(await storage.inner.readCurrent()).toBeUndefined();
    expect(await storage.inner.readPrevious()).toBeUndefined();
  });

  it('another tab with unsaved edits gets a conflict instead of re-creating the vault', async () => {
    const a = await freshVault();
    const b = makeController({ storage: new FaultyStorage(a.factory) });
    await b.c.start();
    expect(await b.c.unlock(PW)).toBe('ok');
    await a.c.destroy();
    addEntry(b.c, entry('zombie'));
    await expect(b.c.flush()).rejects.toMatchObject({ reason: 'conflict' });
    expect(await a.storage.inner.readCurrent()).toBeUndefined();
    expect(b.c.unsavedBackupText()).not.toBeNull(); // still rescuable, encrypted
  });
});

describe('change master password', () => {
  it('a wrong current password writes nothing', async () => {
    const { c, storage } = await freshVault();
    const before = await storage.inner.readCurrent();
    expect(await c.changePassword('wrong', 'new-synthetic-Password-1')).toBe('bad-password');
    expect(await storage.inner.readCurrent()).toEqual(before);
  });

  it('re-encrypts in place, keeps the session unlocked and the authenticator working', async () => {
    const { c, storage } = await freshVault();
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    expect(await c.enableTotp(secret, (await getTotpCode(secret)).code)).toBe('ok');
    addEntry(c, entry('kept'));
    expect(await c.changePassword(PW, 'new-synthetic-Password-1')).toBe('ok');
    expect(c.getSnapshot().status).toBe('unlocked');
    addEntry(c, entry('after-change'));
    await c.flush();
    await c.lock();
    expect(await c.unlock(PW, { totp: (await getTotpCode(secret)).code })).toBe('bad-password');
    expect(await c.unlock('new-synthetic-Password-1', { totp: (await getTotpCode(secret)).code })).toBe('ok');
    expect(c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['after-change', 'kept']);
    void storage;
  });
});

describe('export', () => {
  it('when storage fails, offers the unsaved changes as an encrypted file instead of a stale backup', async () => {
    const { c, storage } = await freshVault();
    storage.failAllWrites = true;
    addEntry(c, entry('unsaved'));
    const r = await c.exportBackup();
    expect(r).toMatchObject({ ok: false, reason: 'storage' });
    if (r.ok) return;
    expect(r.unsavedText).toBeTruthy();
    const other = await started();
    expect(await other.c.importBackup(r.unsavedText!, PW)).toMatchObject({ ok: true });
    expect(other.c.getSnapshot().data?.entries.map((e) => e.id)).toEqual(['unsaved']);
  });

  it('exports v2 files that strictly round-trip', async () => {
    const { c, storage } = await freshVault();
    const text = await exportText(c);
    const rec = (await storage.inner.readCurrent()) as VaultRecordV2;
    expect(JSON.parse(text)).toMatchObject({ version: 2, kind: 'encrypted-vault-export', record: rec });
    expect(serializeBackupFile(rec, 'x')).toContain('"version": 2');
  });
});

describe('boot states', () => {
  it('a damaged stored record is reported, never treated as "no vault"', async () => {
    const factory = new IDBFactory();
    await seedRaw(factory, { ...fixtures.plain().record, verifier: 'broken' });
    const t = makeController({ factory });
    await t.c.start();
    expect(t.c.getSnapshot()).toMatchObject({ status: 'unavailable', unavailableReason: 'invalid-record' });
    expect(await t.c.createVault(PW)).toBe('exists');
  });
});
