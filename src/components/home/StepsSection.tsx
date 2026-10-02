/**
 * Home §7 — Get started in 3 steps. Numbered mono badges, a dashed connector
 * that draws across on scroll, and the closing primary CTA.
 */

import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight, KeyRound, QrCode, ShieldCheck } from 'lucide-react';
import ScrambleText from '@/components/ScrambleText';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const STEPS = [
  {
    n: '01',
    icon: <KeyRound className="h-5 w-5 text-kh-mint" />,
    title: 'Create your master password',
    body: 'One strong password to rule the vault. We show you the strength as you type.',
  },
  {
    n: '02',
    icon: <QrCode className="h-5 w-5 text-kh-cyan" />,
    title: 'Add an authenticator (optional)',
    body: 'Scan a QR with Google Authenticator for an extra 6-digit check every time you unlock.',
  },
  {
    n: '03',
    icon: <ShieldCheck className="h-5 w-5 text-kh-violet" />,
    title: 'Save your first login',
    body: "Add logins by hand or generate strong new ones. Done. It's yours.",
  },
];

export default function StepsSection() {
  const navigate = useNavigate();
  return (
    <section className="border-t border-kh-line py-24 md:py-32">
      <div className="mx-auto max-w-marketing px-6">
        <h2 className="text-center font-display text-[40px] font-bold leading-[48px] tracking-[-0.02em] text-kh-primary">
          <ScrambleText text="Three minutes to total peace of mind." />
        </h2>

        <div className="relative mt-16">
          {/* dashed connector (desktop) */}
          <motion.div
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: '-25%' }}
            transition={{ duration: 1, ease: EASE }}
            className="absolute left-[16%] right-[16%] top-7 hidden origin-left border-t border-dashed border-kh-lineStrong md:block"
            aria-hidden
          />
          <div className="grid gap-10 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <motion.div
                key={step.n}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-20%' }}
                transition={{ delay: i * 0.12, duration: 0.6, ease: EASE }}
                className="relative flex flex-col items-center text-center"
              >
                <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl border border-kh-line bg-kh-elevated font-mono text-sm font-semibold text-kh-mint">
                  {step.n}
                </div>
                <div className="mt-5 flex items-center gap-2">
                  {step.icon}
                  <h3 className="font-display text-lg font-semibold text-kh-primary">{step.title}</h3>
                </div>
                <p className="mt-2 max-w-[34ch] text-sm leading-6 text-kh-muted">{step.body}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20%' }}
          transition={{ delay: 0.3, duration: 0.6, ease: EASE }}
          className="mt-14 flex flex-col items-center"
        >
          <button
            onClick={() => navigate('/unlock?mode=create')}
            className="bg-aurora group flex animate-pulse-glow items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-[#04110B] transition-transform duration-200 hover:-translate-y-px active:scale-[0.97]"
          >
            Create your vault — free
            <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
          </button>
          <p className="mt-3 font-mono text-xs text-kh-faint">No email. No account. No cloud.</p>
        </motion.div>
      </div>
    </section>
  );
}
