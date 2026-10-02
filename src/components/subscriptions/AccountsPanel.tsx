/**
 * AccountsPanel — accounts with their linked logins and subscription count.
 * Full account pages come with the dashboard; this is the minimal list.
 */

import { KeyRound, Plus } from 'lucide-react';
import LetterAvatar from '@/components/LetterAvatar';
import type { Account, Subscription, VaultEntry } from '@/lib/vault';
import { accountTitle } from './labels';

export default function AccountsPanel({
  accounts,
  subscriptions,
  entries,
  onEdit,
  onAdd,
  onOpenLogin,
}: {
  accounts: Account[];
  subscriptions: Subscription[];
  entries: VaultEntry[];
  onEdit: (account: Account) => void;
  onAdd: () => void;
  onOpenLogin: (entryId: string) => void;
}) {
  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-kh-lineStrong bg-kh-surface/60 px-6 py-12 text-center">
        <h2 className="font-display text-xl font-semibold text-kh-primary">No accounts yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-kh-muted">
          An account is one sign-up at one service — your work and personal ChatGPT are two accounts. They're created
          when you add a subscription, or here.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-kh-line bg-kh-inset px-3.5 py-1.5 text-sm text-kh-muted transition-colors hover:border-kh-lineStrong hover:text-kh-primary"
        >
          <Plus className="h-3.5 w-3.5" /> Add account
        </button>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5" aria-label="Accounts">
      {[...accounts]
        .sort((a, b) => accountTitle(a).localeCompare(accountTitle(b)))
        .map((a) => {
          const logins = entries.filter((e) => e.accountId === a.id);
          const subs = subscriptions.filter((s) => s.accountId === a.id).length;
          return (
            <li key={a.id}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-kh-line bg-kh-surface px-4 py-3.5">
                <LetterAvatar name={a.service || '?'} size={38} />
                <button
                  type="button"
                  onClick={() => onEdit(a)}
                  aria-label={`Edit account ${accountTitle(a)}`}
                  className="min-w-0 flex-1 basis-48 text-left"
                >
                  <span className="block truncate text-[15px] font-semibold text-kh-primary">{accountTitle(a)}</span>
                  <span className="block truncate text-sm text-kh-faint">{a.email || 'No email saved'}</span>
                </button>
                <span className="shrink-0 rounded-full border border-kh-line bg-kh-inset px-2.5 py-0.5 font-mono text-[11px] text-kh-muted">
                  {subs} subscription{subs === 1 ? '' : 's'}
                </span>
                {logins.length > 0 && (
                  <div className="flex basis-full flex-wrap gap-1.5 pl-[54px] max-sm:pl-0">
                    {logins.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onOpenLogin(e.id)}
                        className="flex items-center gap-1.5 rounded-full border border-kh-line bg-kh-inset px-2.5 py-0.5 text-[11px] text-kh-muted transition-colors hover:text-kh-primary"
                      >
                        <KeyRound className="h-3 w-3" /> {e.title} — {e.username}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}
