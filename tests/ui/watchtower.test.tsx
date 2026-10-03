// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ScoreHero from '@/components/security/ScoreHero';
import Recommendations from '@/components/security/Recommendations';
import { analyzeVault } from '@/components/security/analysis';
import { entry } from '../helpers/controller';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const OLD = '2025-01-15T00:00:00.000Z';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const withRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('Watchtower copy', () => {
  it('KH-13: "fixes", not "fixs"', () => {
    const entries = [
      entry('w1', { password: 'password' }),
      entry('w2', { password: '123456', updatedAt: OLD }),
      entry('r1', { password: 'Synthetic-Shared-Phrase-9431!' }),
      entry('r2', { password: 'Synthetic-Shared-Phrase-9431!' }),
      entry('o1', { password: 'Synthetic-Unique-Phrase-2210?', updatedAt: OLD }),
      entry('b1', { password: 'Synthetic-Unique-Phrase-7765#', breached: true }),
    ];
    const audit = analyzeVault(entries, new Set());
    expect(audit.fixesToNinety).toBe(4);
    withRouter(<ScoreHero audit={audit} totpEnabled={false} onScrollTo={() => undefined} onHighlight={() => undefined} />);
    expect(screen.getByText(/^4 fixes would push you past 90\./)).toBeTruthy();
    expect(screen.queryByText(/fixs/)).toBeNull();
  });
});

describe('Watchtower recommendations show only what applies (KH-12)', () => {
  const recentExport = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();
  const staleExport = new Date(NOW.getTime() - 45 * 86_400_000).toISOString();
  const withCodes = [entry('a', { totp: true }), entry('b', { totp: true })];
  const tip = (name: RegExp) => screen.queryByRole('heading', { name });

  it('auto-lock already at 5 minutes: no auto-lock tip', () => {
    withRouter(<Recommendations autoLockMinutes={5} lastExportAt={recentExport} entries={withCodes} />);
    expect(tip(/auto-lock/i)).toBeNull();
  });

  it('auto-lock off or longer than 5 minutes: the tip shows', () => {
    withRouter(<Recommendations autoLockMinutes={0} lastExportAt={recentExport} entries={withCodes} />);
    expect(tip(/turn on auto-lock/i)).toBeTruthy();
    cleanup();
    withRouter(<Recommendations autoLockMinutes={30} lastExportAt={recentExport} entries={withCodes} />);
    expect(tip(/auto-lock after 5 minutes/i)).toBeTruthy();
  });

  it('backup tip only without an export in the last 30 days', () => {
    withRouter(<Recommendations autoLockMinutes={5} lastExportAt={recentExport} entries={withCodes} />);
    expect(tip(/backup/i)).toBeNull();
    cleanup();
    withRouter(<Recommendations autoLockMinutes={5} lastExportAt={staleExport} entries={withCodes} />);
    expect(tip(/backup/i)).toBeTruthy();
    cleanup();
    withRouter(<Recommendations autoLockMinutes={5} lastExportAt={null} entries={withCodes} />);
    expect(tip(/backup/i)).toBeTruthy();
  });

  it('2FA tip only while some login has no code', () => {
    withRouter(<Recommendations autoLockMinutes={5} lastExportAt={recentExport} entries={[...withCodes, entry('c')]} />);
    expect(tip(/2FA/)).toBeTruthy();
  });

  it('nothing applies: says so instead of showing stale tips', () => {
    withRouter(<Recommendations autoLockMinutes={5} lastExportAt={recentExport} entries={withCodes} />);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(screen.getByText(/nothing to add right now/i)).toBeTruthy();
  });
});
