/**
 * Vault page shared helpers — strength scoring (zxcvbn-ts), category meta,
 * entry flag derivations (weak / reused / breached / old), TOTP helpers,
 * time formatting, and the local vault toast bus. Self-contained for the
 * /vault scope (src/pages/Vault.tsx + src/components/vault/*).
 */

import { zxcvbn } from 'zxcvbn-ts';
import type { VaultCategory, VaultEntry } from '@/lib/vault';
import { base32Encode } from '@/lib/totp';
import { analyzeVault } from '@/components/security/analysis';

/* ------------------------------------------------------------------ */
/* entry extension fields (stored encrypted inside the vault blob)     */
/* ------------------------------------------------------------------ */

export interface PasswordHistoryItem {
  password: string;
  changedAt: string;
}

/** VaultEntry plus the optional extension fields this page writes. */
export type EntryExt = VaultEntry & {
  /** base32 TOTP secret for the live 2FA code (entries may only carry the `totp` flag) */
  totpSecret?: string;
  passwordHistory?: PasswordHistoryItem[];
};

/* ------------------------------------------------------------------ */
/* categories                                                          */
/* ------------------------------------------------------------------ */

export const CATEGORY_ORDER: VaultCategory[] = [
  'social',
  'finance',
  'work',
  'shopping',
  'streaming',
  'other',
];

export const CATEGORY_META: Record<VaultCategory, { label: string; color: string }> = {
  social: { label: 'Social', color: '#38E1FF' },
  finance: { label: 'Finance', color: '#35F0A1' },
  work: { label: 'Work', color: '#8B7CFF' },
  shopping: { label: 'Shopping', color: '#FFB84D' },
  streaming: { label: 'Streaming', color: '#FF7AB8' },
  other: { label: 'Other', color: '#93A1B8' },
};

/* ------------------------------------------------------------------ */
/* strength                                                            */
/* ------------------------------------------------------------------ */

/** design.md strength ramp: 0–1 danger · 2 warning · 3 cyan · 4 mint */
export const STRENGTH_COLORS = ['#FF5C7A', '#FF5C7A', '#FFB84D', '#38E1FF', '#35F0A1'];
export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'];

export interface StrengthInfo {
  score: 0 | 1 | 2 | 3 | 4;
  /** entropy-ish bits derived from guesses_log10 */
  bits: number;
  crackTime: string;
}

export function strengthOf(password: string): StrengthInfo {
  if (!password) return { score: 0, bits: 0, crackTime: '—' };
  const r = zxcvbn(password);
  return {
    score: r.score,
    bits: Math.max(1, Math.round((r.guesses_log10 || 0) * 3.321928)),
    crackTime: r.crack_times_display.offline_slow_hashing_1e5_per_second,
  };
}

export type StrengthMap = Map<string, StrengthInfo>;

export function buildStrengthMap(entries: VaultEntry[]): StrengthMap {
  const map: StrengthMap = new Map();
  for (const e of entries) map.set(e.id, strengthOf(e.password));
  return map;
}

/* ------------------------------------------------------------------ */
/* entry flags                                                         */
/* ------------------------------------------------------------------ */

export function isWeak(info: StrengthInfo | undefined): boolean {
  return !!info && info.score <= 1;
}

export function reusedPasswords(entries: VaultEntry[]): Set<string> {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.password, (counts.get(e.password) ?? 0) + 1);
  const reused = new Set<string>();
  for (const [pw, n] of counts) if (pw && n > 1) reused.add(pw);
  return reused;
}

const YEAR_MS = 365 * 86_400_000;

export function isOld(entry: VaultEntry): boolean {
  return Date.now() - new Date(entry.updatedAt).getTime() > YEAR_MS;
}

/** e.g. "14mo old" — amber age tag for entries not updated in ≥12 months. */
export function oldMonthsLabel(entry: VaultEntry): string {
  const months = Math.max(12, Math.floor((Date.now() - +new Date(entry.updatedAt)) / (30 * 86_400_000)));
  return `${months}mo old`;
}

export interface VaultStats {
  total: number;
  weak: number;
  reused: number;
  breached: number;
  old: number;
  score: number;
}

