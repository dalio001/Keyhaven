/**
 * UnlockMode — Mode A of the vault gate (design/unlock.md).
 * Two method tabs: master password and authenticator (TOTP).
 * - Master password: mono input + eye toggle, caps-lock warning, honest
 *   KDF microcopy. The password alone derives the vault key.
 * - Authenticator: an extra check made by the app AFTER the password is
 *   verified. 6-box OTP with live 30s countdown ring; auto-submits on the 6th
 *   digit. A one-time authenticator backup code can replace the 6-digit code
 *   (lost phone) — it never replaces the master password.
 * - Failed attempts: counter chip after 2 fails; 5 fails pauses inputs for
 *   30s. This pause lives in memory only (a reload resets it); the real
 *   protection against guessing is the slow key derivation.
 * - Passkey unlock is disabled (its stored data could open the vault without
 *   the authenticator). Legacy vaults are upgraded at the next password unlock.
 * - "Forgot master password?" modal: explains that there is no recovery and
 *   offers a type-DELETE start-over that wipes the vault.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ScrambleText from '@/components/ScrambleText';
import VaultRing from '@/components/VaultRing';
import OtpInput from '@/components/unlock/OtpInput';
import { useVault } from '@/providers/VaultProvider';
import type { UnlockResult } from '@/providers/VaultProvider';
import { downloadBackupFile } from '@/lib/download';
import { cn } from '@/lib/utils';

type Method = 'password' | 'totp';

const LAST_METHOD_KEY = 'keyhaven.lastMethod';
const MAX_FAILS = 5;
const LOCK_SECONDS = 30;

export interface UnlockModeProps {
  /** parent starts the success ceremony (ring sweep → iris → /vault) */
  onSuccess: () => void;
  onSwitchToCreate: () => void;
  /** notify parent to flash the card border danger */
  onFail: () => void;
}

/** Plain-language message for every non-success unlock result. */
function unlockMessage(r: UnlockResult): string {
  switch (r) {
    case 'bad-password':
      return "That master password didn't match — try again.";
    case 'totp-invalid':
      return "That code didn't match — wait for a fresh one and try again.";
    case 'backup-code-invalid':
      return "That backup code didn't match or was already used.";
    case 'corrupt':
      return 'The stored vault failed its integrity check (damaged or altered). Nothing was changed.';
    case 'unsupported-version':
      return 'This vault was saved by a newer version of KeyHaven. Update KeyHaven to open it — nothing was changed.';
    case 'migration-failed':
      return "The one-time security upgrade couldn't be saved, so nothing was changed and the vault stays locked. Free up browser storage or close other KeyHaven tabs, then try again.";
    case 'storage-error':
      return "This browser's storage didn't respond — nothing was changed. Please try again.";
    case 'unsaved-pending':
      return 'Changes from your last session are not saved yet — retry saving or download them first (see above).';
    case 'no-vault':
      return 'There is no vault on this device any more.';
    case 'superseded':
      return 'The vault changed while unlocking — please try again.';
    default:
      return 'Unlock failed — please try again.';
  }
}

const COUNTS_AS_FAIL: UnlockResult[] = ['bad-password', 'totp-invalid', 'backup-code-invalid'];

/** 24px live TOTP countdown ring — strokes scrub in real time. */
function TotpCountdown() {
  const [remaining, setRemaining] = useState(() => 30 - ((Date.now() / 1000) % 30));
  useEffect(() => {
    const id = setInterval(() => setRemaining(30 - ((Date.now() / 1000) % 30)), 200);
    return () => clearInterval(id);
  }, []);
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex h-6 w-6 items-center justify-center" title="Codes refresh every 30 seconds">
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(148,178,255,.12)" strokeWidth="2" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={remaining <= 5 ? '#FF5C7A' : '#35F0A1'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - remaining / 30)}
        />
      </svg>
      <span className="absolute font-mono text-[9px] font-medium text-kh-faint">{Math.ceil(remaining)}</span>
    </span>
  );
}

const LOCK_REASON_TEXT: Record<string, string> = {
  'other-tab': 'Locked because KeyHaven was unlocked in another tab.',
  stale: 'Locked because the vault was changed in another tab — unlock to load the latest version.',
  replaced: 'The vault on this device was replaced (import or restore). Unlock it with its own master password.',
  deleted: 'The vault was deleted in another tab.',
};

