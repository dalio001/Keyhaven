/**
 * /unlock — the vault gate (design/unlock.md). Dual mode:
 *   Mode A (default)     — Unlock: master password (+ authenticator code or backup code).
 *   Mode B (?mode=create) — Create Vault wizard (3 steps).
 *
 * Shell owns: the full-bleed unlock-vault.png backdrop (dimmed 40%, 2px
 * blur, Ken Burns drift), the center-stage 340px VaultRing whose mint arc
 * fills one third per wizard step, the glass card with AnimatePresence
 * cross-slide transitions, the success ceremony (dash sweep → lock flip →
 * iris-open → /vault), failed-attempt danger flashes, and the route guards
 * (already-unlocked → /vault; no-vault → create prompt).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AnimatePresence, animate, motion } from 'framer-motion';
import { AlertTriangle, Check, Loader2, Lock, RefreshCw, Unlock as UnlockIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import CursorRing from '@/components/CursorRing';
import VaultRing from '@/components/VaultRing';
import UnlockMode from '@/components/unlock/UnlockMode';
import CreateWizard from '@/components/unlock/CreateWizard';
import RestoreBackupPanel from '@/components/unlock/RestoreBackupPanel';
import { useVault } from '@/providers/VaultProvider';
import { cn } from '@/lib/utils';

const EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];
const QUINT = [0.83, 0, 0.17, 1] as [number, number, number, number];

/** mono type-in for the seal ceremony log lines */
function TypeIn({ text, delay = 0, speed = 18 }: { text: string; delay?: number; speed?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setN(text.length);
      return;
    }
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      let i = 0;
      interval = window.setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length && interval) window.clearInterval(interval);
      }, speed);
    }, delay * 1000);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
    };
  }, [text, delay, speed]);
  return <span>{text.slice(0, n)}</span>;
}

