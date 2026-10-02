import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIdbStorage, sameRecord } from '@/lib/store/storage';
import { ConflictError, ExistsError, StorageError } from '@/lib/store/errors';
import type { VaultRecordV2 } from '@/lib/store/format';
import { fixtures } from './helpers/fixtures';
import { seedRaw } from './helpers/faultyStorage';

function rec(commitId: string, extra: Partial<VaultRecordV2> = {}): VaultRecordV2 {
  return {
    version: 2, vaultId: 'vault-a', revision: 1, commitId, salt: 's', kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 10000 },
    verifier: 'v', blob: 'b', totpEnabled: false, createdAt: 'c', updatedAt: 'u', ...extra,
  };
}

describe('IndexedDB vault storage', () => {
  it('create never overwrites an existing vault', async () => {
    const s = createIdbStorage({ factory: new IDBFactory() });
    await s.create(rec('c1'));
    await expect(s.create(rec('c2'))).rejects.toBeInstanceOf(ExistsError);
    expect(await s.readCurrent()).toMatchObject({ commitId: 'c1' });
  });

  it('commit is a compare-and-swap on vaultId + commitId', async () => {
    const s = createIdbStorage({ factory: new IDBFactory() });
    await s.create(rec('c1'));
    await s.commit(rec('c2', { revision: 2 }), rec('c1'));
    await expect(s.commit(rec('c3'), rec('c1'))).rejects.toBeInstanceOf(ConflictError);
    expect(await s.readCurrent()).toMatchObject({ commitId: 'c2' });
    // absent record → conflict, never a silent re-create
    await s.deleteAll();
    await expect(s.commit(rec('c4'), rec('c2'))).rejects.toBeInstanceOf(ConflictError);
    expect(await s.readCurrent()).toBeUndefined();
  });

  it('compares legacy v1 records by exact stored content', async () => {
    const f = new IDBFactory();
    const v1 = fixtures.totpPasskey().record;
    await seedRaw(f, v1);
    const s = createIdbStorage({ factory: f });
    const stored = await s.readCurrent();
    expect(sameRecord(stored, v1)).toBe(true);
    await expect(s.commit(rec('x'), { ...v1, blob: 'other' })).rejects.toBeInstanceOf(ConflictError);
    await s.commit(rec('x'), stored);
    expect(await s.readCurrent()).toMatchObject({ version: 2, commitId: 'x' });
  });

  it('replace atomically keeps the old vault in the previous slot (without legacy passkey wraps)', async () => {
    const f = new IDBFactory();
    const v1 = fixtures.totpPasskey().record;
    await seedRaw(f, v1);
    const s = createIdbStorage({ factory: f });
    await s.replace(rec('n1'), await s.readCurrent());
    expect(await s.readCurrent()).toMatchObject({ commitId: 'n1' });
    const prev = (await s.readPrevious()) as Record<string, unknown>;
    expect(prev.blob).toBe(v1.blob);
    expect('passkeys' in prev).toBe(false);

    await s.swapPrevious(await s.readCurrent());
    expect(await s.readCurrent()).toMatchObject({ blob: v1.blob });
    expect(await s.readPrevious()).toMatchObject({ commitId: 'n1' });
    await s.discardPrevious();
    expect(await s.readPrevious()).toBeUndefined();
  });

  it('replace with a stale expectation changes nothing', async () => {
    const s = createIdbStorage({ factory: new IDBFactory() });
    await s.create(rec('c1'));
    await expect(s.replace(rec('n1'), rec('zzz'))).rejects.toBeInstanceOf(ConflictError);
    expect(await s.readCurrent()).toMatchObject({ commitId: 'c1' });
    expect(await s.readPrevious()).toBeUndefined();
  });

  it('deleteAll removes current and previous', async () => {
    const s = createIdbStorage({ factory: new IDBFactory() });
    await s.create(rec('c1'));
    await s.replace(rec('c2'), rec('c1'));
    await s.deleteAll();
    expect(await s.readCurrent()).toBeUndefined();
    expect(await s.readPrevious()).toBeUndefined();
  });

  it('upgrades a v1 database in place and keeps the legacy record', async () => {
    const f = new IDBFactory();
    const v1 = fixtures.plain().record;
    await seedRaw(f, v1, 'current', 1);
    const s = createIdbStorage({ factory: f });
    expect(await s.readCurrent()).toEqual(v1);
  });

  it('is blocked (not broken) while a pre-Phase-1 tab holds a v1 connection, then proceeds', async () => {
    const f = new IDBFactory();
    const old = await new Promise<IDBDatabase>((resolve) => {
      const req = f.open('keyhaven', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('vault');
      req.onsuccess = () => resolve(req.result); // old code never handled versionchange
    });
    const s = createIdbStorage({ factory: f, timeoutMs: 5_000 });
    const events: string[] = [];
    s.onEvent((e) => events.push(e));
    const pending = s.readCurrent();
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toContain('blocked');
    old.close();
    await expect(pending).resolves.toBeUndefined();
  });

  it('old code (DB version 1) can no longer open the upgraded database', async () => {
    const f = new IDBFactory();
    const s = createIdbStorage({ factory: f });
    await s.create(rec('c1'));
    s.close();
    const err = await new Promise<DOMException | null>((resolve) => {
      const req = f.open('keyhaven', 1);
      req.onsuccess = () => resolve(null);
      req.onerror = () => resolve(req.error);
    });
    expect(err?.name).toBe('VersionError');
  });

  it('closes itself and reports when a newer version takes over', async () => {
    const f = new IDBFactory();
    const s = createIdbStorage({ factory: f });
    const events: string[] = [];
    s.onEvent((e) => events.push(e));
    await s.create(rec('c1'));
    await new Promise<void>((resolve) => {
      const req = f.open('keyhaven', 3);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    expect(events).toContain('superseded');
    await expect(s.readCurrent()).rejects.toBeInstanceOf(StorageError); // VersionError → storage error
  });

  it('times out instead of hanging forever', async () => {
    const f = new IDBFactory();
    const old = await new Promise<IDBDatabase>((resolve) => {
      const req = f.open('keyhaven', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('vault');
      req.onsuccess = () => resolve(req.result);
    });
    const s = createIdbStorage({ factory: f, timeoutMs: 100 });
    await expect(s.readCurrent()).rejects.toMatchObject({ kind: 'storage', failure: 'timeout' });
    old.close();
  });
});
