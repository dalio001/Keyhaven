/**
 * /security — Watchtower (design/security.md).
 *
 * Computes a real audit of the decrypted vault via useVault() + zxcvbn-ts:
 * weak (score ≤ 1) · reused (duplicate passwords) · old (> 12 months) ·
 * breached (flagged entries). Renders the animated VaultRing score gauge,
 * issue accordions with one-click fixes, the offline breach-style radar
 * scan, a security event timeline and a recommendations strip — all inside
 * a self-contained app shell (src/components/security/SecurityShell).
 *
 * Guard: locked / no vault → redirect /unlock. Empty vault → graceful
 * all-clear fallbacks in every section.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useVault } from '@/providers/VaultProvider';
import SecurityShell from '@/components/security/SecurityShell';
import ScoreHero from '@/components/security/ScoreHero';
import type { ScrollTarget } from '@/components/security/ScoreHero';
import IssueGroups from '@/components/security/IssueGroups';
import BreachScan from '@/components/security/BreachScan';
import SecurityTimeline from '@/components/security/SecurityTimeline';
import Recommendations from '@/components/security/Recommendations';
import { readLastExport } from '@/lib/lastExport';
import type { CheckType } from '@/components/security/analysis';
import { GROUP_IDS, analyzeVault, ignoreKey, loadIgnored, saveIgnored } from '@/components/security/analysis';

export default function Security() {
  const { status, entries, totpEnabled, settings } = useVault();

  const [ignored, setIgnored] = useState<Set<string>>(() => loadIgnored());
  const [highlighted, setHighlighted] = useState<CheckType | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const audit = useMemo(() => analyzeVault(entries, ignored), [entries, ignored]);

  const toggleIgnore = useCallback((entryId: string, check: CheckType) => {
    setIgnored((prev) => {
      const next = new Set(prev);
      const key = ignoreKey(entryId, check);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveIgnored(next);
      return next;
    });
  }, []);

  const flashHighlight = useCallback((check: CheckType) => {
    setHighlighted(check);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlighted(null), 2400);
  }, []);

  const scrollTo = useCallback(
    (target: ScrollTarget) => {
      let id: string;
      if (target === 'scan') id = 'wt-scan';
      else if (target === 'tips') id = 'wt-tips';
      else {
        id = GROUP_IDS[target];
        flashHighlight(target);
      }
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [flashHighlight],
  );

  const reviewBreaches = useCallback(() => scrollTo('breached'), [scrollTo]);

  /* ------------------------------ guard ------------------------------ */
  if (status !== 'unlocked' && status !== 'loading') {
    return <Navigate to="/unlock" replace />;
  }
  if (status === 'loading') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <Loader2 className="h-6 w-6 animate-spin text-kh-mint" />
        <p className="font-mono text-[13px] text-kh-faint">decrypting vault…</p>
      </div>
    );
  }

  return (
    <SecurityShell>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="space-y-20"
      >
        {/* page intro */}
        <div>
          <p className="text-eyebrow text-kh-mint">Watchtower</p>
          <p className="mt-2 max-w-[64ch] leading-[26px] text-kh-muted">
            Your vault's health, checked locally —{' '}
            <span className="font-mono text-[14px] text-kh-primary">these results never leave your device.</span>
          </p>
        </div>

        {/* §1 — score hero */}
        <ScoreHero
          audit={audit}
          totpEnabled={totpEnabled}
          onScrollTo={scrollTo}
          onHighlight={setHighlighted}
        />

        {/* §2 — issue groups */}
        <IssueGroups audit={audit} ignored={ignored} onToggleIgnore={toggleIgnore} highlighted={highlighted} />

        {/* §3 — local breach scan */}
        <BreachScan entries={entries} onReviewBreaches={reviewBreaches} />

        {/* §4 — security timeline */}
        <SecurityTimeline entries={entries} />

        {/* §5 — recommendations */}
        <Recommendations autoLockMinutes={settings.autoLockMinutes} lastExportAt={readLastExport()} entries={entries} />
      </motion.div>
    </SecurityShell>
  );
}