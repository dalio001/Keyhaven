/**
 * Settings tab 3 — Preferences.
 * Device-level preferences persisted to localStorage under the documented
 * `keyhaven:prefs` key (other surfaces read the same key; vault-critical
 * settings live in the encrypted VaultSettings instead — see AutoLockCard).
 * Renewal reminders are about your subscriptions, so they are saved in the
 * encrypted VaultSettings too (RenewalRemindersCard).
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SectionCard } from './ui';
import { REMINDER_DAY_CHOICES, reminderDays } from '@/lib/billing/reminders';
import { cn } from '@/lib/utils';
import { useVault } from '@/providers/VaultProvider';

export const PREFS_KEY = 'keyhaven:prefs';

export interface DevicePrefs {
  theme: 'obsidian' | 'midnight' | 'system';
  density: 'comfortable' | 'compact';
  reduceMotion: boolean;
  generatorLength: number;
  generatorMode: 'password' | 'passphrase' | 'pin';
  dateFormat: 'iso' | 'us' | 'eu';
  strengthDots: boolean;
}

const DEFAULT_PREFS: DevicePrefs = {
  theme: 'obsidian',
  density: 'comfortable',
  reduceMotion: false,
  generatorLength: 20,
  generatorMode: 'password',
  dateFormat: 'iso',
  strengthDots: true,
};

function loadPrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<DevicePrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-full border border-kh-line bg-kh-inset p-1"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative rounded-full px-4 py-1.5 text-sm transition-colors',
              active ? 'text-[#04110B]' : 'text-kh-muted hover:text-kh-primary',
            )}
          >
            {active && (
              <motion.span
                layoutId={`segmented-pill-${ariaLabel}`}
                className="bg-aurora absolute inset-0 rounded-full"
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              />
            )}
            <span className="relative z-10 font-medium">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PrefRow({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium text-kh-primary">{title}</p>
        {helper && <p className="mt-0.5 text-xs leading-5 text-kh-faint">{helper}</p>}
      </div>
      {children}
    </div>
  );
}

export default function PreferencesTab() {
  const [prefs, setPrefs] = useState<DevicePrefs>(loadPrefs);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const update = <K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    toast.success('Preference saved', { duration: 1400 });
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Appearance" helper="How KeyHaven looks on this device.">
        <div className="divide-y divide-kh-line">
          <PrefRow title="Theme" helper="Obsidian is the signature dark; Midnight is darker still.">
            <Segmented
              ariaLabel="Theme"
              value={prefs.theme}
              onChange={(v) => update('theme', v)}
              options={[
                { value: 'obsidian', label: 'Obsidian' },
                { value: 'midnight', label: 'Midnight' },
                { value: 'system', label: 'System' },
              ]}
            />
          </PrefRow>
          <PrefRow title="Density" helper="Compact tightens list rows from 64px to 52px.">
            <Segmented
              ariaLabel="Density"
              value={prefs.density}
              onChange={(v) => update('density', v)}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </PrefRow>
          <PrefRow title="Reduce motion" helper="Mirrors your OS setting; disables scramble effects.">
            <Switch
              checked={prefs.reduceMotion}
              onCheckedChange={(v) => update('reduceMotion', v)}
              aria-label="Reduce motion"
            />
          </PrefRow>
        </div>
      </SectionCard>

      <SectionCard title="Generator defaults" helper="New generators open with these.">
        <div className="divide-y divide-kh-line">
          <PrefRow title={`Default length — ${prefs.generatorLength} characters`}>
            <div className="w-[220px]">
              <Slider
                value={[prefs.generatorLength]}
                min={8}
                max={64}
                step={1}
                onValueChange={([v]) => setPrefs((p) => ({ ...p, generatorLength: v }))}
                onValueCommit={([v]) => update('generatorLength', v)}
                aria-label="Default generator length"
              />
            </div>
          </PrefRow>
          <PrefRow title="Default mode">
            <Select
              value={prefs.generatorMode}
              onValueChange={(v) => update('generatorMode', v as DevicePrefs['generatorMode'])}
            >
              <SelectTrigger className="h-10 w-[180px] border-kh-lineStrong bg-kh-inset text-sm text-kh-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-kh-line bg-kh-elevated">
                <SelectItem value="password" className="text-kh-primary focus:bg-kh-surface focus:text-kh-primary">
                  Password
                </SelectItem>
                <SelectItem value="passphrase" className="text-kh-primary focus:bg-kh-surface focus:text-kh-primary">
                  Passphrase
                </SelectItem>
                <SelectItem value="pin" className="text-kh-primary focus:bg-kh-surface focus:text-kh-primary">
                  PIN
                </SelectItem>
              </SelectContent>
            </Select>
          </PrefRow>
        </div>
      </SectionCard>

      <SectionCard title="Language & format">
        <div className="divide-y divide-kh-line">
          <PrefRow title="Date format">
            <Select
              value={prefs.dateFormat}
              onValueChange={(v) => update('dateFormat', v as DevicePrefs['dateFormat'])}
            >
              <SelectTrigger className="h-10 w-[180px] border-kh-lineStrong bg-kh-inset text-sm text-kh-primary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-kh-line bg-kh-elevated">
                <SelectItem value="iso" className="text-kh-primary focus:bg-kh-surface focus:text-kh-primary">
                  2024-06-20
                </SelectItem>
                <SelectItem value="us" className="text-kh-primary focus:bg-kh-surface focus:text-kh-primary">
                  06/20/2024
                </SelectItem>
                <SelectItem value="eu" className="text-kh-primary focus:bg-kh-surface focus:text-kh-primary">
                  20/06/2024
                </SelectItem>
              </SelectContent>
            </Select>
          </PrefRow>
          <PrefRow title="Strength dots in list" helper="Show password strength dots next to every login.">
            <Switch
              checked={prefs.strengthDots}
              onCheckedChange={(v) => update('strengthDots', v)}
              aria-label="Show password strength dots in list"
            />
          </PrefRow>
        </div>
      </SectionCard>

      <RenewalRemindersCard />
    </div>
  );
}

const dayLabel = (n: number) => (n === 0 ? 'Off' : n === 1 ? '1 day' : `${n} days`);

/** how many days ahead to remind about renewals — saved in the encrypted vault settings */
function RenewalRemindersCard() {
  const { settings, updateSettings, flush } = useVault();
  const days = reminderDays(settings);
  // a value a later version saved is shown as is, never silently reset
  const choices = (REMINDER_DAY_CHOICES as readonly number[]).includes(days)
    ? [...REMINDER_DAY_CHOICES]
    : [...REMINDER_DAY_CHOICES, days].sort((a, b) => a - b);

  const change = (v: string) => {
    if (!updateSettings({ renewalReminderDays: Number(v) })) {
      toast.error('The vault is locked or out of date — preference not saved');
      return;
    }
    flush().then(
      () => toast.success('Preference saved', { duration: 1400 }),
      () => toast.error('Preference not saved to this browser yet — KeyHaven is retrying'),
    );
  };

  return (
    <SectionCard title="Renewal reminders" helper="Saved in your encrypted vault, so they follow your backups.">
      <PrefRow
        title="Remind me before renewals"
        helper="Shown in KeyHaven while it's open, and as alarms in the calendar files you export from Subscriptions."
      >
        <Segmented
          ariaLabel="Remind me before renewals"
          value={String(days)}
          onChange={change}
          options={choices.map((n) => ({ value: String(n), label: dayLabel(n) }))}
        />
      </PrefRow>
    </SectionCard>
  );
}
