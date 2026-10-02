/**
 * Frozen copy of the KeyHaven v1 (pre-Phase-1) algorithms, kept ONLY for tests.
 *
 * - deriveKey / computeVerifier / encryptVault / decryptVault mirror
 *   src/lib/crypto.ts as of commit 5c41f67.
 * - legacyWrapWithPasskey / legacyUnwrapWithoutAuthenticator mirror the
 *   wrapping scheme from the deleted src/lib/webauthn.ts: the wrapping key is
 *   SHA-256(credential rawId ‖ salt), and BOTH inputs were stored in the
 *   vault record. `legacyUnwrapWithoutAuthenticator` demonstrates that the
 *   stored fields alone recover the vault key — no WebAuthn ceremony needed.
 *
 * Never import this from application code.
 */

const te = new TextEncoder();
const td = new TextDecoder();

export function b64(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function computeVerifier(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return b64(await crypto.subtle.digest('SHA-256', raw));
}

export async function encryptVault(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(plaintext));
  return b64(te.encode(JSON.stringify({ iv: b64(iv), ct: b64(ct) })));
}

export async function decryptVault(key: CryptoKey, payload: string): Promise<string> {
  const { iv, ct } = JSON.parse(td.decode(unb64(payload))) as { iv: string; ct: string };
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return td.decode(pt);
}

async function wrappingKey(rawId: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = new Uint8Array(rawId.length + salt.length);
  material.set(rawId, 0);
  material.set(salt, rawId.length);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export interface LegacyPasskeyBlob {
  credentialId: string;
  wrappedKey: string;
  salt: string;
  name: string;
  createdAt: string;
}

/** What v1 `registerPasskey` stored after the WebAuthn create() ceremony. */
export async function legacyWrapWithPasskey(
  vaultKey: CryptoKey,
  rawId: Uint8Array,
  name: string,
  createdAt: string,
): Promise<LegacyPasskeyBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wk = await wrappingKey(rawId, salt);
  const rawVaultKey = b64(await crypto.subtle.exportKey('raw', vaultKey));
  return { credentialId: b64(rawId), wrappedKey: await encryptVault(wk, rawVaultKey), salt: b64(salt), name, createdAt };
}

/**
 * THE FLAW: recover the vault key from a stored v1 passkey blob using only
 * fields that are persisted next to it. No authenticator, no password.
 */
export async function legacyUnwrapWithoutAuthenticator(blob: LegacyPasskeyBlob): Promise<CryptoKey> {
  const wk = await wrappingKey(unb64(blob.credentialId), unb64(blob.salt));
  const rawVaultKey = await decryptVault(wk, blob.wrappedKey);
  return crypto.subtle.importKey('raw', unb64(rawVaultKey), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}
