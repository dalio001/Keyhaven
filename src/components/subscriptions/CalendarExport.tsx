/**
 * "Add to calendar" (Phase 5): a calendar file (.ics) with the next 12 months
 * of renewals (lib/billing/ics), created only after the dialog says plainly
 * that the file is not encrypted. The user saves it and imports it into their
 * own calendar app; KeyHaven sends nothing anywhere, and exporting never
 * writes to the vault.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarPlus } from 'lucide-react';
import { KhButton } from '@/components/settings/ui';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { showVaultToast } from '@/components/vault/vault-utils';
import { useToday } from '@/hooks/useToday';
import { renewalsCalendar } from '@/lib/billing/ics';
import { reminderDays } from '@/lib/billing/reminders';
import { downloadTextFile } from '@/lib/download';
import type { Account, Subscription } from '@/lib/vault';
import { useVault } from '@/providers/VaultProvider';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function CalendarExport({
  subscriptions,
  accounts,
  fileName = 'keyhaven-renewals.ics',
}: {
  subscriptions: readonly Subscription[];
  accounts: readonly Account[];
  fileName?: string;
}) {
  const { settings } = useVault();
  const today = useToday();
  const days = reminderDays(settings);
  // when the dialog was opened (the file's creation time); null = closed
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const file = useMemo(
    () => (openedAt ? renewalsCalendar({ subscriptions, accounts, today, now: openedAt, daysBefore: days }) : null),
    [openedAt, subscriptions, accounts, today, days],
  );

  const create = () => {
    if (!file || file.charges === 0) return;
    downloadTextFile(fileName, file.text, 'text/calendar;charset=utf-8');
    setOpenedAt(null);
    showVaultToast({ title: 'Calendar file created', description: 'Open it to add the renewals to your calendar app.', variant: 'success' });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenedAt(new Date())}
        className="flex items-center gap-1.5 text-sm font-medium text-kh-cyan transition-colors hover:text-kh-mint"
      >
        <CalendarPlus className="h-4 w-4" aria-hidden /> Add to calendar
      </button>
      <Dialog open={file !== null} onOpenChange={(open) => !open && setOpenedAt(null)}>
        <DialogContent className="border-kh-line bg-kh-elevated sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-kh-primary">Add renewals to your calendar</DialogTitle>
            <DialogDescription className="text-kh-muted">
              {file && file.charges > 0
                ? `A calendar file (.ics) with ${plural(file.charges, 'charge')} from ${plural(file.subscriptions, 'subscription')} in the next 12 months, to open in your calendar app.`
                : 'No renewals in the next 12 months — there is nothing to add.'}
            </DialogDescription>
          </DialogHeader>
          {file && file.skipped > 0 && (
            <p className="text-sm text-kh-muted">
              {plural(file.skipped, 'canceled or incomplete subscription')} {file.skipped === 1 ? 'is' : 'are'} left out.
            </p>
          )}
          <div className="flex items-start gap-3 rounded-xl border border-kh-warning/30 bg-kh-warning/5 p-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-kh-warning" aria-hidden />
            <p className="text-sm leading-6 text-kh-muted">
              <span className="text-kh-primary">This file is not encrypted.</span> It contains service and account names, plans and prices —
              anyone who can open the file, or the calendar you add it to, can read them. Passwords, usernames, emails, notes and links are
              never included.
            </p>
          </div>
          <p className="text-sm leading-6 text-kh-muted">
            {days > 0
              ? `Each charge has an alarm ${plural(days, 'day')} before, at 9:00 — change it in Settings → Preferences.`
              : 'No alarms — renewal reminders are off in Settings → Preferences.'}{' '}
            Creating the file again later updates these events in calendar apps that recognise them; others may add copies.
          </p>
          <DialogFooter>
            <KhButton variant="ghost" onClick={() => setOpenedAt(null)}>
              Cancel
            </KhButton>
            <KhButton variant="primary" onClick={create} disabled={!file || file.charges === 0}>
              <CalendarPlus className="h-4 w-4" aria-hidden /> Create calendar file
            </KhButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
