/**
 * SubscriptionList — every subscription, soonest date first, ended last.
 * Shows only what was entered and what follows from it; no totals (those
 * come with the dashboard).
 */

import { useMemo } from 'react';
import { AlertTriangle, KeyRound, Plus } from 'lucide-react';
import LetterAvatar from '@/components/LetterAvatar';
import { compareStates, subscriptionState } from '@/lib/billing/status';
import { SERVICE_PRESETS } from '@/lib/servicePresets';
import { cn } from '@/lib/utils';
import type { Account, Subscription, VaultEntry } from '@/lib/vault';
import { STATE_BADGE, accountTitle, priceText, providerText, stateText } from './labels';

export default function SubscriptionList({
  subscriptions,
  accounts,
  entries,
  today,
  onEdit,
  onAdd,
  onOpenLogin,
}: {
  subscriptions: Subscription[];
  accounts: Account[];
  entries: VaultEntry[];
  today: string;
  onEdit: (sub: Subscription) => void;
  onAdd: (presetKey: string | null) => void;
  onOpenLogin: (entryId: string) => void;
}) {
  const rows = useMemo(() => {
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return subscriptions
      .map((sub) => ({ sub, state: subscriptionState(sub, today), account: byId.get(sub.accountId) }))
      .sort((a, b) => compareStates(a.state, b.state));
  }, [subscriptions, accounts, today]);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-kh-lineStrong bg-kh-surface/60 px-6 py-12 text-center">
        <h2 className="font-display text-xl font-semibold text-kh-primary">No subscriptions yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-kh-muted">
          Track what you pay for, when it renews and which account it belongs to. Everything stays encrypted in this
          browser.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {SERVICE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onAdd(p.key)}
              className="flex items-center gap-2 rounded-full border border-kh-line bg-kh-inset py-1.5 pl-1.5 pr-3.5 text-sm text-kh-muted transition-colors hover:border-kh-lineStrong hover:text-kh-primary"
            >
              <LetterAvatar name={p.name} size={24} />
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onAdd(null)}
            className="flex items-center gap-1.5 rounded-full border border-kh-line bg-kh-inset px-3.5 py-1.5 text-sm text-kh-muted transition-colors hover:border-kh-lineStrong hover:text-kh-primary"
          >
            <Plus className="h-3.5 w-3.5" /> Another service
          </button>
        </div>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5" aria-label="Subscriptions">
      {rows.map(({ sub, state, account }) => {
        const badge = STATE_BADGE[state.kind];
        const login = entries.find((e) => e.accountId === sub.accountId);
        const service = account?.service ?? 'Unknown service';
        return (
          <li key={sub.id} className="relative">
            <button
              type="button"
              onClick={() => onEdit(sub)}
              aria-label={`Edit ${accountTitle(account)}${sub.plan ? ` ${sub.plan}` : ''}`}
              className={cn(
                'flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-kh-line bg-kh-surface px-4 py-3.5 text-left transition-colors hover:border-kh-lineStrong',
                state.kind === 'ended' && 'opacity-70',
              )}
            >
              <LetterAvatar name={service} size={38} />
              <span className="min-w-0 flex-1 basis-48">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold text-kh-primary">{accountTitle(account)}</span>
                  {typeof sub.plan === 'string' && sub.plan && <span className="truncate text-sm text-kh-muted">{sub.plan}</span>}
                </span>
                <span className="block truncate text-sm text-kh-faint">
                  {[account?.email, providerText(sub)].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="min-w-0 basis-56 text-right max-sm:basis-full max-sm:text-left">
                <span className="block font-mono text-sm text-kh-primary">{priceText(sub)}</span>
                <span className="block text-xs text-kh-muted">{stateText(state)}</span>
              </span>
              <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', badge.cls)}>
                {badge.label}
              </span>
            </button>
            {(login || state.problems.length > 0) && (
              <div className="mt-1 flex flex-wrap items-center gap-2 pl-[70px] max-sm:pl-4">
                {login && (
                  <button
                    type="button"
                    onClick={() => onOpenLogin(login.id)}
                    className="flex items-center gap-1.5 rounded-full border border-kh-line bg-kh-inset px-2.5 py-0.5 text-[11px] text-kh-muted transition-colors hover:text-kh-primary"
                  >
                    <KeyRound className="h-3 w-3" /> {login.title} — {login.username}
                  </button>
                )}
                {state.problems.length > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-kh-warning">
                    <AlertTriangle className="h-3 w-3" /> Needs attention: {state.problems.join(', ')} — edit to fix
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
