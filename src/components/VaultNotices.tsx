/**
 * VaultNotices — app-wide vault messages that must not be missed:
 *  - a banner when the latest changes could not be saved (storage error) or
 *    were rejected because the vault changed elsewhere (conflict), with
 *    recovery actions (retry / download encrypted copy / discard & reload);
 *  - the one-time explanation after a legacy vault was upgraded;
 *  - the notice that a damaged authenticator secret was turned off.
 */

import { useState } from 'react';
import { AlertTriangle, Download, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useVault } from '@/providers/VaultProvider';
import { downloadBackupFile } from '@/lib/download';

function SaveIssueBanner() {
  const { status, save, retrySave, unsavedBackupText, discardUnsaved } = useVault();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  if (status !== 'unlocked' || (save.state !== 'error' && save.state !== 'conflict')) return null;
  const conflict = save.state === 'conflict';
  const text = unsavedBackupText();
  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-20 z-[90] mx-auto max-w-[640px] rounded-2xl border border-kh-warning/50 bg-kh-elevated p-4 shadow-drawer sm:bottom-6"
    >
      <p className="flex items-start gap-2 text-sm font-medium leading-[22px] text-kh-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {conflict
          ? 'This vault was changed elsewhere (another tab, an import or a deletion), so your latest changes here were not saved.'
          : "Your latest changes aren't saved to this browser yet. KeyHaven keeps retrying — don't close this tab."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 pl-6">
        {!conflict && (
          <button
            type="button"
            onClick={retrySave}
            className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3 py-1.5 text-xs font-semibold text-kh-primary hover:bg-kh-surface"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry now
          </button>
        )}
        {text && (
          <button
            type="button"
            onClick={() => downloadBackupFile(text, 'unsaved-changes')}
            className="flex items-center gap-1.5 rounded-full border border-kh-lineStrong px-3 py-1.5 text-xs font-semibold text-kh-primary hover:bg-kh-surface"
          >
            <Download className="h-3.5 w-3.5" /> Download encrypted copy
          </button>
        )}
        {conflict &&
          (confirmDiscard ? (
            <button
              type="button"
              onClick={() => void discardUnsaved()}
              className="rounded-full border border-kh-danger/50 px-3 py-1.5 text-xs font-semibold text-kh-danger hover:bg-kh-danger hover:text-[#1A0508]"
            >
              Discard my changes &amp; reload the vault
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-kh-muted hover:text-kh-primary"
            >
              Discard &amp; reload…
            </button>
          ))}
      </div>
      {text && (
        <p className="mt-2 pl-6 text-xs leading-5 text-kh-faint">
          The copy is encrypted with your master password and can be imported later.
        </p>
      )}
    </div>
  );
}

function MigrationNoticeDialog() {
  const { migrationNotice, dismissMigrationNotice, exportBackup } = useVault();
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  if (!migrationNotice) return null;
  const removed = migrationNotice.removedPasskeys;

  const exportNow = async () => {
    const r = await exportBackup();
    if (r.ok) {
      downloadBackupFile(r.text);
      setExportMsg('Encrypted backup file created.');
    } else {
      setExportMsg("Couldn't export right now — try again from Settings → Vault & data.");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && dismissMigrationNotice()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-kh-lineStrong bg-kh-elevated text-kh-primary sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <ShieldCheck className="h-5 w-5 text-kh-mint" /> Your vault was upgraded
          </DialogTitle>
          <DialogDescription className="text-sm leading-[22px] text-kh-muted">
            KeyHaven re-encrypted this vault with a new key, derived from your master password and a fresh
            random salt, and saved it in the new storage format. Your logins and settings were kept.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm leading-[22px] text-kh-muted">
          {removed > 0 ? (
            <p>
              <span className="font-medium text-kh-primary">
                {removed} stored passkey record{removed === 1 ? ' was' : 's were'} removed.
              </span>{' '}
              The old passkey design stored data that let anyone with a copy of the vault data open it — without
              your master password and without the passkey. Passkey unlock is turned off until a secure design
              is available.
            </p>
          ) : (
            <p>
              No passkey data was found in this vault. If you ever registered a passkey with KeyHaven and later
              removed it, backups exported while it was registered are affected as described below.
            </p>
          )}
          <p>
            <span className="font-medium text-kh-primary">What this protects:</span> the vault stored in this
            browser now, and every backup you export from now on.
          </p>
          <p>
            <span className="font-medium text-kh-primary">What it cannot fix:</span> copies made earlier — backup
            files exported while a passkey was registered, browser-profile backups or synced copies, disk copies —
            can still be opened without your master password. No update can change files that already exist.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Export a fresh encrypted backup now, and delete older backup files and their copies.</li>
            <li>
              If someone else may have had access to an older copy, change the passwords stored in your vault
              (starting with the most important accounts) and your master password.
            </li>
            <li>
              Regenerate your authenticator backup codes and replace your authenticator in Settings — older
              copies contain them too.
            </li>
          </ol>
          {exportMsg && <p className="text-kh-mint">{exportMsg}</p>}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => void exportNow()}
            className="flex items-center justify-center gap-1.5 rounded-full border border-kh-lineStrong px-4 py-2 text-sm font-medium text-kh-primary hover:bg-kh-surface"
          >
            <Download className="h-4 w-4" /> Export a fresh backup
          </button>
          <button
            type="button"
            onClick={dismissMigrationNotice}
            className="bg-aurora rounded-full px-5 py-2 text-sm font-semibold text-[#04110B]"
          >
            I understand
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TotpResetNotice() {
  const { status, notice, dismissNotice, migrationNotice } = useVault();
  if (status !== 'unlocked' || notice !== 'totp-reset' || migrationNotice) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && dismissNotice()}>
      <DialogContent className="border-kh-lineStrong bg-kh-elevated text-kh-primary sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Authenticator turned off</DialogTitle>
          <DialogDescription className="text-sm leading-[22px] text-kh-muted">
            The stored authenticator data was damaged, so after your backup code was accepted the authenticator
            check was turned off. Your logins were not affected. Set the authenticator up again in Settings.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={dismissNotice}
            className="rounded-full border border-kh-lineStrong px-4 py-2 text-sm font-medium text-kh-primary hover:bg-kh-surface"
          >
            OK
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function VaultNotices() {
  return (
    <>
      <SaveIssueBanner />
      <MigrationNoticeDialog />
      <TotpResetNotice />
    </>
  );
}
