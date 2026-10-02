/**
 * AppShell — KeyHaven app shell for /vault (design.md §6.2): 264px sidebar
 * (72px icon rail <1100px, bottom tab bar <720px), 64px top bar with ⌘K
 * search pill, save-status chip (saved / saving / not saved), avatar menu, and the
 * auto-lock countdown widget (amber <60s, click = lock now).
 * Self-contained under src/components/vault/.
 */

import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  LayoutGrid,
  Lock,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Star,
  Wand2,
} from 'lucide-react';
import LetterAvatar from '@/components/LetterAvatar';
import VaultRing from '@/components/VaultRing';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useVault } from '@/providers/VaultProvider';
import SaveStatus from '@/components/SaveStatus';
import { cn } from '@/lib/utils';
import { CATEGORY_META, CATEGORY_ORDER, formatCountdown } from './vault-utils';
import type { CategoryFilter } from './vault-utils';
import type { FilterBarCounts } from './FilterBar';

type NavIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

function NavItem({
  active,
  onClick,
  icon: Icon,
  label,
  count,
  color,
  to,
}: {
  active?: boolean;
  onClick?: () => void;
  icon: NavIcon;
  label: string;
  count?: number;
  color?: string;
  to?: string;
}) {
  const cls = cn(
    'group relative flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors max-[1100px]:justify-center max-[1100px]:px-0',
    active ? 'bg-kh-elevated text-kh-primary' : 'text-kh-muted hover:bg-kh-elevated/60 hover:text-kh-primary',
  );
  const inner = (
    <>
      {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-kh-mint" />}
      <Icon className="h-[18px] w-[18px] shrink-0" style={color ? { color } : undefined} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left max-[1100px]:hidden">{label}</span>
      {typeof count === 'number' && (
        <span className="rounded-full bg-kh-inset px-1.5 py-0.5 font-mono text-[10px] text-kh-faint max-[1100px]:hidden">
          {count}
        </span>
      )}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls} title={label}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} title={label} aria-pressed={active}>
      {inner}
    </button>
  );
}

/** Sidebar bottom widget: mini VaultRing + live auto-lock countdown. */
function AutoLockWidget() {
  const { lockCountdown, lock, settings } = useVault();
  const total = Math.max(1, settings.autoLockMinutes * 60);
  const urgent = lockCountdown !== null && lockCountdown < 60;
  return (
    <button
      type="button"
      onClick={lock}
      title="Lock now"
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border border-kh-line bg-kh-inset p-2.5 text-left transition-colors hover:border-kh-lineStrong max-[1100px]:justify-center max-[1100px]:border-transparent max-[1100px]:bg-transparent max-[1100px]:p-0',
      )}
    >
      <VaultRing
        size={36}
        progress={lockCountdown !== null ? lockCountdown / total : undefined}
        muted={lockCountdown === null}
      >
        <Lock className={cn('h-3.5 w-3.5', urgent ? 'text-kh-warning' : 'text-kh-mint')} />
      </VaultRing>
      <span className="min-w-0 max-[1100px]:hidden">
        <span className={cn('block font-mono text-xs', urgent ? 'text-kh-warning' : 'text-kh-primary')}>
          {lockCountdown !== null ? `Locks in ${formatCountdown(lockCountdown)}` : 'Auto-lock off'}
        </span>
        <span className="block text-[11px] text-kh-faint">Click to lock now</span>
      </span>
    </button>
  );
}

