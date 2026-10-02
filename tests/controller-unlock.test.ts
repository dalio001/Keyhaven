import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { getTotpCode } from '@/lib/totp';
import { parseStoredRecord } from '@/lib/store/format';
import type { VaultRecordV2 } from '@/lib/store/format';
import * as legacy from './legacy/v1';
import { fixtures, tamperEnvelope } from './helpers/fixtures';
import { seedRaw, FaultyStorage } from './helpers/faultyStorage';
import { PW, freshVault, makeController, readStoredPayload, started } from './helpers/controller';

async function legacyVault(fx = fixtures.totpPasskey()) {
  const factory = new IDBFactory();
  await seedRaw(factory, fx.record);
  const x = await started({ factory });
  return { ...x, fx };
}

describe('unlock', () => {
  it('accepts the right password and rejects a wrong one', async () => {
    const { c, factory } = await freshVault();
    await c.lock();
    expect(await c.unlock(`${PW}!`)).toBe('bad-password');
    expect(c.getSnapshot().status).toBe('locked');
    expect(await c.unlock(PW)).toBe('ok');
    void factory;
  });

  it('reports tampered vault data as corrupt (not as a wrong password) and changes nothing', async () => {
    const { c, storage } = await freshVault();
    await c.lock();
    const rec = (await storage.inner.readCurrent()) as VaultRecordV2;
    const tampered = { ...rec, blob: tamperEnvelope(rec.blob, 'ct') };
    await seedRaw(storage.factory, tampered);
    expect(await c.unlock(PW)).toBe('corrupt');
    expect(await storage.inner.readCurrent()).toEqual(tampered);
  });

  it('refuses a vault saved by a newer version and never overwrites it', async () => {
    const { c, storage } = await freshVault();
    await c.lock();
    const newer = { ...((await storage.inner.readCurrent()) as object), version: 3 };
    await seedRaw(storage.factory, newer);
    const tab = makeController({ factory: storage.factory });
    await tab.c.start();
    expect(tab.c.getSnapshot()).toMatchObject({ status: 'unavailable', unavailableReason: 'unsupported-version' });
    expect(await tab.c.unlock(PW)).toBe('unsupported-version');
    expect(await tab.c.createVault('x')).toBe('exists');
    expect(await storage.inner.readCurrent()).toEqual(newer);
  });
});

describe('legacy v1 migration on unlock', () => {
  it('migrates with key rotation, removes passkey wraps and preserves every field', async () => {
    const { c, storage, fx } = await legacyVault();
    expect(c.getSnapshot()).toMatchObject({ status: 'locked', needsMigration: true, legacyPasskeys: 1, totpEnabled: true });
    const { code } = await getTotpCode(fx.totpSecret!);
    expect(await c.unlock(fx.password, { totp: code })).toBe('ok');

    const stored = parseStoredRecord(await storage.inner.readCurrent()) as VaultRecordV2;
    expect(stored.version).toBe(2);
    expect('passkeys' in stored).toBe(false);
    expect(stored.salt).not.toBe(fx.record.salt);
    expect(stored.migratedFrom?.removedPasskeys).toBe(1);
    expect(c.getSnapshot()).toMatchObject({ needsMigration: false, legacyPasskeys: 0, totpEnabled: true });
    expect(c.getSnapshot().migratedFrom?.removedPasskeys).toBe(1);
    expect(c.getSnapshot().data).toEqual(fx.payload);
    expect(await readStoredPayload(storage, fx.password)).toEqual(fx.payload);

    const stolen = await legacy.legacyUnwrapWithoutAuthenticator(
      (fx.record.passkeys as legacy.LegacyPasskeyBlob[])[0],
    );
    await expect(legacy.decryptVault(stolen, stored.blob)).rejects.toThrow();

    // TOTP still required and still works after migration
    await c.lock();
    expect(await c.unlock(fx.password)).toBe('totp-required');
    expect(await c.unlock(fx.password, { totp: (await getTotpCode(fx.totpSecret!)).code })).toBe('ok');
  });

  it('writes nothing until the password AND the authenticator check pass', async () => {
    const { c, storage, fx } = await legacyVault();
    expect(await c.unlock('wrong-password')).toBe('bad-password');
    expect(await c.unlock(fx.password)).toBe('totp-required');
    expect(await c.unlock(fx.password, { totp: '000000' })).not.toBe('ok');
    expect(await c.unlock(fx.password, { backupCode: 'AAAA-AAAA-AAAA' })).toBe('backup-code-invalid');
    expect(storage.calls.filter((op) => op !== 'readCurrent' && op !== 'readPrevious')).toEqual([]);
    expect(await storage.inner.readCurrent()).toEqual(fx.record);
  });

  it('a backup code during migration is consumed in the same single write', async () => {
    const { c, storage, fx } = await legacyVault();
    const code = (fx.payload.recoveryCodes as string[])[3];
    expect(await c.unlock(fx.password, { backupCode: code.toLowerCase() })).toBe('ok');
    expect(storage.calls.filter((op) => op === 'commit')).toHaveLength(1);
    const stored = await readStoredPayload(storage, fx.password);
    expect(stored.recoveryCodes).toHaveLength(7);
    expect(stored.recoveryCodes).not.toContain(code);
    expect(stored.entries).toEqual(fx.payload.entries);
  });

  it('failed migration leaves the original record byte-identical and can be retried', async () => {
    const { c, storage, fx } = await legacyVault(fixtures.plain());
    storage.failNext('commit');
    expect(await c.unlock(fx.password)).toBe('migration-failed');
    expect(c.getSnapshot()).toMatchObject({ status: 'locked', data: null, needsMigration: true });
    expect(JSON.stringify(await storage.inner.readCurrent())).toBe(JSON.stringify(fx.record));

    expect(await c.unlock(fx.password)).toBe('ok');
    expect((parseStoredRecord(await storage.inner.readCurrent()) as VaultRecordV2).migratedFrom?.removedPasskeys).toBe(0);
  });

  it('two tabs migrating at once: exactly one migration lands, both end up on the same v2 vault', async () => {
    const factory = new IDBFactory();
    const fx = fixtures.passkey600k();
    await seedRaw(factory, fx.record);
    const a = makeController({ storage: new FaultyStorage(factory) });
    const b = makeController({ storage: new FaultyStorage(factory) });
    await Promise.all([a.c.start(), b.c.start()]);
    const [ra, rb] = await Promise.all([a.c.unlock(fx.password), b.c.unlock(fx.password)]);
    expect([ra, rb]).toEqual(['ok', 'ok']);
    const landed = [...a.storage.committed, ...b.storage.committed];
    expect(landed).toHaveLength(1);
    expect(a.c.getSnapshot().vaultId).toBe(b.c.getSnapshot().vaultId);
    expect(a.c.getSnapshot().data).toEqual(fx.payload);
    expect(b.c.getSnapshot().data).toEqual(fx.payload);
  });
});

