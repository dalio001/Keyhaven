import { describe, expect, it } from 'vitest';
import {
  FormatError,
  parseBackupFile,
  parsePayload,
  parseStoredRecord,
  serializeBackupFile,
  serializePayload,
} from '@/lib/store/format';
import type { VaultRecordV2 } from '@/lib/store/format';
import { consumeBackupCode, findBackupCode, normalizeBackupCode } from '@/lib/store/backupCodes';
import { createRecord } from '@/lib/store/codec';
import { codecOpts, fixtures } from './helpers/fixtures';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof FormatError ? e.code : 'other';
  }
  return undefined;
}

async function v2Record(): Promise<VaultRecordV2> {
  const payload = parsePayload(JSON.stringify({ entries: [], settings: {}, recoveryCodes: [] }));
  return (await createRecord('pw', payload, codecOpts())).record;
}

describe('parseStoredRecord', () => {
  it('accepts the golden v1 records', () => {
    expect(parseStoredRecord(fixtures.plain().record).version).toBe(1);
    expect(parseStoredRecord(fixtures.totpPasskey().record).version).toBe(1);
  });

  it('accepts v2 records and preserves unknown fields', async () => {
    const rec = { ...(await v2Record()), futureMeta: { a: 1 } };
    const parsed = parseStoredRecord(rec);
    expect(parsed).toBe(rec);
    expect(parsed.futureMeta).toEqual({ a: 1 });
  });

  it('rejects newer formats without downgrading', async () => {
    const rec = { ...(await v2Record()), version: 3 };
    expect(codeOf(() => parseStoredRecord(rec))).toBe('unsupported-version');
  });

  it.each([
    ['bad base64 salt', { salt: 'not*base64' }],
    ['short salt', { salt: btoa('short') }],
    ['bad verifier length', { verifier: btoa('x'.repeat(31)) }],
    ['blob not an envelope', { blob: btoa('{"nope":true}') }],
    ['iterations 0', { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 0 } }],
    ['fractional iterations', { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000.5 } }],
    ['huge iterations', { kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 1e9 } }],
    ['wrong kdf', { kdf: { name: 'scrypt', hash: 'SHA-256', iterations: 600000 } }],
    ['missing verifier', { verifier: undefined }],
    ['totp enabled without secret', { totpEnabled: true, totpSecretEncrypted: undefined }],
    ['passkeys not an array', { passkeys: 'x' }],
  ])('rejects a v1 record with %s', (_label, patch) => {
    const rec = { ...fixtures.plain().record, ...patch };
    expect(codeOf(() => parseStoredRecord(rec))).toBe('invalid');
  });

  it('rejects v2 records missing compare-and-swap fields or carrying passkeys', async () => {
    const base = await v2Record();
    expect(codeOf(() => parseStoredRecord({ ...base, commitId: '' }))).toBe('invalid');
    expect(codeOf(() => parseStoredRecord({ ...base, revision: -1 }))).toBe('invalid');
    expect(codeOf(() => parseStoredRecord({ ...base, passkeys: [] }))).toBe('invalid');
  });

  it('rejects things that are not vault records', () => {
    expect(codeOf(() => parseStoredRecord(null))).toBe('not-keyhaven');
    expect(codeOf(() => parseStoredRecord({ version: 'x' }))).toBe('not-keyhaven');
  });
});

describe('parseBackupFile', () => {
  it('accepts a v1 export wrapper and a bare v1 record', () => {
    const rec = fixtures.totpPasskey().record;
    const wrapper = { app: 'keyhaven', kind: 'encrypted-vault-export', version: 1, exportedAt: 'x', record: rec };
    expect(parseBackupFile(JSON.stringify(wrapper)).record.version).toBe(1);
    expect(parseBackupFile(JSON.stringify(rec)).record.version).toBe(1);
  });

  it('round-trips a v2 export file', async () => {
    const rec = await v2Record();
    const parsed = parseBackupFile(serializeBackupFile(rec, '2026-10-02T00:00:00.000Z'));
    expect(parsed.record).toEqual(rec);
    expect(parsed.fileVersion).toBe(2);
    expect(parsed.exportedAt).toBe('2026-10-02T00:00:00.000Z');
  });

  it('rejects newer wrapper versions, non-JSON, foreign JSON and oversized input', async () => {
    const rec = await v2Record();
    const newer = { app: 'keyhaven', kind: 'encrypted-vault-export', version: 3, record: rec };
    expect(codeOf(() => parseBackupFile(JSON.stringify(newer)))).toBe('unsupported-version');
    expect(codeOf(() => parseBackupFile('{oops'))).toBe('not-json');
    expect(codeOf(() => parseBackupFile('{"hello":"world"}'))).toBe('not-keyhaven');
    expect(codeOf(() => parseBackupFile('x'.repeat(50 * 1024 * 1024 + 1)))).toBe('too-large');
  });
});

describe('parsePayload', () => {
  it('preserves unknown payload keys and unknown entry fields (totpSecret, passwordHistory)', () => {
    const fx = fixtures.plain();
    const parsed = parsePayload(JSON.stringify(fx.payload));
    expect(parsed).toEqual(fx.payload);
    expect(JSON.parse(serializePayload(parsed))).toEqual(fx.payload);
    const e0 = parsed.entries[0] as unknown as Record<string, unknown>;
    expect(e0.totpSecret).toBeTypeOf('string');
    expect(e0.passwordHistory).toHaveLength(1);
  });

  it('fills settings defaults and missing codes without rejecting', () => {
    const p = parsePayload(JSON.stringify({ entries: [] }));
    expect(p.settings.autoLockMinutes).toBe(5);
    expect(p.recoveryCodes).toEqual([]);
  });

  it('rejects structurally broken payloads', () => {
    expect(codeOf(() => parsePayload('[]'))).toBe('invalid');
    expect(codeOf(() => parsePayload('{"entries":[{"title":"no id"}]}'))).toBe('invalid');
    expect(codeOf(() => parsePayload('not json'))).toBe('invalid');
  });
});

describe('backup codes', () => {
  it('normalizes input and finds codes case/format-insensitively', () => {
    const codes = ['ABCD-EFGH-JKMN', 'PQRS-TUVW-XYZ2'];
    expect(normalizeBackupCode(' pqrs tuvw xyz2 ')).toBe('PQRS-TUVW-XYZ2');
    expect(findBackupCode(codes, 'pqrstuvwxyz2')).toBe(1);
    expect(findBackupCode(codes, 'ABCD-EFGH-JKMP')).toBe(-1);
    expect(findBackupCode(codes, 'short')).toBe(-1);
  });

  it('consumes a code without touching anything else', () => {
    const p = parsePayload(JSON.stringify(fixtures.plain().payload));
    const next = consumeBackupCode(p, 0);
    expect(next.recoveryCodes).toHaveLength(7);
    expect(next.recoveryCodes).not.toContain('ABCD-EFGH-JKMN');
    expect(next.entries).toBe(p.entries);
    expect(p.recoveryCodes).toHaveLength(8);
  });
});
