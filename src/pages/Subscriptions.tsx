/**
 * /subscriptions — what you pay for, when it renews, and which account it
 * belongs to (roadmap Phases 2–3). Two tabs: Subscriptions and Accounts.
 *
 * Query params: `?new=1` (optionally `&preset=<key>` and `&login=<entryId>`)
 * opens the add form; `?edit=<subscriptionId>` opens one for editing;
 * `?tab=accounts` shows the Accounts tab.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, Plus } from 'lucide-react';
import VaultRing from '@/components/VaultRing';
import SettingsShell from '@/components/settings/SettingsShell';
import AccountFormDrawer from '@/components/subscriptions/AccountFormDrawer';
import AccountPage from '@/components/subscriptions/AccountPage';
import AccountsPanel from '@/components/subscriptions/AccountsPanel';
import SubscriptionFormDrawer from '@/components/subscriptions/SubscriptionFormDrawer';
import SubscriptionList from '@/components/subscriptions/SubscriptionList';
import SubscriptionsOverview from '@/components/subscriptions/SubscriptionsOverview';
import { parseView, selectedTab } from '@/components/subscriptions/view-params';
import type { SubscriptionsTab } from '@/components/subscriptions/view-params';
import { draftFromSubscription, newDraft } from '@/components/subscriptions/form-model';
import { accountTitle } from '@/components/subscriptions/labels';
import VaultToasts from '@/components/vault/VaultToasts';
import { showVaultToast } from '@/components/vault/vault-utils';
import { useToday } from '@/hooks/useToday';
import { cn } from '@/lib/utils';
import type { Account, Subscription } from '@/lib/vault';
import { useVault } from '@/providers/VaultProvider';
import type { AccountDraft, SaveSubscriptionInput } from '@/providers/VaultProvider';

export default function Subscriptions() {
  const { status } = useVault();
  const { pathname, search } = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <VaultRing size={72} muted />
        <p className="font-mono text-xs text-kh-faint">checking vault…</p>
      </div>
    );
  }
  // same guard as the other app pages: nothing to unlock → create; locked → /unlock
  if (status === 'no-vault') return <Navigate to="/unlock?mode=create" replace />;
  // remember the link (?account=, ?edit= …) so unlocking lands where it pointed
  if (status !== 'unlocked') return <Navigate to="/unlock" replace state={{ next: pathname + search }} />;
  return (
    <SettingsShell title="Subscriptions">
      <SubscriptionsView />
    </SettingsShell>
  );
}

type AccountForm = { open: boolean; account: Account | null };

function SubscriptionsView() {
  const {
    accounts,
    subscriptions,
    entries,
    recordsWritable,
    saveSubscription,
    removeSubscription,
    restoreSubscription,
    addAccount,
    updateAccount,
    removeAccount,
    linkLogin,
    flush,
  } = useVault();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const today = useToday();
  const view = parseView(params);
  const tab = selectedTab(view);
  const pageAccountId = view.kind === 'account' ? view.accountId : null;
  const [accountForm, setAccountForm] = useState<AccountForm>({ open: false, account: null });

  /* the subscription drawer is driven by the URL, so links from a login open it */
  const editId = params.get('edit');
  const editing = editId ? (subscriptions.find((s) => s.id === editId) ?? null) : null;
  const adding = params.get('new') === '1';
  const formOpen = adding || !!editing;
  const presetKey = params.get('preset');
  const loginId = params.get('login');
  const initial = useMemo(() => {
    if (editing) return draftFromSubscription(editing, accounts.find((a) => a.id === editing.accountId));
    if (!adding) return null;
    // the currency of the most recently changed subscription, else US dollars
    const recent = [...subscriptions].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
    const login = entries.find((e) => e.id === loginId);
    return newDraft({ presetKey, currency: recent?.currency ?? 'USD', login, accounts, accountId: pageAccountId ?? undefined });
    // re-create only when the drawer opens for a different target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id, adding, presetKey, loginId, pageAccountId]);

  const closeForm = useCallback(() => {
    setParams((p) => {
      const next = new URLSearchParams(p);
      ['new', 'edit', 'preset', 'login'].forEach((k) => next.delete(k));
      return next;
    });
  }, [setParams]);

  const openAdd = (preset: string | null) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('new', '1');
      next.delete('edit');
      if (preset) next.set('preset', preset);
      else next.delete('preset');
      return next;
    });
  const openEdit = (sub: Subscription) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('edit', sub.id);
      next.delete('new');
      return next;
    });
  const setTab = (t: SubscriptionsTab) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('account');
      if (t === 'overview') next.delete('tab');
      else next.set('tab', t);
      return next;
    });
  const openAccount = (accountId: string) => setParams(new URLSearchParams({ account: accountId }));
  const openLogin = (entryId: string) => navigate(`/vault?entry=${encodeURIComponent(entryId)}`);

  /** toast only once the change is actually saved (encrypted) in this browser */
  const toastWhenSaved = (title: string) =>
    flush().then(
      () => showVaultToast({ title, variant: 'success' }),
      () =>
        showVaultToast({
          title: "Not saved to this browser yet — KeyHaven is retrying. Don't close this tab.",
          variant: 'danger',
          durationMs: 6000,
        }),
    );

  const handleSave = (input: SaveSubscriptionInput): boolean => {
    const saved = saveSubscription(input);
    if (!saved) return false;
    closeForm();
    const account = accounts.find((a) => a.id === saved.accountId);
    void toastWhenSaved(`${account ? accountTitle(account) : 'Subscription'} saved`);
    return true;
  };

  const handleDelete = (sub: Subscription) => {
    if (!removeSubscription(sub.id)) {
      showVaultToast({ title: 'The vault is locked or out of date — nothing was deleted.', variant: 'danger' });
      return;
    }
    closeForm();
    const name = accountTitle(accounts.find((a) => a.id === sub.accountId));
    showVaultToast({
      title: 'Subscription deleted',
      description: `${name} — the account and login stay.`,
      variant: 'danger',
      actionLabel: 'Undo',
      durationMs: 5000,
      onAction: () => {
        if (restoreSubscription(sub)) showVaultToast({ title: `${name} restored`, variant: 'success', durationMs: 2500 });
        else showVaultToast({ title: `Couldn't restore ${name} — its account was removed or the vault is locked.`, variant: 'danger' });
      },
    });
  };

  const handleAccountSave = (draft: AccountDraft): boolean => {
    const ok = accountForm.account ? updateAccount(accountForm.account.id, draft) : addAccount(draft) !== null;
    if (ok) {
      setAccountForm({ open: false, account: null });
      void toastWhenSaved('Account saved');
    }
    return ok;
  };
  const handleAccountRemove = (id: string) => {
    const r = removeAccount(id);
    if (r === 'ok') {
      setAccountForm({ open: false, account: null });
      if (pageAccountId === id) setTab('accounts'); // its page is gone
      void toastWhenSaved('Account removed — its logins stay in your vault');
    }
    return r;
  };
  /* Esc closes whichever drawer is open */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (formOpen) closeForm();
      else if (accountForm.open) setAccountForm({ open: false, account: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [formOpen, accountForm.open, closeForm]);

  // keep the open account drawer in sync with the vault (e.g. after linking a login)
  const liveAccount = accountForm.account ? (accounts.find((a) => a.id === accountForm.account?.id) ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">Subscriptions</h2>
          <p className="mt-1 max-w-xl text-sm text-kh-muted">
            What you pay for and when it renews, linked to the right account and login. Prices and dates are what you
            enter; nothing is fetched or charged.
          </p>
        </div>
        <button
          type="button"
          onClick={() => (view.kind === 'accounts' ? setAccountForm({ open: true, account: null }) : openAdd(null))}
          disabled={!recordsWritable}
          className="bg-aurora flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-[#04110B] transition-all hover:-translate-y-px hover:shadow-glow disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {view.kind === 'accounts' ? 'Add account' : 'Add subscription'}
        </button>
      </div>

      {!recordsWritable && (
        <p className="flex items-start gap-2 rounded-xl border border-kh-warning/30 bg-kh-warning/10 px-4 py-3 text-sm text-kh-warning" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Some account or subscription data in this vault isn't in a format this version understands, so editing it is
          turned off to keep it intact. Your logins are not affected.
        </p>
      )}

      <div
        role="tablist"
        aria-label="View"
        className="flex max-w-full gap-1 self-start overflow-x-auto whitespace-nowrap rounded-xl border border-kh-line bg-kh-inset p-1"
      >
        {(['overview', 'subscriptions', 'accounts'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === t ? 'bg-kh-elevated text-kh-primary' : 'text-kh-muted hover:text-kh-primary',
            )}
          >
            {t === 'overview' ? 'Overview' : t === 'subscriptions' ? `Subscriptions (${subscriptions.length})` : `Accounts (${accounts.length})`}
          </button>
        ))}
      </div>

      {tab === 'overview' && subscriptions.length > 0 ? (
        <SubscriptionsOverview
          subscriptions={subscriptions}
          accounts={accounts}
          today={today}
          onOpen={(sub) => openAccount(sub.accountId)}
          onShowList={() => setTab('subscriptions')}
        />
      ) : view.kind === 'account' ? (
        <AccountPage
          accountId={view.accountId}
          accounts={accounts}
          subscriptions={subscriptions}
          entries={entries}
          today={today}
          canEdit={recordsWritable}
          onBack={() => setTab('accounts')}
          onEditAccount={(account) => setAccountForm({ open: true, account })}
          onEditSubscription={openEdit}
          onAddSubscription={() => openAdd(null)}
          onOpenLogin={openLogin}
        />
      ) : tab !== 'accounts' ? (
        <SubscriptionList
          subscriptions={subscriptions}
          accounts={accounts}
          entries={entries}
          today={today}
          onEdit={openEdit}
          onAdd={openAdd}
          onOpenLogin={openLogin}
        />
      ) : (
        <AccountsPanel
          accounts={accounts}
          subscriptions={subscriptions}
          entries={entries}
          onOpen={(account) => openAccount(account.id)}
          onEdit={(account) => setAccountForm({ open: true, account })}
          onAdd={() => setAccountForm({ open: true, account: null })}
          onOpenLogin={openLogin}
        />
      )}

      <SubscriptionFormDrawer
        open={formOpen && recordsWritable}
        initial={initial}
        editing={editing}
        accounts={accounts}
        entries={entries}
        today={today}
        onClose={closeForm}
        onSave={handleSave}
        onDelete={handleDelete}
      />
      <AccountFormDrawer
        open={accountForm.open && recordsWritable}
        account={liveAccount}
        entries={entries}
        subscriptionCount={liveAccount ? subscriptions.filter((s) => s.accountId === liveAccount.id).length : 0}
        onClose={() => setAccountForm({ open: false, account: null })}
        onSave={handleAccountSave}
        onRemove={handleAccountRemove}
        onLink={linkLogin}
      />
      <VaultToasts />
    </div>
  );
}