describe('authenticator backup codes', () => {
  async function totpVault() {
    const x = await freshVault();
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    expect(await x.c.enableTotp(secret, (await getTotpCode(secret)).code)).toBe('ok');
    const codes = [...x.c.getSnapshot().data!.recoveryCodes];
    await x.c.lock();
    return { ...x, secret, codes };
  }

  it('stand in for the authenticator code (master password still required) and work once', async () => {
    const { c, storage, codes } = await totpVault();
    expect(await c.unlock('wrong-password', { backupCode: codes[0] })).toBe('bad-password');
    expect((await readStoredPayload(storage)).recoveryCodes).toHaveLength(8); // not consumed
    expect(await c.unlock(PW, { backupCode: codes[0] })).toBe('ok');
    expect(c.getSnapshot().data!.recoveryCodes).toHaveLength(7);
    await c.lock();

    // durable: a fresh session cannot reuse it
    const fresh = makeController({ factory: storage.factory });
    await fresh.c.start();
    expect(await fresh.c.unlock(PW, { backupCode: codes[0] })).toBe('backup-code-invalid');
    expect(await fresh.c.unlock(PW, { backupCode: codes[1] })).toBe('ok');
  });

  it('fail closed: if consuming the code cannot be saved, nothing unlocks and the code stays valid', async () => {
    const { c, storage, codes } = await totpVault();
    storage.failNext('commit');
    expect(await c.unlock(PW, { backupCode: codes[2] })).toBe('storage-error');
    expect(c.getSnapshot().status).toBe('locked');
    expect((await readStoredPayload(storage)).recoveryCodes).toContain(codes[2]);
  });

  it('cannot recover a forgotten master password', async () => {
    const { c, codes } = await totpVault();
    for (const code of codes) expect(await c.unlock('', { backupCode: code })).toBe('bad-password');
  });

  it('turning the authenticator off or re-enrolling requires a valid factor', async () => {
    const { c, secret, codes } = await totpVault();
    expect(await c.unlock(PW, { totp: (await getTotpCode(secret)).code })).toBe('ok');
    expect(await c.disableTotp({ totp: '123456' })).toBe('invalid-code');
    expect(await c.enableTotp('KRSXG5CTMVRXEZLUKN2XAZLSKNSWG4TF', '000000')).toBe('factor-required');
    expect(c.getSnapshot().totpEnabled).toBe(true);
    expect(await c.disableTotp({ backupCode: codes[5] })).toBe('ok');
    expect(c.getSnapshot().totpEnabled).toBe(false);
    expect(c.getSnapshot().data!.recoveryCodes).not.toContain(codes[5]);
    await c.lock();
    expect(await c.unlock(PW)).toBe('ok'); // no authenticator step any more
  });

  it('a damaged authenticator secret can be bypassed only with a backup code, which turns it off', async () => {
    const { c, storage, codes } = await totpVault();
    const rec = (await storage.inner.readCurrent()) as VaultRecordV2;
    await seedRaw(storage.factory, { ...rec, totpSecretEncrypted: tamperEnvelope(rec.totpSecretEncrypted!, 'ct') });
    expect(await c.unlock(PW, { totp: '123456' })).toBe('corrupt');
    expect(await c.unlock(PW, { backupCode: codes[0] })).toBe('ok');
    expect(c.getSnapshot()).toMatchObject({ totpEnabled: false, notice: 'totp-reset' });
  });
});
