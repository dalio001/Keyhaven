/**
 * Settings app shell — self-contained sidebar + topbar for the /settings
 * surface (design.md §6.2). The main agent will unify this with the shared
 * app shell later; everything here is local to src/components/settings/.
 *
 * Sidebar 264px → 72px icon rail < 1100px → bottom tab bar < 720px.
 * Top bar 64px: title + breadcrumb, search pill, encryption status chip,
 * auto-lock countdown, lock-now button.
 */

import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  CalendarClock,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  Settings2,
  Vault,
  Wand2,
} from 'lucide-react';
import VaultRing from '@/components/VaultRing';
import { useVault } from '@/providers/VaultProvider';
import SaveStatus from '@/components/SaveStatus';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'All Items', short: 'All Items', to: '/vault', icon: Vault },
  { label: 'Subscriptions', short: 'Subs', to: '/subscriptions', icon: CalendarClock },
  { label: 'Watchtower', short: 'Watchtower', to: '/security', icon: ShieldCheck },
  { label: 'Generator', short: 'Generator', to: '/generator', icon: Wand2 },
  { label: 'Settings', short: 'Settings', to: '/settings', icon: Settings2 },
] as const;

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { lock, lockCountdown } = useVault();

  return (
    <aside
      className={cn(
        'sticky top-[72px] hidden h-[calc(100dvh-72px)] shrink-0 flex-col border-r border-kh-line bg-kh-surface sm:flex',
        'w-[264px] min-[1100px]:w-[264px] max-[1100px]:w-[72px]',
      )}
    >
      {/* wordmark */}
      <div className="flex items-center gap-2.5 px-6 py-6 max-[1100px]:justify-center max-[1100px]:px-0">
        <img src="/logo.svg" alt="" className="h-8 w-8 shrink-0" />
        <span className="font-display text-[17px] font-semibold tracking-tight text-kh-primary max-[1100px]:hidden">
          <span className="text-aurora">Key</span>Haven
        </span>
      </div>

      {/* primary action */}
      <div className="px-4 max-[1100px]:px-3">
        <button
          onClick={() => navigate('/vault')}
          className="bg-aurora flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-[#04110B] transition-all duration-200 hover:-translate-y-px hover:shadow-glow active:scale-[0.97]"
          aria-label="New login"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="max-[1100px]:hidden">New login</span>
        </button>
      </div>

      {/* nav */}
      <nav className="mt-6 flex-1 space-y-1 px-3" aria-label="Vault sections">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.label}
              to={item.to}
              title={item.label}
              className={cn(
                'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors max-[1100px]:justify-center max-[1100px]:px-0',
                active
                  ? 'bg-kh-elevated text-kh-primary'
                  : 'text-kh-muted hover:bg-kh-elevated/60 hover:text-kh-primary',
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-kh-mint" />
              )}
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="max-[1100px]:hidden">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* bottom auto-lock widget */}
      <div className="border-t border-kh-line p-4 max-[1100px]:p-2">
        <button
          onClick={lock}
          className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-kh-elevated max-[1100px]:justify-center"
          title="Lock now"
        >
          <VaultRing size={40} muted>
            <Lock className="h-4 w-4 text-kh-mint" />
          </VaultRing>
          <span className="min-w-0 max-[1100px]:hidden">
            <span className="block font-mono text-xs text-kh-primary">
              {lockCountdown !== null ? `locks in ${formatCountdown(lockCountdown)}` : 'vault unlocked'}
            </span>
            <span className="block text-[11px] text-kh-faint group-hover:text-kh-muted">
              Click to lock now
            </span>
          </span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({ title }: { title: string }) {
  const navigate = useNavigate();
  const { lock, lockCountdown } = useVault();
  return (
    <div className="sticky top-[72px] z-30 flex h-16 items-center justify-between gap-4 border-b border-kh-line bg-kh-base/80 px-4 backdrop-blur-[12px] md:px-8">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-kh-faint">Vault</span>
        <span className="text-kh-faint">/</span>
        <h1 className="font-display text-base font-semibold text-kh-primary">{title}</h1>
      </div>

      <button
        onClick={() => navigate('/vault')}
        className="hidden w-full max-w-[340px] items-center gap-2.5 rounded-full border border-kh-line bg-kh-inset px-4 py-2 text-sm text-kh-faint transition-colors hover:border-kh-lineStrong hover:text-kh-muted md:flex"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search your vault…</span>
        <kbd className="rounded border border-kh-line bg-kh-surface px-1.5 py-0.5 font-mono text-[10px] text-kh-faint">
          ⌘K
        </kbd>
      </button>

      <div className="flex items-center gap-3">
        <SaveStatus className="hidden sm:flex" />
        {lockCountdown !== null && (
          <span className="hidden font-mono text-xs text-kh-faint lg:block">
            {formatCountdown(lockCountdown)}
          </span>
        )}
        <button
          onClick={lock}
          className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3.5 py-1.5 text-xs font-medium text-kh-primary transition-colors hover:bg-kh-elevated"
        >
          <Lock className="h-3.5 w-3.5" />
          Lock now
        </button>
      </div>
    </div>
  );
}

/** Bottom tab bar for narrow viewports (<720px). */
function MobileTabBar() {
  const location = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around border-t border-kh-line bg-kh-surface/95 backdrop-blur-[12px] sm:hidden"
      aria-label="Vault sections"
    >
      {NAV_ITEMS.map((item) => {
        const active = location.pathname === item.to;
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            to={item.to}
            aria-label={item.short === item.label ? undefined : item.label}
            className={cn(
              'flex min-w-0 flex-1 flex-col items-center gap-1 py-2.5 text-[10px]',
              active ? 'text-kh-mint' : 'text-kh-faint',
            )}
          >
            <Icon className="h-5 w-5" />
            {item.short}
          </Link>
        );
      })}
    </nav>
  );
}

export default function SettingsShell({ children, title = 'Settings' }: { children: ReactNode; title?: string }) {
  return (
    <div className="flex min-h-[calc(100dvh-72px)]">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <Topbar title={title} />
        <main className="mx-auto w-full max-w-[1080px] px-4 pb-28 pt-8 sm:pb-16 md:px-8">
          {children}
        </main>
      </div>
      <MobileTabBar />
    </div>
  );
}
