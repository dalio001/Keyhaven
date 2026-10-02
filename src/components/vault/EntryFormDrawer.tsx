/**
 * EntryFormDrawer — add/edit drawer (vault.md §5). URL typeahead auto-fills
 * title + category; password field has an inline mini-generator popover
 * (length slider 8–40, symbols toggle, scramble preview, "Use this
 * password"); live StrengthMeter; category chip radio; optional TOTP secret
 * (otpauth URI auto-parse); notes auto-grow; favorite switch; save shows a
 * mono "sealing ✓" shimmer before closing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Dices, Eye, EyeOff, RefreshCw, Star, Trash2 } from 'lucide-react';
import type { VaultCategory } from '@/lib/vault';
import LiveScramble from '@/components/LiveScramble';
import { Slider } from '@/components/ui/slider';
import { generatePassword } from '@/lib/crypto';
import { cn } from '@/lib/utils';
import StrengthMeter from './StrengthMeter';
import VaultDrawer from './VaultDrawer';
import { FieldError, Label } from './form-fields';
import { inputCls } from './form-styles';
import { CATEGORY_META, CATEGORY_ORDER, parseTotpInput } from './vault-utils';
import type { EntryExt } from './vault-utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

export interface EntryFormDraft {
  title: string;
  url: string;
  username: string;
  password: string;
  category: VaultCategory;
  favorite: boolean;
  notes: string;
  totp: boolean;
  totpSecret?: string;
}

/* ------------------------------------------------------------------ */
/* popular-domain typeahead data                                       */
/* ------------------------------------------------------------------ */

const POPULAR: { domain: string; title: string; category: VaultCategory }[] = [
  { domain: 'github.com', title: 'GitHub', category: 'work' },
  { domain: 'gmail.com', title: 'Gmail', category: 'other' },
  { domain: 'figma.com', title: 'Figma', category: 'work' },
  { domain: 'notion.so', title: 'Notion', category: 'work' },
  { domain: 'slack.com', title: 'Slack', category: 'work' },
  { domain: 'netflix.com', title: 'Netflix', category: 'streaming' },
  { domain: 'spotify.com', title: 'Spotify', category: 'streaming' },
  { domain: 'hulu.com', title: 'Hulu', category: 'streaming' },
  { domain: 'amazon.com', title: 'Amazon', category: 'shopping' },
  { domain: 'ebay.com', title: 'eBay', category: 'shopping' },
  { domain: 'linkedin.com', title: 'LinkedIn', category: 'social' },
  { domain: 'x.com', title: 'X / Twitter', category: 'social' },
  { domain: 'discord.com', title: 'Discord', category: 'social' },
  { domain: 'reddit.com', title: 'Reddit', category: 'social' },
  { domain: 'chase.com', title: 'Chase Bank', category: 'finance' },
  { domain: 'paypal.com', title: 'PayPal', category: 'finance' },
  { domain: 'coinbase.com', title: 'Coinbase', category: 'finance' },
];

/* ------------------------------------------------------------------ */
/* inline mini generator popover                                       */
/* ------------------------------------------------------------------ */

