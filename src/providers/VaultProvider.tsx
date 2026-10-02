/**
 * KeyHaven VaultProvider — the single source of truth for vault state.
 *
 * Holds, in memory ONLY: the derived AES-GCM vault key and the decrypted
 * vault data. Persists to IndexedDB exclusively as an AES-GCM encrypted blob
 * (+ salt, KDF params, verifier, encrypted TOTP secret, wrapped passkeys).
 *
 * Provides: createVault / unlock (password + optional TOTP second factor) /
 * unlockWithPasskey / lock, entries CRUD, auto-lock countdown, clipboard
 * auto-clear, encrypted export/import, TOTP enrollment, passkey management,
 * recovery codes, danger-zone destroy.
 *
 * Usage:
 *   ```tsx
 *   const { status, entries, unlock, lock } = useVault();
 *   ```
 * `status`: 'loading' → 'no-vault' | 'locked' | 'unlocked'.
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
} from 'react';
import type { ReactNode } from 'react';
import {
  bufToB64,
  b64ToBuf,
  computeVerifier,
  decryptVault,
  deriveKey,
  encryptVault,
  generateBackupCodes,
  randomSalt,
} from '@/lib/crypto';
import { generateTotpSecret, totpUri, verifyTotp } from '@/lib/totp';
import { isPasskeyAvailable, registerPasskey, unwrapWithPasskey } from '@/lib/webauthn';
import type { WrappedKeyBlob } from '@/lib/webauthn';
import {
  clearVaultRecord,
  DEFAULT_SETTINGS,
  downloadVaultExport,
  loadVaultRecord,
  newVaultRecord,
  parseExportFile,
  saveVaultRecord,
} from '@/lib/vault';
import type { VaultData, VaultEntry, VaultRecord, VaultSettings } from '@/lib/vault';
import { cloneSampleEntries } from '@/lib/sampleData';

export type VaultStatus = 'loading' | 'no-vault' | 'locked' | 'unlocked';
export type UnlockResult = 'ok' | 'bad-password' | 'totp-required' | 'totp-invalid';

export interface VaultContextValue {
  status: VaultStatus;
  /** true once a vault record exists on this device */
  hasVault: boolean;
  entries: VaultEntry[];
  settings: VaultSettings;
  recoveryCodes: string[];
  totpEnabled: boolean;
  passkeys: WrappedKeyBlob[];
  /** seconds until auto-lock (null when timer inactive) */
  lockCountdown: number | null;
  /** seconds until the clipboard is wiped (null when inactive) */
  clipboardCountdown: number | null;
  lastCopiedLabel: string | null;

  createVault: (password: string, opts?: { seedSample?: boolean }) => Promise<void>;
  unlock: (password: string, totpCode?: string) => Promise<UnlockResult>;
  unlockWithPasskey: () => Promise<boolean>;
  lock: () => void;

  addEntry: (draft: NewEntryDraft) => VaultEntry;
  updateEntry: (id: string, patch: Partial<VaultEntry>) => void;
  removeEntry: (id: string) => void;
  toggleFavorite: (id: string) => void;

  updateSettings: (patch: Partial<VaultSettings>) => void;

  /** begin TOTP enrollment: returns secret + otpauth URI for QR display */
  beginTotpEnrollment: (account?: string) => { secret: string; uri: string };
  /** confirm enrollment with the first code from the authenticator app */
  confirmTotpEnrollment: (code: string) => Promise<boolean>;
  cancelTotpEnrollment: () => void;
  disableTotp: () => Promise<void>;
  pendingTotpSecret: string | null;

  passkeyAvailable: boolean;
  addPasskey: (name?: string) => Promise<boolean>;
  removePasskey: (credentialId: string) => Promise<void>;

  regenerateRecoveryCodes: () => void;

  copyWithAutoClear: (text: string, label?: string) => Promise<void>;
  exportVault: () => void;
  importVault: (file: File) => Promise<{ ok: boolean; error?: string }>;
  destroyVault: () => Promise<void>;
}

export type NewEntryDraft = Omit<VaultEntry, 'id' | 'updatedAt' | 'lastUsedAt'> &
  Partial<Pick<VaultEntry, 'id' | 'updatedAt' | 'lastUsedAt'>>;

const VaultContext = createContext<VaultContextValue | null>(null);

