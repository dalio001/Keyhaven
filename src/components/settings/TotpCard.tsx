/**
 * Settings → Security methods → Authenticator app (TOTP) card.
 * Real enrollment: beginTotpEnrollment() → otpauth:// URI rendered as a real
 * scannable QR (qrcode.react), manual base32 fallback, 6-digit OTP confirm
 * (auto-submits), cancel. Disabling — and replacing (re-enrolling) — require
 * the CURRENT authenticator code or a one-time backup code, verified by the
 * vault. The authenticator is an extra check made by this app after the
 * master password; it is not part of the vault's encryption.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, Copy, Eye, EyeOff, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Input } from '@/components/ui/input';
import { useVault } from '@/providers/VaultProvider';
import { EASE, KhButton, SectionCard, Spinner, StatusChip } from './ui';
import { cn } from '@/lib/utils';

/** Chunk a base32 secret into groups of 4 for manual entry. */
function chunkSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

function OtpBoxes({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <motion.div
      animate={error ? { x: [0, -10, 10, -6, 6, 0] } : { x: 0 }}
      transition={{ duration: 0.4 }}
    >
      <InputOTP
        maxLength={6}
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        disabled={disabled}
        autoFocus={autoFocus}
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="Six-digit authenticator code"
        containerClassName="gap-2"
      >
        <InputOTPGroup className="gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <InputOTPSlot
              key={i}
              index={i}
              className={cn(
                'h-12 w-11 rounded-lg border bg-kh-inset font-mono text-lg text-kh-primary first:rounded-lg last:rounded-lg',
                error ? 'border-kh-danger' : 'border-kh-lineStrong',
              )}
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
    </motion.div>
  );
}

