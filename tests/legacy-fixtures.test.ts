import { describe, expect, it } from 'vitest';
import plain from './fixtures/v1-plain.json';
import * as legacy from './legacy/v1';

describe('golden v1 fixtures (generated from the pre-Phase-1 code)', () => {
  it('open with the legacy algorithm and the synthetic password', async () => {
    const rec = plain.record;
    const key = await legacy.deriveKey(plain.password, legacy.unb64(rec.salt), rec.kdf.iterations);
    expect(await legacy.computeVerifier(key)).toBe(rec.verifier);
    expect(JSON.parse(await legacy.decryptVault(key, rec.blob))).toEqual(plain.payload);
  });
});
