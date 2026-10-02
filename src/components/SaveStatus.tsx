/**
 * SaveStatus — compact chip showing whether the vault's latest changes are
 * saved (encrypted) in this browser. Never claims "saved" before the write
 * has actually been committed.
 */

import { useVault } from '@/providers/VaultProvider';
import { cn } from '@/lib/utils';

export default function SaveStatus({ className }: { className?: string }) {
  const { save, retrySave } = useVault();
  const problem = save.state === 'error' || save.state === 'conflict';
  const dot =
    save.state === 'conflict'
      ? 'bg-kh-danger'
      : save.state === 'error'
        ? 'bg-kh-warning'
        : save.state === 'saving'
          ? 'bg-kh-cyan animate-dot-pulse'
          : 'bg-kh-mint animate-dot-pulse';
  const label =
    save.state === 'conflict'
      ? 'Not saved · changed elsewhere'
      : save.state === 'error'
        ? 'Not saved yet'
        : save.state === 'saving'
          ? 'Saving…'
          : 'Saved · encrypted locally';

  return (
    <span
      role="status"
      aria-live="polite"
      title={save.lastSavedAt ? `Last saved ${new Date(save.lastSavedAt).toLocaleString()}` : undefined}
      className={cn(
        'items-center gap-2 rounded-full border bg-kh-surface px-3 py-1.5 text-xs',
        problem ? 'flex border-kh-warning/50 text-kh-warning' : 'border-kh-line text-kh-muted',
        className,
        problem && 'flex',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      {label}
      {save.state === 'error' && (
        <button type="button" onClick={retrySave} className="font-semibold underline-offset-2 hover:underline">
          Retry
        </button>
      )}
    </span>
  );
}
