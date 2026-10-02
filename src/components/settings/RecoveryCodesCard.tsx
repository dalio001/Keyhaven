/**
 * Settings → Security methods → Authenticator backup codes card.
 * One-time codes that replace the 6-digit authenticator code at unlock (e.g.
 * after losing the phone). The master password is ALWAYS still required:
 * these codes cannot recover a forgotten master password.
 * Masked mono grid (auto-remasks on the vault remask timer), reveal-all with
 * a mini-scramble per code, Download .txt, Print, and Regenerate behind an
 * amber confirm (old codes stop working once the new ones are saved).
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Eye, EyeOff, FileDown, Printer, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import LiveScramble from '@/components/LiveScramble';
import { useVault } from '@/providers/VaultProvider';
import { downloadTextFile } from '@/lib/download';
import { EASE, KhButton, SectionCard, StatusChip } from './ui';

const MASKED = '••••-••••-••••';

function backupCodesText(codes: string[]): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return [
    'KEYHAVEN — AUTHENTICATOR BACKUP CODES',
    `Printed: ${stamp}`,
    '',
    'Each code works ONCE instead of the 6-digit authenticator code, e.g. if',
    'you lose your phone. Your master password is still required.',
    'These codes CANNOT recover a forgotten master password — nothing can.',
    'Keep them offline and away from your master password.',
    '',
    'BACKUP CODES (each works once):',
    ...codes.map((c, i) => `  ${String(i + 1).padStart(2, ' ')}. ${c}`),
    '',
    'How to use: KeyHaven → Unlock → enter your master password →',
    '"Lost your phone? Use a backup code" → enter one code above.',
    '',
    'KeyHaven is local-first: your vault is encrypted in your browser.',
  ].join('\n');
}

export default function RecoveryCodesCard() {
  const { backupCodes: recoveryCodes, regenerateBackupCodes, settings, totpEnabled } = useVault();
  const [revealed, setRevealed] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  // auto-remask on the vault's reveal timeout
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), Math.max(5, settings.remaskSeconds) * 1000);
    return () => clearTimeout(t);
  }, [revealed, settings.remaskSeconds, recoveryCodes]);

  const stamp = new Date().toISOString().slice(0, 10);

  const downloadTxt = () => {
    downloadTextFile(`keyhaven-backup-codes-${stamp}.txt`, backupCodesText(recoveryCodes));
    toast.success('Backup codes file created — store it offline');
  };

  const printKit = () => {
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) {
      toast.error('Popup blocked — allow popups to print the kit');
      return;
    }
    const rows = recoveryCodes
      .map(
        (c, i) =>
          `<div style="display:flex;gap:16px;padding:10px 0;border-bottom:1px dashed #ccc">
            <span style="color:#888;width:24px">${i + 1}.</span>
            <code style="font-family:ui-monospace,monospace;font-size:16px;letter-spacing:2px">${c}</code>
          </div>`,
      )
      .join('');
    w.document.write(`<!doctype html><html><head><title>KeyHaven backup codes</title></head>
      <body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;color:#111;padding:0 24px">
        <h1 style="font-size:22px;margin-bottom:4px">KeyHaven — authenticator backup codes</h1>
        <p style="color:#555;font-size:13px;margin-top:0">Printed ${stamp} · Keep this page offline and away from your master password.
        Each code works once instead of the 6-digit authenticator code. Your master password is still required —
        these codes cannot recover a forgotten master password.</p>
        <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:2px;margin-top:28px">Backup codes (each works once)</h2>
        ${rows}
        <p style="color:#555;font-size:13px;margin-top:28px">How to use: KeyHaven → Unlock → enter your master password →
        “Lost your phone? Use a backup code” → enter one code above.</p>
        <script>window.print()</script>
      </body></html>`);
    w.document.close();
  };

  const regenerate = async () => {
    setRegenOpen(false);
    try {
      await regenerateBackupCodes();
      setRevealed(true);
      toast.success('New backup codes saved — the old ones no longer work');
    } catch {
      toast.error("New codes couldn't be saved yet — the old codes still work until they are");
    }
  };

  return (
    <SectionCard
      id="recovery"
      title="Authenticator backup codes"
      helper={
        totpEnabled
          ? 'One-time codes that replace the 6-digit authenticator code if you lose your phone. Your master password is still required — they cannot recover it. Store them offline.'
          : 'These one-time codes only matter when the authenticator is turned on: they replace its 6-digit code. They never replace or recover your master password.'
      }
      headerAction={<StatusChip tone="faint">{recoveryCodes.length} codes</StatusChip>}
    >
      {/* grid */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {recoveryCodes.map((code, i) => (
            <motion.div
              key={`${code}-${i}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: revealed ? i * 0.04 : 0, duration: 0.3, ease: EASE }}
              className="flex items-center rounded-lg border border-kh-line bg-kh-inset px-4 py-3"
            >
              <span className="mr-3 font-mono text-[11px] text-kh-faint">{String(i + 1).padStart(2, '0')}</span>
              {revealed ? (
                <LiveScramble text={code} className="font-mono text-sm tracking-wider text-kh-mint" speed={22} />
              ) : (
                <span className="font-mono text-sm tracking-wider text-kh-faint">{MASKED}</span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* actions */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <KhButton variant="secondary" onClick={() => setRevealed((r) => !r)}>
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {revealed ? 'Mask all' : 'Reveal all'}
        </KhButton>
        <KhButton variant="ghost" onClick={downloadTxt}>
          <FileDown className="h-4 w-4" /> Download .txt
        </KhButton>
        <KhButton variant="ghost" onClick={printKit}>
          <Printer className="h-4 w-4" /> Print codes
        </KhButton>
        <KhButton variant="amberGhost" onClick={() => setRegenOpen(true)}>
          <RefreshCw className="h-4 w-4" /> Regenerate
        </KhButton>
      </div>
      {revealed && (
        <p className="mt-3 font-mono text-[11px] text-kh-faint">
          masks again in {settings.remaskSeconds}s
        </p>
      )}

      {/* regenerate confirm */}
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent className="border-kh-line bg-kh-elevated sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kh-primary">
              <AlertTriangle className="h-5 w-5 text-kh-warning" /> Regenerate codes?
            </DialogTitle>
            <DialogDescription className="text-kh-muted">
              Old codes stop working as soon as the new ones are saved. A printed or downloaded
              copy of the old codes becomes useless — save the new ones.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <KhButton variant="ghost" onClick={() => setRegenOpen(false)}>
              Keep current codes
            </KhButton>
            <KhButton
              onClick={() => void regenerate()}
              className="border border-kh-warning/50 text-kh-warning hover:bg-kh-warning hover:text-[#04110B]"
            >
              <RefreshCw className="h-4 w-4" /> Regenerate
            </KhButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
