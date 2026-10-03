import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeVault, ignoreKey } from '@/components/security/analysis';
import { buildStrengthMap, computeStats } from '@/components/vault/vault-utils';
import { entry } from './helpers/controller';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const OLD = '2025-01-15T00:00:00.000Z'; // more than a year before NOW

// synthetic passwords: two weak, two sharing one strong password, one old, one flagged breached
const ENTRIES = [
  entry('w1', { password: 'password' }),
  entry('w2', { password: '123456', updatedAt: OLD }),
  entry('r1', { password: 'Synthetic-Shared-Phrase-9431!' }),
  entry('r2', { password: 'Synthetic-Shared-Phrase-9431!' }),
  entry('o1', { password: 'Synthetic-Unique-Phrase-2210?', updatedAt: OLD }),
  entry('b1', { password: 'Synthetic-Unique-Phrase-7765#', breached: true }),
  entry('ok', { password: 'Synthetic-Unique-Phrase-5108$' }),
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('one security score (KH-07)', () => {
  it('the dashboard shows the same score as Watchtower', () => {
    const watchtower = analyzeVault(ENTRIES, new Set()).score;
    // weak 2×5 + reused 2×4 + old 2×4 + breached 1×8 = 34
    expect(watchtower).toBe(66);
    expect(computeStats(ENTRIES, buildStrengthMap(ENTRIES), new Set()).score).toBe(watchtower);
  });

  it('checks ignored in Watchtower are left out of both', () => {
    const ignored = new Set([ignoreKey('w1', 'weak'), ignoreKey('o1', 'old')]);
    const watchtower = analyzeVault(ENTRIES, ignored).score;
    expect(watchtower).toBe(75);
    expect(computeStats(ENTRIES, buildStrengthMap(ENTRIES), ignored).score).toBe(watchtower);
  });

  it('strengths the vault page already measured give the same audit', () => {
    const fresh = analyzeVault(ENTRIES, new Set());
    const reused = analyzeVault(ENTRIES, new Set(), buildStrengthMap(ENTRIES));
    expect(reused.score).toBe(fresh.score);
    expect(reused.weak.map((a) => a.entry.id)).toEqual(fresh.weak.map((a) => a.entry.id));
  });

  it('an empty vault scores 100 in both', () => {
    expect(analyzeVault([], new Set()).score).toBe(100);
    expect(computeStats([], new Map(), new Set()).score).toBe(100);
  });
});
