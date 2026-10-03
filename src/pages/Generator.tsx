/**
 * /generator — the Password Forge (design/generator.md).
 * One-screen instrument: password / passphrase / PIN modes, scramble-in
 * regenerate animation, recipe controls, zxcvbn-scored strength panel with
 * entropy + crack time, session history, copy with auto-clear, save-to-vault
 * handoff. Keyboard-first: Space regenerates, C copies, 1/2/3 switch modes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVault } from '@/providers/VaultProvider';
import AppShell from '@/components/generator/AppShell';
import ScrambleOutput from '@/components/generator/ScrambleOutput';
import RecipeCard from '@/components/generator/RecipeCard';
import StrengthPanel from '@/components/generator/StrengthPanel';
import HistoryList from '@/components/generator/HistoryList';
import SaveBanner from '@/components/generator/SaveBanner';
import CopyToast from '@/components/generator/CopyToast';
import {
  DEFAULT_RECIPE,
  MODE_LABELS,
  entropyBits,
  forgeSecret,
  makeId,
} from '@/components/generator/genUtils';
import type { GenMode, HistoryItem, RecipeState } from '@/components/generator/genUtils';
import { offerSecret } from '@/lib/handoff';

const MODES: { key: GenMode; label: string }[] = [
  { key: 'password', label: 'Password' },
  { key: 'passphrase', label: 'Passphrase' },
  { key: 'pin', label: 'PIN' },
];

export default function Generator() {
  const navigate = useNavigate();
  const { copyWithAutoClear } = useVault();
  const reduce = useReducedMotion();
  const flashControls = useAnimationControls();

  const [mode, setMode] = useState<GenMode>('password');
  const [recipe, setRecipe] = useState<RecipeState>(DEFAULT_RECIPE);
  const modeRef = useRef(mode);
  const recipeRef = useRef(recipe);

  // first forge of the session (shared by the output + history seed)
  const [first] = useState(() => {
    const value = forgeSecret('password', DEFAULT_RECIPE);
    return { value, bits: entropyBits('password', DEFAULT_RECIPE) };
  });
  const [output, setOutput] = useState(first.value);
  const [runId, setRunId] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>(() => [
    { id: makeId(), value: first.value, mode: 'password', bits: first.bits, createdAt: Date.now() },
  ]);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  const debounceTimer = useRef<number | undefined>(undefined);
  const lastForgeAt = useRef(0);

  const bits = useMemo(() => entropyBits(mode, recipe), [mode, recipe]);

  /* ------------------------------ forging ------------------------------ */

  const forge = useCallback(
    (record: boolean) => {
      const m = modeRef.current;
      const r = recipeRef.current;
      const value = forgeSecret(m, r);
      const valueBits = entropyBits(m, r);
      setOutput(value);
      setRunId((n) => n + 1);
      if (record) {
        setHistory((h) =>
          [{ id: makeId(), value, mode: m, bits: valueBits, createdAt: Date.now() }, ...h].slice(0, 5),
        );
      }
      if (!reduce) {
        void flashControls.start({
          boxShadow: [
            '0 8px 32px rgba(0,0,0,.35), 0 0 0 rgba(53,240,161,0)',
            '0 8px 32px rgba(0,0,0,.35), 0 0 56px rgba(53,240,161,.28)',
            '0 8px 32px rgba(0,0,0,.35), 0 0 0 rgba(53,240,161,0)',
          ],
          transition: { duration: 0.3, ease: 'easeOut' },
        });
      }
    },
    [reduce, flashControls],
  );

  /** controls: scramble live (throttled 100ms) + settle with a history commit (150ms) */
  const scheduleForge = useCallback(() => {
    window.clearTimeout(debounceTimer.current);
    if (Date.now() - lastForgeAt.current >= 100) {
      lastForgeAt.current = Date.now();
      forge(false);
    }
    debounceTimer.current = window.setTimeout(() => {
      lastForgeAt.current = Date.now();
      forge(true);
    }, 150);
  }, [forge]);

  const updateRecipe = useCallback(
    (patch: Partial<RecipeState>) => {
      const next = { ...recipeRef.current, ...patch };
      recipeRef.current = next;
      setRecipe(next);
      scheduleForge();
    },
    [scheduleForge],
  );

  const forgeNow = useCallback(() => {
    window.clearTimeout(debounceTimer.current);
    lastForgeAt.current = Date.now();
    forge(true);
  }, [forge]);

  const switchMode = useCallback(
    (m: GenMode) => {
      if (m === modeRef.current) return;
      modeRef.current = m;
      setMode(m);
      forgeNow();
    },
    [forgeNow],
  );

  /* ------------------------------ copy / save ------------------------------ */

  const copy = useCallback(async () => {
    try {
      await copyWithAutoClear(output, 'Generated password');
    } catch {
      /* clipboard unavailable (non-secure context) */
    }
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1400);
  }, [copyWithAutoClear, output]);

  const copyItem = useCallback(
    (item: HistoryItem) => {
      copyWithAutoClear(item.value, `${MODE_LABELS[item.mode]} from history`).catch(() => undefined);
    },
    [copyWithAutoClear],
  );

  const saveToVault = useCallback(
    (value: string) => {
      // hand the secret over in memory only — never in the URL, history or storage (KH-01)
      offerSecret(value);
      navigate('/vault?new=1');
    },
    [navigate],
  );

  /* ------------------------------ keyboard ------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        // let native controls keep their keys (typing, button/switch activation)
        if (t.closest('input, textarea, select, [contenteditable]')) return;
        if (e.code === 'Space' && t.closest('button, [role="switch"], [role="slider"], a')) return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) forgeNow();
      } else if (e.key === 'c' || e.key === 'C') {
        void copy();
      } else if (e.key === '1') switchMode('password');
      else if (e.key === '2') switchMode('passphrase');
      else if (e.key === '3') switchMode('pin');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [forgeNow, copy, switchMode]);

  useEffect(
    () => () => {
      window.clearTimeout(debounceTimer.current);
      window.clearTimeout(copyTimer.current);
    },
    [],
  );

  /* ------------------------------ render ------------------------------ */

  return (
    <AppShell title="Generator">
      {/* page header */}
      <div className="mx-auto max-w-[860px]">
        <h2 className="font-display text-3xl font-bold tracking-[-0.02em] text-kh-primary sm:text-4xl">
          Generator
        </h2>
        <p className="mt-2 max-w-[60ch] text-[15px] leading-7 text-kh-muted">
          Randomness from your browser&rsquo;s crypto engine — generated locally, never stored until
          you say so.
        </p>
      </div>

      {/* Section 1 — output stage */}
      <motion.section
        animate={flashControls}
        className="mx-auto mt-8 max-w-[860px] rounded-3xl border border-kh-line bg-kh-surface p-6 shadow-card sm:p-10"
        aria-label="Generated output"
      >
        {/* mode tabs */}
        <div className="flex justify-center">
          <div
            className="inline-flex rounded-full border border-kh-line bg-kh-inset p-1"
            role="tablist"
            aria-label="Generator mode"
          >
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={mode === m.key}
                onClick={() => switchMode(m.key)}
                className="relative rounded-full px-4 py-1.5 text-sm font-medium transition-colors active:scale-95 sm:px-5"
              >
                {mode === m.key && (
                  <motion.span
                    layoutId="gen-mode-pill"
                    className="absolute inset-0 rounded-full bg-kh-mint"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span
                  className={cn(
                    'relative z-10',
                    mode === m.key ? 'text-[#04110B]' : 'text-kh-muted hover:text-kh-primary',
                  )}
                >
                  {m.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* the output — quick cross-fade on mode switch (remount), scramble on every forge */}
        <motion.div
          key={mode}
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="mt-4 sm:mt-6"
        >
          <ScrambleOutput text={output} runId={runId} mode={mode} />
        </motion.div>

        {/* action row */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3 sm:mt-6">
          <div className="mr-auto hidden items-center gap-4 text-xs text-kh-faint md:flex">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-md border border-kh-line bg-kh-inset px-1.5 py-0.5 font-mono text-[11px]">
                Space
              </kbd>
              regenerate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-md border border-kh-line bg-kh-inset px-1.5 py-0.5 font-mono text-[11px]">
                C
              </kbd>
              copy
            </span>
          </div>

          <button
            type="button"
            onClick={forgeNow}
            className="flex items-center gap-2 rounded-full border border-kh-lineStrong bg-kh-elevated px-5 py-2.5 text-sm font-medium text-kh-primary transition-all duration-200 hover:border-kh-mint/40 hover:text-kh-mint active:scale-[0.97]"
          >
            <motion.span
              className="flex"
              animate={{ rotate: reduce ? 0 : runId * 360 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <RefreshCw className="h-4 w-4" />
            </motion.span>
            Regenerate
          </button>

          <button
            type="button"
            onClick={() => void copy()}
            className="bg-aurora flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-[#04110B] transition-all duration-200 hover:-translate-y-px hover:shadow-glow active:scale-[0.97]"
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={copied ? 'check' : 'copy'}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </motion.span>
              </AnimatePresence>
            </span>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </motion.section>

      {/* Section 2 — controls (cards stagger in 100ms apart) */}
      <div className="mx-auto mt-6 grid max-w-[860px] gap-6 min-[900px]:grid-cols-2">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        >
          <RecipeCard mode={mode} recipe={recipe} onChange={updateRecipe} />
        </motion.div>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <StrengthPanel output={output} bits={bits} mode={mode} />
        </motion.div>
      </div>

      {/* Section 3 — session history */}
      <div className="mx-auto mt-10 max-w-[860px]">
        <HistoryList
          items={history}
          onCopy={copyItem}
          onSave={(item) => saveToVault(item.value)}
          onClear={() => setHistory([])}
        />
      </div>

      {/* Section 4 — save-to-vault CTA */}
      <div className="mx-auto mt-10 max-w-[860px]">
        <SaveBanner onSave={() => saveToVault(output)} />
      </div>

      <CopyToast />
    </AppShell>
  );
}