/**
 * A slim banner on the vault page when an encrypted backup is due
 * (lib/backupReminder): "Back up now" opens Settings → Vault & data,
 * "Remind me in 2 weeks" hides it.
 */

import { useState } from 'react';
import { useNow } from '@/hooks/useToday';
import { Link } from 'react-router';
import { FileDown } from 'lucide-react';
import { backupReminder, hasOwnData, readSnooze, snoozeReminder } from '@/lib/backupReminder';
import { readLastExport } from '@/lib/lastExport';
import { useVault } from '@/providers/VaultProvider';

export default function BackupReminder() {
  const { entries, accounts, subscriptions, save } = useVault();
  const [snoozedUntil, setSnoozedUntil] = useState(() => readSnooze());
  const now = useNow(); // keeps ticking, so a snooze or the 30 days can run out while the page stays open
  const reminder = backupReminder({
    now,
    lastExportAt: readLastExport(),
    lastSavedAt: save.lastSavedAt,
    snoozedUntil,
    hasOwnData: hasOwnData(entries, accounts.length, subscriptions.length),
  });
  if (!reminder.due) return null;
  return (
    <div
      role="status"
      aria-label="Backup reminder"
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-kh-violet/30 bg-kh-violet/10 px-4 py-3 text-sm text-kh-primary"
    >
      <FileDown className="h-4 w-4 shrink-0 text-kh-violet" aria-hidden />
      <span className="min-w-0 flex-1">
        {reminder.reason === 'never'
          ? "You haven't exported an encrypted backup yet — your vault lives only in this browser."
          : `Your last encrypted backup is ${reminder.days} days old and your vault has changed since.`}
      </span>
      <Link to="/settings?tab=data" className="font-medium text-kh-violet transition-colors hover:text-kh-primary">
        Back up now
      </Link>
      <button type="button" onClick={() => setSnoozedUntil(snoozeReminder(Date.now()))} className="text-kh-muted transition-colors hover:text-kh-primary">
        Remind me in 2 weeks
      </button>
    </div>
  );
}