function makeId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>('loading');
  const [record, setRecord] = useState<VaultRecord | null>(null);
  const [data, setData] = useState<VaultData | null>(null);
  const [lockCountdown, setLockCountdown] = useState<number | null>(null);
  const [clipboardCountdown, setClipboardCountdown] = useState<number | null>(null);
  const [lastCopiedLabel, setLastCopiedLabel] = useState<string | null>(null);
  const [pendingTotpSecret, setPendingTotpSecret] = useState<string | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  const keyRef = useRef<CryptoKey | null>(null);
  const recordRef = useRef<VaultRecord | null>(null);
  const dataRef = useRef<VaultData | null>(null);
  const lastActivityRef = useRef<number>(0); // set on unlock + each activity event
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  recordRef.current = record;
  dataRef.current = data;

  /* ---------------- boot ---------------- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rec = await loadVaultRecord().catch(() => null);
      if (cancelled) return;
      setRecord(rec);
      setStatus(rec ? 'locked' : 'no-vault');
    })();
    void isPasskeyAvailable().then((ok) => {
      if (!cancelled) setPasskeyAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- persistence (encrypted blob only) ---------------- */
  const persist = useCallback(async (nextData: VaultData, patch?: Partial<VaultRecord>) => {
    const key = keyRef.current;
    const rec = recordRef.current;
    if (!key || !rec) return;
    const blob = await encryptVault(key, JSON.stringify(nextData));
    const next: VaultRecord = { ...rec, ...patch, blob };
    setRecord(next);
    recordRef.current = next;
    await saveVaultRecord(next);
  }, []);

  /** debounced persist after any in-memory data change while unlocked */
  const schedulePersist = useCallback(
    (nextData: VaultData) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => void persist(nextData), 250);
    },
    [persist],
  );

  /* ---------------- lock / unlock ---------------- */
  const lock = useCallback(() => {
    keyRef.current = null;
    setData(null);
    dataRef.current = null;
    setPendingTotpSecret(null);
    setLockCountdown(null);
    setStatus(recordRef.current ? 'locked' : 'no-vault');
  }, []);

  const createVault = useCallback(async (password: string, opts?: { seedSample?: boolean }) => {
    const salt = randomSalt();
    const key = await deriveKey(password, salt);
    const verifier = await computeVerifier(key);
    const initial: VaultData = {
      entries: opts?.seedSample ? cloneSampleEntries() : [],
      settings: { ...DEFAULT_SETTINGS },
      recoveryCodes: generateBackupCodes(8),
    };
    const blob = await encryptVault(key, JSON.stringify(initial));
    const rec = newVaultRecord(bufToB64(salt), verifier, blob);
    await saveVaultRecord(rec);
    keyRef.current = key;
    setRecord(rec);
    recordRef.current = rec;
    setData(initial);
    dataRef.current = initial;
    lastActivityRef.current = Date.now();
    setStatus('unlocked');
  }, []);

  const unlock = useCallback(async (password: string, totpCode?: string): Promise<UnlockResult> => {
    const rec = recordRef.current ?? (await loadVaultRecord().catch(() => null));
    if (!rec) return 'bad-password';
    let key: CryptoKey;
    try {
      key = await deriveKey(password, b64ToBuf(rec.salt), rec.kdf.iterations);
    } catch {
      return 'bad-password';
    }
    const verifier = await computeVerifier(key);
    if (verifier !== rec.verifier) return 'bad-password';

    // second factor: TOTP (Google Authenticator etc.)
    if (rec.totpEnabled && rec.totpSecretEncrypted) {
      if (!totpCode) return 'totp-required';
      try {
        const secret = await decryptVault(key, rec.totpSecretEncrypted);
        const ok = await verifyTotp(secret, totpCode);
        if (!ok) return 'totp-invalid';
      } catch {
        return 'totp-invalid';
      }
    }

    let decrypted: VaultData;
    try {
      decrypted = JSON.parse(await decryptVault(key, rec.blob)) as VaultData;
    } catch {
      return 'bad-password';
    }
    keyRef.current = key;
    setRecord(rec);
    recordRef.current = rec;
    setData({ ...decrypted, settings: { ...DEFAULT_SETTINGS, ...decrypted.settings } });
    dataRef.current = decrypted;
    lastActivityRef.current = Date.now();
    setStatus('unlocked');
    return 'ok';
  }, []);

  const unlockWithPasskey = useCallback(async (): Promise<boolean> => {
    const rec = recordRef.current ?? (await loadVaultRecord().catch(() => null));
    if (!rec?.passkeys?.length) return false;
    for (const blob of rec.passkeys) {
      const key = await unwrapWithPasskey(blob);
      if (!key) continue;
      try {
        const decrypted = JSON.parse(await decryptVault(key, rec.blob)) as VaultData;
        keyRef.current = key;
        setRecord(rec);
        recordRef.current = rec;
        setData({ ...decrypted, settings: { ...DEFAULT_SETTINGS, ...decrypted.settings } });
        dataRef.current = decrypted;
        lastActivityRef.current = Date.now();
        setStatus('unlocked');
        return true;
      } catch {
        // try next passkey
      }
    }
    return false;
  }, []);

  /* ---------------- entries CRUD ---------------- */
  const mutateData = useCallback(
    (fn: (d: VaultData) => VaultData) => {
      const cur = dataRef.current;
      if (!cur) return;
      const next = fn(cur);
      setData(next);
      dataRef.current = next;
      lastActivityRef.current = Date.now();
      schedulePersist(next);
    },
    [schedulePersist],
  );

  const addEntry = useCallback(
    (draft: NewEntryDraft): VaultEntry => {
      const now = new Date().toISOString();
      const entry: VaultEntry = {
        ...draft,
        id: draft.id ?? makeId(),
        updatedAt: draft.updatedAt ?? now,
        lastUsedAt: draft.lastUsedAt ?? now,
      };
      mutateData((d) => ({ ...d, entries: [entry, ...d.entries] }));
      return entry;
    },
    [mutateData],
  );

  const updateEntry = useCallback(
    (id: string, patch: Partial<VaultEntry>) => {
      mutateData((d) => ({
        ...d,
        entries: d.entries.map((e) =>
          e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e,
        ),
      }));
    },
    [mutateData],
  );

  const removeEntry = useCallback(
    (id: string) => {
      mutateData((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
    },
    [mutateData],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      mutateData((d) => ({
        ...d,
        entries: d.entries.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e)),
      }));
    },
    [mutateData],
  );

  const updateSettings = useCallback(
    (patch: Partial<VaultSettings>) => {
      mutateData((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    },
    [mutateData],
  );

  const regenerateRecoveryCodes = useCallback(() => {
    mutateData((d) => ({ ...d, recoveryCodes: generateBackupCodes(8) }));
  }, [mutateData]);

  /* ---------------- TOTP enrollment ---------------- */
  const beginTotpEnrollment = useCallback((account = 'KeyHaven Vault') => {
    const secret = generateTotpSecret();
    setPendingTotpSecret(secret);
    return { secret, uri: totpUri(secret, account) };
  }, []);

  const confirmTotpEnrollment = useCallback(
    async (code: string): Promise<boolean> => {
      const key = keyRef.current;
      const secret = pendingTotpSecret;
      if (!key || !secret) return false;
      const ok = await verifyTotp(secret, code);
      if (!ok) return false;
      const totpSecretEncrypted = await encryptVault(key, secret);
      const rec = recordRef.current;
      if (!rec) return false;
      const next: VaultRecord = { ...rec, totpSecretEncrypted, totpEnabled: true };
      setRecord(next);
      recordRef.current = next;
      await saveVaultRecord(next);
      setPendingTotpSecret(null);
      return true;
    },
    [pendingTotpSecret],
  );

  const cancelTotpEnrollment = useCallback(() => setPendingTotpSecret(null), []);

  const disableTotp = useCallback(async () => {
    const rec = recordRef.current;
    if (!rec) return;
    const next: VaultRecord = { ...rec, totpSecretEncrypted: undefined, totpEnabled: false };
    setRecord(next);
    recordRef.current = next;
    await saveVaultRecord(next);
  }, []);

  /* ---------------- passkeys ---------------- */
  const addPasskey = useCallback(async (name = 'Passkey'): Promise<boolean> => {
    const key = keyRef.current;
    const rec = recordRef.current;
    if (!key || !rec) return false;
    const blob = await registerPasskey(key, name);
    if (!blob) return false;
    const next: VaultRecord = { ...rec, passkeys: [...(rec.passkeys ?? []), blob] };
    setRecord(next);
    recordRef.current = next;
    await saveVaultRecord(next);
    return true;
  }, []);

  const removePasskey = useCallback(async (credentialId: string) => {
    const rec = recordRef.current;
    if (!rec) return;
    const next: VaultRecord = {
      ...rec,
      passkeys: (rec.passkeys ?? []).filter((p) => p.credentialId !== credentialId),
    };
    setRecord(next);
    recordRef.current = next;
    await saveVaultRecord(next);
  }, []);

  /* ---------------- auto-lock ---------------- */
  const autoLockMinutes = data?.settings.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes;
  useEffect(() => {
    if (status !== 'unlocked' || autoLockMinutes <= 0) {
      setLockCountdown(null);
      return;
    }
    lastActivityRef.current = Date.now();
    const reset = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    const interval = setInterval(() => {
      const total = autoLockMinutes * 60;
      const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      const left = total - elapsed;
      setLockCountdown(Math.max(0, left));
      if (left <= 0) lock();
    }, 1000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      clearInterval(interval);
    };
  }, [status, autoLockMinutes, lock]);

  /* ---------------- clipboard auto-clear ---------------- */
  const copyWithAutoClear = useCallback(async (text: string, label?: string) => {
    await navigator.clipboard.writeText(text);
    setLastCopiedLabel(label ?? null);
    const secs = dataRef.current?.settings.clipboardClearSeconds ?? DEFAULT_SETTINGS.clipboardClearSeconds;
    setClipboardCountdown(secs);
  }, []);

  useEffect(() => {
    if (clipboardCountdown === null) return;
    if (clipboardCountdown <= 0) {
      void navigator.clipboard.writeText('').catch(() => undefined);
      setClipboardCountdown(null);
      setLastCopiedLabel(null);
      return;
    }
    const t = setTimeout(() => setClipboardCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [clipboardCountdown]);

  /* ---------------- export / import / destroy ---------------- */
  const exportVault = useCallback(() => {
    const rec = recordRef.current;
    if (rec) downloadVaultExport(rec);
  }, []);

  const importVault = useCallback(
    async (file: File): Promise<{ ok: boolean; error?: string }> => {
      try {
        const text = await file.text();
        const rec = parseExportFile(text);
        await saveVaultRecord(rec);
        lock();
        setRecord(rec);
        recordRef.current = rec;
        setStatus('locked');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Import failed' };
      }
    },
    [lock],
  );

  const destroyVault = useCallback(async () => {
    await clearVaultRecord();
    keyRef.current = null;
    setData(null);
    dataRef.current = null;
    setRecord(null);
    recordRef.current = null;
    setStatus('no-vault');
  }, []);

  /* ---------------- context value ---------------- */
  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      hasVault: record !== null,
      entries: data?.entries ?? [],
      settings: data?.settings ?? DEFAULT_SETTINGS,
      recoveryCodes: data?.recoveryCodes ?? [],
      totpEnabled: !!record?.totpEnabled,
      passkeys: record?.passkeys ?? [],
      lockCountdown,
      clipboardCountdown,
      lastCopiedLabel,
      createVault,
      unlock,
      unlockWithPasskey,
      lock,
      addEntry,
      updateEntry,
      removeEntry,
      toggleFavorite,
      updateSettings,
      beginTotpEnrollment,
      confirmTotpEnrollment,
      cancelTotpEnrollment,
      disableTotp,
      pendingTotpSecret,
      passkeyAvailable,
      addPasskey,
      removePasskey,
      regenerateRecoveryCodes,
      copyWithAutoClear,
      exportVault,
      importVault,
      destroyVault,
    }),
    [
      status, record, data, lockCountdown, clipboardCountdown, lastCopiedLabel,
      createVault, unlock, unlockWithPasskey, lock, addEntry, updateEntry, removeEntry,
      toggleFavorite, updateSettings, beginTotpEnrollment, confirmTotpEnrollment,
      cancelTotpEnrollment, disableTotp, pendingTotpSecret, passkeyAvailable, addPasskey,
      removePasskey, regenerateRecoveryCodes, copyWithAutoClear, exportVault, importVault,
      destroyVault,
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