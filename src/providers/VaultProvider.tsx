/**
 * KeyHaven VaultProvider — React adapter over the VaultController.
 *
 * All vault state, keys and persistence live in `VaultController`
 * (src/lib/store/controller.ts), which is unit-tested without a browser.
 * This provider only:
 *  - mirrors the controller snapshot into React (useSyncExternalStore),
 *  - wires browser events (auto-lock on inactivity, flush when the page is
 *    hidden, warn before closing with unsaved changes, re-check other tabs'
 *    changes when the page becomes visible again),
 *  - owns UI-only state (auto-lock / clipboard countdowns, a pending TOTP
 *    enrollment secret, the one-time migration notice acknowledgement).
 *
 * The decrypted vault and the vault key exist in memory only while unlocked.
 *
 * Usage:
 *   ```tsx
 *   const { status, entries, unlock, lock } = useVault();
 *   ```
 * `status`: 'loading' → 'no-vault' | 'locked' | 'unlocked' | 'unavailable'.
 * Wrap `<VaultProvider>` around the app once (done in `main.tsx`).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { generateTotpSecret, totpUri } from '@/lib/totp';
import { DEFAULT_SETTINGS } from '@/lib/vault';
import type { Account, Subscription, VaultEntry, VaultSettings } from '@/lib/vault';
import * as records from '@/lib/records';
import { cloneSampleEntries } from '@/lib/sampleData';
import { VaultController } from '@/lib/store/controller';
import type {
  BusyState,
  ChangePasswordResult,
  ExportResult,
  FactorResult,
  ImportResult,
  LockReason,
  SecondFactor,
  UnavailableReason,
  UnlockResult,
  VaultSnapshot,
  VaultStatus,
} from '@/lib/store/controller';
import type { MigratedFrom, VaultPayload } from '@/lib/store/format';
import { createIdbStorage } from '@/lib/store/storage';
import { requestPersistence } from '@/lib/persistence';
import { LAST_EXPORT_KEY } from '@/lib/lastExport';
import { BACKUP_SNOOZE_KEY } from '@/lib/backupReminder';
import { createBroadcastTabChannel } from '@/lib/store/tabChannel';

export type { SecondFactor, UnlockResult, VaultStatus } from '@/lib/store/controller';

export interface VaultContextValue {
  status: VaultStatus;
  unavailableReason: UnavailableReason | null;
  unavailableDetail: string | null;
  /** true once a vault record exists on this device */
  hasVault: boolean;
  entries: VaultEntry[];
  settings: VaultSettings;
  /** one-time authenticator backup codes (never a master-password recovery) */
  backupCodes: string[];
  totpEnabled: boolean;
  /** legacy insecure passkey wraps still stored (vault not yet migrated) */
  legacyPasskeys: number;
  /** stored vault uses the legacy format and upgrades at the next password unlock */
  needsMigration: boolean;
  save: VaultSnapshot['save'];
  lockReason: LockReason;
  busy: BusyState;
  /** a vault replaced by the last import/restore is still kept on this device */
  previousVault: VaultSnapshot['previous'];
  notice: VaultSnapshot['notice'];
  dismissNotice: () => void;
  /** set once after a legacy vault was upgraded, until acknowledged */
  migrationNotice: MigratedFrom | null;
  dismissMigrationNotice: () => void;
  /** seconds until auto-lock (null when timer inactive) */
  lockCountdown: number | null;
  /**
   * pause the idle auto-lock until the returned release is called — for the
   * setup wizard, where the user is away from the keyboard scanning a QR code
   * or writing down backup codes
   */
  holdAutoLock: () => () => void;
  /** seconds until the clipboard is wiped (null when inactive) */
  clipboardCountdown: number | null;
  lastCopiedLabel: string | null;

  /** create a new vault; throws if one already exists or storage fails (never overwrites) */
  createVault: (password: string, opts?: { seedSample?: boolean }) => Promise<void>;
  unlock: (password: string, factor?: SecondFactor) => Promise<UnlockResult>;
  lock: () => Promise<void>;
  /** re-read browser storage (e.g. after "close other tabs") */
  retryStorage: () => Promise<void>;

  /** in-memory changes; each returns null/false when the vault cannot accept edits */
  addEntry: (draft: NewEntryDraft) => VaultEntry | null;
  updateEntry: (id: string, patch: Partial<VaultEntry>) => boolean;
  removeEntry: (id: string) => boolean;
  toggleFavorite: (id: string) => boolean;
  updateSettings: (patch: Partial<VaultSettings>) => boolean;

  /** accounts & subscriptions (empty while locked or before first use) */
  accounts: Account[];
  subscriptions: Subscription[];
  /** false when stored account/subscription data is malformed and edits would risk it */
  recordsWritable: boolean;
  /** save a subscription with its account (new or existing) and optional login link, as one change */
  saveSubscription: (input: SaveSubscriptionInput) => Subscription | null;
  /** deletes only the subscription — never its account or login */
  removeSubscription: (id: string) => boolean;
  /** put back a deleted subscription (undo) */
  restoreSubscription: (sub: Subscription) => boolean;
  addAccount: (draft: AccountDraft) => Account | null;
  updateAccount: (id: string, patch: AccountPatch) => boolean;
  /** refused while subscriptions use the account; otherwise unlinks (keeps) its logins */
  removeAccount: (id: string) => 'ok' | 'has-subscriptions' | 'unavailable';
  /** link a login to an account, or unlink it with null */
  linkLogin: (entryId: string, accountId: string | null) => boolean;

  /** resolves once every change so far is saved (encrypted) in this browser; rejects otherwise */
  flush: () => Promise<void>;
  retrySave: () => void;
  discardUnsaved: () => Promise<void>;
  /** pending unsaved changes as an ENCRYPTED backup file (null when none) */
  unsavedBackupText: () => string | null;

  /** begin TOTP enrollment: returns secret + otpauth URI for QR display */
  beginTotpEnrollment: (account?: string) => { secret: string; uri: string };
  /** confirm enrollment with the first code; re-enrolling also needs the current factor */
  confirmTotpEnrollment: (code: string, current?: SecondFactor) => Promise<FactorResult>;
  cancelTotpEnrollment: () => void;
  disableTotp: (factor: SecondFactor) => Promise<FactorResult>;
  pendingTotpSecret: string | null;
  regenerateBackupCodes: () => Promise<void>;

  changeMasterPassword: (current: string, next: string) => Promise<ChangePasswordResult>;
  copyWithAutoClear: (text: string, label?: string) => Promise<void>;
  exportBackup: () => Promise<ExportResult>;
  importBackup: (text: string, password: string) => Promise<ImportResult>;
  restorePreviousVault: () => ReturnType<VaultController['restorePrevious']>;
  discardPreviousVault: () => Promise<void>;
  destroyVault: () => Promise<void>;
}

