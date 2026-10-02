/**
 * /vault — KeyHaven main dashboard (design/vault.md).
 * App shell (sidebar + top bar + ⌘K palette), stat filter cards, category
 * chips + sort, login cards with mask/reveal/copy, detail drawer with live
 * TOTP, add/edit drawer with inline generator, favorites, empty states.
 * Guard: any non-unlocked status redirects to /unlock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { MotionConfig, motion, useReducedMotion } from 'framer-motion';
import { Plus, SearchX } from 'lucide-react';
import VaultRing from '@/components/VaultRing';
import { useVault } from '@/providers/VaultProvider';
import type { NewEntryDraft } from '@/providers/VaultProvider';
import type { VaultEntry } from '@/lib/vault';
import AppShell from '@/components/vault/AppShell';
import CommandPalette from '@/components/vault/CommandPalette';
import DetailDrawer from '@/components/vault/DetailDrawer';
import EntryFormDrawer from '@/components/vault/EntryFormDrawer';
import type { EntryFormDraft } from '@/components/vault/EntryFormDrawer';
import EntryList from '@/components/vault/EntryList';
import FilterBar from '@/components/vault/FilterBar';
import StatsStrip from '@/components/vault/StatsStrip';
import VaultToasts from '@/components/vault/VaultToasts';
import {
  buildStrengthMap,
  computeStats,
  filterEntries,
  reusedPasswords,
  showVaultToast,
  sortEntries,
} from '@/components/vault/vault-utils';
import type {
  CategoryFilter,
  EntryExt,
  SortKey,
  StatFilter,
} from '@/components/vault/vault-utils';

const WELCOME_KEY = 'kh-vault-welcomed';

/* ------------------------------------------------------------------ */
/* guard shell                                                         */
/* ------------------------------------------------------------------ */

export default function Vault() {
  const { status } = useVault();

  // next unlock session should greet again
  useEffect(() => {
    if (status === 'locked' || status === 'no-vault') {
      sessionStorage.removeItem(WELCOME_KEY);
    }
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="flex h-[calc(100dvh-72px)] flex-col items-center justify-center gap-5">
        <VaultRing size={96} />
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-kh-faint">Opening vault…</p>
      </div>
    );
  }
  if (status !== 'unlocked') {
    return <Navigate to="/unlock" replace />;
  }
  return <VaultDashboard />;
}

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */

interface FormState {
  open: boolean;
  mode: 'add' | 'edit';
  entry: EntryExt | null;
}