export default function TotpCard() {
  const {
    totpEnabled,
    beginTotpEnrollment,
    confirmTotpEnrollment,
    cancelTotpEnrollment,
    disableTotp,
    pendingTotpSecret,
    copyWithAutoClear,
  } = useVault();

  const [setup, setSetup] = useState<null | { secret: string; uri: string }>(null);
  const [showManual, setShowManual] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [disableOpen, setDisableOpen] = useState<null | 'disable' | 'replace'>(null);
  const [disableCode, setDisableCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [disableBusy, setDisableBusy] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // The setup panel renders only while the provider holds a pending secret —
  // a successful confirm or a cancel clears it and the panel closes itself.
  const setupActive = setup !== null && pendingTotpSecret !== null;

  const startSetup = () => {
    const { secret, uri } = beginTotpEnrollment('KeyHaven Vault');
    setSetup({ secret, uri });
    setCode('');
    setCodeError(false);
    setShowManual(false);
  };

  const cancelSetup = () => {
    cancelTotpEnrollment();
    setSetup(null);
    setCode('');
  };

  const submitCode = async (v: string) => {
    if (verifying) return;
    setVerifying(true);
    const result = await confirmTotpEnrollment(v);
    setVerifying(false);
    if (result === 'ok') {
      toast.success('Authenticator enabled — unlocking now also asks for a 6-digit code', {
        description: 'Save your backup codes below in case you lose your phone.',
      });
      setSetup(null);
      setCode('');
      setCodeError(false);
    } else if (result === 'save-failed') {
      toast.error("Code accepted, but this browser didn't save the change yet — KeyHaven keeps retrying");
      setSetup(null);
    } else {
      setCodeError(true);
      setTimeout(() => {
        setCode('');
        setCodeError(false);
      }, 450);
    }
  };

  const closeDisable = () => {
    setDisableOpen(null);
    setDisableCode('');
    setUseBackup(false);
    setDisableError(null);
  };

  const confirmDisable = async () => {
    if (disableBusy || !disableOpen) return;
    const mode = disableOpen;
    setDisableBusy(true);
    setDisableError(null);
    const result = await disableTotp(useBackup ? { backupCode: disableCode } : { totp: disableCode });
    setDisableBusy(false);
    if (result === 'invalid-code') {
      setDisableError(useBackup ? "That backup code didn't match or was already used." : "That code didn't match — try the current one.");
      setDisableCode('');
      return;
    }
    closeDisable();
    if (result === 'ok') {
      if (mode === 'replace') {
        toast.success('Old authenticator turned off — scan the new QR to turn it back on');
        startSetup();
      } else {
        toast.success('Authenticator disabled');
      }
    } else if (result === 'save-failed') {
      toast.error("The change wasn't saved to this browser yet — KeyHaven keeps retrying");
    }
  };

  return (
    <SectionCard
      id="totp"
      title="Authenticator app"
      helper="A 6-digit code from your phone, refreshed every 30 seconds — works with Google Authenticator, Authy, Microsoft Authenticator, and any TOTP app."
      headerAction={
        totpEnabled ? (
          <StatusChip tone="mint" pulse>
            <ShieldCheck className="h-3.5 w-3.5" /> Enabled
          </StatusChip>
        ) : (
          <StatusChip tone="faint">Not set up</StatusChip>
        )
      }
    >
      {/* enabled state */}
      {totpEnabled && !setupActive && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-kh-mint/25 bg-kh-mint/5 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-kh-mint/30 bg-kh-mint/10">
              <Smartphone className="h-4 w-4 text-kh-mint" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-medium text-kh-primary">Enabled</p>
              <p className="font-mono text-[11px] text-kh-faint">asked for after the master password at every unlock</p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-kh-mint" />
          </div>
          <div className="flex flex-wrap gap-3">
            <KhButton variant="secondary" onClick={() => setDisableOpen('replace')}>
              <RefreshCw className="h-4 w-4" /> Replace authenticator
            </KhButton>
            <KhButton variant="dangerGhost" onClick={() => setDisableOpen('disable')}>
              Disable
            </KhButton>
          </div>
        </div>
      )}

      {/* idle / not enabled state */}
      {!totpEnabled && !setupActive && (
        <div className="flex flex-wrap items-center gap-3">
          <KhButton variant="secondary" onClick={startSetup}>
            <Smartphone className="h-4 w-4" /> Set up authenticator
          </KhButton>
          <p className="text-xs text-kh-faint">
            Adds an extra check after your master password. Your vault is still encrypted with the
            master password alone.
          </p>
        </div>
      )}

      {/* setup flow */}
      <AnimatePresence>
        {setup !== null && pendingTotpSecret !== null && (
          <motion.div
            key="totp-setup"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-kh-line bg-kh-inset p-5">
              {/* STEP 1 — scan */}
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-kh-cyan">
                Step 1 — Scan
              </p>
              <div className="mt-3 flex flex-wrap items-start gap-5">
                <div className="relative overflow-hidden rounded-xl border border-kh-lineStrong bg-kh-base p-3">
                  <QRCodeSVG
                    value={setup.uri}
                    size={180}
                    bgColor="transparent"
                    fgColor="#35F0A1"
                    level="M"
                    aria-label="TOTP enrollment QR code"
                  />
                  {/* scan-line sweep */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-3 h-10 bg-gradient-to-b from-transparent via-kh-mint/25 to-transparent"
                    style={{ animation: 'kh-scan 2.5s ease-in-out infinite' }}
                  />
                  <style>{`@keyframes kh-scan { 0%,100% { top: 8%; } 50% { top: 78%; } }`}</style>
                </div>
                <div className="min-w-[220px] flex-1">
                  <p className="text-sm leading-6 text-kh-muted">
                    Point your authenticator app at this QR. It adds an entry named{' '}
                    <span className="text-kh-primary">KeyHaven · KeyHaven Vault</span>.
                  </p>
                  <button
                    onClick={() => setShowManual((s) => !s)}
                    className="mt-3 flex items-center gap-1.5 text-sm font-medium text-kh-cyan hover:text-kh-primary"
                  >
                    {showManual ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    Can’t scan? Enter manually
                  </button>
                  <AnimatePresence>
                    {showManual && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-kh-line bg-kh-base px-3 py-2.5">
                          <code className="flex-1 break-all font-mono text-sm tracking-wider text-kh-mint">
                            {chunkSecret(setup.secret)}
                          </code>
                          <button
                            onClick={() => {
                              void copyWithAutoClear(setup.secret, 'TOTP secret');
                              toast.success('Secret copied — clipboard clears itself');
                            }}
                            className="rounded-md p-1.5 text-kh-muted transition-colors hover:bg-kh-elevated hover:text-kh-primary"
                            aria-label="Copy secret"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* STEP 2 — confirm */}
              <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-kh-cyan">
                Step 2 — Confirm
              </p>
              <p className="mt-2 text-sm text-kh-muted">
                Enter the 6-digit code shown in your app.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <OtpBoxes
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    setCodeError(false);
                  }}
                  onComplete={(v) => void submitCode(v)}
                  error={codeError}
                  disabled={verifying}
                  autoFocus
                />
                {verifying && (
                  <span className="flex items-center gap-2 text-sm text-kh-muted">
                    <Spinner /> Verifying…
                  </span>
                )}
                {codeError && (
                  <span className="text-sm text-kh-danger">Code didn’t match — try the next one.</span>
                )}
              </div>
              <div className="mt-5 flex gap-3">
                <KhButton variant="ghost" onClick={cancelSetup} disabled={verifying}>
                  Cancel setup
                </KhButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* disable modal */}
      <Dialog
        open={disableOpen !== null}
        onOpenChange={(open) => {
          if (!open && !disableBusy) closeDisable();
        }}
      >
        <DialogContent className="border-kh-line bg-kh-elevated sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-kh-primary">
              {disableOpen === 'replace' ? 'Replace authenticator?' : 'Disable authenticator?'}
            </DialogTitle>
            <DialogDescription className="text-kh-muted">
              {disableOpen === 'replace'
                ? 'The current authenticator is turned off first, then you scan a new QR code. '
                : 'Unlocking will no longer ask for a 6-digit code. '}
              Confirm with the current code from your app — or one of your backup codes (it will be
              used up).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {useBackup ? (
              <Input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                aria-label="Backup code"
                autoComplete="off"
                autoFocus
                className="h-11 border-kh-line bg-kh-inset text-center font-mono tracking-[0.06em] text-kh-primary"
              />
            ) : (
              <OtpBoxes value={disableCode} onChange={setDisableCode} error={!!disableError} autoFocus />
            )}
            {disableError && <p className="text-sm text-kh-danger">{disableError}</p>}
            <button
              type="button"
              onClick={() => {
                setUseBackup((u) => !u);
                setDisableCode('');
                setDisableError(null);
              }}
              className="text-xs font-medium text-kh-cyan hover:text-kh-primary"
            >
              {useBackup ? 'Use the authenticator code instead' : 'Lost your phone? Use a backup code'}
            </button>
          </div>
          <DialogFooter>
            <KhButton variant="ghost" onClick={closeDisable} disabled={disableBusy}>
              Keep it
            </KhButton>
            <KhButton
              variant="danger"
              onClick={() => void confirmDisable()}
              disabled={disableBusy || (useBackup ? disableCode.replace(/[^A-Z0-9]/g, '').length !== 12 : disableCode.length !== 6)}
            >
              {disableBusy ? <Spinner /> : null}
              {disableOpen === 'replace' ? 'Continue' : 'Disable authenticator'}
            </KhButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