export type NewEntryDraft = Omit<VaultEntry, 'id' | 'updatedAt' | 'lastUsedAt'> &
  Partial<Pick<VaultEntry, 'id' | 'updatedAt' | 'lastUsedAt'>>;

export type AccountDraft = Omit<Account, 'id' | 'createdAt' | 'updatedAt'>;
export type AccountPatch = Partial<AccountDraft>;
/** everything about a subscription the form edits */
export type SubscriptionFields = Omit<Subscription, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>;

export interface SaveSubscriptionInput {
  /** the subscription being edited; omit to add one */
  id?: string;
  /** an existing account (optionally with changes) or a new one */
  account: { id: string; patch?: AccountPatch } | { create: AccountDraft };
  /** link this login to the account */
  linkEntryId?: string;
  fields: SubscriptionFields;
}

const VaultContext = createContext<VaultContextValue | null>(null);
const NO_ENTRIES: VaultEntry[] = [];
const NO_CODES: string[] = [];
const NO_ACCOUNTS: Account[] = [];
const NO_SUBSCRIPTIONS: Subscription[] = [];
const MIGRATION_ACK_PREFIX = 'keyhaven:migration-ack:';
const LEGACY_LOCAL_KEYS = ['keyhaven.trustedDevice'];
const noop = () => undefined;

