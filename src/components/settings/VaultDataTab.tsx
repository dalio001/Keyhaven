/**
 * Settings tab 2 — Vault & data.
 * - Encrypted backup export: saves pending edits first, then downloads exactly
 *   the encrypted record stored in this browser (ciphertext only).
 * - Import: the file, its master password and its contents are verified in
 *   memory BEFORE anything is replaced. The replaced vault is kept on this
 *   device ("previous vault") and can be restored or deleted. Legacy backups
 *   are upgraded (new key, passkey data removed) as they are imported.
 * - "This device" card and the danger zone (delete vault with type-to-confirm).
 */

import { useRef, useState } from 'react';
import { AlertTriangle, Download, History, MonitorSmartphone, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useVault } from '@/providers/VaultProvider';
import { FormatError, legacyPasskeyCount, parseBackupFile } from '@/lib/store/format';
import type { ParsedBackup } from '@/lib/store/format';
import type { ImportFailure } from '@/lib/store/controller';
import { downloadBackupFile } from '@/lib/download';
import { KhButton, SectionCard, Spinner, StatusChip } from './ui';
import { cn } from '@/lib/utils';

const LAST_EXPORT_KEY = 'keyhaven:last-export';

const IMPORT_ERRORS: Record<ImportFailure, string> = {
  'invalid-file': 'This file is not a valid KeyHaven backup.',
  'unsupported-version': 'This backup was made by a newer version of KeyHaven — update KeyHaven to import it.',
  'bad-password': 'That password doesn’t open this backup. Nothing was changed.',
  corrupt: 'This backup failed its integrity check (damaged or altered). Nothing was changed.',
  'current-unsaved':
    'Your current vault has changes that could not be saved yet, so nothing was replaced. Export or retry saving first.',
  conflict: 'The vault was changed in another tab while importing. Nothing was replaced — try again.',
  'storage-error': 'This browser’s storage refused the import. Nothing was replaced.',
  'not-allowed': 'Unlock your vault before importing a backup.',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function browserName(): string {
  const ua = navigator.userAgent;
  const browser = /edg/i.test(ua)
    ? 'Edge'
    : /chrome/i.test(ua)
      ? 'Chrome'
      : /safari/i.test(ua) && !/chrome/i.test(ua)
        ? 'Safari'
        : /firefox/i.test(ua)
          ? 'Firefox'
          : 'This browser';
  const os = /mac/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : /android/i.test(ua) ? 'Android' : /iphone|ipad/i.test(ua) ? 'iOS' : '';
  return os ? `${browser} on ${os}` : browser;
}

/* ------------------------------------------------------------------ */

function BackupCard() {
  const { entries, exportBackup, importBackup, previousVault, restorePreviousVault, discardPreviousVault } =
    useVault();
  const [exporting, setExporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [lastExport, setLastExport] = useState<string | null>(() => localStorage.getItem(LAST_EXPORT_KEY));
  const [pending, setPending] = useState<null | { text: string; parsed: ParsedBackup }>(null);
  const [password, setPassword] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [prevAction, setPrevAction] = useState<null | 'restore' | 'delete'>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    setExporting(true);
    try {
      const result = await exportBackup();
      if (result.ok) {
        downloadBackupFile(result.text);
        const stamp = new Date().toISOString();
        localStorage.setItem(LAST_EXPORT_KEY, stamp);
        setLastExport(stamp);
        toast.success(
          `Encrypted backup file created (${(new Blob([result.text]).size / 1024).toFixed(1)} KB of ciphertext)`,
        );
      } else if (result.unsavedText) {
        const text = result.unsavedText;
        toast.error('Your latest changes could not be saved to this browser', {
          description: 'You can still download them as an encrypted file (it opens with your master password).',
          action: { label: 'Download', onClick: () => downloadBackupFile(text, 'unsaved-changes') },
          duration: 15_000,
        });
      } else {
        toast.error('Export failed — the vault could not be read back from browser storage');
      }
    } finally {
      setTimeout(() => setExporting(false), 400);
    }
  };

  const pickFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setPending({ text, parsed: parseBackupFile(text) });
      setPassword('');
      setImportError(null);
    } catch (err) {
      toast.error(err instanceof FormatError ? err.message : 'Not a valid KeyHaven backup file');
    }
  };

  const doImport = async () => {
    if (!pending || importing || !password) return;
    setImporting(true);
    setImportError(null);
    const result = await importBackup(pending.text, password);
    setImporting(false);
    if (!result.ok) {
      setImportError(result.detail ?? IMPORT_ERRORS[result.reason]);
      return;
    }
    setPending(null);
    setPassword('');
    const migrated = result.migrated ? ' It was upgraded to the new encrypted format.' : '';
    if (result.unlocked) {
      toast.success(`Backup imported — vault unlocked.${migrated}`, {
        description: 'Your previous vault is kept on this device until you delete it.',
      });
    } else {
      toast.info(`Backup imported.${migrated} Unlock it with its master password and authenticator code.`, {
        duration: 5000,
      });
      // the app-shell guard routes to /unlock on its own
    }
  };

  const doPrevious = async () => {
    if (prevAction === 'restore') {
      const r = await restorePreviousVault();
      setPrevAction(null);
      if (r === 'ok') toast.success('Previous vault restored — unlock it with its own master password');
      else if (r === 'current-unsaved') toast.error('Your current changes are not saved yet — nothing was swapped');
      else toast.error('The previous vault could not be restored — nothing was changed');
    } else if (prevAction === 'delete') {
      await discardPreviousVault();
      setPrevAction(null);
      toast.success('Previous vault deleted from this device');
    }
  };

  const legacyCount = pending ? legacyPasskeyCount(pending.parsed.record) : 0;

  return (
    <SectionCard
      title="Backup & restore"
      helper="Your vault lives only in this browser. Export an encrypted backup file (AES-256-GCM, opens only with the master password in use when you export) and import it on any device."
    >
      <div className="flex flex-wrap gap-3">
        <KhButton variant="primary" onClick={() => void doExport()} disabled={exporting}>
          {exporting ? <Spinner /> : <Download className="h-4 w-4" />}
          Export encrypted vault
        </KhButton>
        <KhButton variant="secondary" onClick={() => fileInput.current?.click()}>
          <Upload className="h-4 w-4" /> Import backup
        </KhButton>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>

      {/* dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void pickFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => fileInput.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
        className={cn(
          'mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-all duration-200',
          dragOver ? 'scale-[1.01] border-kh-mint bg-kh-mint/5' : 'border-kh-lineStrong bg-kh-inset',
        )}
      >
        <Upload className={cn('h-5 w-5', dragOver ? 'text-kh-mint' : 'text-kh-faint')} />
        <p className="text-sm text-kh-muted">
          Drop a <span className="font-mono text-xs">keyhaven-backup-*.json</span> here, or click to browse
        </p>
        <p className="text-xs text-kh-faint">It stays encrypted — it is checked on this device before anything is replaced.</p>
      </div>

      {previousVault && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-kh-line bg-kh-inset px-4 py-3">
          <History className="h-4 w-4 shrink-0 text-kh-cyan" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-kh-primary">Previous vault kept on this device</p>
            <p className="text-xs text-kh-faint">
              Replaced by your last import or restore (last saved {fmtDateTime(previousVault.updatedAt)}). Still
              encrypted with its own master password.
            </p>
          </div>
          <KhButton variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setPrevAction('restore')}>
            Restore it
          </KhButton>
          <KhButton variant="dangerGhost" className="px-3 py-1.5 text-xs" onClick={() => setPrevAction('delete')}>
            Delete it
          </KhButton>
        </div>
      )}

      <p className="mt-4 font-mono text-[11px] leading-5 text-kh-faint">
        Last export: {fmtDateTime(lastExport)} · Vault size: {entries.length} entries · Storage:
        this browser (IndexedDB)
      </p>

      {/* import confirm + password modal */}
      <Dialog open={pending !== null} onOpenChange={(open) => !open && !importing && setPending(null)}>
        <DialogContent className="border-kh-line bg-kh-elevated sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-kh-primary">Import this backup?</DialogTitle>
            <DialogDescription className="text-kh-muted">
              {pending?.parsed.exportedAt ? `Exported ${fmtDateTime(pending.parsed.exportedAt)} · ` : ''}
              {pending?.parsed.record.version === 1 ? 'older format (will be upgraded) · ' : ''}
              {pending?.parsed.record.totpEnabled ? 'authenticator enabled' : 'no authenticator'}.
            </DialogDescription>
          </DialogHeader>
          {legacyCount > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-kh-danger/30 bg-kh-danger/5 p-3.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-kh-danger" />
              <p className="text-sm leading-6 text-kh-muted">
                This file contains old passkey data that lets anyone holding the file open it{' '}
                <span className="text-kh-primary">without your master password</span>. Importing re-encrypts the
                vault with a fresh key and drops that data — but the file itself stays unsafe: delete it and its
                copies after importing.
              </p>
            </div>
          )}
          <div className="flex items-start gap-3 rounded-xl border border-kh-warning/30 bg-kh-warning/5 p-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-kh-warning" />
            <p className="text-sm leading-6 text-kh-muted">
              Importing <span className="text-kh-primary">replaces</span> the vault currently on this device after
              the password is verified. The current vault is kept on this device as the “previous vault” until you
              delete it.
            </p>
          </div>
          <div className="space-y-2 py-1">
            <label htmlFor="import-password" className="text-sm font-medium text-kh-muted">
              Master password for this backup
            </label>
            <Input
              id="import-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="The password in use when the backup was made"
              autoComplete="off"
              className="h-11 border-kh-line bg-kh-inset font-mono text-sm text-kh-primary"
              onKeyDown={(e) => e.key === 'Enter' && password && void doImport()}
            />
            {importError && <p className="text-xs leading-5 text-kh-danger">{importError}</p>}
          </div>
          <DialogFooter>
            <KhButton variant="ghost" onClick={() => setPending(null)} disabled={importing}>
              Cancel
            </KhButton>
            <KhButton variant="primary" onClick={() => void doImport()} disabled={!password || importing}>
              {importing ? (
                <>
                  <Spinner /> Verifying…
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4" /> Verify & import
                </>
              )}
            </KhButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* previous-vault confirm */}
      <Dialog open={prevAction !== null} onOpenChange={(open) => !open && setPrevAction(null)}>
        <DialogContent className="border-kh-line bg-kh-elevated sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-kh-primary">
              {prevAction === 'restore' ? 'Restore the previous vault?' : 'Delete the previous vault?'}
            </DialogTitle>
            <DialogDescription className="text-kh-muted">
              {prevAction === 'restore'
                ? 'The two vaults swap places: the previous one becomes current (locked — unlock it with its own master password) and the current one is kept as the previous vault.'
                : 'The previous vault is permanently deleted from this browser. Your current vault is not affected.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <KhButton variant="ghost" onClick={() => setPrevAction(null)}>
              Cancel
            </KhButton>
            <KhButton variant={prevAction === 'delete' ? 'danger' : 'primary'} onClick={() => void doPrevious()}>
              {prevAction === 'restore' ? 'Restore' : 'Delete'}
            </KhButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */

function DevicesCard() {
  const { save } = useVault();
  const [sessionStart] = useState(() => new Date().toISOString());

  return (
    <SectionCard
      title="This device"
      helper="KeyHaven has no cloud account — this is unlock activity on this browser only."
    >
      <div className="flex items-center gap-3 rounded-xl border border-kh-line bg-kh-inset px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-kh-mint/30 bg-kh-mint/10">
          <MonitorSmartphone className="h-4 w-4 text-kh-mint" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-kh-primary">{browserName()} (current)</p>
          <p className="font-mono text-[11px] text-kh-faint">session started {fmtDateTime(sessionStart)}</p>
        </div>
        <StatusChip tone="mint">active now</StatusChip>
      </div>

      <div className="mt-3 space-y-1.5 font-mono text-[11px] leading-5 text-kh-faint">
        <p>last saved to this browser {fmtDateTime(save.lastSavedAt)}</p>
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */

function DangerZoneCard() {
  const { destroyVault } = useVault();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canDelete = typed === 'DELETE' && accepted && !deleting;

  const doDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    try {
      await destroyVault();
      toast.success('Vault deleted from this browser.');
      // guard routes to /unlock?mode=create
    } catch {
      setDeleting(false);
      toast.error('This browser’s storage refused the deletion — the vault is still here.');
    }
  };

  return (
    <SectionCard
      title="Danger zone"
      helper="Irreversible actions. Calm, but permanent."
      danger
      className="hover:border-kh-danger/50"
    >
      <div className="divide-y divide-kh-line">
        <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <div>
            <p className="text-sm font-medium text-kh-primary">Delete vault on this device</p>
            <p className="text-xs text-kh-faint">
              Wipes the encrypted vault (and any previous vault kept from an import) from this browser.
              Without a backup, it’s gone forever. Backup files you exported are not affected.
            </p>
          </div>
          <KhButton variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> Delete vault
          </KhButton>
        </div>
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteOpen(false);
            setTyped('');
            setAccepted(false);
          }
        }}
      >
        <DialogContent className="border-kh-danger/30 bg-kh-elevated sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kh-danger">
              <AlertTriangle className="h-5 w-5" /> Delete this vault forever?
            </DialogTitle>
            <DialogDescription className="text-kh-muted">
              The encrypted vault on this device is wiped immediately. There is no “undo”, no
              support line, no server copy — that’s the deal with zero-knowledge.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div>
              <label htmlFor="delete-confirm" className="mb-1.5 block text-sm font-medium text-kh-muted">
                Type <span className="font-mono text-kh-danger">DELETE</span> to confirm
              </label>
              <Input
                id="delete-confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                className={cn(
                  'h-11 border-kh-line bg-kh-inset font-mono text-sm text-kh-primary',
                  typed === 'DELETE' && 'border-kh-mint/60',
                )}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-kh-line bg-kh-inset p-3.5 text-sm text-kh-muted">
              <Checkbox
                checked={accepted}
                onCheckedChange={(v) => setAccepted(v === true)}
                className="mt-0.5 border-kh-lineStrong data-[state=checked]:border-kh-danger data-[state=checked]:bg-kh-danger data-[state=checked]:text-[#04110B]"
              />
              I have exported a backup or accept permanent loss.
            </label>
          </div>

          <DialogFooter>
            <KhButton variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Keep my vault
            </KhButton>
            <KhButton variant="danger" onClick={() => void doDelete()} disabled={!canDelete}>
              {deleting ? (
                <>
                  <Spinner /> Wiping…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" /> Delete forever
                </>
              )}
            </KhButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ */

export default function VaultDataTab() {
  return (
    <div className="space-y-6">
      <BackupCard />
      <DevicesCard />
      <DangerZoneCard />
    </div>
  );
}
