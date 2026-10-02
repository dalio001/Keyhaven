/**
 * Settings → Security methods → Change master password.
 *
 * Real re-encryption via the vault controller (changeMasterPassword):
 *  1. saves pending edits, then verifies the CURRENT password against the
 *     stored record
 *  2. derives a NEW key (fresh salt, PBKDF2 ×600k) and re-encrypts the
 *     latest vault contents and the authenticator secret
 *  3. commits atomically (compare-and-swap) and keeps the vault unlocked
 *     with the new key. Failures leave the old password working.
 * Backups exported earlier still open with the password used at the time.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { zxcvbn } from 'zxcvbn-ts';
import { useVault } from '@/providers/VaultProvider';
import { EASE, KhButton, SectionCard, Spinner } from './ui';

const SCORE_COLORS = ['#FF5C7A', '#FF5C7A', '#FFB84D', '#38E1FF', '#35F0A1'];
const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'];

function StrengthMeter({ password }: { password: string }) {
  const result = useMemo(() => (password ? zxcvbn(password) : null), [password]);
  const score = result?.score ?? 0;
  return (
    <div aria-live="polite">
      <div className="flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full transition-colors duration-200"
            style={{
              backgroundColor: result && i <= score ? SCORE_COLORS[score] : 'rgba(148,178,255,.12)',
            }}
          />
        ))}
      </div>
      {result && (
        <p className="mt-2 font-mono text-[11px]" style={{ color: SCORE_COLORS[score] }}>
          {SCORE_LABELS[score]}
          <span className="text-kh-faint">
            {' '}
            · ~{result.crack_times_display.offline_slow_hashing_1e5_per_second} to crack offline
          </span>
        </p>
      )}
    </div>
  );
}

function SecretInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-kh-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-kh-line bg-kh-inset px-4 pr-11 font-mono text-sm text-kh-primary outline-none transition-colors placeholder:text-kh-faint focus:border-kh-cyan/60"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-kh-faint transition-colors hover:text-kh-primary"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

type Phase = 'idle' | 'verifying' | 'reencrypting' | 'done';

export default function MasterPasswordCard({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
}) {
  const { changeMasterPassword } = useVault();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  const score = useMemo(() => (next ? zxcvbn(next).score : 0), [next]);
  const valid = current.length > 0 && next.length >= 8 && next === confirm && score >= 2;
  const mismatch = confirm.length > 0 && next !== confirm;
  const busy = phase === 'verifying' || phase === 'reencrypting';

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
    setPhase('idle');
  };

  const submit = async () => {
    if (!valid || busy) return;
    setError(null);
    setPhase('reencrypting');
    const result = await changeMasterPassword(current, next);
    if (result === 'ok') {
      setPhase('done');
      toast.success('Master password changed — vault re-encrypted and saved');
      return;
    }
    setPhase('idle');
    setError(
      result === 'bad-password'
        ? 'Current password is incorrect.'
        : result === 'conflict'
          ? 'The vault was changed in another tab or by an import, so nothing was changed. Unlock again and retry.'
          : result === 'locked'
            ? 'The vault locked before the change could be made — nothing was changed.'
            : "This browser's storage didn't accept the change — your old password still works. Try again.",
    );
  };

  return (
    <SectionCard
      id="master-password"
      title="Change master password"
      helper="The one secret that derives your vault key. Changing it re-encrypts everything, on this device."
    >
      {phase === 'done' ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="flex items-center gap-3 rounded-xl border border-kh-mint/30 bg-kh-mint/5 px-4 py-4"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-kh-mint" />
          <div>
            <p className="text-sm font-medium text-kh-primary">Vault re-encrypted with your new password.</p>
            <p className="mt-0.5 text-xs text-kh-muted">
              Use it from now on. Backups exported earlier still open with the old password — export a new one.
            </p>
          </div>
        </motion.div>
      ) : (
        <>
          <AnimatePresence initial={false}>
            {!expanded ? (
              <motion.div
                key="collapsed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-between rounded-xl border border-kh-line bg-kh-inset px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-kh-mint/30 bg-kh-mint/10">
                    <KeyRound className="h-4 w-4 text-kh-mint" />
                  </span>
                  <div>
                    <p className="font-mono text-sm text-kh-primary">••••••••••••</p>
                    <p className="font-mono text-[11px] text-kh-faint">PBKDF2-SHA256 · 600,000 iterations</p>
                  </div>
                </div>
                <KhButton variant="ghost" onClick={() => onExpandedChange(true)}>
                  Change
                </KhButton>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="space-y-4 rounded-xl border border-kh-line bg-kh-inset p-5">
                  <SecretInput id="mp-current" label="Current password" value={current} onChange={setCurrent} />
                  <div>
                    <SecretInput
                      id="mp-next"
                      label="New password"
                      value={next}
                      onChange={setNext}
                      placeholder="At least 8 characters"
                    />
                    <div className="mt-2.5">
                      <StrengthMeter password={next} />
                    </div>
                  </div>
                  <div>
                    <SecretInput id="mp-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} />
                    {mismatch && (
                      <p className="mt-2 text-xs text-kh-danger">Passwords don’t match yet.</p>
                    )}
                  </div>

                  <div className="flex items-start gap-3 rounded-xl border border-kh-warning/30 bg-kh-warning/5 p-3.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-kh-warning" />
                    <p className="text-sm leading-6 text-kh-muted">
                      Your vault is re-encrypted with a key from the new password. There is no recovery
                      if you forget it, so store it safely. Your authenticator keeps working.
                    </p>
                  </div>

                  {error && <p className="text-sm text-kh-danger">{error}</p>}

                  <div className="flex flex-wrap items-center gap-3">
                    <KhButton variant="primary" onClick={() => void submit()} disabled={!valid || busy}>
                      {busy ? (
                        <>
                          <Spinner />
                          <span className="font-mono text-xs">re-encrypting…</span>
                        </>
                      ) : (
                        'Re-encrypt & save'
                      )}
                    </KhButton>
                    <KhButton
                      variant="ghost"
                      onClick={() => {
                        onExpandedChange(false);
                        reset();
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </KhButton>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </SectionCard>
  );
}
