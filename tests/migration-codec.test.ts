import { describe, expect, it } from 'vitest';
import { IntegrityError, deriveVaultKey, openText } from '@/lib/crypto';
import { parseStoredRecord } from '@/lib/store/format';
import type { VaultRecordV1 } from '@/lib/store/format';
import { deriveForRecord, migrateV1, openPayload, openTotpSecret, rekey } from '@/lib/store/codec';
import * as legacy from './legacy/v1';
import { codecOpts, fixtures } from './helpers/fixtures';

describe('legacy passkey flaw (security regression)', () => {
  it('a stored v1 passkey blob alone recovers the vault key — no password, no authenticator', async () => {
    const fx = fixtures.totpPasskey();
    const rec = fx.record as unknown as VaultRecordV1 & { passkeys: legacy.LegacyPasskeyBlob[] };
    const stolenKey = await legacy.legacyUnwrapWithoutAuthenticator(rec.passkeys[0]);
    expect(JSON.parse(await legacy.decryptVault(stolenKey, rec.blob))).toEqual(fx.payload);
    expect(await legacy.decryptVault(stolenKey, rec.totpSecretEncrypted!)).toBe(fx.totpSecret);
  });

  it('migration rotates the key: the recovered legacy key no longer opens anything', async () => {
    const fx = fixtures.totpPasskey();
    const rec = parseStoredRecord(fx.record) as VaultRecordV1;
    const stolenKey = await legacy.legacyUnwrapWithoutAuthenticator(
      (rec.passkeys as legacy.LegacyPasskeyBlob[])[0],
    );

    const km = await deriveForRecord(fx.password, rec);
    expect(km.verifier).toBe(rec.verifier);
    const opened = { payload: await openPayload(rec, km.key), totpSecret: await openTotpSecret(rec, km.key) };
    const { record: next, key } = await migrateV1(rec, fx.password, opened, codecOpts());

    // format: v2, no passkeys, new salt + verifier, migration metadata
    expect(next.version).toBe(2);
    expect('passkeys' in next).toBe(false);
    expect(JSON.stringify(next)).not.toContain('credentialId');
    expect(next.salt).not.toBe(rec.salt);
    expect(next.verifier).not.toBe(rec.verifier);
    expect(next.migratedFrom).toEqual({ version: 1, at: '2026-10-02T00:00:00.000Z', removedPasskeys: 1 });
    expect(next.revision).toBe(1);
    expect(parseStoredRecord(next)).toBe(next);

    // the key an attacker recovered from the old blob is useless against the new record
    await expect(legacy.decryptVault(stolenKey, next.blob)).rejects.toThrow();
    await expect(legacy.decryptVault(stolenKey, next.totpSecretEncrypted!)).rejects.toThrow();
    expect(await legacy.computeVerifier(stolenKey)).not.toBe(next.verifier);

    // contents preserved exactly (incl. unknown fields, backup codes, TOTP secret)
    expect(await openPayload(next, key.key)).toEqual(fx.payload);
    expect(await openTotpSecret(next, key.key)).toBe(fx.totpSecret);

    // the SAME master password opens the migrated vault (salt is in the record)
    const again = await deriveVaultKey(fx.password, next.salt, next.kdf.iterations);
    expect(again.verifier).toBe(next.verifier);
    expect(JSON.parse(await openText(again.key, next.blob))).toEqual(fx.payload);
  });

  it('migrates a plain v1 vault too (rotation is unconditional) and reports 0 passkeys', async () => {
    const fx = fixtures.plain();
    const rec = parseStoredRecord(fx.record) as VaultRecordV1;
    const km = await deriveForRecord(fx.password, rec);
    const opened = { payload: await openPayload(rec, km.key), totpSecret: null };
    const { record: next } = await migrateV1(rec, fx.password, opened, codecOpts());
    expect(next.migratedFrom?.removedPasskeys).toBe(0);
    expect(next.salt).not.toBe(rec.salt);
    expect(next.totpEnabled).toBe(false);
    expect(next.totpSecretEncrypted).toBeUndefined();
  });
});

describe('rekey (change master password)', () => {
  it('re-encrypts under the new password only', async () => {
    const fx = fixtures.totpPasskey();
    const rec = parseStoredRecord(fx.record) as VaultRecordV1;
    const km = await deriveForRecord(fx.password, rec);
    const opened = { payload: await openPayload(rec, km.key), totpSecret: await openTotpSecret(rec, km.key) };
    const { record: v2, key: oldKm } = await migrateV1(rec, fx.password, opened, codecOpts());
    const { record: re } = await rekey(v2, 'brand-new-synthetic-pass', opened, codecOpts());

    expect(re.vaultId).toBe(v2.vaultId);
    expect(re.revision).toBe(v2.revision + 1);
    expect(re.commitId).not.toBe(v2.commitId);
    await expect(openText(oldKm.key, re.blob)).rejects.toBeInstanceOf(IntegrityError);
    const nk = await deriveVaultKey('brand-new-synthetic-pass', re.salt, re.kdf.iterations);
    expect(nk.verifier).toBe(re.verifier);
    expect(await openTotpSecret(re, nk.key)).toBe(fx.totpSecret);
    const old = await deriveVaultKey(fx.password, re.salt, re.kdf.iterations);
    expect(old.verifier).not.toBe(re.verifier);
  });
});
