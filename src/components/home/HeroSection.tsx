/**
 * Home §1 — Hero (100vh). Two-layer background: R3F particle key field
 * (lazy; falls back to /hero-fallback.png when WebGL is unavailable or
 * reduced-motion is on) + aurora glows + noise. Content left, max 640px.
 * Full-bleed opt-out: pulls itself under the fixed nav (-mt) and re-pads.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import ScrambleText from '@/components/ScrambleText';

const HeroParticles = lazy(() => import('./HeroParticles'));

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const TRUST_CHIPS = ['AES-256-GCM', 'PBKDF2 600k', 'Encrypted backups', 'Works offline'];

export default function HeroSection() {
  const navigate = useNavigate();
  const [useWebGL, setUseWebGL] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setUseWebGL(!reduced && webglAvailable());
  }, []);

  return (
    <section className="noise-overlay relative -mt-[72px] flex min-h-[100dvh] items-center overflow-hidden pt-[72px]">
      {/* background layer 1: particles or poster */}
      {useWebGL ? (
        <Suspense
          fallback={
            <img src="/hero-fallback.png" alt="" className="absolute inset-0 z-[1] h-full w-full object-cover opacity-60" />
          }
        >
          <HeroParticles />
        </Suspense>
      ) : (
        <img src="/hero-fallback.png" alt="" className="absolute inset-0 z-[1] h-full w-full object-cover opacity-60" />
      )}

      {/* background layer 2: aurora glows */}
      <div
        aria-hidden
        className="absolute inset-0 z-[2]"
        style={{
          background:
            'radial-gradient(700px circle at 18% 8%, rgba(56,225,255,.07), transparent 60%), radial-gradient(680px circle at 88% 92%, rgba(139,124,255,.06), transparent 60%)',
        }}
      />

      {/* content */}
      <div className="relative z-10 mx-auto w-full max-w-marketing px-6">
        <div className="max-w-[640px]">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="text-eyebrow font-mono text-kh-mint"
          >
            ZERO-KNOWLEDGE · LOCAL-FIRST · OPEN SOURCE
          </motion.p>

          <h1 className="text-display-xl mt-6 text-kh-primary">
            <span className="block">
              <ScrambleText text="Every password." trigger="mount" delay={200} />
            </span>
            <span className="block">
              <ScrambleText text="One vault." trigger="mount" delay={420} />
            </span>
            <span className="text-aurora block">
              <ScrambleText text="Only you." trigger="mount" delay={620} />
            </span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.5, ease: EASE }}
            className="mt-6 max-w-[52ch] text-lg leading-[30px] text-kh-muted"
          >
            KeyHaven keeps every login you own behind one vault that's encrypted right here in your
            browser — and unlockable only with your master password, plus an optional Google
            Authenticator check.
          </motion.p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <motion.button
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.45, ease: EASE }}
              onClick={() => navigate('/unlock?mode=create')}
              className="bg-aurora group flex animate-pulse-glow items-center gap-2 rounded-full px-6 py-3 text-base font-semibold text-[#04110B] transition-transform duration-200 hover:-translate-y-px active:scale-[0.97]"
              style={{ animationDelay: '1.6s' }}
            >
              Create your vault — free
              <ArrowRight className="h-4 w-4 -translate-x-1 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
            </motion.button>
            <motion.button
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.0, duration: 0.45, ease: EASE }}
              onClick={() => navigate('/unlock')}
              className="rounded-full border border-kh-lineStrong px-6 py-3 text-base font-medium text-kh-primary transition-all duration-200 hover:-translate-y-px hover:bg-kh-elevated active:scale-[0.97]"
            >
              Unlock existing vault
            </motion.button>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {TRUST_CHIPS.map((chip, i) => (
              <motion.span
                key={chip}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.2 + i * 0.06, duration: 0.4, ease: EASE }}
                className="rounded-full border border-kh-line bg-kh-surface px-3.5 py-1.5 font-mono text-xs text-kh-muted"
              >
                {chip}
              </motion.span>
            ))}
          </div>
        </div>
      </div>

      {/* scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 0.6 }}
        className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-3"
      >
        <span className="text-xs text-kh-faint">Scroll</span>
        <span className="block h-14 w-px overflow-hidden bg-kh-lineStrong/40">
          <span className="block h-full w-full animate-scroll-cue bg-kh-mint" />
        </span>
      </motion.div>
    </section>
  );
}
