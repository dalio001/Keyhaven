/**
 * LinkedSubscriptions — inside a login's detail drawer: the account this
 * login belongs to and its subscriptions, or a way to start tracking one.
 */

import { Link } from 'react-router';
import { CalendarClock, Plus } from 'lucide-react';
import { useToday } from '@/hooks/useToday';
import { subscriptionState } from '@/lib/billing/status';
import type { VaultEntry } from '@/lib/vault';
import { useVault } from '@/providers/VaultProvider';
import { accountTitle, priceText, stateText } from './labels';

export default function LinkedSubscriptions({ entry }: { entry: VaultEntry }) {
  const { accounts, subscriptions } = useVault();
  const account = entry.accountId ? accounts.find((a) => a.id === entry.accountId) : undefined;
  const subs = account ? subscriptions.filter((s) => s.accountId === account.id) : [];
  const today = useToday();

  return (
    <section aria-label="Account and subscriptions">
      <p className="text-eyebrow mb-1.5 text-kh-faint">Account &amp; subscriptions</p>
      {account ? (
        <div className="flex flex-col gap-2 rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2.5">
          <p className="text-sm text-kh-primary">{accountTitle(account)}</p>
          {subs.length === 0 && <p className="text-xs text-kh-faint">No subscriptions on this account.</p>}
          {subs.map((s) => (
            <Link
              key={s.id}
              to={`/subscriptions?edit=${encodeURIComponent(s.id)}`}
              className="flex items-center gap-2 rounded-lg border border-kh-line bg-kh-surface px-3 py-2 text-xs transition-colors hover:border-kh-lineStrong"
            >
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-kh-cyan" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-kh-primary">
                  {s.plan ? `${s.plan} · ` : ''}
                  {priceText(s)}
                </span>
                <span className="block truncate text-kh-faint">{stateText(subscriptionState(s, today))}</span>
              </span>
            </Link>
          ))}
          <Link
            to={`/subscriptions?new=1&login=${encodeURIComponent(entry.id)}`}
            className="flex items-center gap-1.5 text-xs font-medium text-kh-cyan transition-colors hover:text-kh-mint"
          >
            <Plus className="h-3.5 w-3.5" /> Add a subscription
          </Link>
        </div>
      ) : (
        <Link
          to={`/subscriptions?new=1&login=${encodeURIComponent(entry.id)}`}
          className="flex items-center gap-2 rounded-xl border border-dashed border-kh-lineStrong px-3.5 py-2.5 text-sm text-kh-muted transition-colors hover:text-kh-primary"
        >
          <CalendarClock className="h-4 w-4 text-kh-cyan" /> Track a subscription for this login
        </Link>
      )}
    </section>
  );
}
