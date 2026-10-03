/**
 * Overview — what the recorded subscriptions add up to (Phase 4): charges
 * expected this month and in the next 30 days, trials ending soon, and the
 * estimates (monthly average, next 12 months). Per currency only — amounts in
 * different currencies are never combined or converted. Derived on the fly;
 * viewing never writes to the vault.
 */

import { useMemo } from 'react';
import { AlertTriangle, CalendarClock, Hourglass, TrendingUp } from 'lucide-react';
import LetterAvatar from '@/components/LetterAvatar';
import { formatCalendarDate, formatMonthYear, relativeDays } from '@/lib/billing/dates';
import { subscriptionOverview } from '@/lib/billing/forecast';
import type { UpcomingCharge } from '@/lib/billing/forecast';
import { formatMoney } from '@/lib/billing/money';
import type { Account, Subscription } from '@/lib/vault';
import { accountTitle, priceText } from './labels';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TILE = 'rounded-xl border border-kh-line bg-kh-surface p-4 shadow-card';
const MONEY = 'font-mono tabular-nums break-words';

function SectionTitle({ id, icon: Icon, children }: { id: string; icon: typeof TrendingUp; children: React.ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-2 font-display text-lg font-semibold text-kh-primary">
      <Icon className="h-4 w-4 text-kh-cyan" aria-hidden />
      {children}
    </h3>
  );
}

