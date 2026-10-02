/**
 * KeyHaven record codec: crypto + format. Seals/opens vault records, migrates
 * legacy v1 records and re-keys for password changes. Pure (no storage).
 */

import { bufToB64, deriveVaultKey, openText, randomSalt, sealText } from '../crypto';
import type { DerivedKey } from '../crypto';
import {
  FormatError,
  legacyPasskeyCount,
  parsePayload,
  parseStoredRecord,
  serializePayload,
} from './format';
import type { AnyVaultRecord, KdfParams, VaultPayload, VaultRecordV1, VaultRecordV2 } from './format';

/** A derived key together with the salt/KDF parameters it came from. */
export interface KeyMaterial extends DerivedKey {
  salt: string;
  kdf: KdfParams;
}

/** The encrypted fields of a record, all produced by one {@link KeyMaterial}. */
export interface SealedFields {
  salt: string;
  kdf: KdfParams;
  verifier: string;
  blob: string;
  totpSecretEncrypted?: string;
  totpEnabled: boolean;
}

/** Derive key material for an existing record (uses the record's own salt + iterations). */
export async function deriveForRecord(password: string, rec: AnyVaultRecord): Promise<KeyMaterial> {
  const dk = await deriveVaultKey(password, rec.salt, rec.kdf.iterations);
  return { ...dk, salt: rec.salt, kdf: { ...rec.kdf } };
}

/** Fresh salt → fresh key (used by migration, password change and create). */
export async function newKeyMaterial(password: string, iterations: number): Promise<KeyMaterial> {
  const salt = bufToB64(randomSalt());
  const dk = await deriveVaultKey(password, salt, iterations);
  return { ...dk, salt, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations } };
}

/** Encrypt payload (+ optional TOTP secret) with fresh IVs. */
export async function sealFields(
  km: KeyMaterial,
  payload: VaultPayload,
  totpSecret: string | null,
): Promise<SealedFields> {
  const blob = await sealText(km.key, serializePayload(payload));
  const fields: SealedFields = {
    salt: km.salt,
    kdf: km.kdf,
    verifier: km.verifier,
    blob,
    totpEnabled: totpSecret !== null,
  };
  if (totpSecret !== null) fields.totpSecretEncrypted = await sealText(km.key, totpSecret);
  return fields;
}

/** Decrypt + validate the payload. Throws IntegrityError (wrong key/tamper) or FormatError. */
export async function openPayload(rec: AnyVaultRecord, key: CryptoKey): Promise<VaultPayload> {
  return parsePayload(await openText(key, rec.blob));
}

/** Decrypt the TOTP secret, or null when the authenticator is not enabled. Throws IntegrityError. */
export async function openTotpSecret(rec: AnyVaultRecord, key: CryptoKey): Promise<string | null> {
  if (!rec.totpEnabled || !rec.totpSecretEncrypted) return null;
  return openText(key, rec.totpSecretEncrypted);
}

export interface Opened {
  payload: VaultPayload;
  totpSecret: string | null;
}

export interface CodecOptions {
  iterations: number;
  now: string;
  uuid: () => string;
}

/** Re-open what was just sealed and compare — never write what cannot be read back. */
async function selfCheck(record: VaultRecordV2, km: KeyMaterial, desired: Opened): Promise<void> {
  parseStoredRecord(record);
  if (record.verifier !== km.verifier) throw new Error('self-check: verifier mismatch');
  const payloadBack = await openText(km.key, record.blob);
  if (payloadBack !== serializePayload(desired.payload)) throw new Error('self-check: payload mismatch');
  const totpBack = await openTotpSecret(record, km.key);
  if (totpBack !== desired.totpSecret) throw new Error('self-check: authenticator secret mismatch');
}

/**
 * Migrate a legacy v1 record to v2 WITH KEY ROTATION.
 *
 * v1 vaults may carry passkey "wraps" from which the vault key can be
 * recovered without any authenticator. Removing the wraps alone would not
 * help: anyone who already copied one holds the key. So migration derives a
 * NEW key from the same master password and a fresh random salt, re-encrypts
 * the payload and TOTP secret with fresh IVs, and drops the wraps. The old
 * key cannot open the new record.
 *
 * Caller must have verified `password` against `rec` and opened its contents.
 */
export async function migrateV1(
  rec: VaultRecordV1,
  password: string,
  opened: Opened,
  o: CodecOptions,
): Promise<{ record: VaultRecordV2; key: KeyMaterial }> {
  const km = await newKeyMaterial(password, o.iterations);
  if (km.salt === rec.salt) throw new Error('migration: salt did not rotate'); // astronomically unlikely
  const fields = await sealFields(km, opened.payload, opened.totpSecret);
  const record: VaultRecordV2 = {
    version: 2,
    vaultId: o.uuid(),
    revision: 1,
    commitId: o.uuid(),
    ...fields,
    createdAt: rec.createdAt,
    updatedAt: o.now,
    migratedFrom: { version: 1, at: o.now, removedPasskeys: legacyPasskeyCount(rec) },
  };
  await selfCheck(record, km, opened);
  return { record, key: km };
}

/**
 * Re-key a v2 record under a new master password (fresh salt + key), carrying
 * the desired (latest in-memory) contents. Unknown top-level fields are kept.
 */
export async function rekey(
  base: VaultRecordV2,
  newPassword: string,
  desired: Opened,
  o: CodecOptions,
): Promise<{ record: VaultRecordV2; key: KeyMaterial }> {
  const km = await newKeyMaterial(newPassword, o.iterations);
  const fields = await sealFields(km, desired.payload, desired.totpSecret);
  const record: VaultRecordV2 = {
    ...base,
    ...fields,
    revision: base.revision + 1,
    commitId: o.uuid(),
    updatedAt: o.now,
  };
  if (!fields.totpSecretEncrypted) delete record.totpSecretEncrypted;
  await selfCheck(record, km, desired);
  return { record, key: km };
}

/** Build a brand-new v2 record (vault creation). */
export async function createRecord(
  password: string,
  payload: VaultPayload,
  o: CodecOptions,
): Promise<{ record: VaultRecordV2; key: KeyMaterial }> {
  const km = await newKeyMaterial(password, o.iterations);
  const fields = await sealFields(km, payload, null);
  const record: VaultRecordV2 = {
    version: 2,
    vaultId: o.uuid(),
    revision: 1,
    commitId: o.uuid(),
    ...fields,
    createdAt: o.now,
    updatedAt: o.now,
  };
  await selfCheck(record, km, { payload, totpSecret: null });
  return { record, key: km };
}

/** True when an error means "data is damaged/tampered" (vs. wrong password or I/O). */
export function isCorruption(err: unknown): boolean {
  return (
    (err instanceof Error && (err as { kind?: string }).kind === 'integrity') ||
    (err instanceof FormatError && err.code === 'invalid')
  );
}
