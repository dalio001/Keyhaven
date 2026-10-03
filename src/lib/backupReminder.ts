/**
 * Backup reminder (Phase 4). The vault lives only in this browser, so an
 * encrypted export is the only copy elsewhere. Remind when there is data of
 * your own (not just the sample logins) and either there has never been an
 * export, or the last one is over 30 days old and the vault changed since.
 * "Remind me in 2 weeks" stores only a time (no vault data) in localStorage.
 */

import { SAMPLE_ENTRIES } from './sampleData';

export const BACKUP_MAX_AGE_DAYS = 30;
export const SNOOZE_DAYS = 14;
/** an ISO time; no vault data */
export const BACKUP_SNOOZE_KEY = 'keyhaven:backup-reminder-snoozed-until';

const DAY_MS = 86_400_000;
const SAMPLE_IDS = new Set(SAMPLE_ENTRIES.map((e) => e.id));

export interface ReminderInput {
  now: number;
  lastExportAt: string | null;
  /** when the vault was last saved (its record's updatedAt) */
  lastSavedAt: string | null;
  snoozedUntil: string | null;
  hasOwnData: boolean;
}

export type Reminder = { due: false } | { due: true; reason: 'never' } | { due: true; reason: 'stale'; days: number };

/** anything beyond the sample logins new vaults start with */
export function hasOwnData(entries: readonly { id: string }[], accounts: number, subscriptions: number): boolean {
  return accounts > 0 || subscriptions > 0 || entries.some((e) => !SAMPLE_IDS.has(e.id));
}

const instant = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

export function backupReminder(i: ReminderInput): Reminder {
  if (!i.hasOwnData) return { due: false };
  const snoozed = instant(i.snoozedUntil);
  if (!Number.isNaN(snoozed) && snoozed > i.now) return { due: false };
  const exported = instant(i.lastExportAt);
  if (Number.isNaN(exported)) return { due: true, reason: 'never' };
  const days = Math.floor((i.now - exported) / DAY_MS);
  if (days <= BACKUP_MAX_AGE_DAYS) return { due: false };
  const saved = instant(i.lastSavedAt);
  if (!Number.isNaN(saved) && saved <= exported) return { due: false }; // that backup still has everything
  return { due: true, reason: 'stale', days };
}

export function readSnooze(): string | null {
  try {
    return localStorage.getItem(BACKUP_SNOOZE_KEY);
  } catch {
    return null;
  }
}

/** hide the reminder for two weeks; returns the new snooze time */
export function snoozeReminder(now: number): string {
  const until = new Date(now + SNOOZE_DAYS * DAY_MS).toISOString();
  try {
    localStorage.setItem(BACKUP_SNOOZE_KEY, until);
  } catch {
    /* storage blocked: hidden for this visit only */
  }
  return until;
}
