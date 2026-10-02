import { describe, expect, it } from 'vitest';
import { IntegrityError, deriveVaultKey, openText, sealText } from '@/lib/crypto';
import * as legacy from './legacy/v1';
import { fixtures, tamperEnvelope } from './helpers/fixtures';

describe('deriveVaultKey', () => {
  it('is byte-compatible with existing (pre-Phase-1) vaults', async () => {
    for (const fx of [fixtures.plain(), fixtures.passkey600k()]) {
      const rec = fx.record as { salt: string; kdf: { iterations: number }; verifier: string; blob: string };
      const dk = await deriveVaultKey(fx.password, rec.salt, rec.kdf.iterations);
      expect(dk.verifier).toBe(rec.verifier);
      expect(JSON.parse(await openText(dk.key, rec.blob))).toEqual(fx.payload);
    }
  });

  it('matches the legacy deriveKey + computeVerifier on random salts', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const dk = await deriveVaultKey('pässwörd — ünïcode ✓', salt, 10_000);
    const lk = await legacy.deriveKey('pässwörd — ünïcode ✓', salt, 10_000);
    expect(dk.verifier).toBe(await legacy.computeVerifier(lk));
  });

  it('rejects an incorrect password via the verifier', async () => {
    const fx = fixtures.plain();
    const rec = fx.record as { salt: string; kdf: { iterations: number }; verifier: string; blob: string };
    const dk = await deriveVaultKey(`${fx.password}x`, rec.salt, rec.kdf.iterations);
    expect(dk.verifier).not.toBe(rec.verifier);
    await expect(openText(dk.key, rec.blob)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('produces a NON-extractable key', async () => {
    const dk = await deriveVaultKey('pw', crypto.getRandomValues(new Uint8Array(16)), 10_000);
    expect(dk.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', dk.key)).rejects.toThrow();
  });
});

describe('sealText / openText', () => {
  it('round-trips and uses a fresh IV each time', async () => {
    const { key } = await deriveVaultKey('pw', crypto.getRandomValues(new Uint8Array(16)), 10_000);
    const a = await sealText(key, 'hello');
    const b = await sealText(key, 'hello');
    expect(a).not.toBe(b);
    expect(await openText(key, a)).toBe('hello');
  });

  it('detects tampered ciphertext, tampered IV and malformed envelopes', async () => {
    const { key } = await deriveVaultKey('pw', crypto.getRandomValues(new Uint8Array(16)), 10_000);
    const env = await sealText(key, 'secret payload');
    await expect(openText(key, tamperEnvelope(env, 'ct'))).rejects.toBeInstanceOf(IntegrityError);
    await expect(openText(key, tamperEnvelope(env, 'iv'))).rejects.toBeInstanceOf(IntegrityError);
    await expect(openText(key, 'not base64 !!')).rejects.toBeInstanceOf(IntegrityError);
    await expect(openText(key, btoa('{"iv":1}'))).rejects.toBeInstanceOf(IntegrityError);
  });
});