/** counts for the stat chips; the score is Watchtower's (same penalties, same ignored checks) */
export function computeStats(entries: VaultEntry[], strength: StrengthMap, ignored: Set<string>): VaultStats {
  const reused = reusedPasswords(entries);
  let weak = 0;
  let reusedCount = 0;
  let breached = 0;
  let old = 0;
  for (const e of entries) {
    if (isWeak(strength.get(e.id))) weak++;
    if (reused.has(e.password)) reusedCount++;
    if (e.breached) breached++;
    if (isOld(e)) old++;
  }
  const { score } = analyzeVault(entries, ignored, strength);
  return { total: entries.length, weak, reused: reusedCount, breached, old, score };
}

/* ------------------------------------------------------------------ */
/* filtering & sorting                                                 */
/* ------------------------------------------------------------------ */

export type CategoryFilter = 'all' | 'favorites' | VaultCategory;
export type StatFilter = 'weak' | 'reused' | 'breached' | null;
export type SortKey = 'recent' | 'az' | 'added' | 'strength';

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recently used' },
  { key: 'az', label: 'A–Z' },
  { key: 'added', label: 'Date added' },
  { key: 'strength', label: 'Strength' },
];

export function filterEntries(
  entries: VaultEntry[],
  opts: {
    category: CategoryFilter;
    stat: StatFilter;
    query: string;
    strength: StrengthMap;
    reused: Set<string>;
  },
): VaultEntry[] {
  const q = opts.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (opts.category === 'favorites' && !e.favorite) return false;
    if (opts.category !== 'all' && opts.category !== 'favorites' && e.category !== opts.category)
      return false;
    if (opts.stat === 'weak' && !isWeak(opts.strength.get(e.id))) return false;
    if (opts.stat === 'reused' && !opts.reused.has(e.password)) return false;
    if (opts.stat === 'breached' && !e.breached) return false;
    if (q) {
      const hay = `${e.title} ${e.username} ${e.url}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortEntries(entries: VaultEntry[], sort: SortKey, strength: StrengthMap): VaultEntry[] {
  const list = [...entries];
  switch (sort) {
    case 'az':
      list.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'added':
      list.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
      break;
    case 'strength':
      list.sort(
        (a, b) => (strength.get(b.id)?.score ?? 0) - (strength.get(a.id)?.score ?? 0),
      );
      break;
    case 'recent':
    default:
      list.sort((a, b) => +new Date(b.lastUsedAt) - +new Date(a.lastUsedAt));
      break;
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* TOTP helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve the base32 TOTP secret for an entry. Real secrets win; for demo
 * entries that only carry the `totp` flag we derive a stable secret from the
 * entry id so the live code/ring demo works end-to-end.
 */
export function totpSecretFor(entry: EntryExt): string | null {
  if (entry.totpSecret) return entry.totpSecret;
  if (!entry.totp) return null;
  const id = entry.id || entry.title;
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = (id.charCodeAt(i % id.length) * (i + 7) + 31 * i) & 0xff;
  }
  return base32Encode(bytes);
}

/** Parse a pasted TOTP secret or otpauth:// URI → base32 secret, or null. */
export function parseTotpInput(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  if (t.toLowerCase().startsWith('otpauth://')) {
    try {
      const secret = new URL(t).searchParams.get('secret');
      return secret ? secret.replace(/\s+/g, '').toUpperCase() : null;
    } catch {
      return null;
    }
  }
  const clean = t.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  return /^[A-Z2-7]{8,}$/.test(clean) ? clean : null;
}

/* ------------------------------------------------------------------ */
/* time formatting                                                     */
/* ------------------------------------------------------------------ */

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? '1y ago' : `${years}y ago`;
}

export function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function formatCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/* ------------------------------------------------------------------ */
/* vault toast bus (self-contained; design.md §6.4 toast stack)        */
/* ------------------------------------------------------------------ */

export interface VaultToast {
  id: number;
  title: string;
  description?: string;
  variant: 'success' | 'info' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
  durationMs: number;
}

type ToastListener = (t: VaultToast) => void;
const toastListeners = new Set<ToastListener>();
let toastCounter = 0;

export function showVaultToast(
  t: Omit<VaultToast, 'id' | 'variant' | 'durationMs'> & {
    variant?: VaultToast['variant'];
    durationMs?: number;
  },
): number {
  const toast: VaultToast = {
    variant: 'info',
    durationMs: 4000,
    ...t,
    id: ++toastCounter,
  };
  toastListeners.forEach((l) => l(toast));
  return toast.id;
}

export function subscribeVaultToasts(l: ToastListener): () => void {
  toastListeners.add(l);
  return () => toastListeners.delete(l);
}