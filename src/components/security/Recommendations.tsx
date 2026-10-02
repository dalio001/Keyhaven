/**
 * Recommendations — Watchtower §5. Horizontal snap row of tip cards that
 * route into Settings / Vault. Cards stagger in, lift on hover, and the
 * row fades at the edges (mask-fade-x).
 */

import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, FileDown, Smartphone, Timer } from 'lucide-react';

const EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

const TIPS = [
  {
    icon: Timer,
    color: '#35F0A1',
    title: 'Turn on auto-lock after 5 minutes',
    body: 'An idle vault locks itself — no open sessions left behind on this device.',
    to: '/settings',
    cta: 'Open Settings',
  },
  {
    icon: FileDown,
    color: '#8B7CFF',
    title: 'Export an encrypted backup',
    body: 'Keep a copy of your encrypted vault off this browser. It opens only with your master password — there is no other recovery.',
    to: '/settings',
    cta: 'Backup options',
  },
  {
    icon: Smartphone,
    color: '#38E1FF',
    title: 'Add 2FA codes to your top 5 accounts',
    body: 'One-time codes live next to their logins — encrypted with everything else.',
    to: '/vault',
    cta: 'Open vault',
  },
];

export default function Recommendations() {
  return (
    <section aria-label="Recommendations" id="wt-tips" className="scroll-mt-36">
      <motion.h2
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ duration: 0.5, ease: EXPO }}
        className="font-display text-[clamp(24px,3vw,32px)] font-semibold tracking-[-0.015em] text-kh-primary"
      >
        Worth doing next
      </motion.h2>

      <div className="mask-fade-x -mx-4 mt-6 overflow-x-auto px-4 pb-2 sm:-mx-8 sm:px-8">
        <div className="flex gap-4" style={{ scrollSnapType: 'x mandatory' }}>
          {TIPS.map((tip, i) => (
            <motion.div
              key={tip.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.5, delay: i * 0.08, ease: EXPO }}
              whileHover={{ y: -4 }}
              className="min-w-[280px] flex-1 rounded-2xl border border-kh-line bg-kh-surface p-5 shadow-card transition-colors hover:border-kh-lineStrong"
              style={{ scrollSnapAlign: 'start' }}
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${tip.color}14`, border: `1px solid ${tip.color}30` }}
              >
                <tip.icon style={{ color: tip.color, width: 18, height: 18 }} />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold leading-snug text-kh-primary">{tip.title}</h3>
              <p className="mt-1.5 text-[13px] leading-[22px] text-kh-muted">{tip.body}</p>
              <Link
                to={tip.to}
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-kh-cyan transition-colors hover:text-kh-primary"
              >
                {tip.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
