/**
 * Watchtower analysis — computes the real security audit of the decrypted
 * vault entries (design/security.md). Everything runs locally, in memory:
 *
 *  - weak     → zxcvbn-ts score ≤ 1
 *  - reused   → identical password shared by ≥ 2 entries (grouped)
 *  - old      → updatedAt more than 12 months ago
 *  - breached → entry flagged by the local breach-style scan (`breached`)
 *
 * The score starts at 100 and subtracts per-entry penalties
 * (weak −5 · reused −4 · old −4 · breached −8), clamped to 0–100.
 * Entries whose check was "ignored" are excluded from the score.
 */

import { zxcvbn } from 'zxcvbn-ts';
import type { VaultEntry } from '@/lib/vault';

export type CheckType = 'weak' | 'reused' | 'old' | 'breached';

export const PENALTY: Record<CheckType, number> = {
  weak: 5,
  reused: 4,
  old: 4,
  breached: 8,
};

const YEAR_MS = 365 * 86_400_000;

export interface EntryAudit {
  entry: VaultEntry;
  /** zxcvbn 0–4 */
  strength: number;
  /** human crack time (offline slow hashing scenario) */
  crackTime: string;
  weak: boolean;
  reused: boolean;
  /** index of the reuse cluster this entry belongs to (null when unique) */
  reuseGroup: number | null;
  old: boolean;
  breached: boolean;
  /** whole months since the password was last changed */
  ageMonths: number;
}

export interface VaultAudit {
  audits: EntryAudit[];
  byId: Map<string, EntryAudit>;
  weak: EntryAudit[];
  /** reuse clusters — each cluster holds the entries sharing one password */
  reuseGroups: EntryAudit[][];
  reused: EntryAudit[];
  old: EntryAudit[];
  breached: EntryAudit[];
  /** 0–100 after penalties from non-ignored issues */
  score: number;
  penalties: Record<CheckType, number>;
  total: number;
  /** entries whose password is not shared with any other entry */
  uniqueCount: number;
  /** ids of entries with at least one active (non-ignored) issue */
  issueIds: Set<string>;
  /** greedy estimate: how many fixes push the score past 90 */
  fixesToNinety: number;
}

/** localStorage key for per-check ignores, e.g. "nf-05:weak" */
const IGNORE_KEY = 'keyhaven.watchtower.ignored';

export function loadIgnored(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function saveIgnored(ignored: Set<string>): void {
  try {
    localStorage.setItem(IGNORE_KEY, JSON.stringify([...ignored]));
  } catch {
    /* private mode etc. — non-fatal */
  }
}

export function ignoreKey(entryId: string, check: CheckType): string {
  return `${entryId}:${check}`;
}

/** DOM ids used for in-page scroll targets (chips, CTAs, scan review) */
export const GROUP_IDS: Record<CheckType, string> = {
  weak: 'wt-group-weak',
  reused: 'wt-group-reused',
  old: 'wt-group-old',
  breached: 'wt-group-breached',
};
export const FIRST_FIX_ID = 'wt-first-fix';

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function monthsAgo(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / (30.44 * 86_400_000)));
}

/** zxcvbn results already measured elsewhere (the vault page's strength map), by entry id */
export type KnownStrengths = ReadonlyMap<string, { score: number; crackTime: string }>;

function measure(password: string): { score: number; crackTime: string } {
  const r = zxcvbn(password || '');
  return { score: r.score, crackTime: r.crack_times_display.offline_slow_hashing_1e5_per_second };
}

/**
 * The one security score: Watchtower and the vault dashboard both show this
 * (KH-07). Pass `known` to reuse strengths that were already measured.
 */
