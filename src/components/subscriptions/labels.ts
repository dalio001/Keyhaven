/** Wording shared by the subscription list, form and the login drawer. */

import { formatCalendarDate, relativeDays } from '@/lib/billing/dates';
import { formatMoney } from '@/lib/billing/money';
import { formatInterval } from '@/lib/billing/status';
import type { SubscriptionState } from '@/lib/billing/status';
import type { Account, BillingProvider, Subscription } from '@/lib/vault';

export const PROVIDER_LABELS: Record<BillingProvider, string> = {
  website: 'Service website',
  apple: 'Apple (App Store)',
  'google-play': 'Google Play',
  other: 'Other',
};

export function providerText(sub: Subscription): string {
  if (sub.provider === 'other') return sub.providerOther ? `via ${sub.providerOther}` : 'via another provider';
  if (sub.provider === 'apple') return 'via Apple';
  if (sub.provider === 'google-play') return 'via Google Play';
  return 'via the service website';
}

export function priceText(sub: Subscription): string {
  if (!Number.isSafeInteger(sub.amountMinor) || typeof sub.currency !== 'string') return 'Price missing';
  return `${formatMoney(sub.amountMinor, sub.currency)} ${formatInterval(sub.interval)}`.trim();
}

const when = (s: SubscriptionState) =>
  s.date ? `${formatCalendarDate(s.date)}${s.daysLeft !== null ? ` · ${relativeDays(s.daysLeft)}` : ''}` : '';

/** "Renews Oct 15, 2026 · in 13 days", "Trial ends …", "Canceled · access until …", "Ended …" */
export function stateText(s: SubscriptionState): string {
  switch (s.kind) {
    case 'renews':
      return s.date ? `Renews ${when(s)}` : 'No billing date yet';
    case 'trial':
      return `Trial ends ${when(s)}`;
    case 'access-until':
      return `Canceled · access until ${when(s)}`;
    case 'ended':
      return s.date ? `Ended ${formatCalendarDate(s.date)}` : 'Ended';
  }
}

export const STATE_BADGE: Record<SubscriptionState['kind'], { label: string; cls: string }> = {
  renews: { label: 'Active', cls: 'border-kh-mint/30 bg-kh-mint/10 text-kh-mint' },
  trial: { label: 'Trial', cls: 'border-kh-cyan/30 bg-kh-cyan/10 text-kh-cyan' },
  'access-until': { label: 'Canceled', cls: 'border-kh-warning/30 bg-kh-warning/10 text-kh-warning' },
  ended: { label: 'Ended', cls: 'border-kh-line bg-kh-inset text-kh-faint' },
};

export function accountTitle(a: Account | undefined): string {
  if (!a) return 'Unknown account';
  return a.label ? `${a.service} · ${a.label}` : a.service;
}

/** where to manage a subscription that isn't billed through the service's own website — instructions only, no links */
export function manageHint(sub: Subscription): string {
  if (sub.provider === 'apple') return 'Billed through Apple: on iPhone or iPad, open Settings → your name → Subscriptions.';
  if (sub.provider === 'google-play') return 'Billed through Google Play: open the Play Store → your profile → Payments & subscriptions → Subscriptions.';
  if (sub.provider === 'other') return `Billed through ${sub.providerOther || 'another provider'}: manage it where you signed up.`;
  if (sub.provider === 'website') return '';
  return 'Manage it where you signed up.'; // a provider this version doesn't know
}
