/**
 * Account page (Phase 4) — one sign-up at one service: its details, what it
 * costs, its subscriptions, where they're managed, and its logins. Changes go
 * through the existing drawers; this page itself never writes.
 */

import { useMemo } from 'react';
import { ArrowLeft, ExternalLink, KeyRound, Pencil, Plus } from 'lucide-react';
import LetterAvatar from '@/components/LetterAvatar';
import { formatCalendarDate, relativeDays } from '@/lib/billing/dates';
import { subscriptionOverview } from '@/lib/billing/forecast';
import { formatMoney } from '@/lib/billing/money';
import { calendarFileName } from '@/lib/billing/ics';
import { subscriptionState } from '@/lib/billing/status';
import type { Account, Subscription, VaultEntry } from '@/lib/vault';
import CalendarExport from './CalendarExport';
import { accountTitle, manageHint, priceText } from './labels';
import { STORE_SUBSCRIPTION_PAGES, displayHost, safeExternalUrl } from './links';
import SubscriptionList from './SubscriptionList';

const SECTION_TITLE = 'font-display text-lg font-semibold text-kh-primary';

/** a link out of KeyHaven: a new tab, with no opener and no referrer */
function OutLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 self-start text-sm font-medium text-kh-cyan transition-colors hover:text-kh-mint"
    >
      {children} <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </a>
  );
}