function withoutAccountId(e: VaultEntry): VaultEntry {
  const next = { ...e };
  delete next.accountId;
  return next;
}

function makeId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readAck(vaultId: string | null): boolean {
  if (!vaultId) return true;
  try {
    return localStorage.getItem(MIGRATION_ACK_PREFIX + vaultId) === '1';
  } catch {
    return false;
  }
}

function createDefaultController(): VaultController {
  return new VaultController({ storage: createIdbStorage(), channel: createBroadcastTabChannel() });
}

export function VaultProvider({
  children,
  controller: injected,
}: {
  children: ReactNode;
  /** test hook: supply a pre-configured controller */
  controller?: VaultController;
}) {
  const [controller] = useState(() => injected ?? createDefaultController());
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  const [lockCountdown, setLockCountdown] = useState<number | null>(null);
  const [clipboardCountdown, setClipboardCountdown] = useState<number | null>(null);
  const [lastCopiedLabel, setLastCopiedLabel] = useState<string | null>(null);
  const [pendingTotpSecret, setPendingTotpSecret] = useState<string | null>(null);
  const [ackTick, setAckTick] = useState(0);
  const lastActivityRef = useRef<number>(0);
  const autoLockHoldsRef = useRef(0);
  const clipTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const status = snap.status;
  const settings = snap.data?.settings ?? DEFAULT_SETTINGS;

  // ask the browser once per page load to keep the vault's storage (it may clear site data when the disk is
  // nearly full). Only after unlock or create — Firefox shows a prompt; Chromium decides silently.
  const askedPersistRef = useRef(false);
  useEffect(() => {
    if (status !== 'unlocked' || askedPersistRef.current) return;
    askedPersistRef.current = true;
    void requestPersistence();
  }, [status]);
  const accounts = useMemo(() => (snap.data ? records.listAccounts(snap.data) : NO_ACCOUNTS), [snap.data]);
  const subscriptions = useMemo(
    () => (snap.data ? records.listSubscriptions(snap.data) : NO_SUBSCRIPTIONS),
    [snap.data],
  );
  const recordsWritable = snap.data
    ? records.canWrite(snap.data, 'accounts') && records.canWrite(snap.data, 'subscriptions')
    : false;

  /* ---------------- boot + browser lifecycle ---------------- */
  useEffect(() => {
    void controller.start();
    try {
      LEGACY_LOCAL_KEYS.forEach((k) => localStorage.removeItem(k)); // no-op "trusted device" flag
    } catch {
      /* storage blocked */
    }
  }, [controller]);

  // drop a half-finished authenticator enrollment secret whenever the vault
  // stops being unlocked (auto-lock, another tab, import…), not only on lock()
  useEffect(
    () =>
      controller.subscribe(() => {
        if (controller.getSnapshot().status !== 'unlocked') setPendingTotpSecret(null);
      }),
    [controller],
  );

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void controller.flush().catch(noop);
      else void controller.checkForExternalChanges();
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void controller.checkForExternalChanges();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.getSnapshot().save.unsaved) {
        void controller.flush().catch(noop);
        e.preventDefault();
        e.returnValue = ''; // legacy browsers need this to show the prompt
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [controller]);

  /* ---------------- auto-lock ---------------- */
  const autoLockMinutes = settings.autoLockMinutes;
  useEffect(() => {
    if (status !== 'unlocked' || autoLockMinutes <= 0) return;
    lastActivityRef.current = Date.now();
    const reset = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    const interval = setInterval(() => {
      if (autoLockHoldsRef.current > 0) lastActivityRef.current = Date.now();
      const left = autoLockMinutes * 60 - Math.floor((Date.now() - lastActivityRef.current) / 1000);
      setLockCountdown(Math.max(0, left));
      if (left <= 0) void controller.lock(); // idempotent
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearInterval(interval);
    };
  }, [status, autoLockMinutes, controller]);

  const holdAutoLock = useCallback(() => {
    autoLockHoldsRef.current += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      autoLockHoldsRef.current -= 1;
      lastActivityRef.current = Date.now(); // the idle clock starts over when the hold ends
    };
  }, []);

  /* ---------------- clipboard auto-clear ---------------- */
  useEffect(
    () => () => {
      if (clipTimer.current) clearInterval(clipTimer.current);
    },
    [],
  );

  const copyWithAutoClear = useCallback(
    async (text: string, label?: string) => {
      await navigator.clipboard.writeText(text);
      const secs =
        controller.getSnapshot().data?.settings.clipboardClearSeconds ?? DEFAULT_SETTINGS.clipboardClearSeconds;
      setLastCopiedLabel(label ?? null);
      setClipboardCountdown(secs);
      if (clipTimer.current) clearInterval(clipTimer.current);
      const deadline = Date.now() + secs * 1000;
      clipTimer.current = setInterval(() => {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        if (left > 0) {
          setClipboardCountdown(left);
          return;
        }
        if (clipTimer.current) clearInterval(clipTimer.current);
        clipTimer.current = null;
        void navigator.clipboard.writeText('').catch(noop);
        setClipboardCountdown(null);
        setLastCopiedLabel(null);
      }, 1000);
    },
    [controller],
  );

  /* ---------------- vault lifecycle ---------------- */
  const createVault = useCallback(
    async (password: string, opts?: { seedSample?: boolean }) => {
      const r = await controller.createVault(password, { entries: opts?.seedSample ? cloneSampleEntries() : [] });
      if (r === 'exists') throw new Error('A vault already exists on this device — unlock it or delete it first.');
      if (r !== 'ok') throw new Error('This browser refused to save the vault — please try again.');
      // a new vault has no backup yet: forget the last export / snooze of any earlier vault in this browser
      try {
        localStorage.removeItem(LAST_EXPORT_KEY);
        localStorage.removeItem(BACKUP_SNOOZE_KEY);
      } catch {
        /* storage blocked */
      }
    },
    [controller],
  );

  const unlock = useCallback(
    (password: string, factor?: SecondFactor) => controller.unlock(password, factor),
    [controller],
  );
  const lock = useCallback(() => {
    setPendingTotpSecret(null);
    return controller.lock();
  }, [controller]);
  const retryStorage = useCallback(() => controller.refresh(), [controller]);

  /* ---------------- entries & settings ---------------- */
  const addEntry = useCallback(
    (draft: NewEntryDraft): VaultEntry | null => {
      const now = new Date().toISOString();
      const entry: VaultEntry = {
        ...draft,
        id: draft.id ?? makeId(),
        updatedAt: draft.updatedAt ?? now,
        lastUsedAt: draft.lastUsedAt ?? now,
      };
      return controller.mutate((p) => {
        // undo after the login's account was removed: don't restore a dangling link
        const e = entry.accountId && !records.findAccount(p, entry.accountId) ? withoutAccountId(entry) : entry;
        return { ...p, entries: [e, ...p.entries] };
      })
        ? entry
        : null;
    },
    [controller],
  );

  const updateEntry = useCallback(
    (id: string, patch: Partial<VaultEntry>) =>
      controller.mutate((p) => ({
        ...p,
        entries: p.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e)),
      })),
    [controller],
  );

  const removeEntry = useCallback(
    (id: string) => controller.mutate((p) => ({ ...p, entries: p.entries.filter((e) => e.id !== id) })),
    [controller],
  );

  const toggleFavorite = useCallback(
    (id: string) =>
      controller.mutate((p) => ({
        ...p,
        entries: p.entries.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e)),
      })),
    [controller],
  );

  const updateSettings = useCallback(
    (patch: Partial<VaultSettings>) =>
      controller.mutate((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
    [controller],
  );

  /* ---------------- accounts & subscriptions ---------------- */
  /** apply a pure records operation; false (and no save) when it refuses */
  const tryMutate = useCallback(
    (op: (p: VaultPayload) => VaultPayload | null): boolean => {
      const current = controller.getSnapshot().data;
      if (!current || op(current) === null) return false;
      return controller.mutate((p) => op(p) ?? p);
    },
    [controller],
  );

  const saveSubscription = useCallback(
    (input: SaveSubscriptionInput): Subscription | null => {
      const current = controller.getSnapshot().data;
      if (!current) return null;
      const now = new Date().toISOString();
      const stored = input.id ? records.listSubscriptions(current).find((x) => x.id === input.id) : undefined;
      if (input.id && !stored) return null;
      const newAccount: Account | undefined =
        'create' in input.account ? { ...input.account.create, id: makeId(), createdAt: now, updatedAt: now } : undefined;
      const accountId = newAccount ? newAccount.id : 'id' in input.account ? input.account.id : '';
      const subscription: Subscription = {
        ...input.fields,
        id: stored?.id ?? makeId(),
        accountId,
        createdAt: stored?.createdAt ?? now,
        updatedAt: now,
      };
      const bundle: records.SubscriptionBundle = {
        newAccount,
        accountPatch: 'id' in input.account ? input.account.patch : undefined,
        linkEntryId: input.linkEntryId,
        subscription,
      };
      return tryMutate((p) => records.saveSubscriptionBundle(p, bundle, now)) ? subscription : null;
    },
    [controller, tryMutate],
  );

  const removeSubscription = useCallback(
    (id: string) => tryMutate((p) => records.removeSubscription(p, id)),
    [tryMutate],
  );
  const restoreSubscription = useCallback(
    (sub: Subscription) => tryMutate((p) => records.upsertSubscription(p, sub)),
    [tryMutate],
  );

  const addAccount = useCallback(
    (draft: AccountDraft): Account | null => {
      const now = new Date().toISOString();
      const account: Account = { ...draft, id: makeId(), createdAt: now, updatedAt: now };
      return tryMutate((p) => records.addAccount(p, account)) ? account : null;
    },
    [tryMutate],
  );
  const updateAccount = useCallback(
    (id: string, patch: AccountPatch) => {
      const now = new Date().toISOString();
      return tryMutate((p) => records.updateAccount(p, id, patch, now));
    },
    [tryMutate],
  );
  const removeAccount = useCallback(
    (id: string): 'ok' | 'has-subscriptions' | 'unavailable' => {
      const current = controller.getSnapshot().data;
      if (!current) return 'unavailable';
      const r = records.removeAccount(current, id);
      if (!r.ok) return r.reason === 'has-subscriptions' ? 'has-subscriptions' : 'unavailable';
      return tryMutate((p) => {
        const again = records.removeAccount(p, id);
        return again.ok ? again.payload : null;
      })
        ? 'ok'
        : 'unavailable';
    },
    [controller, tryMutate],
  );
  const linkLogin = useCallback(
    (entryId: string, accountId: string | null) => tryMutate((p) => records.linkLogin(p, entryId, accountId)),
    [tryMutate],
  );

  const flush = useCallback(() => controller.flush(), [controller]);
  const retrySave = useCallback(() => controller.retrySave(), [controller]);
  const discardUnsaved = useCallback(() => controller.discardUnsaved(), [controller]);
  const unsavedBackupText = useCallback(() => controller.unsavedBackupText(), [controller]);

  /* ---------------- authenticator ---------------- */
  const beginTotpEnrollment = useCallback((account = 'KeyHaven Vault') => {
    const secret = generateTotpSecret();
    setPendingTotpSecret(secret);
    return { secret, uri: totpUri(secret, account) };
  }, []);

  const confirmTotpEnrollment = useCallback(
    async (code: string, current?: SecondFactor): Promise<FactorResult> => {
      if (!pendingTotpSecret) return 'locked';
      const r = await controller.enableTotp(pendingTotpSecret, code, current);
      if (r === 'ok') setPendingTotpSecret(null);
      return r;
    },
    [controller, pendingTotpSecret],
  );

  const cancelTotpEnrollment = useCallback(() => setPendingTotpSecret(null), []);
  const disableTotp = useCallback((factor: SecondFactor) => controller.disableTotp(factor), [controller]);
  const regenerateBackupCodes = useCallback(() => controller.regenerateBackupCodes(), [controller]);

  /* ---------------- password, backup, danger zone ---------------- */
  const changeMasterPassword = useCallback(
    (current: string, next: string) => controller.changePassword(current, next),
    [controller],
  );
  const exportBackup = useCallback(() => controller.exportBackup(), [controller]);
  const importBackup = useCallback(
    (text: string, password: string) => controller.importBackup(text, password),
    [controller],
  );
  const restorePreviousVault = useCallback(() => controller.restorePrevious(), [controller]);
  const discardPreviousVault = useCallback(() => controller.discardPrevious(), [controller]);
  const destroyVault = useCallback(async () => {
    setPendingTotpSecret(null);
    await controller.destroy();
  }, [controller]);
  const dismissNotice = useCallback(() => controller.dismissNotice(), [controller]);

  /* ---------------- migration notice ---------------- */
  const acknowledged = useMemo(() => {
    void ackTick; // re-evaluate after dismiss
    return readAck(snap.vaultId);
  }, [snap.vaultId, ackTick]);
  const migrationNotice = status === 'unlocked' && snap.migratedFrom && !acknowledged ? snap.migratedFrom : null;
  const dismissMigrationNotice = useCallback(() => {
    if (snap.vaultId) {
      try {
        localStorage.setItem(MIGRATION_ACK_PREFIX + snap.vaultId, '1');
      } catch {
        /* storage blocked: the notice may show again next time */
      }
    }
    setAckTick((t) => t + 1);
  }, [snap.vaultId]);

  /* ---------------- context value ---------------- */
  const unlocked = status === 'unlocked';
  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      unavailableReason: snap.unavailableReason,
      unavailableDetail: snap.unavailableDetail,
      hasVault: snap.hasVault,
      entries: snap.data?.entries ?? NO_ENTRIES,
      accounts,
      subscriptions,
      recordsWritable,
      settings,
      backupCodes: snap.data?.recoveryCodes ?? NO_CODES,
      totpEnabled: snap.totpEnabled,
      legacyPasskeys: snap.legacyPasskeys,
      needsMigration: snap.needsMigration,
      save: snap.save,
      lockReason: snap.lockReason,
      busy: snap.busy,
      previousVault: snap.previous,
      notice: snap.notice,
      dismissNotice,
      migrationNotice,
      dismissMigrationNotice,
      lockCountdown: unlocked && autoLockMinutes > 0 ? lockCountdown : null,
      holdAutoLock,
      clipboardCountdown,
      lastCopiedLabel,
      createVault,
      unlock,
      lock,
      retryStorage,
      addEntry,
      updateEntry,
      removeEntry,
      toggleFavorite,
      updateSettings,
      saveSubscription,
      removeSubscription,
      restoreSubscription,
      addAccount,
      updateAccount,
      removeAccount,
      linkLogin,
      flush,
      retrySave,
      discardUnsaved,
      unsavedBackupText,
      beginTotpEnrollment,
      confirmTotpEnrollment,
      cancelTotpEnrollment,
      disableTotp,
      pendingTotpSecret: unlocked ? pendingTotpSecret : null,
      regenerateBackupCodes,
      changeMasterPassword,
      copyWithAutoClear,
      exportBackup,
      importBackup,
      restorePreviousVault,
      discardPreviousVault,
      destroyVault,
    }),
    [
      status, snap, settings, unlocked, autoLockMinutes, lockCountdown, holdAutoLock, clipboardCountdown, lastCopiedLabel,
      pendingTotpSecret, migrationNotice, dismissNotice, dismissMigrationNotice, createVault, unlock, lock,
      retryStorage, addEntry, updateEntry, removeEntry, toggleFavorite, updateSettings, flush, retrySave,
      discardUnsaved, unsavedBackupText, beginTotpEnrollment, confirmTotpEnrollment, cancelTotpEnrollment,
      disableTotp, regenerateBackupCodes, changeMasterPassword, copyWithAutoClear, exportBackup, importBackup,
      restorePreviousVault, discardPreviousVault, destroyVault, accounts, subscriptions, recordsWritable,
      saveSubscription, removeSubscription, restoreSubscription, addAccount, updateAccount, removeAccount, linkLogin,
    ],
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

/** Access the vault context. Must be used inside `<VaultProvider>`. */
export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be used within <VaultProvider>');
  return ctx;
}
