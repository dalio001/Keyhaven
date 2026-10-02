/**
 * AccountFormDrawer — add or edit an account, link and unlink saved logins,
 * remove it (only once it has no subscriptions; its logins always stay).
 */

import { useState } from 'react';
import { Trash2, Unlink } from 'lucide-react';
import VaultDrawer from '@/components/vault/VaultDrawer';
import { FieldError, Label } from '@/components/vault/form-fields';
import { inputCls } from '@/components/vault/form-styles';
import { CATEGORY_META, CATEGORY_ORDER } from '@/components/vault/vault-utils';
import type { Account, VaultCategory, VaultEntry } from '@/lib/vault';
import type { AccountDraft } from '@/providers/VaultProvider';

function FormBody({
  account,
  entries,
  subscriptionCount,
  onSave,
  onRemove,
  onLink,
}: {
  account: Account | null;
  entries: VaultEntry[];
  subscriptionCount: number;
  onSave: (draft: AccountDraft) => boolean;
  onRemove: (id: string) => 'ok' | 'has-subscriptions' | 'unavailable';
  onLink: (entryId: string, accountId: string | null) => boolean;
}) {
  const [service, setService] = useState(account?.service ?? '');
  const [label, setLabel] = useState(account?.label ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [website, setWebsite] = useState(account?.website ?? '');
  const [category, setCategory] = useState<VaultCategory>(account?.category ?? 'other');
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const linked = account ? entries.filter((e) => e.accountId === account.id) : [];
  const linkable = account ? entries.filter((e) => e.accountId !== account.id) : [];

  const submit = () => {
    setAttempted(true);
    if (!service.trim()) return;
    const draft: AccountDraft = {
      ...(account?.serviceKey ? { serviceKey: account.serviceKey } : {}),
      service: service.trim(),
      label: label.trim() || undefined,
      email: email.trim() || undefined,
      website: website.trim() || undefined,
      category,
      notes: notes.trim() || undefined,
    };
    if (!onSave(draft)) setMessage("Couldn't save — the vault is locked or changed in another tab.");
  };

  return (
    <form
      id="account-form"
      className="flex flex-col gap-4 p-6 pt-0"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="af-service">Service</Label>
        <input id="af-service" value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. ChatGPT" className={inputCls} />
        <FieldError show={attempted && !service.trim()}>A service name is required.</FieldError>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="af-label">Label</Label>
        <input id="af-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Work or Personal" className={inputCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="af-email">Email or username</Label>
        <input id="af-email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={inputCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="af-website">Website</Label>
        <input id="af-website" value={website} onChange={(e) => setWebsite(e.target.value)} inputMode="url" placeholder="https://…" className={inputCls} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="af-category">Category</Label>
        <select id="af-category" value={category} onChange={(e) => setCategory(e.target.value as VaultCategory)} className={inputCls}>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_META[c].label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="af-notes">Notes</Label>
        <textarea
          id="af-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2.5 text-sm text-kh-primary transition-colors focus:border-kh-cyan/60 focus:outline-none"
        />
      </div>

      {account && (
        <section aria-label="Linked logins" className="flex flex-col gap-2 border-t border-kh-line pt-4">
          <Label>Linked logins</Label>
          {linked.length === 0 && <p className="text-sm text-kh-faint">None yet.</p>}
          {linked.map((e) => (
            <div key={e.id} className="flex items-center gap-2 rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-kh-primary">
                {e.title} <span className="text-kh-faint">— {e.username}</span>
              </span>
              <button
                type="button"
                onClick={() => onLink(e.id, null)}
                className="flex shrink-0 items-center gap-1 text-xs text-kh-muted transition-colors hover:text-kh-primary"
              >
                <Unlink className="h-3.5 w-3.5" /> Unlink
              </button>
            </div>
          ))}
          {linkable.length > 0 && (
            <select
              aria-label="Link a login"
              value=""
              onChange={(e) => e.target.value && onLink(e.target.value, account.id)}
              className={inputCls}
            >
              <option value="">Link a saved login…</option>
              {linkable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} — {e.username}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-kh-faint">Unlinking never deletes a login.</p>
        </section>
      )}

      {message && (
        <p className="text-sm text-kh-danger" role="alert">
          {message}
        </p>
      )}

      {account && (
        <div className="border-t border-kh-line pt-4">
          {subscriptionCount > 0 ? (
            <p className="text-sm text-kh-faint">
              This account has {subscriptionCount} subscription{subscriptionCount === 1 ? '' : 's'}. Delete{' '}
              {subscriptionCount === 1 ? 'it' : 'them'} first to remove the account.
            </p>
          ) : confirmRemove ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-kh-muted">Removes the account. Its logins stay in your vault.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const r = onRemove(account.id);
                    if (r !== 'ok') setMessage(r === 'has-subscriptions' ? 'Delete its subscriptions first.' : "Couldn't remove — the vault is locked.");
                  }}
                  className="flex-1 rounded-xl bg-kh-danger px-3 py-2.5 text-sm font-semibold text-[#1A0509] transition-all hover:brightness-110"
                >
                  Remove account
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  className="rounded-xl border border-kh-line px-3 py-2.5 text-sm text-kh-muted transition-colors hover:text-kh-primary"
                >
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="flex items-center gap-2 text-sm font-medium text-kh-danger/80 transition-colors hover:text-kh-danger"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove this account
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export default function AccountFormDrawer({
  open,
  account,
  entries,
  subscriptionCount,
  onClose,
  onSave,
  onRemove,
  onLink,
}: {
  open: boolean;
  account: Account | null;
  entries: VaultEntry[];
  subscriptionCount: number;
  onClose: () => void;
  onSave: (draft: AccountDraft) => boolean;
  onRemove: (id: string) => 'ok' | 'has-subscriptions' | 'unavailable';
  onLink: (entryId: string, accountId: string | null) => boolean;
}) {
  return (
    <VaultDrawer
      open={open}
      onClose={onClose}
      labelledBy="account-form-title"
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
            form="account-form"
            className="bg-aurora flex-[2] rounded-xl px-4 py-2.5 text-sm font-semibold text-[#04110B] transition-all hover:-translate-y-px hover:brightness-110"
          >
            Save account
          </button>
        </div>
      }
    >
      <header className="p-6 pb-5">
        <h3 id="account-form-title" className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
          {account ? `Edit ${account.service}` : 'New account'}
        </h3>
        <p className="mt-1 text-sm text-kh-muted">One sign-up at one service. Encrypted in your browser.</p>
      </header>
      {open && (
        <FormBody
          key={account?.id ?? 'new'}
          account={account}
          entries={entries}
          subscriptionCount={subscriptionCount}
          onSave={onSave}
          onRemove={onRemove}
          onLink={onLink}
        />
      )}
    </VaultDrawer>
  );
}
