/**
 * CreateWizard — Mode B of the vault gate (design/unlock.md): the 3-step
 * Create Vault wizard.
 *   1. Master password — zxcvbn StrengthMeter, passphrase generator,
 *      no-recovery warning. Continuing derives the key and creates the
 *      (empty-entries + sample-seeded) encrypted vault locally. Creation
 *      never overwrites an existing vault.
 *   2. Authenticator (optional extra check by the app) — TOTP enrollment:
 *      real otpauth:// QR (qrcode.react), manual base32 entry, 6-digit
 *      confirm via confirmTotpEnrollment(). Skippable.
 *   3. Safety — authenticator backup codes (only when the authenticator was
 *      enabled): masked grid, download .txt, printable kit, copy-all; plus a
 *      required acknowledgement that a forgotten master password cannot be
 *      recovered → "Seal my vault" → parent success ceremony.
 * (Passkey registration was removed in Phase 1 — see docs/security-model.md.)
 */

import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  KeyRound,
  Loader2,
  Printer,
  QrCode,
  ShieldCheck,
  SkipForward,
  Sparkles,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { zxcvbn } from 'zxcvbn-ts';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import LiveScramble from '@/components/LiveScramble';
import OtpInput from '@/components/unlock/OtpInput';
import StrengthMeter from '@/components/unlock/StrengthMeter';
import { generatePassword } from '@/lib/crypto';
import { useVault } from '@/providers/VaultProvider';
import { cn } from '@/lib/utils';

const QUINT = [0.83, 0, 0.17, 1] as [number, number, number, number];
const EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

export interface CreateWizardProps {
  /** parent starts the 'create' success ceremony */
  onSuccess: () => void;
  /** back chevron on step 1 → return to Unlock mode */
  onBackToUnlock: () => void;
  /** report the current step (parent fills the backdrop ring per quarter) */
  onStepChange: (step: number) => void;
  /**
   * the wizard is creating (and unlocking) the vault — called BEFORE creation
   * starts, because the vault becomes unlocked before createVault() resolves
   * and the parent must not auto-redirect mid-wizard
   */
  onVaultCreated: () => void;
  /** creation failed (e.g. a vault already exists): undo onVaultCreated */
  onVaultCreateFailed?: () => void;
  /** a vault already exists on this device → edge banner */
  hasVault: boolean;
  onSwitchToUnlock: () => void;
}

