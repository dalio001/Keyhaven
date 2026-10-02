/**
 * KeyHaven storage + backup formats — pure types, parsing and validation.
 * No crypto, no IndexedDB.
 *
 * Versions
 * --------
 * - Record v1 (pre-Phase-1): password-derived key, optional `passkeys` array
 *   holding INSECURELY wrapped copies of the vault key. Read-only: v1 records
 *   are migrated to v2 (with key rotation) on the next master-password unlock
 *   or import, and are never written again.
 * - Record v2: adds `vaultId`, `revision`, `commitId` (compare-and-swap token)
 *   and `migratedFrom`; has no passkey field.
 * - Backup file v1/v2: `{ app, kind: 'encrypted-vault-export', version, exportedAt, record }`.
 *
 * `record.version` (plaintext) is the single format gate: anything newer than
 * {@link RECORD_VERSION} is rejected as `unsupported-version` and is never
 * downgraded. Within a known version, unknown fields are preserved verbatim.
 */

import { DEFAULT_SETTINGS } from '../vault';
import type { VaultEntry, VaultSettings } from '../vault';

export const RECORD_VERSION = 2;
export const BACKUP_FILE_VERSION = 2;
export const MIN_KDF_ITERATIONS = 10_000;
export const MAX_KDF_ITERATIONS = 10_000_000;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export interface KdfParams {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
}

/** Legacy record written before Phase 1. Parsed for migration only. */
export interface VaultRecordV1 {
  version: 1;
  salt: string;
  kdf: KdfParams;
  verifier: string;
  blob: string;
  totpSecretEncrypted?: string;
  totpEnabled?: boolean;
  /** insecure passkey wraps — dropped by migration, never written again */
  passkeys?: unknown[];
  createdAt: string;
  updatedAt: string;
  [unknownField: string]: unknown;
}

export interface MigratedFrom {
  version: 1;
  /** ISO time of the migration */
  at: string;
  /** number of insecure legacy passkey wraps removed */
  removedPasskeys: number;
}

export interface VaultRecordV2 {
  version: 2;
  /** random id of this vault lineage (kept across saves; new on create/migration) */
  vaultId: string;
  /** +1 on every committed write to a device's storage */
  revision: number;
  /** random token of the write that produced this record (compare-and-swap) */
  commitId: string;
  salt: string;
  kdf: KdfParams;
  verifier: string;
  blob: string;
  totpSecretEncrypted?: string;
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  migratedFrom?: MigratedFrom;
  [unknownField: string]: unknown;
}

export type AnyVaultRecord = VaultRecordV1 | VaultRecordV2;

export type FormatErrorCode = 'not-json' | 'not-keyhaven' | 'unsupported-version' | 'invalid' | 'too-large';

