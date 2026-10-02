/**
 * Settings → Security methods → Auto-lock & clipboard card.
 * VaultSettings via useVault: autoLockMinutes, clipboardClearSeconds,
 * remaskSeconds — every change persists (encrypted) and toasts.
 */

import { Clock, Copy, Eye } from 'lucide-react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useVault } from '@/providers/VaultProvider';
import { SectionCard } from './ui';

/** clipboard "Never" is stored as 24h — practically never within a session */
const NEVER_SECONDS = 86_400;

const AUTO_LOCK_OPTIONS = [
  { value: '1', label: '1 minute' },
  { value: '5', label: '5 minutes (default)' },
  { value: '15', label: '15 minutes' },
  { value: '0', label: 'Only when the tab closes' },
];

const CLIPBOARD_OPTIONS = [
  { value: '10', label: '10 seconds' },
  { value: '20', label: '20 seconds (default)' },
  { value: '60', label: '60 seconds' },
  { value: String(NEVER_SECONDS), label: 'Never (not recommended)' },
];

const REMASK_OPTIONS = [
  { value: '15', label: '15 seconds (default)' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '60 seconds' },
];

function SettingRow({
  icon: Icon,
  title,
  helper,
  value,
  options,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  helper: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 py-4 first:pt-0 last:pb-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-kh-line bg-kh-inset">
        <Icon className="h-4 w-4 text-kh-cyan" />
      </span>
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium text-kh-primary">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-kh-faint">{helper}</p>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-[220px] border-kh-lineStrong bg-kh-inset text-sm text-kh-primary">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-kh-line bg-kh-elevated">
          {options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="text-sm text-kh-primary focus:bg-kh-surface focus:text-kh-primary"
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function AutoLockCard() {
  const { settings, updateSettings, flush } = useVault();

  const clipboardValue = settings.clipboardClearSeconds >= 3600 ? String(NEVER_SECONDS) : String(settings.clipboardClearSeconds);

  const saved = () =>
    flush().then(
      () => toast.success('Preference saved', { duration: 1600 }),
      () => toast.error("Preference not saved to this browser yet — KeyHaven is retrying"),
    );

  return (
    <SectionCard
      id="auto-lock"
      title="Auto-lock & clipboard"
      helper="Quiet hygiene timers that keep an unattended vault from staying open."
    >
      <div className="divide-y divide-kh-line">
        <SettingRow
          icon={Clock}
          title="Auto-lock"
          helper="Vault locks itself after inactivity. Pending changes are encrypted and saved first."
          value={String(settings.autoLockMinutes)}
          options={AUTO_LOCK_OPTIONS}
          onChange={(v) => {
            if (updateSettings({ autoLockMinutes: Number(v) })) void saved();
          }}
        />
        <SettingRow
          icon={Copy}
          title="Clipboard auto-clear"
          helper="Copied passwords vanish from your clipboard on a timer."
          value={clipboardValue}
          options={CLIPBOARD_OPTIONS}
          onChange={(v) => {
            if (updateSettings({ clipboardClearSeconds: Number(v) })) void saved();
          }}
        />
        <SettingRow
          icon={Eye}
          title="Reveal timeout"
          helper="Mask revealed passwords again after this long."
          value={String(settings.remaskSeconds)}
          options={REMASK_OPTIONS}
          onChange={(v) => {
            if (updateSettings({ remaskSeconds: Number(v) })) void saved();
          }}
        />
      </div>
    </SectionCard>
  );
}
