/**
 * KeyHaven crypto core — zero-knowledge, browser-native (WebCrypto only).
 *
 * - Key derivation: PBKDF2-SHA256, 600_000 iterations → NON-extractable
 *   AES-GCM 256-bit key + a SHA-256 verifier (rejects wrong passwords early).
 * - Vault encryption: AES-GCM (random 12-byte IV per encrypt), payload is
 *   base64(JSON { iv, ct }) so it can be stored as a single opaque string.
 * - NOTHING plaintext is ever persisted — only ciphertext, salt and KDF params.
 * - The vault key never leaves WebCrypto: there is no raw-key export.
 *
 * All page agents: import from `@/lib/crypto` — signatures are stable.
 */

export const KDF_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
const IV_BYTES = 12;

const te = new TextEncoder();
const td = new TextDecoder();

/* ------------------------------------------------------------------ */
/* base64 / buffer helpers                                             */
/* ------------------------------------------------------------------ */

/** Encode bytes (or an ArrayBuffer) to a base64 string. */
export function bufToB64(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Decode a base64 string to bytes. */
export function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `n` cryptographically secure random bytes. */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Random 16-byte KDF salt. */
export function randomSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/** Secure uniform random integer in [0, max) via rejection sampling. */
export function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  const range = 0x100000000;
  const limit = range - (range % max);
  const buf = new Uint32Array(1);
  let x: number;
  do {
    crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % max;
}

/* ------------------------------------------------------------------ */
/* key derivation & vault encryption                                   */
/* ------------------------------------------------------------------ */

/** Thrown when ciphertext is malformed, tampered with, or opened with the wrong key. */
export class IntegrityError extends Error {
  readonly kind = 'integrity' as const;
  constructor(message = 'Encrypted data failed its integrity check.') {
    super(message);
    this.name = 'IntegrityError';
  }
}

/** A password-derived vault key plus its stored verifier. */
export interface DerivedKey {
  /** AES-GCM 256 key — NON-extractable: it can encrypt/decrypt but never be exported. */
  key: CryptoKey;
  /** base64 SHA-256 of the raw key bytes (rejects wrong passwords before decrypting) */
  verifier: string;
}

/**
 * Derive the vault key + verifier from a master password.
 *
 * PBKDF2-SHA256 → 256 bits. Byte-compatible with every existing vault: the
 * WebCrypto `deriveKey(PBKDF2 → AES-GCM-256)` used before Phase 1 is defined
 * as exactly these 256 derived bits, and the old verifier was SHA-256 of the
 * exported raw key, i.e. of these same bits. The password is UTF-8 encoded
 * with no Unicode normalization (changing that would lock users out).
 */
export async function deriveVaultKey(
  password: string,
  salt: Uint8Array | string,
  iterations: number,
): Promise<DerivedKey> {
  const saltBytes = typeof salt === 'string' ? b64ToBuf(salt) : salt;
  const baseKey = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes as BufferSource, iterations },
      baseKey,
      256,
    ),
  );
  try {
    const verifier = bufToB64(await crypto.subtle.digest('SHA-256', bits));
    const key = await crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    return { key, verifier };
  } finally {
    bits.fill(0); // best effort: importKey keeps its own copy
  }
}

/**
 * Encrypt text with AES-GCM (fresh random 12-byte IV per call).
 * Returns the KeyHaven envelope: base64(JSON `{ iv, ct }`).
 */
export async function sealText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    te.encode(plaintext),
  );
  return bufToB64(te.encode(JSON.stringify({ iv: bufToB64(iv), ct: bufToB64(ct) })));
}

/** Decrypt a {@link sealText} envelope. Throws {@link IntegrityError} on any failure. */
export async function openText(key: CryptoKey, envelope: string): Promise<string> {
  let iv: Uint8Array;
  let ct: Uint8Array;
  try {
    const parsed = JSON.parse(td.decode(b64ToBuf(envelope))) as { iv?: unknown; ct?: unknown };
    if (typeof parsed.iv !== 'string' || typeof parsed.ct !== 'string') throw new Error('shape');
    iv = b64ToBuf(parsed.iv);
    ct = b64ToBuf(parsed.ct);
  } catch {
    throw new IntegrityError('Encrypted data is malformed.');
  }
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
    return td.decode(pt);
  } catch {
    throw new IntegrityError();
  }
}

/* ------------------------------------------------------------------ */
/* authenticator backup codes                                          */
/* ------------------------------------------------------------------ */

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars

/**
 * Generate human-friendly one-time codes like `KQ7M-4PDX-9T2A`
 * (~59 bits each). Used as authenticator backup codes — see
 * `src/lib/store/backupCodes.ts`. They cannot recover a master password.
 * @param count number of codes (default 8)
 */
export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const groups: string[] = [];
    for (let g = 0; g < 3; g++) {
      let s = '';
      for (let c = 0; c < 4; c++) s += RECOVERY_ALPHABET[secureRandomInt(RECOVERY_ALPHABET.length)];
      groups.push(s);
    }
    codes.push(groups.join('-'));
  }
  return codes;
}

/* ------------------------------------------------------------------ */
/* password / passphrase / PIN generation                              */
/* ------------------------------------------------------------------ */