function MiniGenerator({ onUse }: { onUse: (password: string) => void }) {
  const [length, setLength] = useState(20);
  const [symbols, setSymbols] = useState(true);
  const [preview, setPreview] = useState(() =>
    generatePassword({ length: 20, symbols: true, upper: true, lower: true, digits: true }),
  );
  const regen = (len: number, sym: boolean) =>
    setPreview(generatePassword({ length: len, symbols: sym, upper: true, lower: true, digits: true }));

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.2, ease: EASE }}
      className="flex flex-col gap-3 rounded-xl border border-kh-lineStrong bg-kh-surface p-3.5 shadow-card"
    >
      <div className="flex items-center gap-2 rounded-lg border border-kh-line bg-kh-inset px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[15px] text-kh-mint">
          <LiveScramble text={preview} speed={18} />
        </span>
        <button
          type="button"
          aria-label="Regenerate password"
          onClick={() => regen(length, symbols)}
          className="shrink-0 rounded-md p-1.5 text-kh-muted transition-colors hover:bg-kh-elevated hover:text-kh-primary"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <span className="shrink-0 font-mono text-[11px] text-kh-faint">{length} chars</span>
        <Slider
          value={[length]}
          min={8}
          max={40}
          step={1}
          onValueChange={(v) => {
            setLength(v[0]);
            regen(v[0], symbols);
          }}
          aria-label="Password length"
          className="flex-1"
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={symbols}
          onClick={() => {
            const next = !symbols;
            setSymbols(next);
            regen(length, next);
          }}
          className="flex items-center gap-2 text-sm text-kh-muted transition-colors hover:text-kh-primary"
        >
          <span
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors',
              symbols ? 'bg-kh-mint/80' : 'bg-kh-elevated border border-kh-lineStrong',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                symbols ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </span>
          Symbols
        </button>
        <button
          type="button"
          onClick={() => onUse(preview)}
          className="bg-aurora rounded-lg px-3 py-1.5 text-xs font-semibold text-[#04110B] transition-all hover:-translate-y-px hover:brightness-110"
        >
          Use this password
        </button>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* the form (remounted per entry / mode via key)                       */
/* ------------------------------------------------------------------ */

