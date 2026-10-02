/**
 * Home §4 — Encryption story (signature pinned section). GSAP ScrollTrigger
 * pins a 100vh stage for 200vh of scroll; progress scrubs three stages:
 * "You type" → "Your browser encrypts" → "Only your key opens it".
 * Reduced motion: three stacked static panels, no pin.
 */

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { KeyRound } from 'lucide-react';
import VaultRing from '@/components/VaultRing';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const PLAINTEXT = 'SunnyDay!2024';
const CIPHER = '9fA3X7q2Lz81c7';
const GLYPHS = 'abcdef0123456789$#%&*+=?';

const STEPS = ['1 Plaintext', '2 Ciphertext', '3 Sealed'];

function StatusChip({ stage }: { stage: number }) {
  const conf = [
    { label: 'EXPOSED', cls: 'border-kh-danger/40 bg-kh-danger/10 text-kh-danger' },
    { label: 'ENCRYPTED', cls: 'border-kh-cyan/40 bg-kh-cyan/10 text-kh-cyan' },
    { label: 'SEALED — ONLY YOU', cls: 'border-kh-mint/40 bg-kh-mint/10 text-kh-mint' },
  ][stage];
  return (
    <span
      className={cn(
        'rounded-full border px-3 py-1 font-mono text-xs font-medium tracking-wider transition-colors duration-200',
        conf.cls,
      )}
    >
      {conf.label}
    </span>
  );
}

function StatusRow({ stage }: { stage: number }) {
  return (
    <div className="mb-6 flex w-full max-w-[720px] items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={cn(
              'rounded-full px-3 py-1 font-mono text-xs transition-colors duration-300',
              i === stage ? 'bg-kh-elevated text-kh-primary' : 'text-kh-faint',
            )}
          >
            {s}
          </span>
        ))}
      </div>
      <StatusChip stage={stage} />
    </div>
  );
}

export default function EncryptionStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    if (mq.matches) return;

    const trigger = ScrollTrigger.create({
      trigger: sectionRef.current,
      start: 'top top',
      end: '+=200%',
      pin: true,
      scrub: 0.6,
      onUpdate: (self) => {
        setProgress((prev) => (Math.abs(self.progress - prev) > 0.002 ? self.progress : prev));
      },
    });
    return () => trigger.kill();
  }, []);

  const stage = progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2;
  const lp = Math.min(1, Math.max(0, progress * 3 - stage)); // local stage progress

  /* ---------- reduced motion: stacked panels ---------- */
  if (reduced) {
    return (
      <section id="security" ref={sectionRef} className="py-24">
        <div className="mx-auto max-w-[720px] space-y-8 px-6">
          {[
            { chip: 0, title: 'You type.', body: 'A password on its own is just text — anyone who reads it, owns it.', content: PLAINTEXT, cls: 'text-kh-primary' },
            { chip: 1, title: 'Your browser encrypts.', body: 'PBKDF2 stretches your master password into a key (600,000 iterations); AES-256-GCM seals every login. It never leaves your device readable.', content: CIPHER, cls: 'text-kh-warning' },
            { chip: 2, title: 'Only your key opens it.', body: 'Stored as unreadable noise. Opened only with your master password (plus your authenticator check, if enabled).', content: CIPHER, cls: 'text-kh-mint' },
          ].map((p) => (
            <div key={p.title} className="rounded-2xl border border-kh-line bg-kh-inset p-8">
              <StatusChip stage={p.chip} />
              <h3 className="mt-4 font-display text-2xl font-semibold text-kh-primary">{p.title}</h3>
              <p className={`mt-3 break-all font-mono text-lg ${p.cls}`}>{p.content}</p>
              <p className="mt-3 text-sm leading-6 text-kh-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>
    );
  }

  /* ---------- pinned scrub stage ---------- */
  const typedCount = stage === 0 ? Math.floor(lp * (PLAINTEXT.length + 1)) : PLAINTEXT.length;
  const settleCount = stage === 1 ? Math.floor(lp * (CIPHER.length + 1)) : stage === 2 ? CIPHER.length : 0;
  const iterations = stage === 1 ? Math.floor(lp * 600_000) : 600_000;
  const collapse = stage === 2 ? lp : 0;

  return (
    <section id="security" ref={sectionRef} className="relative">
      <div className="flex h-[100dvh] flex-col items-center justify-center overflow-hidden px-6">
        {/* backdrop ring */}
        <VaultRing
          size={620}
          muted
          progress={stage === 2 ? lp : 0}
          className="pointer-events-none absolute opacity-40"
        />

        <StatusRow stage={stage} />

        {/* terminal card */}
        <div
          className="relative w-full max-w-[720px] rounded-2xl border border-kh-line bg-kh-inset p-8 shadow-card"
          style={{
            transform: `scale(${1 - collapse * 0.12})`,
            opacity: 1 - collapse * 0.35,
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-kh-danger/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-kh-warning/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-kh-mint/60" />
            <span className="ml-3 font-mono text-xs text-kh-faint">vault-entry — local only</span>
          </div>

          <div className="mt-6 min-h-[96px] font-mono text-[clamp(20px,3vw,30px)] leading-[1.4]">
            {stage === 0 && (
              <span className="text-kh-primary">
                {PLAINTEXT.slice(0, typedCount)}
                <span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-caret-blink bg-kh-mint align-middle" />
              </span>
            )}
            {stage >= 1 && (
              <span className={stage === 1 ? 'text-kh-warning' : 'text-kh-mint'}>
                {CIPHER.split('').map((c, i) =>
                  i < settleCount ? (
                    <span key={i}>{c}</span>
                  ) : (
                    <span key={i} className="opacity-70">
                      {GLYPHS[(i * 7 + Math.floor(lp * 40)) % GLYPHS.length]}
                    </span>
                  ),
                )}
              </span>
            )}
          </div>

          {stage === 1 && (
            <p className="mt-4 font-mono text-xs text-kh-cyan">
              PBKDF2-SHA256 · {iterations.toLocaleString()} iterations · salt 0x8F2E…
            </p>
          )}

          {stage === 2 && (
            <div className="mt-4 flex items-center gap-3" style={{ opacity: Math.min(1, lp * 1.6) }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-kh-mint/40 bg-kh-mint/10">
                <KeyRound className="h-5 w-5 text-kh-mint" />
              </span>
              <span className="font-mono text-sm text-kh-mint">key verified · vault sealed</span>
            </div>
          )}
        </div>

        {/* captions */}
        <p className="mt-8 max-w-[52ch] text-center text-sm leading-6 text-kh-muted">
          {stage === 0 && 'You type. A password on its own is just text — anyone who reads it, owns it.'}
          {stage === 1 &&
            'Your browser encrypts. PBKDF2 stretches your master password into a key; AES-256-GCM seals every login. It never leaves your device readable.'}
          {stage === 2 &&
            'Only your key opens it. Stored as unreadable noise. Opened only with your master password (plus your authenticator check, if enabled).'}
        </p>
      </div>
    </section>
  );
}