export interface PasswordGenOptions {
  /** 'password' (random chars) | 'passphrase' (words) | 'pin' (digits only). Default 'password'. */
  mode?: 'password' | 'passphrase' | 'pin';
  /** Character length for mode 'password'. Default 20. */
  length?: number;
  /** Include A-Z (default true) */
  upper?: boolean;
  /** Include a-z (default true) */
  lower?: boolean;
  /** Include 0-9 (default true) */
  digits?: boolean;
  /** Include symbols (default true) */
  symbols?: boolean;
  /** Word count for mode 'passphrase'. Default 4. */
  words?: number;
  /** Separator for mode 'passphrase'. Default '-'. */
  separator?: string;
  /** Digit count for mode 'pin'. Default 6. */
  pinLength?: number;
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>?/~';

/** Compact curated word list for passphrases (common, easy-to-type words). */
const PASSPHRASE_WORDS = (
  'apple anchor arbor autumn badge bamboo banner beacon berry birch breeze bridge brook bucket butter ' +
  'cactus candle canyon castle cedar celery chapel cherry cider circus cliff clover cobalt comet copper ' +
  'coral cotton cradle crane cricket crystal dancer dawn delta desert dolphin domino dragon drift eagle ' +
  'ember engine falcon feather fern fiddle flame flint forest fossil foxglove frost galaxy garden garnet ' +
  'gentle ginger glacier golden gravel harbor hazel heron hollow honey horizon hunter icicle island ivory ' +
  'jasmine jacket jungle juniper kayak kettle lagoon lantern laurel lemon lilac linen lizard lotus lumber ' +
  'magnet mango marble meadow merlin middle midnight mirror misty molten monkey mosaic mountain muffin ' +
  'nectar needle nickel nimble noodle north oak oasis ocean olive onion opal orange orchid otter owl ' +
  'paddle palace panda panther paper parcel parrot pebble pepper picnic pigeon pine pioneer planet plum ' +
  'pocket polar poppy prairie prince pumpkin puzzle quartz rabbit radar rainbow raven river rocket ruby ' +
  'saddle saffron salmon satin shadow shutter signal silver saddle spirit spring sparrow stable stone ' +
  'summer sunset tango temple timber topaz tower trail tulip turtle twilight umbrella valley velvet ' +
  'violet violin voyage walnut wander wasp whisper willow window winter wonder yellow zebra zephyr ' +
  'artist bolt brave cabin cable camel canoe carpet cereal charm chorus cinema cloud coach cobalt comet ' +
  'compass copper crater cricket crystal cupid curtain dagger daisy decoy denim diner doctor donut draper ' +
  'dream dust dynamo east echo elbow ember epic ether fabric factor fairy fancy favor fiesta figure ' +
  'filter final flake flare flight flower fluent foggy folio forge forum fountain frame fresco friend ' +
  'frozen fable gadget gable galaxy gallop gamut garden garlic gather gauge gavel genius gentle geyser ' +
  'giant giggle glacier glamor glance glass gleam glide globe glory glove gnome goblet gondola grace ' +
  'grain grand granite grape graph gravel grove guard guest guide gulf hammer happy haven hazard heart ' +
  'heather helium helmet herald hidden hike holiday honest hoodie hotel humble icon igloo index infini ' +
  'iris iron jade jazz jewel jolly joker jolly juice karma kestrel kitten koala ladder laser latin lemon ' +
  'level liberty lilac lingo llama lobster lodge logic loyal lunar lyric magic magnet maiden manor maple ' +
  'market marble marvel melon memory mentor meteor micro miller mineral mint model modern molten moment'
).split(' ');

/** Secure shuffle (Fisher–Yates with crypto random). */
function secureShuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Cryptographically secure password generator (crypto.getRandomValues only).
 * Guarantees ≥1 char from each selected class for mode 'password'.
 */
export function generatePassword(opts: PasswordGenOptions = {}): string {
  const mode = opts.mode ?? 'password';

  if (mode === 'pin') {
    const n = opts.pinLength ?? 6;
    let out = '';
    for (let i = 0; i < n; i++) out += DIGITS[secureRandomInt(10)];
    return out;
  }

  if (mode === 'passphrase') {
    const count = Math.max(2, opts.words ?? 4);
    const sep = opts.separator ?? '-';
    const words: string[] = [];
    for (let i = 0; i < count; i++) {
      words.push(PASSPHRASE_WORDS[secureRandomInt(PASSPHRASE_WORDS.length)]);
    }
    // capitalize one random word + append one digit for mixed-character strength
    const wi = secureRandomInt(words.length);
    words[wi] = words[wi][0].toUpperCase() + words[wi].slice(1);
    return words.join(sep) + sep + secureRandomInt(10);
  }

  const length = Math.max(4, opts.length ?? 20);
  const upper = opts.upper ?? true;
  const lower = opts.lower ?? true;
  const digits = opts.digits ?? true;
  const symbols = opts.symbols ?? true;

  const pools: string[] = [];
  if (upper) pools.push(UPPER);
  if (lower) pools.push(LOWER);
  if (digits) pools.push(DIGITS);
  if (symbols) pools.push(SYMBOLS);
  if (pools.length === 0) pools.push(LOWER);

  const all = pools.join('');
  const chars: string[] = pools.map((p) => p[secureRandomInt(p.length)]); // ≥1 per class
  while (chars.length < length) chars.push(all[secureRandomInt(all.length)]);
  return secureShuffle(chars).join('');
}