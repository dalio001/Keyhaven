/**
 * /settings — security methods & vault control (design/settings.md).
 * App-shell guard: locked / no-vault → redirect /unlock (create mode when
 * there is no vault yet). Two-level layout: left tab rail + tab panels.
 * Tabs: Security methods (default) · Vault & data · Preferences · About.
 * `?tab=data` (or another tab id) opens that tab.
 */

import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { Database, Info, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import SettingsShell from '@/components/settings/SettingsShell';
import SecurityMethodsTab from '@/components/settings/SecurityMethodsTab';
import VaultDataTab from '@/components/settings/VaultDataTab';
import PreferencesTab from '@/components/settings/PreferencesTab';
import AboutTab from '@/components/settings/AboutTab';
import { EASE } from '@/components/settings/ui';
import VaultRing from '@/components/VaultRing';
import { Toaster } from '@/components/ui/sonner';
import { useVault } from '@/providers/VaultProvider';
import { cn } from '@/lib/utils';

type TabId = 'security' | 'data' | 'preferences' | 'about';

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'security', label: 'Security methods', icon: ShieldCheck },
  { id: 'data', label: 'Vault & data', icon: Database },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'about', label: 'About', icon: Info },
];

export default function Settings() {
  const { status } = useVault();
  // /settings?tab=data opens Vault & data (e.g. from the backup reminder)
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabId>(() => TABS.find((t) => t.id === params.get('tab'))?.id ?? 'security');

  if (status === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <VaultRing size={72} muted />
        <p className="font-mono text-xs text-kh-faint">checking vault…</p>
      </div>
    );
  }

  // app-shell guard: nothing to lock → create flow; any other non-unlocked state → /unlock
  if (status === 'no-vault') return <Navigate to="/unlock?mode=create" replace />;
  if (status !== 'unlocked') return <Navigate to="/unlock" replace />;

  return (
    <SettingsShell>
      <Toaster position="bottom-right" theme="dark" />

      {/* page header */}
      <div className="mb-8">
        <p className="text-eyebrow text-kh-mint">Vault control room</p>
        <h2 className="mt-2 font-display text-3xl font-bold tracking-[-0.02em] text-kh-primary">
          Settings
        </h2>
        <p className="mt-2 max-w-[62ch] text-sm leading-6 text-kh-muted">
          How your vault is protected, in one place — master password, authenticator, backup
          codes, encrypted backups. Everything here is stored encrypted in this browser only.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* tab rail */}
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto pb-1 lg:w-[200px] lg:flex-col lg:overflow-visible"
        >
          {TABS.map((t, i) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <motion.button
                key={t.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * i, duration: 0.4, ease: EASE }}
                onClick={() => {
                  setTab(t.id);
                  setParams({ tab: t.id }, { replace: true }); // Back returns to the tab you left
                }}
                className={cn(
                  'relative flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3.5 text-sm transition-colors lg:w-full',
                  active
                    ? 'bg-kh-elevated text-kh-primary'
                    : 'text-kh-muted hover:bg-kh-elevated/60 hover:text-kh-primary',
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-kh-mint max-lg:hidden" />
                )}
                <Icon className={cn('h-4 w-4', active && 'text-kh-mint')} />
                {t.label}
              </motion.button>
            );
          })}
        </nav>

        {/* panels */}
        <div className="min-w-0 w-full max-w-[760px] flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {tab === 'security' && <SecurityMethodsTab />}
              {tab === 'data' && <VaultDataTab />}
              {tab === 'preferences' && <PreferencesTab />}
              {tab === 'about' && <AboutTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </SettingsShell>
  );
}