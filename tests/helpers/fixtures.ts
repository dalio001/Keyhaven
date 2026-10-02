import plain from '../fixtures/v1-plain.json';
import totpPasskey from '../fixtures/v1-totp-passkey.json';
import passkey600k from '../fixtures/v1-600k-passkey.json';

export interface V1Fixture {
  password: string;
  totpSecret: string | null;
  payload: Record<string, unknown>;
  record: Record<string, unknown>;
}

/** Deep copies of the golden v1 fixtures (synthetic data only). */
export const fixtures = {
  plain: (): V1Fixture => structuredClone(plain) as V1Fixture,
  totpPasskey: (): V1Fixture => structuredClone(totpPasskey) as V1Fixture,
  passkey600k: (): V1Fixture => structuredClone(passkey600k) as V1Fixture,
};

/** Low iteration count used for vaults created inside tests (records store their own count). */
export const TEST_ITERATIONS = 10_000;

export const codecOpts = (now = '2026-10-02T00:00:00.000Z') => ({
  iterations: TEST_ITERATIONS,
  now,
  uuid: () => crypto.randomUUID(),
});

/** Flip one character of a base64 string (keeps it valid base64). */
export function flipB64(s: string, at = Math.floor(s.length / 2)): string {
  const c = s[at] === 'A' ? 'B' : 'A';
  return s.slice(0, at) + c + s.slice(at + 1);
}

/** Tamper with the ciphertext (or IV) INSIDE an envelope, keeping the envelope well-formed. */
export function tamperEnvelope(envelope: string, field: 'ct' | 'iv'): string {
  const inner = JSON.parse(atob(envelope)) as { iv: string; ct: string };
  inner[field] = flipB64(inner[field], 2);
  return btoa(JSON.stringify(inner));
}
