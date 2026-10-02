/**
 * AppShell — generator-local copy of the KeyHaven app chrome
 * (design.md §6.2): 264px sidebar (72px icon rail < 1100px, bottom tab bar
 * < 720px), 64px top bar, unlock guard. Self-contained so the main agent can
 * later unify shells across app routes without touching this page.
 *
 * Guard: all shell routes require an unlocked vault — locked/no-vault
 * redirects to /unlock.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, NavLink, useLocation, useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  CalendarClock,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVault } from '@/providers/VaultProvider';
import VaultRing from '@/components/VaultRing';
import type { VaultCategory } from '@/lib/vault';

const CATEGORIES: { key: VaultCategory; label: string; dot: string }[] = [
  { key: 'social', label: 'Social', dot: '#38E1FF' },
  { key: 'finance', label: 'Finance', dot: '#35F0A1' },
  { key: 'work', label: 'Work', dot: '#8B7CFF' },
  { key: 'shopping', label: 'Shopping', dot: '#FFB84D' },
  { key: 'streaming', label: 'Streaming', dot: '#FF8AC2' },
  { key: 'other', label: 'Other', dot: '#93A1B8' },
];

function formatClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ------------------------------ sidebar ------------------------------ */

function SideNavLink({
  to,
  icon,
  label,
  count,
  active,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <NavLink
      to={to}
      title={label}
      className={cn(
        'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
        'max-[1099px]:justify-center max-[1099px]:px-0',
        active ? 'bg-kh-elevated text-kh-primary' : 'text-kh-muted hover:bg-kh-elevated/60 hover:text-kh-primary',
      )}
    >
      {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-kh-mint" />}
      {icon}
      <span className="min-w-0 flex-1 truncate max-[1099px]:hidden">{label}</span>
      {typeof count === 'number' && (
        <span className="rounded-full border border-kh-line bg-kh-inset px-1.5 py-px font-mono text-[10px] text-kh-faint max-[1099px]:hidden">
          {count}
        </span>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const { entries, subscriptions, lockCountdown, lock } = useVault();
  const location = useLocation();
  const navigate = useNavigate();

  const countFor = (cat: VaultCategory) => entries.filter((e) => e.category === cat).length;
  const favorites = entries.filter((e) => e.favorite).length;
  const is = (path: string) => location.pathname === path;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col border-r border-kh-line bg-kh-surface min-[720px]:flex min-[1100px]:w-[264px]">
      {/* logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-kh-line px-6 max-[1099px]:justify-center max-[1099px]:px-0">
        <img src="/logo.svg" alt="" className="h-7 w-7 shrink-0" />
        <span className="font-display text-[17px] font-semibold tracking-tight text-kh-primary max-[1099px]:hidden">
          <span className="text-aurora">Key</span>Haven
        </span>
      </div>

      {/* primary action */}
      <div className="px-4 pt-4 max-[1099px]:px-3">
        <button
          type="button"
          onClick={() => navigate('/vault?new=1')}
          title="New login"
          className="bg-aurora flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#04110B] transition-all duration-200 hover:-translate-y-px hover:shadow-glow active:scale-[0.97]"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="max-[1099px]:hidden">New login</span>
        </button>
      </div>

      {/* nav */}
      <nav className="mt-4 flex-1 space-y-1 overflow-y-auto px-4 max-[1099px]:px-3" aria-label="Vault">
        <SideNavLink to="/vault" icon={<KeyRound className="h-[18px] w-[18px] shrink-0" />} label="All Items" count={entries.length} active={is('/vault')} />
        <SideNavLink to="/vault?filter=favorites" icon={<Star className="h-[18px] w-[18px] shrink-0" />} label="Favorites" count={favorites} />
        <SideNavLink to="/subscriptions" icon={<CalendarClock className="h-[18px] w-[18px] shrink-0" />} label="Subscriptions" count={subscriptions.length} active={is('/subscriptions')} />
        <SideNavLink to="/security" icon={<ShieldCheck className="h-[18px] w-[18px] shrink-0" />} label="Watchtower" active={is('/security')} />
        <SideNavLink to="/generator" icon={<RefreshCw className="h-[18px] w-[18px] shrink-0" />} label="Generator" active={is('/generator')} />

        <div className="pt-4 max-[1099px]:hidden">
          <div className="text-eyebrow px-3 pb-2 text-kh-faint">Categories</div>
          {CATEGORIES.map((cat) => (
            <NavLink
              key={cat.key}
              to={`/vault?cat=${cat.key}`}
              className="flex h-9 items-center gap-3 rounded-lg px-3 text-sm text-kh-muted transition-colors hover:bg-kh-elevated/60 hover:text-kh-primary"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: cat.dot }} />
              <span className="min-w-0 flex-1 truncate">{cat.label}</span>
              <span className="rounded-full border border-kh-line bg-kh-inset px-1.5 py-px font-mono text-[10px] text-kh-faint">
                {countFor(cat.key)}
              </span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* bottom: settings + lock widget */}
      <div className="space-y-3 border-t border-kh-line p-4 max-[1099px]:p-3">
        <button
          type="button"
          onClick={() => (lockCountdown !== null ? lock() : navigate('/vault'))}
          title={lockCountdown !== null ? `Vault locks in ${formatClock(lockCountdown)} — click to lock now` : 'Auto-lock off'}
          className="flex w-full items-center gap-3 rounded-xl border border-kh-line bg-kh-inset px-3 py-2.5 text-left transition-colors hover:border-kh-lineStrong max-[1099px]:justify-center max-[1099px]:px-0"
        >
          <VaultRing size={30} muted />
          <span className="min-w-0 max-[1099px]:hidden">
            <span className="block truncate font-mono text-[11px] text-kh-muted">
              {lockCountdown !== null ? `Vault locked in ${formatClock(lockCountdown)}` : 'Auto-lock off'}
            </span>
            <span className="block text-[10px] text-kh-faint">
              {lockCountdown !== null ? 'Click to lock now' : 'Vault unlocked'}
            </span>
          </span>
        </button>
        <SideNavLink to="/settings" icon={<Settings className="h-[18px] w-[18px] shrink-0" />} label="Settings" active={is('/settings')} />
      </div>
    </aside>
  );
}

/* ------------------------------ top bar ------------------------------ */

function TopBar({ title }: { title: string }) {
  const { lock } = useVault();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  return (
    <header className="flex h-16 items-center gap-4 border-b border-kh-line bg-kh-base/80 px-4 backdrop-blur sm:px-8">
      <div className="flex shrink-0 items-baseline gap-2">
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.18em] text-kh-faint sm:inline">
          KeyHaven /
        </span>
        <h1 className="font-display text-[17px] font-semibold text-kh-primary">{title}</h1>
      </div>

      {/* ⌘K search pill */}
      <button
        type="button"
        onClick={() => navigate('/vault')}
        className="mx-auto hidden w-full max-w-[320px] items-center gap-2 rounded-full border border-kh-line bg-kh-inset px-4 py-2 text-sm text-kh-faint transition-colors hover:border-kh-lineStrong md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">Search your vault…</span>
        <kbd className="rounded-md border border-kh-line bg-kh-surface px-1.5 py-0.5 font-mono text-[10px] text-kh-faint">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-3 md:ml-0">
        <span className="hidden items-center gap-2 rounded-full border border-kh-line bg-kh-surface px-3 py-1.5 text-xs text-kh-muted sm:flex">
          <span className="animate-dot-pulse h-1.5 w-1.5 rounded-full bg-kh-mint" />
          Encrypted · local
        </span>

        {/* avatar menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="bg-aurora flex h-9 w-9 items-center justify-center rounded-full text-[#04110B] transition-transform hover:scale-105 active:scale-95"
          >
            <Lock className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-xl border border-kh-lineStrong bg-kh-elevated py-1.5 shadow-drawer"
            >
              {[
                { label: 'Settings', action: () => navigate('/settings') },
                { label: 'Lock now', action: () => lock() },
                { label: 'About', action: () => navigate('/about') },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    item.action();
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-kh-muted transition-colors hover:bg-kh-surface hover:text-kh-primary"
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------ mobile tabs ------------------------------ */

function MobileTabs() {
  const location = useLocation();
  const tabs = [
    { to: '/vault', label: 'Vault', icon: KeyRound },
    { to: '/subscriptions', label: 'Subs', icon: CalendarClock },
    { to: '/security', label: 'Watchtower', icon: ShieldCheck },
    { to: '/generator', label: 'Generator', icon: RefreshCw },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <nav
      aria-label="App"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-kh-line bg-kh-surface/95 backdrop-blur min-[720px]:hidden"
    >
      {tabs.map((tab) => {
        const active = location.pathname === tab.to;
        const Icon = tab.icon;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            aria-label={tab.to === '/subscriptions' ? 'Subscriptions' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
              active ? 'text-kh-mint' : 'text-kh-faint hover:text-kh-muted',
            )}
          >
            <Icon className="h-5 w-5" />
            {tab.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

/* ------------------------------ shell + guard ------------------------------ */

export default function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const { status } = useVault();

  if (status === 'loading') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-kh-base">
        <VaultRing size={96} />
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-kh-faint">Opening vault…</p>
      </div>
    );
  }
  if (status !== 'unlocked') return <Navigate to="/unlock" replace />;

  return (
    <div className="relative min-h-[100dvh] bg-kh-base text-kh-primary">
      {/* ambient glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-[420px] w-[420px] rounded-full bg-kh-cyan/[0.05] blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-[380px] w-[380px] rounded-full bg-kh-mint/[0.04] blur-[120px]" />
      </div>

      <Sidebar />

      <div className="relative min-[720px]:pl-[72px] min-[1100px]:pl-[264px]">
        <TopBar title={title} />
        <motion.main
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="mx-auto w-full max-w-[1080px] px-4 pb-28 pt-8 min-[720px]:pb-14 sm:px-8"
        >
          {children}
        </motion.main>
      </div>

      <MobileTabs />
    </div>
  );
}
