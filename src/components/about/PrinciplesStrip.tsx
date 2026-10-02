/**
 * About §5 — Principles strip. Three mono-numbered columns: no accounts,
 * backups you own, honest by default. Numbers scramble in; aurora top line
 * draws per card.
 */

import { motion } from 'framer-motion';
import ScrambleText from '@/components/ScrambleText';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const PRINCIPLES = [
  {
    n: '01',
    title: 'No accounts, ever.',
    body: 'No email, no server, no telemetry. The app runs entirely on your device.',
  },
  {
    n: '02',
    title: 'Backups you own.',
    body: 'Encrypted export files you can hold, move, and restore anywhere.',
  },
  {
    n: '03',
    title: 'Honest by default.',
    body: 'Plain-language answers, visible crypto choices, and clear limits — like the fact that nobody can recover a forgotten master password.',
  },
];

export default function PrinciplesStrip() {
  return (
    <section id="privacy" className="scroll-mt-24 border-t border-kh-line py-20 md:py-24">
      <div className="mx-auto grid max-w-marketing gap-10 px-6 md:grid-cols-3">
        {PRINCIPLES.map((p, i) => (
          <motion.div
            key={p.n}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20%' }}
            transition={{ delay: 0.1 * i, duration: 0.55, ease: EASE }}
            className="relative pt-6"
          >
            {/* aurora top line draws in */}
            <motion.span
              aria-hidden
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: '-20%' }}
              transition={{ delay: 0.1 * i + 0.15, duration: 0.7, ease: EASE }}
              className="bg-aurora absolute left-0 top-0 h-px w-full origin-left"
            />
            <span className="font-mono text-sm text-kh-mint">
              <ScrambleText text={p.n} />
            </span>
            <h3 className="mt-3 font-display text-xl font-semibold text-kh-primary">{p.title}</h3>
            <p className="mt-2 text-sm leading-6 text-kh-muted">{p.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