export default function SubscriptionsOverview({
  subscriptions,
  accounts,
  today,
  onOpen,
  onShowList,
}: {
  subscriptions: Subscription[];
  accounts: Account[];
  today: string;
  /** a row was chosen (an upcoming renewal or a trial) */
  onOpen: (sub: Subscription) => void;
  /** go to the full list (where problems are shown) */
  onShowList: () => void;
}) {
  const o = useMemo(() => subscriptionOverview(subscriptions, today), [subscriptions, today]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const month = formatMonthYear(o.month.start);
  const title = (sub: Subscription) => accountTitle(byId.get(sub.accountId));
  const nothingBillable = o.averages.length === 0;

  return (
    <div className="flex flex-col gap-8">
      {o.needsAttention > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-kh-warning/30 bg-kh-warning/10 px-4 py-3 text-sm text-kh-warning" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            {plural(o.needsAttention, 'subscription needs', 'subscriptions need')} attention and{' '}
            {o.needsAttention === 1 ? "isn't" : "aren't"} counted below.
          </span>
          <button type="button" onClick={onShowList} className="font-medium underline underline-offset-2 hover:text-kh-primary">
            Review
          </button>
        </p>
      )}

      {nothingBillable && o.needsAttention === 0 ? (
        <div className="rounded-2xl border border-dashed border-kh-lineStrong bg-kh-surface/60 px-6 py-10 text-center">
          <h3 className="font-display text-lg font-semibold text-kh-primary">Nothing to pay right now</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-kh-muted">Every subscription here is canceled or has ended.</p>
          <button type="button" onClick={onShowList} className="mt-4 text-sm font-medium text-kh-cyan hover:text-kh-primary">
            See all subscriptions
          </button>
        </div>
      ) : (
        <>
          <section aria-labelledby="ov-month" className="flex flex-col gap-3">
            <SectionTitle id="ov-month" icon={CalendarClock}>
              Expected in {month}
            </SectionTitle>
            {o.month.totals.length === 0 ? (
              <p className="text-sm text-kh-muted">No charges expected in {month}.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Expected in ${month}`}>
                {o.month.totals.map((t) => (
                  <li key={t.currency} className={TILE}>
                    <p className={`${MONEY} text-2xl font-semibold text-kh-primary`}>{formatMoney(t.totalMinor, t.currency)}</p>
                    <p className="mt-1 text-xs text-kh-muted">
                      {plural(t.charges, 'charge')}
                      {t.earlierMinor > 0 && ` · ${formatMoney(t.earlierMinor, t.currency)} earlier this month`}
                      {` · ${formatMoney(t.remainingMinor, t.currency)} still to come`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ov-next" className="flex flex-col gap-3">
            <SectionTitle id="ov-next" icon={CalendarClock}>
              Next 30 days
            </SectionTitle>
            {o.upcoming.length === 0 ? (
              <p className="text-sm text-kh-muted">Nothing renews in the next 30 days.</p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Upcoming renewals">
                {o.upcoming.map((u) => (
                  <UpcomingRow key={u.sub.id} u={u} title={title(u.sub)} service={byId.get(u.sub.accountId)?.service ?? '?'} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </section>

          {o.trials.length > 0 && (
            <section aria-labelledby="ov-trials" className="flex flex-col gap-3">
              <SectionTitle id="ov-trials" icon={Hourglass}>
                Trials ending soon
              </SectionTitle>
              <ul className="flex flex-col gap-2" aria-label="Trials ending soon">
                {o.trials.map((t) => (
                  <li key={t.sub.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(t.sub)}
                      className="w-full rounded-xl border border-kh-cyan/30 bg-kh-cyan/5 px-4 py-3 text-left text-sm text-kh-primary transition-colors hover:border-kh-cyan/50"
                    >
                      <span className="font-medium">{title(t.sub)}</span> trial ends {formatCalendarDate(t.date)} ·{' '}
                      {relativeDays(t.daysLeft)}, then <span className={MONEY}>{priceText(t.sub)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="ov-est" className="flex flex-col gap-3">
            <SectionTitle id="ov-est" icon={TrendingUp}>
              Estimates
            </SectionTitle>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Estimates">
              {o.averages.map((a) => {
                const year = o.yearAhead.totals.find((t) => t.currency === a.currency);
                return (
                  <li key={a.currency} className={TILE}>
                    <p className="text-sm text-kh-muted">
                      <span className={`${MONEY} text-lg font-semibold text-kh-primary`}>≈ {formatMoney(a.monthlyMinor, a.currency)}</span> a
                      month on average
                      {a.trials > 0 && <span className="text-kh-faint"> · incl. {plural(a.trials, 'trial')}</span>}
                    </p>
                    <p className="mt-2 text-sm text-kh-muted">
                      {year ? (
                        <>
                          <span className={`${MONEY} font-semibold text-kh-primary`}>{formatMoney(year.totalMinor, a.currency)}</span> in the next
                          12 months
                        </>
                      ) : (
                        'No billing dates yet for the next 12 months'
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-kh-faint">
              From the prices and dates you entered ({formatCalendarDate(o.yearAhead.start)} – {formatCalendarDate(o.yearAhead.end)} for the
              12 months). Not a bill. Currencies are never combined or converted.
              {o.undated > 0 && ` ${plural(o.undated, 'subscription')} without a billing date ${o.undated === 1 ? 'is' : 'are'} in the averages only.`}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function UpcomingRow({ u, title, service, onOpen }: { u: UpcomingCharge; title: string; service: string; onOpen: (sub: Subscription) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(u.sub)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-kh-line bg-kh-surface px-4 py-3 text-left transition-colors hover:border-kh-lineStrong"
      >
        <span className="w-28 shrink-0 text-sm text-kh-primary">
          {formatCalendarDate(u.date)}
          <span className="block text-xs text-kh-faint">{relativeDays(u.daysLeft)}</span>
        </span>
        <LetterAvatar name={service} size={28} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-kh-primary">
          {title}
          {u.sub.plan && <span className="ml-1.5 font-normal text-kh-muted">{u.sub.plan}</span>}
          {u.kind === 'trial' && (
            <span className="ml-2 rounded-full border border-kh-cyan/30 bg-kh-cyan/10 px-2 py-0.5 text-[11px] font-normal text-kh-cyan">Trial ends</span>
          )}
        </span>
        <span className={`${MONEY} text-sm text-kh-primary max-sm:basis-full max-sm:pl-[calc(7rem+0.75rem)]`}>{priceText(u.sub)}</span>
      </button>
    </li>
  );
}