export class FormatError extends Error {
  readonly kind = 'format' as const;
  readonly code: FormatErrorCode;
  constructor(code: FormatErrorCode, message: string) {
    super(message);
    this.name = 'FormatError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* primitive validators                                                */
/* ------------------------------------------------------------------ */

const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** decoded byte length of a well-formed base64 string, or -1 */
function b64Bytes(v: unknown): number {
  if (typeof v !== 'string' || v.length % 4 !== 0 || !B64_RE.test(v)) return -1;
  const pad = v.endsWith('==') ? 2 : v.endsWith('=') ? 1 : 0;
  return (v.length / 4) * 3 - pad;
}

function invalid(field: string): FormatError {
  return new FormatError('invalid', `Vault data is damaged or not a KeyHaven vault (${field}).`);
}

/** Validate the `{ iv, ct }` envelope shape of an encrypted field without decrypting it. */
function checkEnvelope(v: unknown, field: string): void {
  if (b64Bytes(v) < 0) throw invalid(field);
  let inner: unknown;
  try {
    inner = JSON.parse(atob(v as string));
  } catch {
    throw invalid(field);
  }
  if (!isObject(inner) || b64Bytes(inner.iv) !== 12 || b64Bytes(inner.ct) < 16) throw invalid(field);
}

function checkKdf(v: unknown): void {
  if (
    !isObject(v) ||
    v.name !== 'PBKDF2' ||
    v.hash !== 'SHA-256' ||
    typeof v.iterations !== 'number' ||
    !Number.isInteger(v.iterations) ||
    v.iterations < MIN_KDF_ITERATIONS ||
    v.iterations > MAX_KDF_ITERATIONS
  ) {
    throw invalid('kdf');
  }
}

/* ------------------------------------------------------------------ */
/* records                                                             */
/* ------------------------------------------------------------------ */

/**
 * Validate a stored/imported vault record. Returns the SAME object (typed) so
 * callers can use it as an exact compare-and-swap base. Throws {@link FormatError}.
 */
export function parseStoredRecord(raw: unknown): AnyVaultRecord {
  if (!isObject(raw)) throw new FormatError('not-keyhaven', 'Not a KeyHaven vault record.');
  const version = raw.version;
  if (typeof version === 'number' && Number.isInteger(version) && version > RECORD_VERSION) {
    throw new FormatError(
      'unsupported-version',
      `This vault was saved by a newer version of KeyHaven (format ${version}). Update KeyHaven to open it — it has not been modified.`,
    );
  }
  if (version !== 1 && version !== 2) throw new FormatError('not-keyhaven', 'Not a KeyHaven vault record.');

  const saltBytes = b64Bytes(raw.salt);
  if (saltBytes < 16 || saltBytes > 64) throw invalid('salt');
  checkKdf(raw.kdf);
  if (b64Bytes(raw.verifier) !== 32) throw invalid('verifier');
  checkEnvelope(raw.blob, 'blob');
  if (typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string') throw invalid('timestamps');
  if (raw.totpSecretEncrypted !== undefined) checkEnvelope(raw.totpSecretEncrypted, 'totpSecretEncrypted');
  if (raw.totpEnabled !== undefined && typeof raw.totpEnabled !== 'boolean') throw invalid('totpEnabled');
  if (raw.totpEnabled === true && raw.totpSecretEncrypted === undefined) throw invalid('totpSecretEncrypted');

  if (version === 1) {
    if (raw.passkeys !== undefined && !Array.isArray(raw.passkeys)) throw invalid('passkeys');
    return raw as VaultRecordV1;
  }

  if (typeof raw.vaultId !== 'string' || raw.vaultId.length === 0) throw invalid('vaultId');
  if (typeof raw.commitId !== 'string' || raw.commitId.length === 0) throw invalid('commitId');
  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 0) {
    throw invalid('revision');
  }
  if (typeof raw.totpEnabled !== 'boolean') throw invalid('totpEnabled');
  if ('passkeys' in raw && raw.passkeys !== undefined) throw invalid('passkeys');
  if (raw.migratedFrom !== undefined) {
    const m = raw.migratedFrom;
    if (
      !isObject(m) ||
      m.version !== 1 ||
      typeof m.at !== 'string' ||
      typeof m.removedPasskeys !== 'number' ||
      !Number.isInteger(m.removedPasskeys) ||
      m.removedPasskeys < 0
    ) {
      throw invalid('migratedFrom');
    }
  }
  return raw as VaultRecordV2;
}

/** Number of legacy (insecure) passkey wraps stored in a record. */
export function legacyPasskeyCount(rec: AnyVaultRecord): number {
  return rec.version === 1 && Array.isArray(rec.passkeys) ? rec.passkeys.length : 0;
}

/* ------------------------------------------------------------------ */
/* backup files                                                        */
/* ------------------------------------------------------------------ */

export interface ParsedBackup {
  record: AnyVaultRecord;
  /** `exportedAt` from the wrapper, when present */
  exportedAt: string | null;
  /** wrapper format version (null for a bare record) */
  fileVersion: number | null;
}

/**
 * Parse an encrypted backup file: a v1/v2 export wrapper or a bare record.
 * Never decrypts. Throws {@link FormatError}.
 */
export function parseBackupFile(text: string): ParsedBackup {
  if (text.length > MAX_BACKUP_BYTES) {
    throw new FormatError('too-large', 'This file is too large to be a KeyHaven backup.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FormatError('not-json', 'This file is not a KeyHaven backup (it is not JSON).');
  }
  if (!isObject(parsed)) throw new FormatError('not-keyhaven', 'This file is not a KeyHaven backup.');

  if (parsed.kind === 'encrypted-vault-export') {
    if (parsed.app !== 'keyhaven') throw new FormatError('not-keyhaven', 'This file is not a KeyHaven backup.');
    const v = parsed.version;
    if (typeof v === 'number' && Number.isInteger(v) && v > BACKUP_FILE_VERSION) {
      throw new FormatError(
        'unsupported-version',
        `This backup was made by a newer version of KeyHaven (file format ${v}). Update KeyHaven to import it.`,
      );
    }
    if (v !== 1 && v !== 2) throw new FormatError('not-keyhaven', 'This file is not a KeyHaven backup.');
    return {
      record: parseStoredRecord(parsed.record),
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
      fileVersion: v,
    };
  }
  if ('version' in parsed && 'blob' in parsed) {
    return { record: parseStoredRecord(parsed), exportedAt: null, fileVersion: null };
  }
  throw new FormatError('not-keyhaven', 'This file is not a KeyHaven backup.');
}

/** Serialize a v2 record as an encrypted backup file (ciphertext only). */
export function serializeBackupFile(record: VaultRecordV2, exportedAt: string): string {
  return JSON.stringify(
    { app: 'keyhaven', kind: 'encrypted-vault-export', version: BACKUP_FILE_VERSION, exportedAt, record },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ */
/* decrypted payload                                                   */
/* ------------------------------------------------------------------ */

/**
 * The decrypted vault payload. Unknown keys (top-level and per entry, e.g.
 * `totpSecret`, `passwordHistory`, future account/subscription data) are
 * preserved on every round-trip.
 */
export interface VaultPayload {
  entries: VaultEntry[];
  settings: VaultSettings;
  /**
   * Authenticator backup codes (one-time). The key keeps its historical name
   * for compatibility; the codes NEVER recover a forgotten master password.
   */
  recoveryCodes: string[];
  [unknownField: string]: unknown;
}

/**
 * Validate a decrypted payload structurally. Never rebuilds entries — only
 * checks the minimum needed to operate, so no user data can be dropped.
 * Throws {@link FormatError} (`invalid`).
 */
export function parsePayload(json: string): VaultPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new FormatError('invalid', 'The decrypted vault contents are not valid JSON.');
  }
  if (!isObject(raw) || !Array.isArray(raw.entries)) throw invalid('payload');
  for (const e of raw.entries) {
    if (!isObject(e) || typeof e.id !== 'string') throw invalid('entry');
  }
  const settings = isObject(raw.settings)
    ? ({ ...DEFAULT_SETTINGS, ...raw.settings } as VaultSettings)
    : { ...DEFAULT_SETTINGS };
  const recoveryCodes = Array.isArray(raw.recoveryCodes)
    ? raw.recoveryCodes.filter((c): c is string => typeof c === 'string')
    : [];
  return { ...raw, entries: raw.entries as VaultEntry[], settings, recoveryCodes };
}

export function serializePayload(payload: VaultPayload): string {
  return JSON.stringify(payload);
}
