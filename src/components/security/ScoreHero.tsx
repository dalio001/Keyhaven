/**
 * ScoreHero — Watchtower §1. Left: ScoreGauge + penalty breakdown chips
 * (hover highlights / click scrolls to the matching issue group). Right:
 * headline, dynamic summary copy, security checklist with drawn checks,
 * and the "Fix weakest first" / "Run breach scan" CTAs.
 */

import { motion } from 'framer-motion';
import { Check, ChevronRight, KeyRound, Radar, Smartphone } from 'lucide-react';
import { Link } from 'react-router';
import ScoreGauge from './ScoreGauge';
import type { CheckType, VaultAudit } from './analysis';
import { BAND_HEADLINE, scoreBand } from './analysis';
import { cn } from '@/lib/utils';

export type ScrollTarget = CheckType | 'scan' | 'tips';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** mint check that draws itself as its row lands */
function DrawnCheck({ delay }: { delay: number }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-kh-mint/12">
      <motion.svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
        <motion.path
          d="M2.5 7.5 5.5 10.5 11.5 3.5"
          stroke="#35F0A1"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay, duration: 0.3, ease: 'easeOut' }}
        />
      </motion.svg>
    </span>
  );
}

export default function ScoreHero({
  audit,
  totpEnabled,
  onScrollTo,
  onHighlight,
}: {
  audit: VaultAudit;
  totpEnabled: boolean;
  onScrollTo: (t: ScrollTarget) => void;
  onHighlight: (c: CheckType | null) => void;
}) {
  const { score, penalties, total, uniqueCount, issueIds, fixesToNinety } = audit;
  const issueCount = issueIds.size;
  const band = scoreBand(score);

  const allChips: { check: CheckType; amount: number; label: string; color: string }[] = [
    { check: 'weak', amount: penalties.weak, label: 'weak', color: '#FF5C7A' },
    { check: 'reused', amount: penalties.reused, label: 'reused', color: '#FFB84D' },
    { check: 'old', amount: penalties.old, label: 'old', color: '#FFB84D' },
    { check: 'breached', amount: penalties.breached, label: 'breached', color: '#FF5C7A' },
  ];
  const chips = allChips.filter((c) => c.amount > 0);

  const summary =
    total === 0
      ? 'Add your first login and Watchtower will grade its strength, spot reuse and flag breaches — all locally, on this device.'
      : issueCount === 0
        ? `No weak, reused, old or breached passwords across ${plural(total, 'login')}. Keep it up — a fresh scan never hurts.`
        : score < 90
          ? `${plural(fixesToNinety, 'fix')} would push you past 90. Strongest area: unique passwords on ${uniqueCount} of ${total} logins.`
          : `Strongest area: unique passwords on ${uniqueCount} of ${total} logins.`;

  const checklist: {
    key: string;
    done: boolean;
    icon: typeof KeyRound;
    label: string;
    action?: { label: string; onClick: () => void };
    to?: string;
  }[] = [
    { key: 'master', done: true, icon: KeyRound, label: 'Master password set' },
    {
      key: 'totp',
      done: totpEnabled,
      icon: Smartphone,
      label: totpEnabled ? 'Authenticator check enabled' : 'Authenticator check not enabled yet',
      to: totpEnabled ? undefined : '/settings',
    },
    {
      key: 'weak',
      done: penalties.weak === 0,
      icon: KeyRound,
      label:
        penalties.weak === 0
          ? 'No weak passwords'
          : `${plural(audit.weak.length, 'weak password')} to replace`,
      action:
        penalties.weak === 0
          ? undefined
          : { label: 'Fix now', onClick: () => onScrollTo('weak') },
    },
  ];

  return (
    <section aria-label="Security score" className="grid items-center gap-12 min-[900px]:grid-cols-12">
      {/* gauge + chips */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="flex flex-col items-center min-[900px]:col-span-5"
      >
        <ScoreGauge score={score} />
        {chips.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {chips.map((chip, i) => (
              <motion.button
                key={chip.check}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.2 + i * 0.08, type: 'spring', stiffness: 260, damping: 20 }}
                onMouseEnter={() => onHighlight(chip.check)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(chip.check)}
                onBlur={() => onHighlight(null)}
                onClick={() => onScrollTo(chip.check)}
                className="rounded-full border px-3 py-1.5 font-mono text-[13px] transition-all duration-200 hover:-translate-y-px"
                style={{
                  color: chip.color,
                  borderColor: `${chip.color}45`,
                  backgroundColor: `${chip.color}12`,
                }}
                aria-label={`${chip.label} passwords, minus ${chip.amount} points — jump to group`}
              >
                −{chip.amount} {chip.label}
              </motion.button>
            ))}
          </div>
        )}
      </motion.div>

      {/* copy + checklist + CTAs */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.25 } } }}
        className="min-[900px]:col-span-7"
      >
        <motion.h2
          variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }}
          className="font-display text-[clamp(28px,4vw,40px)] font-bold leading-[1.15] tracking-[-0.02em] text-kh-primary"
        >
          {total === 0 ? 'Your vault is empty — and fully secure.' : BAND_HEADLINE[band]}
        </motion.h2>
        <motion.p
          variants={{ hidden: { opacity: 0, y: 18 }, show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }}
          className="mt-3 max-w-[52ch] leading-[26px] text-kh-muted"
        >
          {summary}
        </motion.p>

        <ul className="mt-7 space-y-2.5">
          {checklist.map((row, i) => (
            <motion.li
              key={row.key}
              variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } } }}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-4 py-3',
                row.done ? 'border-kh-line bg-kh-surface/60' : 'border-kh-warning/25 bg-kh-warning/[0.05]',
              )}
            >
              {row.done ? (
                <DrawnCheck delay={0.35 + i * 0.09} />
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-kh-warning/50">
                  <row.icon className="h-3 w-3 text-kh-warning" />
                </span>
              )}
              <span className={cn('flex-1 text-sm', row.done ? 'text-kh-primary' : 'text-kh-muted')}>
                {row.label}
              </span>
              {row.action && (
                <button
                  onClick={row.action.onClick}
                  className="flex items-center gap-1 rounded-full bg-kh-warning/15 px-3 py-1 text-[12px] font-semibold text-kh-warning transition-all hover:-translate-y-px hover:bg-kh-warning/25"
                >
                  {row.action.label}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
              {row.to && (
                <Link
                  to={row.to}
                  className="flex items-center gap-1 rounded-full bg-kh-warning/15 px-3 py-1 text-[12px] font-semibold text-kh-warning transition-all hover:-translate-y-px hover:bg-kh-warning/25"
                >
                  Set up
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </motion.li>
          ))}
        </ul>

        <motion.div
          variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } } }}
          className="mt-7 flex flex-wrap items-center gap-3"
        >
          {issueCount > 0 && (
            <button
              onClick={() => onScrollTo('weak')}
              className="bg-aurora flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-[#04110B] transition-all duration-200 hover:-translate-y-px hover:shadow-glow active:scale-[0.97]"
            >
              <Check className="h-4 w-4" />
              Fix weakest first
            </button>
          )}
          <button
            onClick={() => onScrollTo('scan')}
            className="flex items-center gap-2 rounded-full border border-kh-lineStrong px-5 py-2.5 text-sm font-medium text-kh-primary transition-all duration-200 hover:-translate-y-px hover:bg-kh-elevated active:scale-[0.97]"
          >
            <Radar className="h-4 w-4 text-kh-cyan" />
            Run breach scan
          </button>
        </motion.div>
      </motion.div>
    </section>
  );
}