/** Shown while the last session's encrypted changes have not reached storage. */
function UnsavedChangesBanner() {
  const { save, retrySave, discardUnsaved, unsavedBackupText } = useVault();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  if (!save.unsaved) return null;
  const text = unsavedBackupText();
  return (
    <div className="mt-4 rounded-xl border border-kh-warning/40 bg-kh-warning/10 p-3.5 text-left" role="alert">
      <p className="flex items-start gap-2 text-sm leading-[22px] text-kh-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {save.state === 'conflict'
          ? 'Your latest changes could not be saved because the vault was changed elsewhere (another tab, an import or a deletion).'
          : save.state === 'saving'
            ? 'Saving your latest changes…'
            : "Your latest changes haven't been saved to this browser yet."}
      </p>
      <p className="mt-1 text-xs leading-5 text-kh-muted">
        They are held in memory, encrypted with your master password. Closing this tab now would lose them.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {save.state !== 'conflict' && (
          <button
            type="button"
            onClick={retrySave}
            className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3 py-1.5 text-xs font-semibold text-kh-primary hover:bg-kh-elevated"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry saving
          </button>
        )}
        {text && (
          <button
            type="button"
            onClick={() => downloadBackupFile(text, 'unsaved-changes')}
            className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3 py-1.5 text-xs font-semibold text-kh-primary hover:bg-kh-elevated"
          >
            <Download className="h-3.5 w-3.5" /> Download encrypted copy
          </button>
        )}
        {confirmDiscard ? (
          <button
            type="button"
            onClick={() => void discardUnsaved()}
            className="rounded-full border border-kh-danger/50 px-3 py-1.5 text-xs font-semibold text-kh-danger hover:bg-kh-danger hover:text-[#1A0508]"
          >
            Yes, discard these changes
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDiscard(true)}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-kh-muted hover:text-kh-primary"
          >
            Discard…
          </button>
        )}
      </div>
    </div>
  );
}