export function analyzeVault(entries: VaultEntry[], ignored: Set<string>, known?: KnownStrengths): VaultAudit {
  // reuse clusters on the raw password (exact duplicates)
  const byPassword = new Map<string, VaultEntry[]>();
  for (const e of entries) {
    const list = byPassword.get(e.password);
    if (list) list.push(e);
    else byPassword.set(e.password, [e]);
  }
  const reuseClusters = [...byPassword.values()].filter((l) => l.length > 1);
  const reuseIndex = new Map<string, number>();
  reuseClusters.forEach((cluster, i) => cluster.forEach((e) => reuseIndex.set(e.id, i)));

  const audits: EntryAudit[] = entries.map((entry) => {
    const result = known?.get(entry.id) ?? measure(entry.password);
    const age = monthsAgo(entry.updatedAt);
    const reuseGroup = reuseIndex.get(entry.id) ?? null;
    const updatedMs = Date.parse(entry.updatedAt);
    return {
      entry,
      strength: result.score,
      crackTime: result.crackTime,
      weak: result.score <= 1,
      reused: reuseGroup !== null,
      reuseGroup,
      old: !Number.isNaN(updatedMs) && Date.now() - updatedMs > YEAR_MS,
      breached: entry.breached === true,
      ageMonths: age,
    };
  });

  const isActive = (a: EntryAudit, check: CheckType, flagged: boolean) =>
    flagged && !ignored.has(ignoreKey(a.entry.id, check));

  const weak = audits.filter((a) => a.weak);
  const old = audits.filter((a) => a.old);
  const breached = audits.filter((a) => a.breached);
  const reuseGroups: EntryAudit[][] = reuseClusters.map((cluster) =>
    cluster.map((e) => audits.find((a) => a.entry.id === e.id)!),
  );
  const reused = audits.filter((a) => a.reused);

  const penalties: Record<CheckType, number> = { weak: 0, reused: 0, old: 0, breached: 0 };
  const issueIds = new Set<string>();
  for (const a of audits) {
    if (isActive(a, 'weak', a.weak)) {
      penalties.weak += PENALTY.weak;
      issueIds.add(a.entry.id);
    }
    if (isActive(a, 'reused', a.reused)) {
      penalties.reused += PENALTY.reused;
      issueIds.add(a.entry.id);
    }
    if (isActive(a, 'old', a.old)) {
      penalties.old += PENALTY.old;
      issueIds.add(a.entry.id);
    }
    if (isActive(a, 'breached', a.breached)) {
      penalties.breached += PENALTY.breached;
      issueIds.add(a.entry.id);
    }
  }

  const totalPenalty = penalties.weak + penalties.reused + penalties.old + penalties.breached;
  const score = entries.length === 0 ? 100 : clampScore(100 - totalPenalty);

  // greedy: fix the most expensive entries first until score ≥ 90
  let fixesToNinety = 0;
  if (score < 90) {
    const perEntry = audits
      .map((a) => {
        let p = 0;
        if (isActive(a, 'weak', a.weak)) p += PENALTY.weak;
        if (isActive(a, 'reused', a.reused)) p += PENALTY.reused;
        if (isActive(a, 'old', a.old)) p += PENALTY.old;
        if (isActive(a, 'breached', a.breached)) p += PENALTY.breached;
        return p;
      })
      .filter((p) => p > 0)
      .sort((x, y) => y - x);
    let recovered = 0;
    for (const p of perEntry) {
      if (score + recovered >= 90) break;
      recovered += p;
      fixesToNinety++;
    }
  }

  return {
    audits,
    byId: new Map(audits.map((a) => [a.entry.id, a])),
    weak,
    reuseGroups,
    reused,
    old,
    breached,
    score,
    penalties,
    total: entries.length,
    uniqueCount: entries.length - reused.length,
    issueIds,
    fixesToNinety,
  };
}

export type ScoreBand = 'excellent' | 'good' | 'fair' | 'risk';

export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'risk';
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  excellent: 'EXCELLENT',
  good: 'GOOD',
  fair: 'FAIR',
  risk: 'AT RISK',
};

export const BAND_COLOR: Record<ScoreBand, string> = {
  excellent: '#35F0A1',
  good: '#35F0A1',
  fair: '#FFB84D',
  risk: '#FF5C7A',
};

export const BAND_HEADLINE: Record<ScoreBand, string> = {
  excellent: 'Your vault is in excellent shape.',
  good: 'Your vault is in good shape.',
  fair: 'Your vault needs a little attention.',
  risk: 'Your vault needs urgent attention.',
};

/** strength ramp (design.md §2): 0–1 danger · 2 warning · 3 cyan · 4 mint */
export const STRENGTH_COLORS = ['#FF5C7A', '#FF5C7A', '#FFB84D', '#38E1FF', '#35F0A1'];
export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'];
