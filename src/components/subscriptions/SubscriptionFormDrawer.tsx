/**
 * SubscriptionFormDrawer — add / edit a subscription (Phase 3). Service
 * preset or custom → account (existing at that service, or new) → optional
 * saved login → plan, price, billing cycle, status with its date, who bills
 * you, notes. One save writes the account, the login link and the
 * subscription together.
 *
 * Date fields are native `<input type="date">`; only their string `.value`
 * is read (see form-model.ts).
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import LetterAvatar from '@/components/LetterAvatar';
import VaultDrawer from '@/components/vault/VaultDrawer';
import { FieldError, Label } from '@/components/vault/form-fields';
import { inputCls } from '@/components/vault/form-styles';
import { nextOnOrAfter } from '@/lib/billing/dates';
import { currencyOptions } from '@/lib/billing/money';
import { SERVICE_PRESETS } from '@/lib/servicePresets';
import { cn } from '@/lib/utils';
import type { Account, BillingProvider, BillingUnit, Subscription, SubscriptionStatus, VaultEntry } from '@/lib/vault';
import type { SaveSubscriptionInput } from '@/providers/VaultProvider';
import { accountsForService, duplicateAccount, validateDraft } from './form-model';
import { PROVIDER_LABELS } from './labels';
import type { DraftErrors, SubscriptionDraft } from './form-model';

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            value === o.value
              ? 'border-kh-mint/50 bg-kh-mint/10 text-kh-mint'
              : 'border-kh-line bg-kh-inset text-kh-muted hover:border-kh-lineStrong hover:text-kh-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-1.5', className)}>{children}</div>;
}

const hostOf = (url: string) => {
  const m = /^(?:[a-z]+:\/\/)?([^/:?#]+)/i.exec(url.trim());
  return (m?.[1] ?? '').replace(/^www\./, '').toLowerCase();
};

function accountName(a: Account): string {
  return [a.label, a.email].filter(Boolean).join(' · ') || 'Account';
}

function FormBody({
  initial,
  editing,
  accounts,
  entries,
  today,
  onSave,
  onDelete,
}: {
  initial: SubscriptionDraft;
  editing: Subscription | null;
  accounts: Account[];
  entries: VaultEntry[];
  today: string;
  onSave: (input: SaveSubscriptionInput) => boolean;
  onDelete?: (sub: Subscription) => void;
}) {
  const [d, setD] = useState<SubscriptionDraft>(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const currencies = useMemo(() => currencyOptions(), []);

  const set = (patch: Partial<SubscriptionDraft>) => {
    const next = { ...d, ...patch };
    setD(next);
    if (attempted) setErrors(validateDraft(next, accounts).errors);
  };

  const serviceAccounts = accountsForService(accounts, d);
  const dup = duplicateAccount(accounts, d);
  const linkedLogins = d.accountChoice === 'new' ? [] : entries.filter((e) => e.accountId === d.accountChoice);
  const host = hostOf(d.website);
  const loginOptions = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const am = host && hostOf(a.url) === host ? 0 : 1;
        const bm = host && hostOf(b.url) === host ? 0 : 1;
        return am - bm || a.title.localeCompare(b.title);
      }),
    [entries, host],
  );

  const pickService = (key: string | null) => {
    const preset = SERVICE_PRESETS.find((p) => p.key === key);
    const nextService = { serviceKey: preset?.key ?? null, serviceName: preset?.name ?? '' };
    const stillValid = accountsForService(accounts, nextService).some((a) => a.id === d.accountChoice);
    set({
      ...nextService,
      website: preset?.website ?? '',
      accountChoice: stillValid ? d.accountChoice : 'new',
    });
  };

  const setStatus = (status: SubscriptionStatus) => {
    const patch: Partial<SubscriptionDraft> = { status };
    if (status === 'canceled' && !d.accessEndsOn && d.billingDate) {
      // paid access usually lasts until the next billing date
      const interval = d.intervalPreset === 'custom'
        ? { unit: d.customUnit, count: Number(d.customCount) }
        : { unit: d.intervalPreset, count: 1 };
      patch.accessEndsOn = nextOnOrAfter(d.billingDate, interval, today) ?? '';
    }
    set(patch);
  };

  const submit = () => {
    setAttempted(true);
    const { errors: errs, value } = validateDraft(d, accounts);
    setErrors(errs);
    if (!value) return;
    const ok = onSave(editing ? { ...value, id: editing.id } : value);
    setSaveFailed(!ok);
  };

  const err = (k: keyof DraftErrors) => (attempted ? errors[k] : undefined);

  return (
    <form
      id="subscription-form"
      className="flex flex-col gap-5 p-6 pt-0"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* service */}
      <Field>
        <Label>Service</Label>
        <Segmented
          label="Service"
          value={d.serviceKey ?? 'custom'}
          options={[...SERVICE_PRESETS.map((p) => ({ value: p.key, label: p.name })), { value: 'custom', label: 'Custom' }]}
          onChange={(v) => pickService(v === 'custom' ? null : v)}
        />
        {d.serviceKey === null && (
          <input
            id="sf-service"
            aria-label="Service name"
            value={d.serviceName}
            onChange={(e) => set({ serviceName: e.target.value, accountChoice: 'new' })}
            placeholder="e.g. Netflix"
            className={cn(inputCls, err('service') && 'border-kh-danger/60')}
          />
        )}
        <FieldError show={!!err('service')}>{err('service') ?? ''}</FieldError>
      </Field>

      {/* account */}
      <Field>
        <Label>Account</Label>
        {serviceAccounts.length > 0 && (
          <div role="radiogroup" aria-label="Account" className="flex flex-col gap-1.5">
            {[...serviceAccounts.map((a) => ({ id: a.id, text: accountName(a) })), { id: 'new', text: 'New account' }].map((o) => (
              <label
                key={o.id}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors',
                  d.accountChoice === o.id ? 'border-kh-mint/50 bg-kh-mint/5 text-kh-primary' : 'border-kh-line bg-kh-inset text-kh-muted',
                )}
              >
                <input
                  type="radio"
                  name="sf-account"
                  value={o.id}
                  checked={d.accountChoice === o.id}
                  onChange={() => set({ accountChoice: o.id })}
                  className="accent-[#35F0A1]"
                />
                {o.text}
              </label>
            ))}
          </div>
        )}
        <FieldError show={!!err('account')}>{err('account') ?? ''}</FieldError>
        {d.accountChoice === 'new' ? (
          <div className="flex flex-col gap-2">
            <input
              id="sf-email"
              aria-label="Account email"
              value={d.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="Email or username on this service (optional)"
              autoComplete="off"
              className={inputCls}
            />
            <input
              id="sf-label"
              aria-label="Account label"
              value={d.label}
              onChange={(e) => set({ label: e.target.value })}
              placeholder="Label, e.g. Work or Personal (optional)"
              className={inputCls}
            />
            <input
              id="sf-website"
              aria-label="Website"
              value={d.website}
              onChange={(e) => set({ website: e.target.value })}
              placeholder="https://… (optional)"
              inputMode="url"
              className={inputCls}
            />
            {dup && (
              <p className="flex items-start gap-1.5 text-xs text-kh-warning" role="status">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                You already have this account ({accountName(dup)}). Pick it above to keep them together, or change the
                label to keep a separate one.
              </p>
            )}
          </div>
        ) : (
          linkedLogins.length > 0 && (
            <p className="text-xs text-kh-faint">
              Linked login{linkedLogins.length > 1 ? 's' : ''}: {linkedLogins.map((e) => e.title).join(', ')}
            </p>
          )
        )}
      </Field>

      {/* login */}
      <Field>
        <Label htmlFor="sf-login">Link a saved login (optional)</Label>
        <select
          id="sf-login"
          value={d.linkEntryId}
          onChange={(e) => {
            const login = entries.find((x) => x.id === e.target.value);
            set({
              linkEntryId: e.target.value,
              ...(login && d.accountChoice === 'new' && !d.email && login.username.includes('@') ? { email: login.username } : {}),
            });
          }}
          className={inputCls}
        >
          <option value="">{d.accountChoice === 'new' ? 'None' : 'Keep links as they are'}</option>
          {loginOptions.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} — {e.username}
            </option>
          ))}
        </select>
      </Field>

      {/* plan + price */}
      <Field>
        <Label htmlFor="sf-plan">Plan</Label>
        <input id="sf-plan" value={d.plan} onChange={(e) => set({ plan: e.target.value })} placeholder="e.g. Plus, Pro, Team (optional)" className={inputCls} />
      </Field>
      <Field>
        <Label htmlFor="sf-amount">Price</Label>
        <div className="flex gap-2">
          <input
            id="sf-amount"
            value={d.amount}
            onChange={(e) => set({ amount: e.target.value })}
            inputMode="decimal"
            placeholder="20.00"
            className={cn(inputCls, 'flex-1', err('amount') && 'border-kh-danger/60')}
          />
          <select
            aria-label="Currency"
            value={d.currency}
            onChange={(e) => set({ currency: e.target.value })}
            className={cn(inputCls, 'w-28 shrink-0', err('currency') && 'border-kh-danger/60')}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <FieldError show={!!(err('amount') || err('currency'))}>{err('amount') ?? err('currency') ?? ''}</FieldError>
      </Field>

      {/* billing cycle */}
      <Field>
        <Label>Billing cycle</Label>
        <Segmented
          label="Billing cycle"
          value={d.intervalPreset}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Annual' },
            { value: 'custom', label: 'Custom' },
          ]}
          onChange={(v) => set({ intervalPreset: v })}
        />
        {d.intervalPreset === 'custom' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-kh-muted">Every</span>
            <input
              aria-label="Repeat every"
              value={d.customCount}
              onChange={(e) => set({ customCount: e.target.value })}
              inputMode="numeric"
              className={cn(inputCls, 'w-20', err('interval') && 'border-kh-danger/60')}
            />
            <select
              aria-label="Repeat unit"
              value={d.customUnit}
              onChange={(e) => set({ customUnit: e.target.value as BillingUnit })}
              className={cn(inputCls, 'w-32')}
            >
              <option value="day">days</option>
              <option value="week">weeks</option>
              <option value="month">months</option>
              <option value="year">years</option>
            </select>
          </div>
        )}
        <FieldError show={!!err('interval')}>{err('interval') ?? ''}</FieldError>
      </Field>

      {/* status + its date */}
      <Field>
        <Label>Status</Label>
        <Segmented
          label="Status"
          value={d.status}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'trial', label: 'Free trial' },
            { value: 'canceled', label: 'Canceled' },
          ]}
          onChange={setStatus}
        />
      </Field>
      {d.status === 'active' && (
        <Field>
          <Label htmlFor="sf-billing">Next billing date</Label>
          <input
            id="sf-billing"
            type="date"
            value={d.billingDate}
            onChange={(e) => set({ billingDate: e.target.value })}
            className={cn(inputCls, '[color-scheme:dark]', err('billingDate') && 'border-kh-danger/60')}
          />
          <p className="text-xs text-kh-faint">Any past or upcoming charge date — later ones are worked out from it.</p>
          <FieldError show={!!err('billingDate')}>{err('billingDate') ?? ''}</FieldError>
        </Field>
      )}
      {d.status === 'trial' && (
        <Field>
          <Label htmlFor="sf-trial">Trial ends on</Label>
          <input
            id="sf-trial"
            type="date"
            value={d.trialEndsOn}
            onChange={(e) => set({ trialEndsOn: e.target.value })}
            className={cn(inputCls, '[color-scheme:dark]', err('trialEndsOn') && 'border-kh-danger/60')}
          />
          <p className="text-xs text-kh-faint">The first charge, unless you cancel before then.</p>
          <FieldError show={!!err('trialEndsOn')}>{err('trialEndsOn') ?? ''}</FieldError>
        </Field>
      )}
      {d.status === 'canceled' && (
        <Field>
          <Label htmlFor="sf-access">Paid access until</Label>
          <input
            id="sf-access"
            type="date"
            value={d.accessEndsOn}
            onChange={(e) => set({ accessEndsOn: e.target.value })}
            className={cn(inputCls, '[color-scheme:dark]', err('accessEndsOn') && 'border-kh-danger/60')}
          />
          <p className="text-xs text-kh-faint">Renewal is off. The account and any saved login stay in your vault.</p>
          <FieldError show={!!err('accessEndsOn')}>{err('accessEndsOn') ?? ''}</FieldError>
        </Field>
      )}

      {/* provider */}
      <Field>
        <Label>Billed through</Label>
        <Segmented
          label="Billed through"
          value={d.provider}
          options={(Object.keys(PROVIDER_LABELS) as BillingProvider[]).map((p) => ({ value: p, label: PROVIDER_LABELS[p] }))}
          onChange={(v) => set({ provider: v })}
        />
        {d.provider === 'other' && (
          <input
            aria-label="Billed by"
            value={d.providerOther}
            onChange={(e) => set({ providerOther: e.target.value })}
            placeholder="e.g. PayPal, your mobile carrier"
            className={cn(inputCls, err('providerOther') && 'border-kh-danger/60')}
          />
        )}
        <FieldError show={!!err('providerOther')}>{err('providerOther') ?? ''}</FieldError>
      </Field>

      {/* notes */}
      <Field>
        <Label htmlFor="sf-notes">Notes</Label>
        <textarea
          id="sf-notes"
          value={d.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={3}
          placeholder="Anything worth remembering…"
          className="w-full resize-none rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2.5 text-sm leading-[22px] text-kh-primary placeholder:text-kh-faint transition-colors focus:border-kh-cyan/60 focus:outline-none"
        />
      </Field>

      {saveFailed && (
        <p className="text-sm text-kh-danger" role="alert">
          Couldn't save — the vault is locked or changed in another tab. Nothing was saved.
        </p>
      )}

      {editing && onDelete && (
        <div className="mt-1 border-t border-kh-line pt-4">
          {confirmDelete ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-kh-muted">Deletes this subscription only. The account and login stay.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onDelete(editing)}
                  className="flex-1 rounded-xl bg-kh-danger px-3 py-2.5 text-sm font-semibold text-[#1A0509] transition-all hover:brightness-110"
                >
                  Delete subscription
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl border border-kh-line px-3 py-2.5 text-sm text-kh-muted transition-colors hover:text-kh-primary"
                >
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-sm font-medium text-kh-danger/80 transition-colors hover:text-kh-danger"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete this subscription
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export default function SubscriptionFormDrawer({
  open,
  initial,
  editing,
  accounts,
  entries,
  today,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: SubscriptionDraft | null;
  editing: Subscription | null;
  accounts: Account[];
  entries: VaultEntry[];
  today: string;
  onClose: () => void;
  /** false when the vault refused the change */
  onSave: (input: SaveSubscriptionInput) => boolean;
  onDelete?: (sub: Subscription) => void;
}) {
  const title = editing ? `Edit ${initial?.serviceName || 'subscription'}` : 'New subscription';
  return (
    <VaultDrawer
      open={open}
      onClose={onClose}
      labelledBy="subscription-form-title"
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-kh-muted transition-colors hover:bg-kh-surface hover:text-kh-primary"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="subscription-form"
            className="bg-aurora flex-[2] rounded-xl px-4 py-2.5 text-sm font-semibold text-[#04110B] transition-all hover:-translate-y-px hover:brightness-110"
          >
            Save subscription
          </button>
        </div>
      }
    >
      <header className="flex items-start gap-3 p-6 pb-5">
        {initial?.serviceName && <LetterAvatar name={initial.serviceName} size={36} />}
        <div>
          <h3 id="subscription-form-title" className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
            {title}
          </h3>
          <p className="mt-1 text-sm text-kh-muted">
            Encrypted in your browser like your logins. Prices and dates are what you enter — nothing is looked up
            online.
          </p>
        </div>
      </header>
      {open && initial && (
        <FormBody
          key={editing?.id ?? 'new'}
          initial={initial}
          editing={editing}
          accounts={accounts}
          entries={entries}
          today={today}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </VaultDrawer>
  );
}
