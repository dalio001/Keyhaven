/**
 * KeyHaven vault content model (the decrypted entries + settings).
 *
 * Persistence, record formats, migration and backups live in `src/lib/store/`:
 * only ciphertext is ever written to disk (see docs/security-model.md).
 *
 * All page agents: import from `@/lib/vault` — signatures are stable.
 */

/* ------------------------------------------------------------------ */
/* content model (design.md §7)                                        */
/* ------------------------------------------------------------------ */

export type VaultCategory = 'social' | 'finance' | 'work' | 'shopping' | 'streaming' | 'other';

export interface VaultEntry {
  id: string;
  title: string;
  url: string;
  username: string;
  /** secret — rendered masked in UI; strength derived via zxcvbn (0–4) */
  password: string;
  category: VaultCategory;
  favorite: boolean;
  notes?: string;
  /** has a 2FA/TOTP code stored for this login */
  totp?: boolean;
  /** ISO timestamps */
  updatedAt: string;
  lastUsedAt: string;
  /** flagged by local breach-style scan */
  breached?: boolean;
}

export interface VaultSettings {
  /** minutes of inactivity before the vault auto-locks (default 5) */
  autoLockMinutes: number;
  /** seconds before a copied secret is wiped from the clipboard (default 20) */
  clipboardClearSeconds: number;
  /** reveal secrets auto-remask after N seconds (default 15) */
  remaskSeconds: number;
}

export const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 20,
  remaskSeconds: 15,
};
