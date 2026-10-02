/**
 * RestoreBackupPanel — restore an encrypted KeyHaven backup file on a device
 * that has no (readable) vault. The file, its master password and its
 * contents are verified in memory before anything is written; legacy backups
 * are upgraded (fresh key, passkey data removed) as they are imported.
 */

import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { useVault } from '@/providers/VaultProvider';
import type { ImportFailure } from '@/lib/store/controller';
import { cn } from '@/lib/utils';

const ERRORS: Record<ImportFailure, string> = {
  'invalid-file': 'This file is not a valid KeyHaven backup.',
  'unsupported-version': 'This backup was made by a newer version of KeyHaven — update KeyHaven to import it.',
  'bad-password': "That password doesn't open this backup.",
  corrupt: 'This backup failed its integrity check (damaged or altered).',
  'current-unsaved': 'Unsaved changes are pending — nothing was replaced.',
  conflict: 'The vault changed in another tab — nothing was replaced. Try again.',
  'storage-error': "This browser's storage refused the import.",
  'not-allowed': 'A vault already exists here — unlock it and import from Settings instead.',
};

export default function RestoreBackupPanel({ onDone }: { onDone?: () => void }) {
  const { importBackup } = useVault();
  const [fileText, setFileText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!fileText || !password || busy) return;
    setBusy(true);
    setError(null);
    const r = await importBackup(fileText, password);
    setBusy(false);
    if (r.ok) {
      setPassword('');
      onDone?.();
    } else {
      setError(r.detail ?? ERRORS[r.reason]);
    }
  };

  return (
    <div className="w-full space-y-3 rounded-xl border border-kh-line bg-kh-inset p-4 text-left">
      <p className="text-sm font-medium text-kh-primary">Restore from an encrypted backup</p>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setFileName(f.name);
          setFileText(await f.text());
          setError(null);
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-kh-lineStrong px-3 py-3 text-sm text-kh-muted transition-colors hover:text-kh-primary"
      >
        <Upload className="h-4 w-4" />
        <span className="truncate">{fileName ?? 'Choose keyhaven-backup-*.json'}</span>
      </button>
      {fileText && (
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="Master password used for this backup"
          aria-label="Master password for the backup"
          autoComplete="off"
          className="h-11 w-full rounded-md border border-kh-line bg-kh-base px-3 font-mono text-sm text-kh-primary placeholder:text-kh-faint focus:border-kh-cyan/60 focus:outline-none"
        />
      )}
      {error && (
        <p className="text-sm text-kh-danger" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!fileText || !password || busy}
        className={cn(
          'flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-kh-lineStrong text-sm font-semibold text-kh-primary transition-colors hover:bg-kh-elevated',
          'disabled:cursor-not-allowed disabled:opacity-40',
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? 'Verifying…' : 'Verify & restore'}
      </button>
      <p className="text-xs leading-5 text-kh-faint">Checked on this device before anything is written.</p>
    </div>
  );
}