export default function UnlockMode({ onSuccess, onSwitchToCreate, onFail }: UnlockModeProps) {
  const { unlock, totpEnabled, destroyVault, busy, needsMigration, legacyPasskeys, lockReason } = useVault();

  const validMethod = (m: string | null): Method => (m === 'totp' && totpEnabled ? 'totp' : 'password');

  const [method, setMethod] = useState<Method>(() =>
    validMethod(typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_METHOD_KEY) : null),
  );

  /* master password state */
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* totp state */
  const [pendingPassword, setPendingPassword] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [totpShake, setTotpShake] = useState(0);
  const [totpNotice, setTotpNotice] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');

  /* failed-attempt throttling (in memory only) */
  const [fails, setFails] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [lockRemaining, setLockRemaining] = useState(0);
  const locked = lockUntil !== null && lockRemaining > 0;

  /* forgot-password dialog */
  const [forgotOpen, setForgotOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const pwInputRef = useRef<HTMLInputElement>(null);
  const busyText = busy === 'migrating' ? 'one-time security upgrade · re-encrypting with a fresh key…' : null;

  useEffect(() => {
    if (lockUntil === null) return;
    const tick = () => {
      const left = Math.ceil((lockUntil - Date.now()) / 1000);
      if (left <= 0) {
        setLockUntil(null);
        setLockRemaining(0);
        setFails(0);
      } else {
        setLockRemaining(left);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [lockUntil]);

  const registerFail = () => {
    onFail();
    setFails((f) => {
      const n = f + 1;
      if (n >= MAX_FAILS) setLockUntil(Date.now() + LOCK_SECONDS * 1000);
      return n;
    });
  };

  const succeed = (m: Method) => {
    localStorage.setItem(LAST_METHOD_KEY, m);
    setPendingPassword(null);
    onSuccess();
  };

  const submitPassword = async () => {
    if (!password || pwBusy || locked) return;
    setPwBusy(true);
    setError(null);
    const res = await unlock(password);
    setPwBusy(false);
    if (res === 'ok') {
      succeed('password');
    } else if (res === 'totp-required') {
      setPendingPassword(password);
      setPassword('');
      setTotpNotice(true);
      setTotpError(null);
      setTotpCode('');
      setUseBackupCode(false);
      setMethod('totp');
    } else {
      if (COUNTS_AS_FAIL.includes(res)) registerFail();
      setError(unlockMessage(res));
    }
  };

  const submitSecondFactor = async (factor: { totp: string } | { backupCode: string }) => {
    if (!pendingPassword || totpBusy || locked) return;
    setTotpBusy(true);
    setTotpError(null);
    const res = await unlock(pendingPassword, factor);
    setTotpBusy(false);
    if (res === 'ok') {
      succeed('totp');
    } else if (res === 'totp-invalid' || res === 'backup-code-invalid') {
      registerFail();
      setTotpShake((k) => k + 1);
      setTotpCode('');
      setTotpError(unlockMessage(res));
    } else if (res === 'bad-password' || res === 'totp-required') {
      setPendingPassword(null);
      setMethod('password');
      setError('Please re-enter your master password to continue.');
    } else {
      setTotpError(unlockMessage(res));
    }
  };

  const startOver = async () => {
    if (deleteInput !== 'DELETE' || deleting) return;
    setDeleting(true);
    await destroyVault();
    setDeleting(false);
    setForgotOpen(false);
    setDeleteInput('');
    onSwitchToCreate();
  };

  const capsProps = {
    onKeyDown: (e: React.KeyboardEvent) => setCapsLock(e.getModifierState('CapsLock')),
    onKeyUp: (e: React.KeyboardEvent) => setCapsLock(e.getModifierState('CapsLock')),
  };

  const tabs = useMemo(
    () =>
      [
        { id: 'password' as Method, label: 'Master password', icon: KeyRound, disabled: false, tip: null as string | null },
        { id: 'totp' as Method, label: 'Authenticator', icon: Smartphone, disabled: !totpEnabled, tip: 'Authenticator not enabled for this vault' },
      ],
    [totpEnabled],
  );

  return (
    <div className="flex flex-col">
      {/* header block */}
      <div className="flex flex-col items-center text-center">
        <VaultRing size={64}>
          <Lock className="h-6 w-6 text-kh-mint" />
        </VaultRing>
        <h3 className="mt-4 font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
          <ScrambleText text="Welcome back." trigger="mount" speed={30} />
        </h3>
        <p className="mt-1.5 text-sm leading-[22px] text-kh-muted">
          Your vault is sealed. Unlock it with your master password.
        </p>
      </div>

      {lockReason && LOCK_REASON_TEXT[lockReason] && (
        <p className="mt-4 rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2.5 text-center text-xs leading-5 text-kh-muted" role="status">
          {LOCK_REASON_TEXT[lockReason]}
        </p>
      )}

      <UnsavedChangesBanner />

      {/* legacy vault: passkeys disabled, one-time upgrade on next password unlock */}
      {needsMigration && (
        <div className="mt-4 rounded-xl border border-kh-cyan/30 bg-kh-cyan/5 p-3.5 text-left">
          <p className="flex items-start gap-2 text-sm font-medium leading-[22px] text-kh-primary">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-kh-cyan" />
            {legacyPasskeys > 0 ? 'Passkey unlock has been turned off' : 'One-time security upgrade'}
          </p>
          <p className="mt-1 text-xs leading-5 text-kh-muted">
            {legacyPasskeys > 0
              ? 'The passkey data this vault stored could be used to open it without your fingerprint, face or PIN. Unlock with your master password: KeyHaven will re-encrypt the vault with a fresh key and delete that passkey data.'
              : 'When you unlock with your master password, KeyHaven re-encrypts this vault with a fresh key in its new storage format. Your logins are kept.'}
          </p>
        </div>
      )}

      {/* failed-attempt chip / pause notice */}
      <AnimatePresence>
        {(fails >= 2 || locked) && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                'mt-4 flex items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium',
                locked
                  ? 'border-kh-danger/40 bg-kh-danger/10 text-kh-danger'
                  : 'border-kh-warning/40 bg-kh-warning/10 text-kh-warning',
              )}
              role="status"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {locked
                ? `Too many attempts — unlocking is paused. Try again in ${lockRemaining}s.`
                : `${fails} failed attempts`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* method tabs */}
      <Tabs value={method} onValueChange={(v) => setMethod(v as Method)} className="mt-6">
        <TabsList className="grid w-full grid-cols-2 gap-1 rounded-xl border border-kh-line bg-kh-inset p-1">
          {tabs.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              disabled={t.disabled || locked}
              title={t.disabled ? (t.tip ?? undefined) : undefined}
              className="relative rounded-lg px-2 py-2 text-xs font-medium text-kh-muted transition-colors hover:text-kh-primary data-[state=active]:bg-transparent data-[state=active]:text-kh-primary data-[state=active]:shadow-none sm:text-[13px]"
            >
              <t.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t.label}</span>
              {method === t.id && !t.disabled && (
                <motion.span
                  layoutId="method-underline"
                  className="absolute inset-x-3 -bottom-[5px] h-0.5 rounded-full bg-kh-mint"
                  transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                />
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-6 min-h-[280px]">
        {/* TAB 1 — master password */}
        {method === 'password' && (
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="kh-master-pw" className="mb-1.5 block text-sm font-medium text-kh-primary">
                Master password
              </label>
              <div className="relative">
                <input
                  ref={pwInputRef}
                  id="kh-master-pw"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  disabled={locked || pwBusy}
                  aria-label="Master password"
                  autoComplete="current-password"
                  autoFocus
                  placeholder="••••••••••••"
                  {...capsProps}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    capsProps.onKeyDown(e);
                    if (e.key === 'Enter') void submitPassword();
                  }}
                  className="h-11 w-full rounded-md border border-kh-line bg-kh-inset px-3 pr-11 font-mono text-[15px] tracking-[0.02em] text-kh-primary placeholder:text-kh-faint focus:border-kh-cyan/60 focus:outline-none focus:ring-2 focus:ring-kh-cyan/25 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide master password' : 'Show master password'}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-kh-faint transition-colors hover:text-kh-primary"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <AnimatePresence>
                {capsLock && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-kh-warning/40 bg-kh-warning/10 px-2.5 py-1 text-[11px] font-medium text-kh-warning"
                  >
                    <AlertTriangle className="h-3 w-3" /> Caps Lock is on
                  </motion.div>
                )}
              </AnimatePresence>
              {/* honest KDF microcopy */}
              <p className="mt-2 font-mono text-[11px] leading-4 text-kh-faint">
                {pwBusy
                  ? (busyText ?? 'PBKDF2-SHA256 · 600,000 iterations · deriving key…')
                  : password
                    ? 'PBKDF2-SHA256 · 600k iterations — stretching is intentional.'
                    : 'Key derived locally — it never leaves this device.'}
              </p>
              {pwBusy && (
                <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-kh-inset">
                  <motion.div
                    className="h-full w-1/3 rounded-full bg-kh-mint/70"
                    animate={{ x: ['0%', '300%'] }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
                  />
                </div>
              )}
              {error && (
                <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 text-sm text-kh-danger" role="alert">
                  {error}
                </motion.p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void submitPassword()}
              disabled={!password || pwBusy || locked}
              className={cn(
                'bg-aurora flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#04110B] transition-all duration-200',
                'hover:-translate-y-px hover:shadow-glow active:scale-[0.97]',
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none',
              )}
            >
              {pwBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              Unlock vault
            </button>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="text-kh-muted underline-offset-4 transition-colors hover:text-kh-primary hover:underline"
              >
                Forgot master password?
              </button>
            </div>
          </div>
        )}

        {/* TAB 2 — authenticator */}
        {method === 'totp' && (
          <div className="flex flex-col gap-4">
            {pendingPassword ? (
              <>
                {!useBackupCode ? (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-sm font-medium text-kh-primary">Authenticator code</label>
                      <TotpCountdown />
                    </div>
                    <p className="mb-3 text-sm leading-[22px] text-kh-muted">
                      {totpNotice
                        ? 'Master password verified. Now open your authenticator app (e.g. Google Authenticator) and enter the 6-digit code for KeyHaven.'
                        : 'Open your authenticator app (e.g. Google Authenticator) and enter the 6-digit code for KeyHaven.'}
                    </p>
                    <OtpInput
                      value={totpCode}
                      onChange={(v) => {
                        setTotpCode(v);
                        setTotpError(null);
                      }}
                      onComplete={(v) => void submitSecondFactor({ totp: v })}
                      disabled={locked || totpBusy}
                      error={!!totpError}
                      shakeKey={totpShake}
                      autoFocus
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="kh-backup-code" className="mb-1.5 block text-sm font-medium text-kh-primary">
                      Authenticator backup code
                    </label>
                    <p className="mb-3 text-sm leading-[22px] text-kh-muted">
                      Lost your phone? Enter one of the one-time backup codes you saved. Each code works
                      once and is used up immediately.
                    </p>
                    <div className="flex gap-2">
                      <input
                        id="kh-backup-code"
                        value={backupCode}
                        onChange={(e) => {
                          setBackupCode(e.target.value.toUpperCase());
                          setTotpError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && backupCode) void submitSecondFactor({ backupCode });
                        }}
                        disabled={locked || totpBusy}
                        placeholder="XXXX-XXXX-XXXX"
                        autoComplete="off"
                        autoFocus
                        className="h-11 flex-1 rounded-md border border-kh-line bg-kh-inset px-3 font-mono text-[15px] tracking-[0.06em] text-kh-primary placeholder:text-kh-faint focus:border-kh-cyan/60 focus:outline-none focus:ring-2 focus:ring-kh-cyan/25"
                      />
                      <button
                        type="button"
                        onClick={() => void submitSecondFactor({ backupCode })}
                        disabled={!backupCode || locked || totpBusy}
                        className="rounded-md border border-kh-lineStrong px-4 text-sm font-medium text-kh-primary transition-colors hover:bg-kh-surface disabled:opacity-40"
                      >
                        Unlock
                      </button>
                    </div>
                  </div>
                )}
                {totpBusy && (
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-kh-faint">
                    <Loader2 className="h-3 w-3 animate-spin" /> {busyText ?? 'verifying…'}
                  </p>
                )}
                {totpError && (
                  <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-kh-danger" role="alert">
                    {totpError}
                  </motion.p>
                )}
                <p className="font-mono text-[11px] leading-4 text-kh-faint">
                  An extra check by this app — your vault is encrypted with your master password.
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setUseBackupCode((u) => !u);
                      setTotpError(null);
                      setBackupCode('');
                      setTotpCode('');
                    }}
                    className="font-mono text-[13px] text-kh-cyan underline-offset-4 transition-colors hover:text-kh-primary hover:underline"
                  >
                    {useBackupCode ? 'Use the authenticator app instead' : 'Lost your phone? Use a backup code'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <Smartphone className="h-8 w-8 text-kh-faint" />
                <p className="text-sm leading-[22px] text-kh-muted">
                  Your master password is verified first — then KeyHaven asks for
                  the 6-digit code from your authenticator app.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setMethod('password');
                    setTimeout(() => pwInputRef.current?.focus(), 60);
                  }}
                  className="rounded-full border border-kh-lineStrong px-4 py-2 text-sm font-medium text-kh-primary transition-colors hover:bg-kh-elevated"
                >
                  Enter master password
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* card footer */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-kh-line pt-4 text-sm">
        <span className="text-kh-muted">
          New here?{' '}
          <button type="button" onClick={onSwitchToCreate} className="font-semibold text-kh-mint underline-offset-4 hover:underline">
            Create a vault
          </button>
        </span>
        <Link to="/about" className="text-kh-muted underline-offset-4 transition-colors hover:text-kh-primary hover:underline">
          About the security
        </Link>
      </div>

      {/* forgot-password modal */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="border-kh-lineStrong bg-kh-elevated text-kh-primary sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Forgot your master password?</DialogTitle>
            <DialogDescription className="text-sm leading-[22px] text-kh-muted">
              KeyHaven cannot reset or recover it. Your vault key is derived only from your master
              password, which is never stored — not on this device and not anywhere else.
            </DialogDescription>
          </DialogHeader>

          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-[22px] text-kh-muted">
            <li>
              Authenticator backup codes only replace the 6-digit code. They cannot open the vault
              without the master password.
            </li>
            <li>
              An encrypted backup file opens only with the master password that was in use when it was
              exported — try older passwords you may have used.
            </li>
          </ul>

          <div className="my-1 h-px bg-kh-line" />

          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm leading-[22px] text-kh-muted">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-kh-danger" />
              Start over — permanently deletes the encrypted vault from this browser (including a
              previously replaced vault kept here). Without the password its contents are already
              unreadable; this just deletes them.
            </p>
            <div className="flex gap-2">
              <input
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder='Type DELETE to confirm'
                aria-label='Type DELETE to confirm vault deletion'
                className="h-11 flex-1 rounded-md border border-kh-danger/40 bg-kh-inset px-3 font-mono text-[15px] text-kh-danger placeholder:text-kh-faint focus:border-kh-danger focus:outline-none focus:ring-2 focus:ring-kh-danger/25"
              />
              <button
                type="button"
                onClick={() => void startOver()}
                disabled={deleteInput !== 'DELETE' || deleting}
                className="rounded-md border border-kh-danger/50 px-4 text-sm font-semibold text-kh-danger transition-colors hover:bg-kh-danger hover:text-[#1A0508] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-kh-danger"
              >
                {deleting ? 'Wiping…' : 'Delete vault'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