function FormBody({
  mode,
  entry,
  initialPassword,
  onSave,
  onDelete,
  onValidityChange,
}: {
  mode: 'add' | 'edit';
  entry: EntryExt | null;
  initialPassword?: string;
  onSave: (draft: EntryFormDraft) => void;
  onDelete?: (entry: EntryExt) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [title, setTitle] = useState(entry?.title ?? '');
  const [url, setUrl] = useState(entry?.url ?? '');
  const [username, setUsername] = useState(entry?.username ?? '');
  const [password, setPassword] = useState(entry?.password ?? initialPassword ?? '');
  const [category, setCategory] = useState<VaultCategory>(entry?.category ?? 'other');
  const [favorite, setFavorite] = useState(entry?.favorite ?? false);
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [totpInput, setTotpInput] = useState('');
  const [totpOn, setTotpOn] = useState(!!entry?.totp);
  const [showTotp, setShowTotp] = useState(!!entry?.totp);

  const [pwVisible, setPwVisible] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [pwFlash, setPwFlash] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  // fresh array identity per failed submit → the shake re-triggers exactly once
  const [shakeFrames, setShakeFrames] = useState<number[]>([0]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // URL typeahead
  const [urlFocus, setUrlFocus] = useState(false);
  const [urlIndex, setUrlIndex] = useState(0);
  const suggestions = useMemo(() => {
    const q = url.trim().toLowerCase().replace(/^https?:\/\//, '');
    if (!q) return [];
    return POPULAR.filter((p) => p.domain.includes(q) || p.title.toLowerCase().includes(q)).slice(0, 6);
  }, [url]);

  // opening the 2FA panel puts the cursor in the secret and scrolls the panel into view, so the
  // click can't look like it did nothing when the panel opens below the visible area (KH-05)
  const totpInputRef = useRef<HTMLInputElement>(null);
  const totpPanelRef = useRef<HTMLDivElement>(null);
  const revealTotp = useRef(false);
  useEffect(() => {
    if (!showTotp || !revealTotp.current) return;
    revealTotp.current = false;
    totpInputRef.current?.focus({ preventScroll: true });
    const t = window.setTimeout(() => totpPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }), 350);
    return () => window.clearTimeout(t);
  }, [showTotp]);

  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = notesRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.max(el.scrollHeight, 88)}px`;
    }
  }, [notes]);

  const titleValid = title.trim().length > 0;
  const usernameValid = username.trim().length > 0;
  const passwordValid = password.length > 0;
  const formValid = titleValid && usernameValid && passwordValid;

  useEffect(() => {
    onValidityChange(formValid);
  }, [formValid, onValidityChange]);

  const pickSuggestion = (s: (typeof POPULAR)[number]) => {
    setUrl(`https://${s.domain}`);
    if (!title.trim()) setTitle(s.title);
    setCategory(s.category);
    setUrlFocus(false);
  };

  const useGenerated = (pw: string) => {
    setPassword(pw);
    setPwVisible(true);
    setGenOpen(false);
    setPwFlash(true);
    setTimeout(() => setPwFlash(false), 700);
  };

  const submit = () => {
    setAttempted(true);
    if (saving) return;
    if (!formValid) {
      setShakeFrames([0, -5, 5, -5, 5, 0]);
      return;
    }
    setSaving(true);
    const parsedSecret = totpOn ? parseTotpInput(totpInput) : null;
    onSave({
      title: title.trim(),
      url: url.trim(),
      username: username.trim(),
      password,
      category,
      favorite,
      notes: notes.trim(),
      totp: totpOn && (parsedSecret !== null || (mode === 'edit' && !!entry?.totp)),
      totpSecret: parsedSecret ?? (mode === 'edit' ? entry?.totpSecret : undefined),
    });
  };

  const fieldMotion = (invalid: boolean, i: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, x: attempted && invalid ? shakeFrames : 0 },
    transition: { duration: 0.35, ease: EASE, delay: 0.06 + i * 0.04, x: { duration: 0.3, delay: 0 } },
  });

  return (
    <form
      id="entry-form"
      className="flex flex-col gap-4 p-6 pt-0"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      {/* 1 — title */}
      <motion.div key="f-title" {...fieldMotion(!titleValid, 0)} className="flex flex-col gap-1.5">
        <Label htmlFor="ef-title">Title</Label>
        <input
          id="ef-title"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Netflix"
          className={cn(inputCls, attempted && !titleValid && 'border-kh-danger/60')}
        />
        <FieldError show={attempted && !titleValid}>A title is required.</FieldError>
      </motion.div>

      {/* 2 — url + typeahead */}
      <motion.div key="f-url" {...fieldMotion(false, 1)} className="relative flex flex-col gap-1.5">
        <Label htmlFor="ef-url">Website URL</Label>
        <input
          id="ef-url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlIndex(0);
            setUrlFocus(true);
          }}
          onFocus={() => setUrlFocus(true)}
          onBlur={() => window.setTimeout(() => setUrlFocus(false), 150)}
          onKeyDown={(e) => {
            if (!suggestions.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setUrlIndex((i) => (i + 1) % suggestions.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setUrlIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
            } else if (e.key === 'Enter' && urlFocus && suggestions[urlIndex]) {
              e.preventDefault();
              pickSuggestion(suggestions[urlIndex]);
            }
          }}
          placeholder="https://example.com"
          inputMode="url"
          className={inputCls}
        />
        <AnimatePresence>
          {urlFocus && suggestions.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-kh-lineStrong bg-kh-elevated shadow-drawer"
              role="listbox"
            >
              {suggestions.map((s, i) => (
                <li key={s.domain}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === urlIndex}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickSuggestion(s)}
                    onMouseEnter={() => setUrlIndex(i)}
                    className={cn(
                      'flex w-full items-center justify-between px-3.5 py-2.5 text-left text-sm transition-colors',
                      i === urlIndex ? 'bg-kh-surface text-kh-primary' : 'text-kh-muted',
                    )}
                  >
                    <span>{s.title}</span>
                    <span className="font-mono text-xs text-kh-faint">{s.domain}</span>
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 3 — username */}
      <motion.div key="f-user" {...fieldMotion(!usernameValid, 2)} className="flex flex-col gap-1.5">
        <Label htmlFor="ef-username">Username / email</Label>
        <input
          id="ef-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="you@example.com"
          autoComplete="off"
          className={cn(inputCls, attempted && !usernameValid && 'border-kh-danger/60')}
        />
        <FieldError show={attempted && !usernameValid}>A username is required.</FieldError>
      </motion.div>

      {/* 4 — password + generator */}
      <motion.div key="f-pass" {...fieldMotion(!passwordValid, 3)} className="flex flex-col gap-1.5">
        <Label htmlFor="ef-password">Password</Label>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-xl border border-kh-line bg-kh-inset pr-1.5 transition-colors focus-within:border-kh-cyan/60',
            attempted && !passwordValid && 'border-kh-danger/60',
            pwFlash && 'border-kh-mint/60 shadow-glow',
          )}
        >
          <input
            id="ef-password"
            type={pwVisible ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="new-password"
            className="h-11 min-w-0 flex-1 bg-transparent px-3.5 font-mono text-sm tracking-[0.06em] text-kh-primary placeholder:text-kh-faint focus:outline-none"
          />
          <button
            type="button"
            aria-label={pwVisible ? 'Hide password' : 'Show password'}
            onClick={() => setPwVisible((v) => !v)}
            className="shrink-0 rounded-lg p-2 text-kh-faint transition-colors hover:bg-kh-elevated hover:text-kh-primary"
          >
            {pwVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            type="button"
            aria-label="Open password generator"
            aria-expanded={genOpen}
            onClick={() => setGenOpen((v) => !v)}
            className={cn(
              'shrink-0 rounded-lg p-2 transition-colors hover:bg-kh-elevated',
              genOpen ? 'text-kh-mint' : 'text-kh-faint hover:text-kh-mint',
            )}
          >
            <Dices className="h-4 w-4" />
          </button>
        </div>
        <FieldError show={attempted && !passwordValid}>A password is required.</FieldError>
        <AnimatePresence>{genOpen && <MiniGenerator onUse={useGenerated} />}</AnimatePresence>
        {password.length > 0 && <StrengthMeter password={password} showCrackTime />}
      </motion.div>

      {/* 5 — category chips */}
      <motion.div {...fieldMotion(false, 4)} className="flex flex-col gap-1.5">
        <Label>Category</Label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
          {CATEGORY_ORDER.map((c) => {
            const meta = CATEGORY_META[c];
            const active = category === c;
            return (
              <motion.button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(c)}
                whileTap={{ scale: 0.9 }}
                animate={{ scale: active ? 1 : 0.97 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  active ? 'font-medium' : 'border-kh-line bg-kh-surface text-kh-muted hover:text-kh-primary',
                )}
                style={
                  active
                    ? { backgroundColor: `${meta.color}1F`, borderColor: `${meta.color}55`, color: meta.color }
                    : undefined
                }
              >
                {meta.label}
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* 6 — 2FA secret */}
      <motion.div {...fieldMotion(false, 5)} className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => {
            revealTotp.current = !showTotp;
            setShowTotp(!showTotp);
          }}
          aria-expanded={showTotp}
          className="flex items-center gap-2 text-sm font-medium text-kh-cyan transition-colors hover:text-kh-mint"
        >
          {showTotp ? '− Hide two-factor code' : '+ Add two-factor code'}
          {totpOn && !showTotp && <span className="rounded-full bg-kh-mint/15 px-1.5 font-mono text-[10px] text-kh-mint">on</span>}
        </button>
        <AnimatePresence>
          {showTotp && (
            <motion.div
              ref={totpPanelRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-col gap-1.5 pt-1">
                <input
                  ref={totpInputRef}
                  value={totpInput}
                  onChange={(e) => setTotpInput(e.target.value)}
                  placeholder={mode === 'edit' && entry?.totp ? 'Paste a new secret to replace' : 'TOTP secret or otpauth:// URI'}
                  className={cn(inputCls, 'font-mono text-xs')}
                  aria-label="TOTP secret"
                />
                <p className="text-xs text-kh-faint">
                  From your authenticator app's “manual entry” option.
                </p>
                {totpInput.trim().length > 0 && !parseTotpInput(totpInput) && (
                  <p className="text-xs text-kh-danger">
                    Couldn't parse that — paste the base32 secret or a full otpauth:// URI.
                  </p>
                )}
                <label className="mt-1 flex items-center gap-2 text-sm text-kh-muted">
                  <input
                    type="checkbox"
                    checked={totpOn}
                    onChange={(e) => setTotpOn(e.target.checked)}
                    className="h-4 w-4 accent-[#35F0A1]"
                  />
                  Enable live 2FA codes for this login
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* 7 — notes */}
      <motion.div {...fieldMotion(false, 6)} className="flex flex-col gap-1.5">
        <Label htmlFor="ef-notes">Notes</Label>
        <textarea
          id="ef-notes"
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything worth remembering…"
          className="w-full resize-none overflow-hidden rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2.5 text-sm leading-[22px] text-kh-primary placeholder:text-kh-faint transition-colors focus:border-kh-cyan/60 focus:outline-none"
        />
      </motion.div>

      {/* 8 — favorite switch */}
      <motion.div {...fieldMotion(false, 7)}>
        <button
          type="button"
          role="switch"
          aria-checked={favorite}
          onClick={() => setFavorite((f) => !f)}
          className="flex w-full items-center gap-3 rounded-xl border border-kh-line bg-kh-inset px-3.5 py-3 text-left transition-colors hover:border-kh-lineStrong"
        >
          <Star
            className={cn('h-4 w-4 transition-colors', favorite ? 'text-kh-warning' : 'text-kh-faint')}
            fill={favorite ? 'currentColor' : 'none'}
          />
          <span className="flex-1 text-sm text-kh-primary">Favorite</span>
          <span
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors',
              favorite ? 'bg-kh-warning/80' : 'bg-kh-elevated border border-kh-lineStrong',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                favorite ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </span>
        </button>
      </motion.div>

      {/* edit-mode danger zone */}
      {mode === 'edit' && entry && onDelete && (
        <motion.div {...fieldMotion(false, 8)} className="mt-2 border-t border-kh-line pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onDelete(entry)}
                className="flex-1 rounded-xl bg-kh-danger px-3 py-2.5 text-sm font-semibold text-[#1A0509] transition-all hover:brightness-110"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl border border-kh-line px-3 py-2.5 text-sm text-kh-muted transition-colors hover:text-kh-primary"
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-sm font-medium text-kh-danger/80 transition-colors hover:text-kh-danger"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete this login
            </button>
          )}
        </motion.div>
      )}

    </form>
  );
}

/* ------------------------------------------------------------------ */
/* drawer wrapper                                                      */
/* ------------------------------------------------------------------ */

export default function EntryFormDrawer({
  open,
  mode,
  entry,
  initialPassword,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  entry: EntryExt | null;
  /** add mode: start with this password (e.g. one just generated) */
  initialPassword?: string;
  onClose: () => void;
  onSave: (draft: EntryFormDraft) => void;
  onDelete?: (entry: EntryExt) => void;
}) {
  const [savingOut, setSavingOut] = useState(false);
  const [formValid, setFormValid] = useState(false);

  const handleSave = (draft: EntryFormDraft) => {
    // mono "sealing ✓" shimmer on the button (~450ms), then the page closes
    setSavingOut(true);
    window.setTimeout(() => {
      onSave(draft);
      setSavingOut(false);
    }, 450);
  };

  return (
    <VaultDrawer
      open={open}
      onClose={onClose}
      labelledBy="entry-form-title"
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
            form="entry-form"
            disabled={!formValid && !savingOut}
            className="bg-aurora relative flex-[2] overflow-hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-[#04110B] transition-all hover:-translate-y-px hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {savingOut ? (
              <span className="animate-pulse font-mono text-[13px] tracking-wider">sealing ✓</span>
            ) : (
              'Save login'
            )}
          </button>
        </div>
      }
    >
      <header className="p-6 pb-5">
        <h3
          id="entry-form-title"
          className="font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary"
        >
          {mode === 'add' ? 'New login' : `Edit ${entry?.title ?? ''}`}
        </h3>
        <p className="mt-1 text-sm text-kh-muted">
          Encrypted in your browser before it's stored — we never see it.
        </p>
      </header>
      {open && (
        <FormBody
          key={`${mode}-${entry?.id ?? 'new'}`}
          mode={mode}
          entry={entry}
          initialPassword={mode === 'add' ? initialPassword : undefined}
          onSave={handleSave}
          onDelete={onDelete}
          onValidityChange={setFormValid}
        />
      )}
    </VaultDrawer>
  );
}