/**
 * Renewal reminders (Phase 5): what renews, or whose trial ends, within the
 * chosen number of days (Settings → Preferences, default 3). Shown on the
 * vault page and at the top of the subscriptions Overview. A row opens the
 * account; "Hide until next time" remembers that one renewal in the encrypted
 * vault settings. Viewing never writes.
 */

import { useMemo } from 'react';
import { Link } from 'react-router';
import { BellRing } from 'lucide-react';
import { showVaultToast } from '@/components/vault/vault-utils';
import { useToday } from '@/hooks/useToday';
import { formatCalendarDate, relativeDays } from '@/lib/billing/dates';
import { dismissedReminders, reminderDays, remindersDue, withDismissed } from '@/lib/billing/reminders';
import { useVault } from '@/providers/VaultProvider';
import { accountTitle, priceText } from './labels';

export default function RenewalReminder({ className = 'mb-4' }: { className?: string }) {
  const { accounts, subscriptions, settings, updateSettings } = useVault();
  const today = useToday();
  const due = useMemo(
    () => remindersDue(subscriptions, today, reminderDays(settings), dismissedReminders(settings)),
    [subscriptions, today, settings],
  );
  if (due.length === 0) return null;
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const hide = (key: string) => {
    if (!updateSettings({ dismissedReminders: withDismissed(dismissedReminders(settings), key, today) })) {
      showVaultToast({ title: "Couldn't hide the reminder — the vault is locked or out of date.", variant: 'danger' });
    }
  };

  return (
    <div className={`${className} rounded-xl border border-kh-cyan/30 bg-kh-cyan/5 px-4 py-3 text-sm`}>
      <p className="flex items-center gap-2 font-medium text-kh-primary">
        <BellRing className="h-4 w-4 shrink-0 text-kh-cyan" aria-hidden /> Coming up
      </p>
      <ul aria-label="Renewal reminders" className="mt-2 flex flex-col gap-1.5">
        {due.map((r) => {
          const account = byId.get(r.sub.accountId);
          // an account this version can't show has no page: open the subscription instead
          const to = account ? `/subscriptions?account=${encodeURIComponent(account.id)}` : `/subscriptions?edit=${encodeURIComponent(r.sub.id)}`;
          return (
            <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link to={to} className="min-w-0 flex-1 basis-48 text-kh-primary transition-colors hover:text-kh-cyan">
                <span className="font-medium">{accountTitle(account)}</span> {r.kind === 'trial' ? 'trial ends' : 'renews'} {relativeDays(r.daysLeft)}
                <span className="text-kh-muted"> · {formatCalendarDate(r.date)}</span> — {r.kind === 'trial' && 'then '}
                <span className="font-mono tabular-nums">{priceText(r.sub)}</span>
              </Link>
              <button type="button" onClick={() => hide(r.key)} className="text-kh-muted transition-colors hover:text-kh-primary">
                Hide until next time
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
