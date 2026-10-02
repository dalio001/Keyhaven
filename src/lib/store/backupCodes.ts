/**
 * Authenticator backup codes.
 *
 * One-time codes that can be used INSTEAD of a 6-digit authenticator code at
 * unlock (e.g. after losing the phone). The master password is always still
 * required. They are stored inside the encrypted vault payload (historical
 * key: `recoveryCodes`) and are consumed — removed and saved — on use.
 *
 * They do NOT and cannot recover a forgotten master password: the vault key
 * is derived only from the master password.
 */

import type { VaultPayload } from './format';

/** Normalize user input: uppercase, drop spaces/dashes → `XXXX-XXXX-XXXX` (or '' if malformed). */
export function normalizeBackupCode(input: string): string {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 12) return '';
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
}

/** Length-independent-ish comparison (codes are short; this avoids early exit). */
function sameCode(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Index of the matching unused code, or -1. */
export function findBackupCode(codes: readonly string[], input: string): number {
  const wanted = normalizeBackupCode(input);
  if (!wanted) return -1;
  let found = -1;
  codes.forEach((c, i) => {
    if (found === -1 && sameCode(normalizeBackupCode(c), wanted)) found = i;
  });
  return found;
}

/** Return a new payload with code `index` removed (used codes never work again). */
export function consumeBackupCode(payload: VaultPayload, index: number): VaultPayload {
  return { ...payload, recoveryCodes: payload.recoveryCodes.filter((_, i) => i !== index) };
}