export default function AccountPage({
  accountId,
  accounts,
  subscriptions,
  entries,
  today,
  canEdit,
  onBack,
  onEditAccount,
  onEditSubscription,
  onAddSubscription,
  onOpenLogin,
}: {
  accountId: string;
  accounts: Account[];
  subscriptions: Subscription[];
  entries: VaultEntry[];
  today: string;
  canEdit: boolean;
  onBack: () => void;
  onEditAccount: (account: Account) => void;
  onEditSubscription: (sub: Subscription) => void;
  onAddSubscription: () => void;
  onOpenLogin: (entryId: string) => void;
}) {
  const account = accounts.find((a) => a.id === accountId);
  const subs = useMemo(() => subscriptions.filter((s) => s.accountId === accountId), [subscriptions, accountId]);
  const overview = useMemo(() => subscriptionOverview(subs, today), [subs, today]);
  const logins = entries.filter((e) => e.accountId === accountId);

  const back = (
    <button type="button" onClick={onBack} className="flex items-center gap-1.5 self-start text-sm text-kh-muted transition-colors hover:text-kh-primary">
      <ArrowLeft className="h-4 w-4" /> All accounts
    </button>
  );

  if (!account) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="rounded-xl border border-kh-line bg-kh-surface px-4 py-6 text-sm text-kh-muted">
          This account isn't in your vault. It may have been removed.
        </p>
      </div>
    );
  }

  const website = safeExternalUrl(account.website);
  const live = subs.filter((s) => subscriptionState(s, today).kind !== 'ended');
  // links saved on the subscriptions themselves (Phase 5), one per address
  const savedLinks: { url: string; plan: string }[] = [];
  for (const s of live) {
    const url = safeExternalUrl(s.manageUrl);
    if (!url) continue;
    const plan = typeof s.plan === 'string' ? s.plan.trim() : '';
    const seen = savedLinks.find((l) => l.url === url);
    if (seen) seen.plan = seen.plan === plan ? plan : ''; // shared by several plans: name none
    else savedLinks.push({ url, plan });
  }
  // the account's website, for subscriptions billed there without a link of their own
  const needsWebsite = live.some((s) => s.provider === 'website' && !safeExternalUrl(s.manageUrl));
  const next = overview.upcoming[0];

  return (
    <div className="flex flex-col gap-7">
      {back}

      <header className="flex flex-wrap items-start gap-4">
        <LetterAvatar name={account.service || '?'} size={48} />
        <div className="min-w-0 flex-1 basis-56">
          <h3 className="break-words font-display text-2xl font-semibold text-kh-primary">{accountTitle(account)}</h3>
          <p className="mt-0.5 break-all text-sm text-kh-muted">{account.email || 'No email saved'}</p>
          {account.notes && <p className="mt-2 max-w-xl whitespace-pre-wrap text-sm text-kh-faint">{account.notes}</p>}
        </div>
        <button
          type="button"
          onClick={() => onEditAccount(account)}
          disabled={!canEdit}
          className="flex items-center gap-1.5 rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2 text-sm text-kh-muted transition-colors hover:border-kh-lineStrong hover:text-kh-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit account
        </button>
      </header>

      {overview.needsAttention > 0 && (
        <p className="rounded-xl border border-kh-warning/30 bg-kh-warning/10 px-4 py-3 text-sm text-kh-warning">
          {overview.needsAttention === 1 ? "1 subscription needs attention and isn't" : `${overview.needsAttention} subscriptions need attention and aren't`}{' '}
          counted below.
        </p>
      )}

      {overview.averages.length > 0 && (
        <section aria-label="What this account costs" className="flex flex-wrap gap-3">
          {overview.averages.map((a) => (
            <p key={a.currency} className="rounded-xl border border-kh-line bg-kh-surface px-4 py-3 text-sm text-kh-muted">
              <span className="font-mono text-base font-semibold tabular-nums text-kh-primary">≈ {formatMoney(a.monthlyMinor, a.currency)}</span> a month on
              average
            </p>
          ))}
          {next && (
            <p className="rounded-xl border border-kh-line bg-kh-surface px-4 py-3 text-sm text-kh-muted">
              Next charge <span className="text-kh-primary">{formatCalendarDate(next.date)}</span> · {relativeDays(next.daysLeft)} ·{' '}
              <span className="font-mono tabular-nums text-kh-primary">{priceText(next.sub)}</span>
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="acct-subs" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 id="acct-subs" className={SECTION_TITLE}>
            Subscriptions
          </h4>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {subs.length > 0 && <CalendarExport subscriptions={subs} accounts={accounts} fileName={calendarFileName(accountTitle(account))} />}
            <button
              type="button"
              onClick={onAddSubscription}
              disabled={!canEdit}
              className="flex items-center gap-1.5 text-sm font-medium text-kh-cyan transition-colors hover:text-kh-mint disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add subscription for this account
            </button>
          </div>
        </div>
        {subs.length === 0 ? (
          <p className="text-sm text-kh-muted">No subscriptions on this account.</p>
        ) : (
          <SubscriptionList subscriptions={subs} accounts={accounts} entries={entries} today={today} onEdit={onEditSubscription} onAdd={onAddSubscription} onOpenLogin={onOpenLogin} />
        )}
      </section>

      <section aria-labelledby="acct-manage" className="flex flex-col gap-2">
        <h4 id="acct-manage" className={SECTION_TITLE}>
          Where it's managed
        </h4>
        {live.length === 0 && <p className="text-sm text-kh-muted">No active subscriptions to manage.</p>}
        {savedLinks.map(({ url, plan }) => (
          <OutLink key={url} href={url}>
            Manage or cancel{plan ? ` ${plan}` : ''} at {displayHost(url)}
          </OutLink>
        ))}
        {needsWebsite &&
          (website ? (
            <OutLink href={website}>Manage at {displayHost(website)}</OutLink>
          ) : (
            <p className="text-sm text-kh-muted">Billed through the service's website — no website saved for this account.</p>
          ))}
        {live
          .filter((s) => s.provider !== 'website')
          .filter((s, i, all) => all.findIndex((o) => manageHint(o) === manageHint(s)) === i)
          .map((s) => {
            const store = s.provider === 'apple' || s.provider === 'google-play' ? STORE_SUBSCRIPTION_PAGES[s.provider] : null;
            return (
              <div key={s.id} className="flex flex-col gap-1">
                {store && <OutLink href={store.href}>{store.label}</OutLink>}
                <p className="text-sm text-kh-muted">{manageHint(s)}</p>
              </div>
            );
          })}
        <p className="text-xs text-kh-faint">KeyHaven doesn't contact the service or cancel anything for you.</p>
      </section>

      <section aria-labelledby="acct-logins" className="flex flex-col gap-2">
        <h4 id="acct-logins" className={SECTION_TITLE}>
          Logins
        </h4>
        {logins.length === 0 ? (
          <p className="text-sm text-kh-muted">No logins linked. Link one with Edit account.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Linked logins">
            {logins.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onOpenLogin(e.id)}
                  className="flex max-w-full items-center gap-1.5 rounded-full border border-kh-line bg-kh-inset px-3 py-1 text-sm text-kh-muted transition-colors hover:text-kh-primary"
                >
                  <KeyRound className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{e.title} — {e.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