function VaultDashboard() {
  const { entries, addEntry, updateEntry, removeEntry, flush } = useVault();

  /** Toast only once the change is actually saved (encrypted) in this browser. */
  const toastWhenSaved = useCallback(
    (title: string) => {
      flush().then(
        () => showVaultToast({ title, variant: 'success' }),
        () =>
          showVaultToast({
            title: "Not saved to this browser yet — KeyHaven is retrying. Don't close this tab.",
            variant: 'danger',
            durationMs: 6000,
          }),
      );
    },
    [flush],
  );

  const [category, setCategory] = useState<CategoryFilter>('all');
  const [statFilter, setStatFilter] = useState<StatFilter>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [params, setParams] = useSearchParams();
  // /vault?entry=<id> (from a subscription or account) opens that login
  const [detailId, setDetailId] = useState<string | null>(() => params.get('entry'));
  const [form, setForm] = useState<FormState>({ open: false, mode: 'add', entry: null });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newId, setNewId] = useState<string | null>(null);
  const greeted = useRef(false);

  /* ---------- derived data ---------- */
  const strength = useMemo(() => buildStrengthMap(entries), [entries]);
  const reused = useMemo(() => reusedPasswords(entries), [entries]);
  const stats = useMemo(() => computeStats(entries, strength), [entries, strength]);

  const counts = useMemo(() => {
    const perCategory = Object.fromEntries(
      (['social', 'finance', 'work', 'shopping', 'streaming', 'other'] as const).map((c) => [
        c,
        entries.filter((e) => e.category === c).length,
      ]),
    ) as Record<VaultEntry['category'], number>;
    return {
      total: entries.length,
      favorites: entries.filter((e) => e.favorite).length,
      perCategory,
    };
  }, [entries]);

  const visible = useMemo(
    () =>
      sortEntries(
        filterEntries(entries, { category, stat: statFilter, query, strength, reused }),
        sort,
        strength,
      ),
    [entries, category, statFilter, query, sort, strength, reused],
  );

  const detailEntry = useMemo(
    () => (entries.find((e) => e.id === detailId) as EntryExt | undefined) ?? null,
    [entries, detailId],
  );

  /* ---------- first visit after unlock ---------- */
  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;
    if (!sessionStorage.getItem(WELCOME_KEY)) {
      sessionStorage.setItem(WELCOME_KEY, '1');
      showVaultToast({
        title: 'Vault unlocked — your data never left this device.',
        variant: 'success',
        durationMs: 4500,
      });
    }
    if (entries.length === 0) {
      const t = setTimeout(() => setForm({ open: true, mode: 'add', entry: null }), 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- deep link: /vault?entry=<id> opened that login (above); tidy the URL ---------- */
  useEffect(() => {
    if (!params.has('entry')) return;
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('entry');
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  /* ---------- keyboard: ⌘K palette + Esc closes drawers ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.key === 'Escape' && !paletteOpen) {
        if (form.open) setForm((f) => ({ ...f, open: false }));
        else if (detailId) setDetailId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, form.open, detailId]);

  /* clear the scramble-materialize flag shortly after save */
  useEffect(() => {
    if (!newId) return;
    const t = setTimeout(() => setNewId(null), 1600);
    return () => clearTimeout(t);
  }, [newId]);

  /* ---------- actions ---------- */
  const openDetail = useCallback((e: VaultEntry) => setDetailId(e.id), []);

  const openEdit = useCallback((e: EntryExt) => {
    setDetailId(null);
    setForm({ open: true, mode: 'edit', entry: e });
  }, []);

  const handleDelete = useCallback(
    (e: VaultEntry) => {
      if (!removeEntry(e.id)) {
        showVaultToast({ title: 'The vault is locked or out of date — nothing was deleted.', variant: 'danger' });
        return;
      }
      setDetailId((id) => (id === e.id ? null : id));
      setForm((f) => (f.entry?.id === e.id ? { ...f, open: false } : f));
      const snapshot = { ...(e as EntryExt) };
      showVaultToast({
        title: 'Login deleted',
        description: e.title,
        variant: 'danger',
        actionLabel: 'Undo',
        durationMs: 5000,
        onAction: () => {
          if (addEntry(snapshot as NewEntryDraft)) {
            showVaultToast({ title: `${e.title} restored`, variant: 'success', durationMs: 2500 });
          } else {
            showVaultToast({ title: `Couldn't restore ${e.title} — the vault is locked.`, variant: 'danger' });
          }
        },
      });
    },
    [removeEntry, addEntry],
  );

  const handleDuplicate = useCallback(
    (e: VaultEntry) => {
      const ext = e as EntryExt;
      const copy = addEntry({
        title: `${e.title} copy`,
        url: e.url,
        username: e.username,
        password: e.password,
        category: e.category,
        favorite: e.favorite,
        notes: e.notes,
        totp: e.totp,
        ...(ext.totpSecret ? { totpSecret: ext.totpSecret } : {}),
      } as NewEntryDraft);
      if (!copy) return;
      setNewId(copy.id);
      showVaultToast({ title: `${e.title} duplicated`, variant: 'success', durationMs: 2500 });
    },
    [addEntry],
  );

  const handleSave = useCallback(
    (draft: EntryFormDraft) => {
      const { totpSecret, ...base } = draft;
      if (form.mode === 'edit' && form.entry) {
        const prev = form.entry;
        const history =
          draft.password !== prev.password
            ? [
                { password: prev.password, changedAt: prev.updatedAt },
                ...((prev as EntryExt).passwordHistory ?? []),
              ].slice(0, 10)
            : (prev as EntryExt).passwordHistory;
        const applied = updateEntry(prev.id, {
          ...base,
          ...(history ? { passwordHistory: history } : {}),
          totpSecret: draft.totp ? totpSecret : undefined,
        } as Partial<VaultEntry>);
        if (!applied) {
          showVaultToast({ title: 'The vault is locked or out of date — the change was not applied.', variant: 'danger' });
          return;
        }
        toastWhenSaved('Login updated — encrypted and saved locally.');
      } else {
        const created = addEntry({
          ...base,
          ...(draft.totp && totpSecret ? { totpSecret } : {}),
        } as NewEntryDraft);
        if (!created) {
          showVaultToast({ title: 'The vault is locked or out of date — the login was not added.', variant: 'danger' });
          return;
        }
        setNewId(created.id);
        toastWhenSaved('Login saved — encrypted and saved locally.');
      }
      setForm((f) => ({ ...f, open: false }));
    },
    [form.mode, form.entry, addEntry, updateEntry, toastWhenSaved],
  );

  const clearAllFilters = useCallback(() => {
    setCategory('all');
    setStatFilter(null);
    setQuery('');
  }, []);

  /* ---------- render ---------- */
  const freshVault = entries.length === 0;

  return (
    <MotionConfig reducedMotion="user">
      <AppShell
        counts={counts}
        activeCategory={category}
        onSelectCategory={setCategory}
        onNewLogin={() => setForm({ open: true, mode: 'add', entry: null })}
        onOpenPalette={() => setPaletteOpen(true)}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mx-auto w-full max-w-[1080px] px-4 pt-6 min-[900px]:px-8"
        >
          <StatsStrip stats={stats} active={statFilter} onSelect={setStatFilter} />

          <FilterBar
            counts={counts}
            category={category}
            onCategory={setCategory}
            sort={sort}
            onSort={setSort}
            view={view}
            onView={setView}
            query={query}
            onClearQuery={() => setQuery('')}
          />

          {freshVault ? (
            <EmptyVault onAdd={() => setForm({ open: true, mode: 'add', entry: null })} />
          ) : visible.length === 0 ? (
            <NoMatches query={query.trim()} onClear={clearAllFilters} />
          ) : (
            <EntryList
              entries={visible}
              view={view}
              strength={strength}
              reused={reused}
              newId={newId}
              onOpen={openDetail}
              onEdit={(e) => openEdit(e as EntryExt)}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
            />
          )}
        </motion.div>
      </AppShell>

      <DetailDrawer
        entry={detailEntry}
        onClose={() => setDetailId(null)}
        onEdit={openEdit}
        onDelete={handleDelete}
      />

      <EntryFormDrawer
        open={form.open}
        mode={form.mode}
        entry={form.entry}
        onClose={() => setForm((f) => ({ ...f, open: false }))}
        onSave={handleSave}
        onDelete={form.mode === 'edit' ? (e) => handleDelete(e) : undefined}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        entries={entries as EntryExt[]}
        onOpenEntry={openDetail}
        onAddLogin={() => setForm({ open: true, mode: 'add', entry: null })}
        onQueryChange={setQuery}
      />

      <VaultToasts />
    </MotionConfig>
  );
}

/* ------------------------------------------------------------------ */
/* empty states                                                        */
/* ------------------------------------------------------------------ */

function EmptyVault({ onAdd }: { onAdd: () => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <motion.img
        src="/empty-vault.png"
        alt="An open, empty vault"
        className="w-[280px] max-w-full"
        initial={{ opacity: 0, y: 16 }}
        animate={reduce ? { opacity: 1, y: 0 } : { opacity: 1, y: [0, -8, 0] }}
        transition={
          reduce
            ? { duration: 0.3 }
            : { opacity: { duration: 0.5 }, y: { duration: 4, repeat: Infinity, ease: 'easeInOut' } }
        }
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08 }}
      >
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary">
          Your vault is waiting.
        </h2>
        <p className="mt-2 max-w-[36ch] text-sm leading-6 text-kh-muted">
          Add your first login — it takes 20 seconds.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="bg-aurora mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-[#04110B] shadow-glow transition-all hover:-translate-y-0.5 hover:brightness-110"
        >
          <Plus className="h-4 w-4" /> Add a login
        </button>
      </motion.div>
    </div>
  );
}

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center py-20 text-center"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-kh-line bg-kh-surface">
        <SearchX className="h-6 w-6 text-kh-faint" />
      </span>
      <h2 className="mt-5 font-display text-xl font-semibold text-kh-primary">
        {query ? `Nothing matches “${query}”` : 'Nothing matches these filters'}
      </h2>
      <p className="mt-2 max-w-[40ch] text-sm leading-6 text-kh-muted">
        {query
          ? 'Try a different name, username or website.'
          : 'Try clearing a filter or two to see more logins.'}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 rounded-full border border-kh-lineStrong px-5 py-2.5 text-sm font-medium text-kh-primary transition-all hover:-translate-y-px hover:bg-kh-elevated"
      >
        {query ? 'Clear search' : 'Clear filters'}
      </button>
    </motion.div>
  );
}