export default function CreateWizard({
  onSuccess,
  onBackToUnlock,
  onStepChange,
  onVaultCreated,
  onVaultCreateFailed,
  hasVault,
  onSwitchToUnlock,
}: CreateWizardProps) {
  const {
    createVault,
    beginTotpEnrollment,
    confirmTotpEnrollment,
    cancelTotpEnrollment,
    backupCodes,
    copyWithAutoClear,
    destroyVault,
  } = useVault();

  const [step, setStep] = useState(1);
  const dirRef = useRef(1);

  /* replace-existing-vault dialog */
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceInput, setReplaceInput] = useState('');
  const [replacing, setReplacing] = useState(false);

  /* step 1 — master password */
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [infoShown, setInfoShown] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);

  /* step 2 — TOTP */
  const [totpChoice, setTotpChoice] = useState<'app' | 'skip' | null>(null);
  const [enroll, setEnroll] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [totpShake, setTotpShake] = useState(0);
  const [enrolled, setEnrolled] = useState(false);
  const [enrollSaveWarning, setEnrollSaveWarning] = useState(false);
  const [manual, setManual] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  /* step 3 — backup codes + no-recovery acknowledgement */
  const [vaultCreated, setVaultCreated] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [printBlocked, setPrintBlocked] = useState(false);

  const pwScore = useMemo(() => (password ? zxcvbn(password).score : 0), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canContinue1 =
    password.length > 0 && pwScore >= 3 && password === confirm && !creating && !hasVault && !vaultCreated;

  const goTo = (n: number) => {
    dirRef.current = n > step ? 1 : -1;
    setStep(n);
    onStepChange(n);
  };

  /* ---------------- step 1 ---------------- */
  const generatePassphrase = () => {
    const p = generatePassword({ mode: 'passphrase', words: 4 });
    setPassword(p);
    setConfirm('');
    setShowPw(true);
    setGenerated(p);
  };

  const continueStep1 = async () => {
    if (!canContinue1) return;
    setCreating(true);
    setCreateError(null);
    try {
      // derive the key + write the encrypted vault record right away, so the
      // remaining wizard steps (authenticator, backup codes) operate on it.
      // createVault never overwrites an existing vault.
      onVaultCreated();
      await createVault(password, { seedSample: true });
      setVaultCreated(true);
      goTo(2);
    } catch (err) {
      onVaultCreateFailed?.();
      setCreateError(err instanceof Error ? err.message : 'Could not create the vault on this device — please try again.');
    }
    setCreating(false);
  };

  /* ---------------- step 2 ---------------- */
  const chooseTotp = (c: 'app' | 'skip') => {
    // once a code was accepted the authenticator is on (it can be turned off
    // later in Settings with a code) — "Skip" would not undo it, so lock the choice
    if (enrolled) return;
    setTotpChoice(c);
    setTotpError(null);
    if (c === 'app') {
      if (!enroll) setEnroll(beginTotpEnrollment('KeyHaven Vault'));
    } else {
      cancelTotpEnrollment();
      setEnroll(null);
      setEnrolled(false);
      setTotpCode('');
    }
  };

  const submitEnrollCode = async (code: string) => {
    if (totpBusy || enrolled) return;
    setTotpBusy(true);
    setTotpError(null);
    const result = await confirmTotpEnrollment(code);
    setTotpBusy(false);
    if (result === 'ok' || result === 'save-failed') {
      // 'save-failed': the code was accepted and the authenticator is already
      // enabled in memory; the save is being retried — so it IS enrolled and the
      // backup codes must be shown in the next step
      setEnrolled(true);
      setEnrollSaveWarning(result === 'save-failed');
    } else {
      setTotpShake((k) => k + 1);
      setTotpCode('');
      setTotpError("That code didn't match — wait for a fresh one and try again.");
    }
  };

  const copySecret = async () => {
    if (!enroll) return;
    await copyWithAutoClear(enroll.secret, 'TOTP secret');
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  /* ---------------- step 3 ---------------- */
  const codes = backupCodes;

  const downloadTxt = () => {
    const text = [
      'KeyHaven — Authenticator backup codes',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      'Each code can be used ONCE instead of the 6-digit authenticator code,',
      'for example if you lose your phone. Your master password is still required.',
      'These codes CANNOT recover a forgotten master password.',
      'Store them offline, away from your master password.',
      '',
      ...codes.map((c, i) => `${String(i + 1).padStart(2, '0')}.  ${c}`),
      '',
      'KeyHaven is local-first — your vault is encrypted in this browser.',
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keyhaven-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printKit = () => {
    const win = window.open('', '_blank', 'width=720,height=900');
    if (!win) {
      setPrintBlocked(true);
      setTimeout(() => setPrintBlocked(false), 4000);
      return;
    }
    const rows = codes
      .map(
        (c, i) =>
          `<div style="border:1px dashed #94B2FF55;border-radius:8px;padding:10px 14px;font-family:ui-monospace,monospace;font-size:15px;letter-spacing:.06em;"><span style="color:#667;margin-right:10px;">${String(i + 1).padStart(2, '0')}</span>${c}</div>`,
      )
      .join('');
    win.document.write(`<!doctype html>
<html><head><title>KeyHaven backup codes</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#111;padding:40px;max-width:640px;margin:0 auto;">
  <h1 style="font-size:22px;margin:0 0 4px;">KeyHaven — authenticator backup codes</h1>
  <p style="color:#555;font-size:13px;margin:0 0 24px;">Printed ${new Date().toLocaleString()} · Store this sheet somewhere safe and offline.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${rows}</div>
  <p style="margin-top:28px;font-size:13px;color:#333;">Master password hint: <span style="display:inline-block;min-width:280px;border-bottom:1px solid #999;">&nbsp;</span></p>
  <p style="margin-top:20px;font-size:12px;color:#777;">Each code works once, instead of the 6-digit authenticator code. Your master password is still required — these codes cannot recover a forgotten master password, and KeyHaven cannot either.</p>
</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const copyAll = async () => {
    await copyWithAutoClear(codes.join('\n'), 'Backup codes');
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const replaceVault = async () => {
    if (replaceInput !== 'DELETE' || replacing) return;
    setReplacing(true);
    await destroyVault();
    setReplacing(false);
    setReplaceOpen(false);
    setReplaceInput('');
  };

  const mask = '••••-••••-••••';

  return (
    <div className="flex flex-col">
      {/* existing-vault edge banner */}
      <AnimatePresence>
        {hasVault && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mb-5 rounded-xl border border-kh-warning/40 bg-kh-warning/10 p-4">
              <p className="flex items-start gap-2 text-sm leading-[22px] text-kh-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                A vault already exists on this device.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onSwitchToUnlock}
                  className="rounded-full border border-kh-lineStrong px-4 py-1.5 text-xs font-semibold text-kh-primary transition-colors hover:bg-kh-elevated"
                >
                  Unlock it
                </button>
                <button
                  type="button"
                  onClick={() => setReplaceOpen(true)}
                  className="rounded-full border border-kh-danger/50 px-4 py-1.5 text-xs font-semibold text-kh-danger transition-colors hover:bg-kh-danger hover:text-[#1A0508]"
                >
                  Replace it (deletes existing)
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* wizard header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (step > 2 ? goTo(step - 1) : step === 1 ? onBackToUnlock() : undefined)}
          disabled={step === 2}
          title={step === 2 ? 'Your vault is already created — change the master password later in Settings' : undefined}
          aria-label="Back"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-kh-line text-kh-muted transition-colors hover:border-kh-lineStrong hover:text-kh-primary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-kh-faint">
          Step {step} of 3
        </span>
        <div className="ml-auto flex gap-1">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-1 w-8 overflow-hidden rounded-full bg-kh-inset">
              <motion.div
                className="h-full w-full origin-left rounded-full bg-kh-mint"
                initial={false}
                animate={{ scaleX: step >= n ? 1 : 0 }}
                transition={{ duration: 0.3, ease: EXPO }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* steps */}
      <div className="relative mt-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 40 * dirRef.current }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 * dirRef.current }}
            transition={{ duration: 0.3, ease: QUINT }}
          >
            {/* ---------------- STEP 1 — master password ---------------- */}
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
                    Create your master password.
                  </h3>
                  <p className="mt-1.5 text-sm leading-[22px] text-kh-muted">
                    The one password you'll remember. It never leaves your
                    device — it becomes the key that seals everything else.
                  </p>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="kh-new-pw" className="text-sm font-medium text-kh-primary">
                      Master password
                    </label>
                    <button
                      type="button"
                      onClick={generatePassphrase}
                      className="flex items-center gap-1.5 text-xs font-medium text-kh-cyan transition-colors hover:text-kh-primary"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Generate one for me
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="kh-new-pw"
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      autoFocus
                      autoComplete="new-password"
                      aria-label="New master password"
                      placeholder="A long password or passphrase"
                      onFocus={() => setInfoShown(true)}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setGenerated(null);
                      }}
                      className="h-11 w-full rounded-md border border-kh-line bg-kh-inset px-3 pr-11 font-mono text-[15px] tracking-[0.02em] text-kh-primary placeholder:text-kh-faint focus:border-kh-cyan/60 focus:outline-none focus:ring-2 focus:ring-kh-cyan/25"
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
                  {generated && (
                    <p className="mt-2 font-mono text-xs leading-5 text-kh-mint">
                      <LiveScramble text={generated} speed={18} /> — write it down, then hide it.
                    </p>
                  )}
                  <div className="mt-3">
                    <StrengthMeter password={password} />
                  </div>
                </div>

                <div>
                  <label htmlFor="kh-confirm-pw" className="mb-1.5 block text-sm font-medium text-kh-primary">
                    Confirm master password
                  </label>
                  <input
                    id="kh-confirm-pw"
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    autoComplete="new-password"
                    aria-label="Confirm master password"
                    placeholder="Type it once more"
                    onChange={(e) => setConfirm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void continueStep1();
                    }}
                    className={cn(
                      'h-11 w-full rounded-md border bg-kh-inset px-3 font-mono text-[15px] tracking-[0.02em] text-kh-primary placeholder:text-kh-faint focus:outline-none focus:ring-2',
                      mismatch
                        ? 'border-kh-danger/60 focus:border-kh-danger focus:ring-kh-danger/25'
                        : 'border-kh-line focus:border-kh-cyan/60 focus:ring-kh-cyan/25',
                    )}
                  />
                  {mismatch && (
                    <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 text-sm text-kh-danger" role="alert">
                      These don't match yet — retype the same password.
                    </motion.p>
                  )}
                </div>

                <AnimatePresence>
                  {infoShown && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.35, ease: EXPO }}
                      className="overflow-hidden"
                    >
                      <p className="flex items-start gap-2 rounded-xl border border-kh-warning/40 bg-kh-warning/10 p-3.5 text-sm leading-[22px] text-kh-warning">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        If you forget this, no one — not even us — can open your
                        vault. There is no recovery. Write it down somewhere safe.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {createError && (
                  <p className="text-sm text-kh-danger" role="alert">
                    {createError}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => void continueStep1()}
                  disabled={!canContinue1}
                  className={cn(
                    'bg-aurora flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#04110B] transition-all duration-200',
                    'hover:-translate-y-px hover:shadow-glow active:scale-[0.97]',
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none',
                  )}
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sealing your vault…
                    </>
                  ) : (
                    'Continue'
                  )}
                </button>
                {password.length > 0 && pwScore < 3 && (
                  <p className="-mt-2 text-center text-xs text-kh-faint">
                    Reach <span className="font-medium text-kh-cyan">Strong</span> to continue — longer is better.
                  </p>
                )}
              </div>
            )}

            {/* ---------------- STEP 2 — TOTP ---------------- */}
            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
                    Add an authenticator check.
                  </h3>
                  <p className="mt-1.5 text-sm leading-[22px] text-kh-muted">
                    After your master password, KeyHaven will also ask for a
                    6-digit code from your phone. It's an extra check by this
                    app — your vault is encrypted with your master password, so
                    keep that strong.
                  </p>
                </div>

                {/* option cards */}
                <div className="flex flex-col gap-3" role="radiogroup" aria-label="Second factor options">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={totpChoice === 'app'}
                    onClick={() => chooseTotp('app')}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors duration-200',
                      totpChoice === 'app'
                        ? 'border-kh-mint/60 bg-kh-mint/5'
                        : 'border-kh-line bg-kh-inset hover:border-kh-lineStrong',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        totpChoice === 'app' ? 'border-kh-mint' : 'border-kh-lineStrong',
                      )}
                    >
                      {totpChoice === 'app' && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                          className="h-2 w-2 rounded-full bg-kh-mint"
                        />
                      )}
                    </span>
                    <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-kh-mint" />
                    <span>
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-kh-primary">
                        Authenticator app
                        <span className="rounded-full bg-kh-mint/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kh-mint">
                          recommended
                        </span>
                      </span>
                      <span className="mt-1 block text-sm leading-[22px] text-kh-muted">
                        Google Authenticator, Authy, or any TOTP app.
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={totpChoice === 'skip'}
                    disabled={enrolled}
                    title={enrolled ? 'The authenticator is already on — turn it off later in Settings if needed' : undefined}
                    onClick={() => chooseTotp('skip')}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors duration-200',
                      totpChoice === 'skip'
                        ? 'border-kh-warning/60 bg-kh-warning/5'
                        : 'border-kh-line bg-kh-inset hover:border-kh-lineStrong',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                        totpChoice === 'skip' ? 'border-kh-warning' : 'border-kh-lineStrong',
                      )}
                    >
                      {totpChoice === 'skip' && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                          className="h-2 w-2 rounded-full bg-kh-warning"
                        />
                      )}
                    </span>
                    <SkipForward className="mt-0.5 h-5 w-5 shrink-0 text-kh-warning" />
                    <span>
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-kh-primary">
                        Skip for now
                        <span className="rounded-full bg-kh-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kh-warning">
                          not recommended
                        </span>
                      </span>
                      <span className="mt-1 block text-sm leading-[22px] text-kh-muted">
                        You can enable it later in Settings.
                      </span>
                    </span>
                  </button>
                </div>

                {/* QR enrollment section */}
                <AnimatePresence initial={false}>
                  {totpChoice === 'app' && enroll && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EXPO }}
                      className="overflow-hidden"
                    >
                      <div className="flex flex-col items-center gap-4 rounded-xl border border-kh-line bg-kh-inset p-4">
                        <div className="relative overflow-hidden rounded-xl bg-[#EAF0FA] p-3">
                          <QRCodeSVG value={enroll.uri} size={180} bgColor="#EAF0FA" fgColor="#0A0F1C" level="M" />
                          {/* scan-line sweep */}
                          <motion.div
                            aria-hidden
                            className="pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-kh-mint shadow-[0_0_12px_rgba(53,240,161,.8)]"
                            animate={{ top: ['8%', '92%'] }}
                            transition={{ duration: 2.5, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
                          />
                        </div>
                        <p className="text-center text-sm leading-[22px] text-kh-muted">
                          Scan with your authenticator app, then enter the
                          6-digit code it shows for <span className="font-semibold text-kh-primary">KeyHaven</span>.
                        </p>

                        <button
                          type="button"
                          onClick={() => setManual((m) => !m)}
                          className="font-mono text-xs text-kh-cyan underline-offset-4 transition-colors hover:text-kh-primary hover:underline"
                        >
                          {manual ? 'Hide the manual secret' : "Can't scan? Enter the secret manually"}
                        </button>
                        <AnimatePresence initial={false}>
                          {manual && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.3, ease: EXPO }}
                              className="w-full overflow-hidden"
                            >
                              <div className="flex items-center justify-between gap-3 rounded-lg border border-kh-line bg-kh-base px-3 py-2.5">
                                <code className="break-all font-mono text-[13px] tracking-[0.08em] text-kh-primary">
                                  {enroll.secret.match(/.{1,4}/g)?.join(' ')}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => void copySecret()}
                                  aria-label="Copy TOTP secret"
                                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-kh-faint transition-colors hover:text-kh-primary"
                                >
                                  {copiedSecret ? <Check className="h-4 w-4 text-kh-mint" /> : <Copy className="h-4 w-4" />}
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div className="flex flex-col items-start gap-2 self-start">
                          <OtpInput
                            value={totpCode}
                            onChange={(v) => {
                              setTotpCode(v);
                              setTotpError(null);
                            }}
                            onComplete={(v) => void submitEnrollCode(v)}
                            disabled={totpBusy || enrolled}
                            error={!!totpError}
                            shakeKey={totpShake}
                            success={enrolled}
                          />
                          {totpBusy && (
                            <p className="flex items-center gap-1.5 font-mono text-[11px] text-kh-faint">
                              <Loader2 className="h-3 w-3 animate-spin" /> verifying…
                            </p>
                          )}
                          {totpError && (
                            <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-kh-danger" role="alert">
                              {totpError}
                            </motion.p>
                          )}
                          {enrolled && (
                            <motion.p
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="flex items-center gap-1.5 text-sm font-medium text-kh-mint"
                            >
                              <ShieldCheck className="h-4 w-4" /> Authenticator enabled.
                            </motion.p>
                          )}
                          {enrolled && enrollSaveWarning && (
                            <p className="text-sm text-kh-warning" role="status">
                              This browser hasn't saved it yet — KeyHaven keeps retrying. Check the save status
                              before closing this tab.
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="button"
                  onClick={() => goTo(3)}
                  disabled={totpChoice === null || (totpChoice === 'app' && !enrolled)}
                  className={cn(
                    'bg-aurora flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#04110B] transition-all duration-200',
                    'hover:-translate-y-px hover:shadow-glow active:scale-[0.97]',
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none',
                  )}
                >
                  {totpChoice === 'skip' ? 'Skip & continue' : 'Confirm & continue'}
                </button>
              </div>
            )}

            {/* ---------------- STEP 3 — safety: backup codes + no recovery ---------------- */}
            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
                    Before you seal it.
                  </h3>
                  <p className="mt-1.5 text-sm leading-[22px] text-kh-muted">
                    Your master password is the only way to decrypt this vault.
                    KeyHaven cannot reset or recover it. Keep a copy somewhere
                    safe, and export encrypted backups from Settings.
                  </p>
                </div>

                {enrolled && (
                <>
                <p className="text-sm leading-[22px] text-kh-muted">
                  <span className="font-medium text-kh-primary">Authenticator backup codes.</span>{' '}
                  {codes.length} one-time codes — each can replace the 6-digit
                  code once if you lose your phone. They still require your
                  master password and cannot recover it.
                </p>

                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-kh-faint">
                    Backup codes
                  </span>
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => !r)}
                    className="flex items-center gap-1.5 text-xs font-medium text-kh-cyan transition-colors hover:text-kh-primary"
                  >
                    {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {revealed ? 'Hide' : 'Reveal'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {codes.map((code, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-center rounded-md border border-dashed border-kh-lineStrong bg-kh-inset px-2 py-2.5 font-mono text-[13px] tracking-[0.04em]"
                    >
                      {revealed ? (
                        <LiveScramble text={code} speed={14} className="text-kh-primary" />
                      ) : (
                        <span className="text-kh-faint" aria-label="Masked backup code">
                          {mask}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={downloadTxt}
                    className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3.5 py-2 text-xs font-semibold text-kh-primary transition-colors hover:bg-kh-elevated"
                  >
                    <FileDown className="h-3.5 w-3.5" /> Download .txt
                  </button>
                  <button
                    type="button"
                    onClick={printKit}
                    className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3.5 py-2 text-xs font-semibold text-kh-primary transition-colors hover:bg-kh-elevated"
                  >
                    <Printer className="h-3.5 w-3.5" /> Print codes
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyAll()}
                    className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3.5 py-2 text-xs font-semibold text-kh-primary transition-colors hover:bg-kh-elevated"
                  >
                    {copiedAll ? <Check className="h-3.5 w-3.5 text-kh-mint" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedAll ? 'Copied' : 'Copy all'}
                  </button>
                </div>
                {printBlocked && (
                  <p className="text-xs text-kh-warning">
                    Your browser blocked the print window — allow pop-ups for this page and try again.
                  </p>
                )}
                </>
                )}

                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="kh-saved"
                    checked={saved}
                    onCheckedChange={(v) => setSaved(v === true)}
                    className="mt-0.5 border-kh-lineStrong"
                  />
                  <label htmlFor="kh-saved" className="cursor-pointer select-none text-sm leading-[22px] text-kh-muted">
                    {enrolled
                      ? "I've saved my backup codes, and I understand KeyHaven cannot recover a forgotten master password."
                      : 'I understand KeyHaven cannot recover a forgotten master password.'}
                  </label>
                </div>

                <button
                  type="button"
                  onClick={onSuccess}
                  disabled={!saved}
                  className={cn(
                    'bg-aurora flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#04110B] transition-all duration-200',
                    'hover:-translate-y-px hover:shadow-glow active:scale-[0.97]',
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none',
                  )}
                >
                  <KeyRound className="h-4 w-4" />
                  Seal my vault
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* replace-vault danger dialog */}
      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent className="border-kh-lineStrong bg-kh-elevated text-kh-primary sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Replace the existing vault?</DialogTitle>
            <DialogDescription className="text-sm leading-[22px] text-kh-muted">
              This permanently deletes the encrypted vault on this device. If
              you don't know its master password, its contents are already
              unreadable — but deletion cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <input
              value={replaceInput}
              onChange={(e) => setReplaceInput(e.target.value)}
              placeholder='Type DELETE to confirm'
              aria-label='Type DELETE to confirm vault replacement'
              className="h-11 flex-1 rounded-md border border-kh-danger/40 bg-kh-inset px-3 font-mono text-[15px] text-kh-danger placeholder:text-kh-faint focus:border-kh-danger focus:outline-none focus:ring-2 focus:ring-kh-danger/25"
            />
            <button
              type="button"
              onClick={() => void replaceVault()}
              disabled={replaceInput !== 'DELETE' || replacing}
              className="rounded-md border border-kh-danger/50 px-4 text-sm font-semibold text-kh-danger transition-colors hover:bg-kh-danger hover:text-[#1A0508] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-kh-danger"
            >
              {replacing ? 'Deleting…' : 'Delete & start fresh'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}