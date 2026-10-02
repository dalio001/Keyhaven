/**
 * SecurityShell — self-contained copy of the KeyHaven app shell
 * (design.md §6.2) scoped to the Watchtower page. The shared scaffold
 * still renders the marketing navbar/footer; the main agent unifies the
 * shell later, so everything here lives under src/components/security/.
 *
 * Sidebar 264px (icon rail 72px < 1100px, bottom tab bar < 720px),
 * top bar 64px with title/breadcrumb, ⌘K search pill, encryption status
 * chip and avatar menu. Bottom widget: mini VaultRing auto-lock countdown.
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Briefcase,
  CalendarClock,
  Clapperboard,
  Dices,
  Globe,
  LayoutGrid,
  Lock,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import VaultRing from '@/components/VaultRing';
import { useVault } from '@/providers/VaultProvider';
import type { VaultCategory } from '@/lib/vault';
import { cn } from '@/lib/utils';

const CATEGORIES: { id: VaultCategory; label: string; icon: typeof Globe }[] = [
  { id: 'social', label: 'Social', icon: Users },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'work', label: 'Work', icon: Briefcase },
  { id: 'shopping', label: 'Shopping', icon: ShoppingBag },
  { id: 'streaming', label: 'Streaming', icon: Clapperboard },
  { id: 'other', label: 'Other', icon: Globe },
];

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        'ml-auto rounded-full bg-kh-elevated px-2 py-0.5 font-mono text-[11px] text-kh-faint min-[1100px]:inline hidden',
        className,
      )}
    >
      {count}
    </span>
  );
}

export default function SecurityShell({ children }: { children: ReactNode }) {
  const { entries, lockCountdown, lock } = useVault();
  const location = useLocation();
  const navigate = useNavigate();
  const [avatarOpen, setAvatarOpen] = useState(false);

  const counts = useMemo(() => {
    const byCat = new Map<VaultCategory, number>();
    let favorites = 0;
    for (const e of entries) {
      byCat.set(e.category, (byCat.get(e.category) ?? 0) + 1);
      if (e.favorite) favorites++;
    }
    return { byCat, favorites, total: entries.length };
  }, [entries]);

  const navRow =
    'group flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-kh-muted transition-colors hover:bg-kh-elevated hover:text-kh-primary max-[1100px]:justify-center max-[1100px]:px-0';
  const activeRow =
    'bg-kh-elevated text-kh-primary shadow-[inset_2px_0_0_0_#35F0A1] max-[1100px]:shadow-[inset_0_-2px_0_0_#35F0A1]';

  return (
    <div className="relative flex min-h-[calc(100dvh-72px)] bg-kh-base">
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(700px circle at 85% 0%, rgba(56,225,255,.05), transparent 60%), radial-gradient(600px circle at 10% 100%, rgba(53,240,161,.04), transparent 60%)',
        }}
      />

      {/* ------------------------------ sidebar ------------------------------ */}
      <aside className="sticky top-[72px] z-30 hidden h-[calc(100dvh-72px)] w-[264px] shrink-0 flex-col border-r border-kh-line bg-kh-surface/80 backdrop-blur-sm max-[1100px]:w-[72px] max-[720px]:hidden min-[720px]:flex">
        <div className="flex items-center gap-2.5 px-6 pt-6 pb-5 max-[1100px]:justify-center max-[1100px]:px-0">
          <img src="/logo.svg" alt="" className="h-8 w-8 shrink-0" />
          <span className="font-display text-[18px] font-semibold tracking-tight text-kh-primary max-[1100px]:hidden">
            <span className="text-aurora">Key</span>Haven
          </span>
        </div>

        <div className="px-4 max-[1100px]:px-3">
          <Link
            to="/vault?new=1"
            className="bg-aurora flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#04110B] transition-all duration-200 hover:-translate-y-px hover:shadow-glow active:scale-[0.97]"
            aria-label="New login"
          >
            <Plus className="h-4 w-4" />
            <span className="max-[1100px]:hidden">New login</span>
          </Link>
        </div>

        <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Vault">
          <Link to="/vault" className={navRow}>
            <LayoutGrid className="h-[18px] w-[18px] shrink-0" />
            <span className="max-[1100px]:hidden">All Items</span>
            <CountBadge count={counts.total} />
          </Link>
          <Link to="/vault?filter=favorites" className={navRow}>
            <Star className="h-[18px] w-[18px] shrink-0" />
            <span className="max-[1100px]:hidden">Favorites</span>
            <CountBadge count={counts.favorites} />
          </Link>
          <Link to="/subscriptions" className={navRow}>
            <CalendarClock className="h-[18px] w-[18px] shrink-0" />
            <span className="max-[1100px]:hidden">Subscriptions</span>
          </Link>

          <p className="text-eyebrow px-3 pt-5 pb-2 text-kh-faint max-[1100px]:hidden">Categories</p>
          {CATEGORIES.map((c) => (
            <Link key={c.id} to={`/vault?category=${c.id}`} className={navRow}>
              <c.icon className="h-[18px] w-[18px] shrink-0" />
              <span className="max-[1100px]:hidden">{c.label}</span>
              <CountBadge count={counts.byCat.get(c.id) ?? 0} />
            </Link>
          ))}

          <p className="text-eyebrow px-3 pt-5 pb-2 text-kh-faint max-[1100px]:hidden">Tools</p>
          <Link to="/security" className={cn(navRow, location.pathname === '/security' && activeRow)} aria-current="page">
            <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-kh-mint" />
            <span className="max-[1100px]:hidden">Watchtower</span>
          </Link>
          <Link to="/generator" className={navRow}>
            <Dices className="h-[18px] w-[18px] shrink-0" />
            <span className="max-[1100px]:hidden">Generator</span>
          </Link>
        </nav>

        <div className="space-y-0.5 px-3 pb-3">
          <Link to="/settings" className={navRow}>
            <Settings className="h-[18px] w-[18px] shrink-0" />
            <span className="max-[1100px]:hidden">Settings</span>
          </Link>
          <button
            onClick={lock}
            className="group flex w-full items-center gap-3 rounded-xl border border-kh-line bg-kh-base/60 p-2.5 text-left transition-colors hover:border-kh-lineStrong max-[1100px]:justify-center max-[1100px]:border-0 max-[1100px]:bg-transparent"
            aria-label="Lock vault now"
            title="Lock now"
          >
            <VaultRing size={40} className="shrink-0">
              <Lock className="h-3.5 w-3.5 text-kh-mint" />
            </VaultRing>
            <span className="min-w-0 max-[1100px]:hidden">
              <span className="block truncate font-mono text-[13px] text-kh-primary">
                {lockCountdown !== null ? formatCountdown(lockCountdown) : '—'}
              </span>
              <span className="block text-[11px] text-kh-faint group-hover:text-kh-muted">
                Vault locks · click to lock now
              </span>
            </span>
          </button>
        </div>
      </aside>

      {/* ------------------------------ column ------------------------------ */}
      <div className="relative flex min-w-0 flex-1 flex-col pb-20 max-[720px]:pb-24">
        {/* top bar */}
        <header className="sticky top-[72px] z-20 flex h-16 items-center gap-4 border-b border-kh-line bg-kh-base/80 px-4 backdrop-blur-[16px] sm:px-8">
          <div className="min-w-0">
            <h1 className="font-display truncate text-[17px] font-semibold leading-tight text-kh-primary">
              Watchtower
            </h1>
            <p className="hidden text-[12px] text-kh-faint sm:block">Vault / Security</p>
          </div>

          <button
            onClick={() => navigate('/vault')}
            className="mx-auto hidden h-10 w-full max-w-[380px] items-center gap-2.5 rounded-xl border border-kh-line bg-kh-inset px-3.5 text-sm text-kh-faint transition-colors hover:border-kh-lineStrong hover:text-kh-muted md:flex"
            aria-label="Search your vault"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search your vault…</span>
            <kbd className="rounded-md border border-kh-line bg-kh-elevated px-1.5 py-0.5 font-mono text-[10px] text-kh-faint">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <span className="hidden items-center gap-2 rounded-full border border-kh-line bg-kh-surface px-3 py-1.5 text-[12px] text-kh-muted sm:flex">
              <span className="animate-dot-pulse h-1.5 w-1.5 rounded-full bg-kh-mint" />
              Encrypted · local
            </span>
            <div className="relative">
              <button
                onClick={() => setAvatarOpen((v) => !v)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-kh-lineStrong bg-gradient-to-br from-kh-mint/30 to-kh-violet/30 font-display text-[13px] font-semibold text-kh-primary transition-colors hover:border-kh-mint/50"
                aria-label="Account menu"
                aria-expanded={avatarOpen}
              >
                M
              </button>
              <AnimatePresence>
                {avatarOpen && (
                  <>
                    <button
                      aria-hidden
                      tabIndex={-1}
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setAvatarOpen(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-xl border border-kh-line bg-kh-elevated shadow-drawer"
                    >
                      {[
                        { label: 'Settings', icon: Settings, to: '/settings' },
                        { label: 'About', icon: Wrench, to: '/about' },
                      ].map((item) => (
                        <Link
                          key={item.label}
                          to={item.to}
                          onClick={() => setAvatarOpen(false)}
                          className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-kh-muted transition-colors hover:bg-kh-surface hover:text-kh-primary"
                        >
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      ))}
                      <button
                        onClick={() => {
                          setAvatarOpen(false);
                          lock();
                        }}
                        className="flex w-full items-center gap-2.5 border-t border-kh-line px-3.5 py-2.5 text-sm text-kh-muted transition-colors hover:bg-kh-surface hover:text-kh-primary"
                      >
                        <Lock className="h-4 w-4" />
                        Lock now
                      </button>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* page content */}
        <div className="mx-auto w-full max-w-[1080px] px-4 py-8 sm:px-8">{children}</div>
      </div>

      {/* ------------------------------ bottom tab bar (<720px) ------------------------------ */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 hidden border-t border-kh-line bg-kh-surface/95 backdrop-blur-[16px] max-[720px]:flex"
        aria-label="App"
      >
        {[
          { to: '/vault', label: 'Vault', icon: LayoutGrid },
          { to: '/subscriptions', label: 'Subs', icon: CalendarClock },
          { to: '/security', label: 'Watchtower', icon: ShieldCheck },
          { to: '/generator', label: 'Generator', icon: Dices },
          { to: '/settings', label: 'Settings', icon: Settings },
        ].map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-label={item.to === '/subscriptions' ? 'Subscriptions' : undefined}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition-colors',
                active ? 'text-kh-mint' : 'text-kh-faint hover:text-kh-muted',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={lock}
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] text-kh-faint transition-colors hover:text-kh-muted"
          aria-label="Lock vault"
        >
          <Lock className="h-5 w-5" />
          Lock
        </button>
      </nav>
    </div>
  );
}