export default function AppShell({
  counts,
  activeCategory,
  onSelectCategory,
  onNewLogin,
  onOpenPalette,
  children,
}: {
  counts: FilterBarCounts;
  activeCategory: CategoryFilter;
  onSelectCategory: (c: CategoryFilter) => void;
  onNewLogin: () => void;
  onOpenPalette: () => void;
  children: ReactNode;
}) {
  const { lock } = useVault();
  const navigate = useNavigate();

  return (
    <div className="flex h-[calc(100dvh-72px)] bg-kh-base">
      {/* ------------------------------------------------ sidebar */}
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-kh-line bg-kh-surface min-[720px]:flex max-[1100px]:w-[72px]">
        <div className="flex items-center gap-2.5 px-6 py-5 max-[1100px]:justify-center max-[1100px]:px-0">
          <img src="/logo.svg" alt="KeyHaven" className="h-7 w-7" />
          <span className="font-display text-lg font-semibold tracking-[-0.01em] max-[1100px]:hidden">
            <span className="text-aurora">Key</span>
            <span className="text-kh-primary">Haven</span>
          </span>
        </div>

        <div className="px-4 max-[1100px]:px-2">
          <button
            type="button"
            onClick={onNewLogin}
            className="bg-aurora flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[#04110B] transition-all hover:-translate-y-px hover:brightness-110 max-[1100px]:rounded-full"
            aria-label="New login"
          >
            <Plus className="h-4 w-4" />
            <span className="max-[1100px]:hidden">New login</span>
          </button>
        </div>

        <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 max-[1100px]:px-2" aria-label="Vault navigation">
          <NavItem
            icon={LayoutGrid}
            label="All Items"
            count={counts.total}
            active={activeCategory === 'all'}
            onClick={() => onSelectCategory('all')}
          />
          <NavItem
            icon={Star}
            label="Favorites"
            count={counts.favorites}
            active={activeCategory === 'favorites'}
            onClick={() => onSelectCategory('favorites')}
          />
          <p className="text-eyebrow mt-4 px-3 pb-1 text-[10px] text-kh-faint max-[1100px]:hidden">
            Categories
          </p>
          {CATEGORY_ORDER.map((c) => (
            <NavItem
              key={c}
              icon={({ className, style }: { className?: string; style?: React.CSSProperties }) => (
                <span className={cn('flex items-center justify-center', className)} style={style}>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_META[c].color }} />
                </span>
              )}
              label={CATEGORY_META[c].label}
              count={counts.perCategory[c]}
              active={activeCategory === c}
              onClick={() => onSelectCategory(c)}
            />
          ))}

          <div className="mt-auto" />
          <p className="text-eyebrow mt-4 px-3 pb-1 text-[10px] text-kh-faint max-[1100px]:hidden">Tools</p>
          <NavItem icon={ShieldCheck} label="Watchtower" to="/security" />
          <NavItem icon={Wand2} label="Generator" to="/generator" />
          <NavItem icon={SettingsIcon} label="Settings" to="/settings" />
        </nav>

        <div className="border-t border-kh-line p-4 max-[1100px]:p-2">
          <AutoLockWidget />
        </div>
      </aside>

      {/* ------------------------------------------------ main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-kh-line bg-kh-base/60 px-4 min-[900px]:px-6">
          <div className="min-w-0">
            <h1 className="truncate font-display text-[17px] font-semibold leading-tight text-kh-primary">
              Vault
            </h1>
            <p className="hidden text-[11px] leading-tight text-kh-faint min-[520px]:block">
              KeyHaven / Vault
            </p>
          </div>

          {/* center ⌘K search pill */}
          <div className="mx-auto w-full max-w-[380px]">
            <button
              type="button"
              onClick={onOpenPalette}
              className="flex w-full items-center gap-2.5 rounded-full border border-kh-line bg-kh-inset px-4 py-2 text-sm text-kh-faint transition-colors hover:border-kh-lineStrong hover:text-kh-muted"
            >
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left max-[520px]:hidden">
                Search your vault…
              </span>
              <span className="min-w-0 flex-1 truncate text-left min-[520px]:hidden">Search…</span>
              <kbd className="rounded border border-kh-lineStrong bg-kh-surface px-1.5 py-0.5 font-mono text-[10px] text-kh-muted">
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <SaveStatus className="hidden min-[900px]:flex" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Account menu" className="rounded-full transition-transform hover:scale-105">
                  <LetterAvatar name="Maya" size={32} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 border-kh-lineStrong bg-kh-elevated">
                <DropdownMenuItem className="gap-2 text-sm" onSelect={() => navigate('/settings')}>
                  <SettingsIcon className="h-3.5 w-3.5 text-kh-muted" /> Settings
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2 text-sm" onSelect={lock}>
                  <Lock className="h-3.5 w-3.5 text-kh-muted" /> Lock now
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-kh-line" />
                <DropdownMenuItem className="gap-2 text-sm" onSelect={() => navigate('/about')}>
                  <ShieldCheck className="h-3.5 w-3.5 text-kh-muted" /> About
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* native scroll inside the content column only */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24 min-[720px]:pb-8">
          {children}
        </div>
      </div>

      {/* ------------------------------------------------ bottom tab bar (<720px) */}
      <nav
        aria-label="Vault tabs"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-kh-line bg-kh-surface/95 px-2 py-2 backdrop-blur-md min-[720px]:hidden"
      >
        <TabButton icon={LayoutGrid} label="All" active={activeCategory === 'all'} onClick={() => onSelectCategory('all')} />
        <TabButton icon={Star} label="Favorites" active={activeCategory === 'favorites'} onClick={() => onSelectCategory('favorites')} />
        <button
          type="button"
          onClick={onNewLogin}
          aria-label="New login"
          className="bg-aurora -mt-5 flex h-11 w-11 items-center justify-center rounded-full text-[#04110B] shadow-glow"
        >
          <Plus className="h-5 w-5" />
        </button>
        <TabButton icon={ShieldCheck} label="Security" onClick={() => navigate('/security')} />
        <TabButton icon={SettingsIcon} label="Settings" onClick={() => navigate('/settings')} />
      </nav>
    </div>
  );
}

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof LayoutGrid;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex w-14 flex-col items-center gap-1 rounded-lg py-1 text-[10px] transition-colors',
        active ? 'text-kh-mint' : 'text-kh-faint hover:text-kh-primary',
      )}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      {label}
    </button>
  );
}