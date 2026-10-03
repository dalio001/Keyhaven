/**
 * The subscription form's state and validation — pure, no React.
 *
 * Dates stay strings end to end: the value of `<input type="date">` is a
 * `'YYYY-MM-DD'` string, it is validated as a calendar date and stored
 * verbatim. Nothing here (or in the form) parses a date with the Date
 * constructor, `Date.parse` or `valueAsDate`, so the stored day can't shift
 * with the time zone.
 */

import { isCalendarDate } from '@/lib/billing/dates';
import { isCurrencyCode, minorToInput, parseMoneyInput } from '@/lib/billing/money';
import { findPreset } from '@/lib/servicePresets';
import { safeExternalUrl } from './links';
import type { Account, BillingProvider, BillingUnit, Subscription, SubscriptionStatus, VaultEntry } from '@/lib/vault';
import type { SaveSubscriptionInput } from '@/providers/VaultProvider';

export interface SubscriptionDraft {
  /** preset key, or null for a custom service */
  serviceKey: string | null;
  serviceName: string;
  website: string;
  /** 'new' or the id of an existing account */
  accountChoice: string;
  /** new account only */
  email: string;
  label: string;
  /** login to link to the account ('' = leave links as they are) */
  linkEntryId: string;
  plan: string;
  /** price as typed */
  amount: string;
  currency: string;
  intervalPreset: 'month' | 'year' | 'custom';
  customCount: string;
  customUnit: BillingUnit;
  status: SubscriptionStatus;
  /** `<input type="date">` values: 'YYYY-MM-DD' or '' */
  billingDate: string;
  trialEndsOn: string;
  accessEndsOn: string;
  provider: BillingProvider;
  providerOther: string;
  /** "Manage or cancel link" as typed */
  manageUrl: string;
  notes: string;
}

export type DraftField =
  | 'service'
  | 'account'
  | 'amount'
  | 'currency'
  | 'interval'
  | 'billingDate'
  | 'trialEndsOn'
  | 'accessEndsOn'
  | 'providerOther'
  | 'manageUrl';

export type DraftErrors = Partial<Record<DraftField, string>>;

export function newDraft(opts: {
  presetKey?: string | null;
  currency: string;
  login?: VaultEntry;
  accounts?: Account[];
  /** add to this existing account (from its account page) */
  accountId?: string;
}): SubscriptionDraft {
  const preset = findPreset(opts.presetKey ?? undefined);
  // from an account page, or a login that already belongs to an account: add the subscription to that account
  const ownerId = opts.accountId ?? opts.login?.accountId;
  const owner = ownerId ? opts.accounts?.find((a) => a.id === ownerId) : undefined;
  const base: SubscriptionDraft = {
    serviceKey: preset?.key ?? null,
    serviceName: preset?.name ?? opts.login?.title ?? '',
    website: preset?.website ?? opts.login?.url ?? '',
    accountChoice: 'new',
    email: opts.login && opts.login.username.includes('@') ? opts.login.username : '',
    label: '',
    linkEntryId: opts.login?.id ?? '',
    plan: '',
    amount: '',
    currency: opts.currency,
    intervalPreset: 'month',
    customCount: '1',
    customUnit: 'month',
    status: 'active',
    billingDate: '',
    trialEndsOn: '',
    accessEndsOn: '',
    provider: 'website',
    providerOther: '',
    manageUrl: '',
    notes: '',
  };
  if (!owner) return base;
  return {
    ...base,
    serviceKey: owner.serviceKey ?? null,
    serviceName: owner.service,
    website: owner.website ?? '',
    accountChoice: owner.id,
    email: '',
    linkEntryId: '',
  };
}

export function draftFromSubscription(sub: Subscription, account: Account | undefined): SubscriptionDraft {
  const unit = sub.interval?.unit;
  const count = sub.interval?.count;
  const intervalPreset = count === 1 && (unit === 'month' || unit === 'year') ? unit : 'custom';
  const currency = typeof sub.currency === 'string' ? sub.currency : 'USD';
  return {
    serviceKey: account?.serviceKey ?? null,
    serviceName: account?.service ?? '',
    website: account?.website ?? '',
    accountChoice: sub.accountId,
    email: '',
    label: '',
    linkEntryId: '',
    plan: typeof sub.plan === 'string' ? sub.plan : '',
    amount: Number.isSafeInteger(sub.amountMinor) && sub.amountMinor >= 0 ? minorToInput(sub.amountMinor, currency) : '',
    currency,
    intervalPreset,
    customCount: String(Number.isInteger(count) && count >= 1 ? count : 1),
    customUnit: unit === 'day' || unit === 'week' || unit === 'month' || unit === 'year' ? unit : 'month',
    status: sub.status === 'trial' || sub.status === 'canceled' ? sub.status : 'active',
    billingDate: typeof sub.billingAnchor === 'string' ? sub.billingAnchor : '',
    trialEndsOn: typeof sub.trialEndsOn === 'string' ? sub.trialEndsOn : '',
    accessEndsOn: typeof sub.accessEndsOn === 'string' ? sub.accessEndsOn : '',
    provider: sub.provider === 'apple' || sub.provider === 'google-play' || sub.provider === 'other' ? sub.provider : 'website',
    providerOther: typeof sub.providerOther === 'string' ? sub.providerOther : '',
    manageUrl: typeof sub.manageUrl === 'string' ? sub.manageUrl : '',
    notes: typeof sub.notes === 'string' ? sub.notes : '',
  };
}