/** success ceremony inside the card: lock flip + (create) sealing log lines */
function CeremonyPanel({ kind }: { kind: 'unlock' | 'create' }) {
  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      <VaultRing size={96} progress={1}>
        <motion.span
          key={kind}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-kh-mint/15 text-kh-mint"
        >
          {kind === 'unlock' ? <UnlockIcon className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
        </motion.span>
      </VaultRing>

      {kind === 'unlock' ? (
        <div>
          <p className="font-display text-xl font-semibold text-kh-primary">Vault open.</p>
          <p className="mt-1.5 font-mono text-xs text-kh-faint">decrypted locally · only you hold the key</p>
        </div>
      ) : (
        <div className="space-y-2 text-left font-mono text-[13px] leading-5">
          {['deriving key…', 'encrypting vault…', 'sealed. only you hold the key.'].map((line, i) => (
            <p key={line} className="flex items-center gap-2 text-kh-faint">
              <TypeIn text={line} delay={0.15 + i * 0.25} />
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.15 + i * 0.25 + 0.28, type: 'spring', stiffness: 380, damping: 14 }}
              >
                <Check className="h-3.5 w-3.5 text-kh-mint" strokeWidth={3} />
              </motion.span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Unlock() {
  const { status, hasVault, unavailableReason, unavailableDetail, retryStorage, destroyVault } = useVault();
  const [showRestore, setShowRestore] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState('');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const mode: 'unlock' | 'create' = params.get('mode') === 'create' ? 'create' : 'unlock';

  const [ceremony, setCeremony] = useState<'unlock' | 'create' | null>(null);
  const [iris, setIris] = useState(false);
  const [ringProgress, setRingProgress] = useState(0);
  const [wizardStep, setWizardStep] = useState(1);
  const [dangerFlash, setDangerFlash] = useState(false);

  const ringProgressRef = useRef(0);
  const createdHereRef = useRef(false);
  const modeDirRef = useRef(1);

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* already-unlocked sessions go straight to the vault (unless this wizard
     just created it, or the ceremony is playing) */
  useEffect(() => {
    if (status === 'unlocked' && !createdHereRef.current && !ceremony) {
      navigate('/vault', { replace: true });
    }
  }, [status, ceremony, navigate]);

  /* ring fills one third per completed wizard step */
  useEffect(() => {
    if (ceremony) return;
    const v = mode === 'create' ? (wizardStep - 1) / 3 : 0;
    ringProgressRef.current = v;
    setRingProgress(v);
  }, [mode, wizardStep, ceremony]);

  /* success ceremony timeline: sweep → (log lines) → iris-open → /vault */
  useEffect(() => {
    if (!ceremony) return;
    const controls = animate(ringProgressRef.current, 1, {
      duration: 0.7,
      ease: QUINT,
      onUpdate: (v) => {
        ringProgressRef.current = v;
        setRingProgress(v);
      },
    });
    const irisDelay = ceremony === 'create' ? 1500 : 750;
    const t1 = window.setTimeout(() => {
      setIris(true);
      if (ceremony === 'create') {
        toast.success('Vault created. Add your first login.');
      }
    }, irisDelay);
    const t2 = window.setTimeout(() => {
      navigate('/vault', { state: { welcome: ceremony } });
    }, irisDelay + 600);
    return () => {
      controls.stop();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ceremony, navigate]);

  const flashDanger = useCallback(() => {
    setDangerFlash(true);
    window.setTimeout(() => setDangerFlash(false), 250);
  }, []);

  const switchMode = useCallback(
    (next: 'unlock' | 'create') => {
      modeDirRef.current = next === 'create' ? 1 : -1;
      setParams(next === 'create' ? { mode: 'create' } : {}, { replace: true });
    },
    [setParams],
  );

  const startCeremony = useCallback((kind: 'unlock' | 'create') => {
    setCeremony((prev) => prev ?? kind);
  }, []);

  const contentKey = ceremony
    ? `ceremony-${ceremony}`
    : status === 'loading'
      ? 'loading'
      : status === 'unavailable'
        ? 'unavailable'
        : mode === 'unlock'
        ? hasVault
          ? 'unlock'
          : 'no-vault'
        : 'create';

  return (
    <div className="noise-overlay relative -mt-[72px] flex min-h-[100dvh] flex-col overflow-hidden">
      {/* full-bleed backdrop: vault door, dimmed + blurred, Ken Burns drift */}
      <motion.div
        aria-hidden
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        <motion.img
          src="/unlock-vault.png"
          alt=""
          className="h-full w-full object-cover opacity-40 blur-[2px]"
          initial={{ scale: 1 }}
          animate={reducedMotion ? { scale: 1 } : { scale: [1, 1.06] }}
          transition={{ duration: 30, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(1200px circle at 50% 42%, rgba(5,8,15,.18), rgba(5,8,15,.9) 78%), linear-gradient(rgba(5,8,15,.5), rgba(5,8,15,.72))',
          }}
        />
      </motion.div>

      {/* center-stage vault ring behind the card */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={iris ? { opacity: 0, scale: 1.8 } : { opacity: 1, scale: 1 }}
          transition={iris ? { duration: 0.6, ease: QUINT } : { duration: 1.2, ease: EXPO }}
        >
          <VaultRing size={340} muted progress={ringProgress} />
        </motion.div>
      </div>

      {/* soft mint flash as the ring iris-opens */}
      {iris && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.45, 0] }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{
            background: 'radial-gradient(600px circle at 50% 45%, rgba(53,240,161,.5), transparent 65%)',
          }}
        />
      )}

      {/* stage */}
      <div className="relative flex flex-1 items-center justify-center px-4 pb-16 pt-[104px]">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15, ease: EXPO }}
          className={cn(
            'w-[min(480px,100%)] rounded-3xl border bg-[#0A0F1C]/[0.72] p-6 shadow-drawer backdrop-blur-[20px] transition-colors duration-200 sm:p-10',
            dangerFlash ? 'border-kh-danger/60' : 'border-kh-lineStrong',
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={contentKey}
              initial={{ opacity: 0, x: 40 * modeDirRef.current }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 * modeDirRef.current }}
              transition={{ duration: ceremony ? 0.15 : 0.3, ease: QUINT }}
            >
              {contentKey === 'loading' && (
                <div className="flex flex-col items-center gap-4 py-12 text-center">
                  <VaultRing size={72}>
                    <Loader2 className="h-6 w-6 animate-spin text-kh-mint" />
                  </VaultRing>
                  <p className="font-mono text-xs text-kh-faint">Reading your vault…</p>
                </div>
              )}

              {contentKey === 'no-vault' && (
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <VaultRing size={64}>
                    <Lock className="h-6 w-6 text-kh-mint" />
                  </VaultRing>
                  <h3 className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
                    No vault on this device yet.
                  </h3>
                  <p className="text-sm leading-[22px] text-kh-muted">
                    Create one — it takes about a minute, and everything stays
                    on this device.
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('create')}
                    className="bg-aurora mt-2 flex h-11 items-center justify-center rounded-xl px-6 text-sm font-semibold text-[#04110B] transition-all duration-200 hover:-translate-y-px hover:shadow-glow active:scale-[0.97]"
                  >
                    Create your vault
                  </button>
                  {showRestore ? (
                    <RestoreBackupPanel />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRestore(true)}
                      className="text-sm text-kh-muted underline-offset-4 transition-colors hover:text-kh-primary hover:underline"
                    >
                      Restore from an encrypted backup instead
                    </button>
                  )}
                </div>
              )}

              {contentKey === 'unavailable' && (
                <div className="flex flex-col items-center gap-4 py-4 text-center">
                  <VaultRing size={64}>
                    <AlertTriangle className="h-6 w-6 text-kh-warning" />
                  </VaultRing>
                  <h3 className="font-display text-xl font-semibold text-kh-primary">
                    {unavailableReason === 'invalid-record'
                      ? "The stored vault can't be read."
                      : unavailableReason === 'unsupported-version'
                        ? 'This vault needs a newer KeyHaven.'
                        : unavailableReason === 'blocked'
                          ? 'Close other KeyHaven tabs.'
                          : unavailableReason === 'superseded'
                            ? 'KeyHaven was updated in another tab.'
                            : "This browser's storage isn't available."}
                  </h3>
                  <p className="text-sm leading-[22px] text-kh-muted">
                    {unavailableReason === 'invalid-record'
                      ? 'The vault data in this browser is damaged or not a KeyHaven vault. Nothing was changed. You can restore an encrypted backup (the unreadable data is kept as the previous vault) or delete it.'
                      : unavailableReason === 'unsupported-version'
                        ? 'It was saved by a newer version of KeyHaven. Update KeyHaven to open it — it has not been changed.'
                        : unavailableReason === 'blocked'
                          ? 'A KeyHaven tab opened before this update is still using the vault storage. Close it so the storage can be upgraded — nothing has been changed.'
                          : unavailableReason === 'superseded'
                            ? 'A newer version of KeyHaven now owns this browser’s vault storage. Reload this page to continue.'
                            : 'KeyHaven could not open its storage (private browsing or blocked site data can cause this). Nothing was changed.'}
                  </p>
                  {unavailableDetail && (
                    <p className="font-mono text-[11px] leading-4 text-kh-faint">{unavailableDetail}</p>
                  )}
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => (unavailableReason === 'superseded' ? window.location.reload() : void retryStorage())}
                      className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-4 py-2 text-sm font-medium text-kh-primary hover:bg-kh-elevated"
                    >
                      <RefreshCw className="h-4 w-4" /> {unavailableReason === 'superseded' ? 'Reload' : 'Try again'}
                    </button>
                  </div>
                  {unavailableReason === 'invalid-record' && (
                    <>
                      <RestoreBackupPanel />
                      <div className="flex w-full gap-2">
                        <input
                          value={confirmWipe}
                          onChange={(e) => setConfirmWipe(e.target.value)}
                          placeholder="Type DELETE to wipe it"
                          aria-label="Type DELETE to delete the unreadable vault"
                          className="h-10 flex-1 rounded-md border border-kh-danger/40 bg-kh-inset px-3 font-mono text-sm text-kh-danger placeholder:text-kh-faint"
                        />
                        <button
                          type="button"
                          disabled={confirmWipe !== 'DELETE'}
                          onClick={() => void destroyVault().then(() => setConfirmWipe(''))}
                          className="rounded-md border border-kh-danger/50 px-3 text-sm font-semibold text-kh-danger disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {contentKey === 'unlock' && (
                <UnlockMode
                  onSuccess={() => startCeremony('unlock')}
                  onSwitchToCreate={() => switchMode('create')}
                  onFail={flashDanger}
                />
              )}

              {contentKey === 'create' && (
                <CreateWizard
                  onSuccess={() => startCeremony('create')}
                  onBackToUnlock={() => switchMode('unlock')}
                  onStepChange={setWizardStep}
                  onVaultCreated={() => {
                    createdHereRef.current = true;
                  }}
                  hasVault={hasVault && !createdHereRef.current}
                  onSwitchToUnlock={() => switchMode('unlock')}
                />
              )}

              {(contentKey === 'ceremony-unlock' || contentKey === 'ceremony-create') && (
                <CeremonyPanel kind={ceremony ?? 'unlock'} />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>

      <CursorRing />
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          style: { background: '#101828', border: '1px solid rgba(148,178,255,.18)', color: '#EAF0FA' },
        }}
      />
    </div>
  );
}