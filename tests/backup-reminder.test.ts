import { describe, expect, it } from 'vitest';
import { BACKUP_MAX_AGE_DAYS, backupReminder, hasOwnData } from '@/lib/backupReminder';
import { cloneSampleEntries } from '@/lib/sampleData';

const NOW = Date.UTC(2026, 9, 2, 12);
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const base = { now: NOW, lastExportAt: null, lastSavedAt: daysAgo(1), snoozedUntil: null, hasOwnData: true };

describe('backup reminder rules', () => {
  it('never exported → due', () => {
    expect(backupReminder(base)).toEqual({ due: true, reason: 'never' });
  });

  it('a recent export → not due; an old one with changes since → due', () => {
    expect(backupReminder({ ...base, lastExportAt: daysAgo(3) })).toEqual({ due: false });
    expect(backupReminder({ ...base, lastExportAt: daysAgo(BACKUP_MAX_AGE_DAYS) })).toEqual({ due: false });
    expect(backupReminder({ ...base, lastExportAt: daysAgo(40), lastSavedAt: daysAgo(2) })).toEqual({ due: true, reason: 'stale', days: 40 });
  });

  it('an old export that is still complete (nothing saved since) → not due', () => {
    expect(backupReminder({ ...base, lastExportAt: daysAgo(40), lastSavedAt: daysAgo(41) })).toEqual({ due: false });
  });

  it('snoozed → not due until the snooze ends; only sample data → not due', () => {
    expect(backupReminder({ ...base, snoozedUntil: new Date(NOW + 86_400_000).toISOString() })).toEqual({ due: false });
    expect(backupReminder({ ...base, snoozedUntil: daysAgo(1) })).toEqual({ due: true, reason: 'never' });
    expect(backupReminder({ ...base, snoozedUntil: 'garbage' })).toEqual({ due: true, reason: 'never' });
    expect(backupReminder({ ...base, hasOwnData: false })).toEqual({ due: false });
  });

  it('own data: any account, subscription, or a login that is not one of the samples', () => {
    const samples = cloneSampleEntries();
    expect(hasOwnData(samples, 0, 0)).toBe(false);
    expect(hasOwnData([], 0, 0)).toBe(false);
    expect(hasOwnData([...samples, { id: 'mine' }], 0, 0)).toBe(true);
    expect(hasOwnData(samples, 1, 0)).toBe(true);
    expect(hasOwnData([], 0, 1)).toBe(true);
  });
});

describe('backup reminder: review fixes', () => {
  it('a sample login edited into a real one is your own data', () => {
    const samples = cloneSampleEntries();
    samples[1] = { ...samples[1], password: 'Synthetic-Real-Password-77!' };
    expect(hasOwnData(samples, 0, 0)).toBe(true);
  });

  it('clock skew: a snooze longer than two weeks, or an export dated in the future, is not trusted', () => {
    expect(backupReminder({ ...base, snoozedUntil: new Date(NOW + 365 * 86_400_000).toISOString() })).toEqual({ due: true, reason: 'never' });
    expect(backupReminder({ ...base, lastExportAt: new Date(NOW + 30 * 86_400_000).toISOString() })).toEqual({ due: true, reason: 'never' });
    expect(backupReminder({ ...base, lastExportAt: new Date(NOW + 3_600_000).toISOString() })).toEqual({ due: false });
  });
});