/** accounts at the draft's service (same preset, or same name ignoring case) */
export function accountsForService(accounts: Account[], draft: Pick<SubscriptionDraft, 'serviceKey' | 'serviceName'>): Account[] {
  const name = draft.serviceName.trim().toLowerCase();
  return accounts.filter((a) =>
    draft.serviceKey && a.serviceKey ? a.serviceKey === draft.serviceKey : (a.service ?? '').trim().toLowerCase() === name,
  );
}

/** an existing account the new one would duplicate (same service, email and label) — a warning, not a block */
export function duplicateAccount(accounts: Account[], draft: SubscriptionDraft): Account | undefined {
  if (draft.accountChoice !== 'new') return undefined;
  const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase();
  return accountsForService(accounts, draft).find(
    (a) => norm(a.email) === norm(draft.email) && norm(a.label) === norm(draft.label),
  );
}

const MONEY_HINT = 'Enter the price like 20 or 20.00.';

export function validateDraft(
  d: SubscriptionDraft,
  accounts: Account[],
): { errors: DraftErrors; value: SaveSubscriptionInput | null } {
  const errors: DraftErrors = {};
  const serviceName = d.serviceName.trim();
  if (!serviceName) errors.service = 'Choose a service or type its name.';

  const existing = d.accountChoice === 'new' ? undefined : accounts.find((a) => a.id === d.accountChoice);
  if (d.accountChoice !== 'new' && !existing) errors.account = 'That account no longer exists — pick another.';

  const currency = d.currency.trim().toUpperCase();
  if (!isCurrencyCode(currency)) errors.currency = 'Choose a currency.';
  const amountMinor = isCurrencyCode(currency) ? parseMoneyInput(d.amount, currency) : null;
  if (amountMinor === null) errors.amount = MONEY_HINT;

  let count = 1;
  let unit: BillingUnit = d.intervalPreset === 'custom' ? d.customUnit : d.intervalPreset;
  if (d.intervalPreset === 'custom') {
    count = /^\d{1,4}$/.test(d.customCount.trim()) ? Number(d.customCount.trim()) : NaN;
    if (!(count >= 1 && count <= 1000)) errors.interval = 'Repeat every 1 to 1000 days, weeks, months or years.';
    if (!['day', 'week', 'month', 'year'].includes(unit)) unit = 'month';
  }

  // dates: validated as calendar strings and kept exactly as typed
  if (d.billingDate && !isCalendarDate(d.billingDate)) errors.billingDate = 'Enter a real date.';
  if (d.status === 'trial') {
    if (!d.trialEndsOn) errors.trialEndsOn = 'When does the trial end?';
    else if (!isCalendarDate(d.trialEndsOn)) errors.trialEndsOn = 'Enter a real date.';
  }
  if (d.status === 'canceled' && d.accessEndsOn && !isCalendarDate(d.accessEndsOn)) {
    errors.accessEndsOn = 'Enter a real date.';
  }
  if (d.provider === 'other' && !d.providerOther.trim()) errors.providerOther = 'Who bills you?';
  // only an http(s) address is kept (never javascript:, data: or user:password@)
  const manageUrl = d.manageUrl.trim() ? safeExternalUrl(d.manageUrl) : null;
  if (d.manageUrl.trim() && !manageUrl) errors.manageUrl = 'Enter a web address, like https://example.com/account.';

  if (Object.keys(errors).length > 0 || amountMinor === null) return { errors, value: null };

  const website = d.website.trim();
  const fields: SaveSubscriptionInput['fields'] = {
    plan: d.plan.trim(),
    amountMinor,
    currency,
    interval: { unit, count },
    status: d.status,
    provider: d.provider,
    // a trial's first charge is its end date; a billing date hidden by switching to "Free trial" is dropped
    ...(d.billingDate && d.status !== 'trial' ? { billingAnchor: d.billingDate } : {}),
    ...(d.status === 'trial' ? { trialEndsOn: d.trialEndsOn } : {}),
    ...(d.status === 'canceled' && d.accessEndsOn ? { accessEndsOn: d.accessEndsOn } : {}),
    ...(d.provider === 'other' ? { providerOther: d.providerOther.trim() } : {}),
    ...(manageUrl ? { manageUrl } : {}),
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
  };
  const preset = findPreset(d.serviceKey ?? undefined);
  const account: SaveSubscriptionInput['account'] = existing
    ? { id: existing.id }
    : {
        create: {
          service: serviceName,
          ...(preset ? { serviceKey: preset.key } : {}),
          ...(d.label.trim() ? { label: d.label.trim() } : {}),
          ...(d.email.trim() ? { email: d.email.trim() } : {}),
          ...(website ? { website } : {}),
          category: preset?.category ?? 'other',
        },
      };
  return {
    errors,
    value: { account, fields, ...(d.linkEntryId ? { linkEntryId: d.linkEntryId } : {}) },
  };
}
