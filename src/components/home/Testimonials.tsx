/**
 * Home §6 — Testimonials. Three cards, 5 mint stars, quote, avatar + name +
 * role. Hover: lift + tilt (max 2°, spring following cursor).
 */

import { useCallback } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { Star } from 'lucide-react';
import ScrambleText from '@/components/ScrambleText';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const TESTIMONIALS = [
  {
    avatar: '/avatar-maya.png',
    name: 'Maya R.',
    role: 'Freelance designer',
    quote:
      'I had passwords in sticky notes, texts to myself, and my browser. Now they\u2019re all in one place — and I\u2019m the only one with the key.',
  },
  {
    avatar: '/avatar-daniel.png',
    name: 'Daniel K.',
    role: 'Small-business owner',
    quote:
      'Encrypted backups I can carry between computers sold me. No account, no cloud copy.',
  },
  {
    avatar: '/avatar-priya.png',
    name: 'Priya S.',
    role: 'Software engineer',
    quote:
      'I checked the code path — it really does encrypt locally with AES-GCM. That\u2019s why I trust it with 200+ logins.',
  },
];

function TiltCard({ children, index }: { children: React.ReactNode; index: number }) {
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 260, damping: 24 });
  const sry = useSpring(ry, { stiffness: 260, damping: 24 });

  const onMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      ry.set(px * 4); // max 2deg each way
      rx.set(-py * 4);
    },
    [rx, ry],
  );
  const onLeave = useCallback(() => {
    rx.set(0);
    ry.set(0);
  }, [rx, ry]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-20%' }}
      transition={{ delay: index * 0.1, duration: 0.6, ease: EASE }}
      style={{ rotateX: srx, rotateY: sry, transformPerspective: 900 }}
      whileHover={{ y: -6 }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="rounded-2xl border border-kh-line bg-kh-surface p-8 shadow-card transition-colors duration-300 hover:border-kh-lineStrong"
    >
      {children}
    </motion.div>
  );
}

export default function Testimonials() {
  return (
    <section className="py-24 md:py-32">
      <div className="mx-auto max-w-marketing px-6">
        <h2 className="text-center font-display text-[40px] font-bold leading-[48px] tracking-[-0.02em] text-kh-primary">
          <ScrambleText text="People sleep better now." />
        </h2>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <TiltCard key={t.name} index={i}>
              <svg width="24" height="24" viewBox="0 0 24 24" className="text-kh-mint" aria-hidden>
                <path
                  d="M4 12c0-4 2.5-7 6-8l.6 1.4C8.4 6.4 7.2 8 7 10c.2-.1.6-.2 1-.2 1.5 0 2.6 1.2 2.6 2.7S9.4 15 8 15c-2 0-4-1.4-4-3zm9 0c0-4 2.5-7 6-8l.6 1.4c-2.2 1-3.4 2.6-3.6 4.6.2-.1.6-.2 1-.2 1.5 0 2.6 1.2 2.6 2.7S18.4 15 17 15c-2 0-4-1.4-4-3z"
                  fill="currentColor"
                />
              </svg>
              <div className="mt-4 flex gap-1" aria-label="5 out of 5 stars">
                {Array.from({ length: 5 }).map((_, s) => (
                  <Star key={s} className="h-4 w-4 fill-kh-mint text-kh-mint" />
                ))}
              </div>
              <p className="mt-4 text-lg leading-[30px] text-kh-primary">{t.quote}</p>
              <div className="mt-6 flex items-center gap-3">
                <img
                  src={t.avatar}
                  alt={`Portrait of ${t.name}`}
                  className="h-11 w-11 rounded-full border border-kh-line object-cover"
                  loading="lazy"
                />
                <div>
                  <p className="text-sm font-semibold text-kh-primary">{t.name}</p>
                  <p className="text-sm text-kh-faint">{t.role}</p>
                </div>
              </div>
            </TiltCard>
          ))}
        </div>
      </div>
    </section>
  );
}
