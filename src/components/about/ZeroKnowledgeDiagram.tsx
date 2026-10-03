/**
 * About §2 — Zero-knowledge architecture diagram (signature pinned section).
 * GSAP ScrollTrigger pins a 100vh stage for 250vh of scroll; progress scrubs
 * four beats across three zones — You → Your browser → Storage. Pipes carry
 * traveling packets; plaintext visibly scrambles into ciphertext; storage
 * fills with noise while the only key stays on the You side.
 * Reduced motion: four stacked static panels, no pin.
 */

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger);

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const BEATS = [
  {
    title: 'It starts with one password.',
    caption:
      'Your master password never goes anywhere. It’s not stored — it’s used, right here, to derive a key.',
  },
  {
    title: 'Stretching makes guessing hopeless.',
    caption:
      'Key derivation (PBKDF2, 600,000 rounds) turns one password into a key that would take attackers millennia to brute-force.',
  },
  {
    title: 'Everything is sealed with AES-256.',
    caption:
      'AES-256-GCM — the same standard banks and governments use — seals every login before it’s saved.',
  },
  {
    title: 'What’s stored is noise to everyone but you.',
    caption:
      'There is no KeyHaven server. No account. Even someone reading your browser storage finds only ciphertext — the key exists in your head and your devices alone.',
  },
];

const CIPHER = '9fA3X7q2Lz81c7W0';
const GLYPHS = 'abcdef0123456789$#%&*+=?';
const HEX_KEY = '4F7A 91C3 0E5B 88D2';
const STORAGE_ROWS = ['a91f 4c77 b2e3 90', '0be3 99aa 41f2 7c', 'f27c 10d8 6e55 03', '77aa 02c1 9bd4 68'];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function Gear({ x, y, rotation, opacity }: { x: number; y: number; rotation: number; opacity: number }) {
  const spokes = [0, 60, 120, 180, 240, 300].map((a) => {
    const rad = (a * Math.PI) / 180;
    return {
      x1: x + 12 * Math.cos(rad),
      y1: y + 12 * Math.sin(rad),
      x2: x + 17 * Math.cos(rad),
      y2: y + 17 * Math.sin(rad),
    };
  });
  return (
    <g opacity={opacity} transform={`rotate(${rotation} ${x} ${y})`}>
      <circle cx={x} cy={y} r={12} fill="none" stroke="#38E1FF" strokeWidth={2} />
      <circle cx={x} cy={y} r={4.5} fill="none" stroke="#38E1FF" strokeWidth={2} />
      {spokes.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#38E1FF" strokeWidth={2.5} strokeLinecap="round" />
      ))}
    </g>
  );
}

function KeyGlyph({ x, y, opacity, glow }: { x: number; y: number; opacity: number; glow: number }) {
  return (
    <g opacity={opacity}>
      {glow > 0 && <circle cx={x} cy={y} r={26} fill="none" stroke="#35F0A1" strokeWidth={1.5} opacity={0.35 * glow} />}
      <circle cx={x - 12} cy={y} r={8} fill="none" stroke="#35F0A1" strokeWidth={2.5} />
      <line x1={x - 4} y1={y} x2={x + 18} y2={y} stroke="#35F0A1" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={x + 10} y1={y} x2={x + 10} y2={y + 7} stroke="#35F0A1" strokeWidth={2.5} strokeLinecap="round" />
      <line x1={x + 17} y1={y} x2={x + 17} y2={y + 6} stroke="#35F0A1" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

function LockGlyph({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) translate(${-x} ${-y})`} opacity={scale > 0 ? 1 : 0}>
      <path d={`M${x - 11} ${y - 6} v-7 a11 11 0 0 1 22 0 v7`} fill="none" stroke="#35F0A1" strokeWidth={2.5} />
      <rect x={x - 17} y={y - 6} width={34} height={26} rx={6} fill="none" stroke="#35F0A1" strokeWidth={2.5} />
      <circle cx={x} cy={y + 5} r={3} fill="#35F0A1" />
      <line x1={x} y1={y + 7} x2={x} y2={y + 12} stroke="#35F0A1" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

export default function ZeroKnowledgeDiagram() {
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
      end: '+=250%',
      pin: true,
      scrub: 0.6,
      onUpdate: (self) => {
        setProgress((prev) => (Math.abs(self.progress - prev) > 0.002 ? self.progress : prev));
      },
    });
    return () => trigger.kill();
  }, []);

  /* ---------------- reduced motion: stacked static panels ---------------- */
  if (reduced) {
    return (
      // GSAP pins the <section> by moving it into a spacer div; this React-owned
      // wrapper keeps React able to remove the page when navigating away (KH-06).
      <div>
        <section ref={sectionRef} className="border-t border-kh-line py-24">
          <div className="mx-auto max-w-[720px] space-y-8 px-6">
            {BEATS.map((b, i) => (
              <div key={b.title} className="rounded-2xl border border-kh-line bg-kh-inset p-8">
                <span className="font-mono text-xs text-kh-mint">0{i + 1}</span>
                <h3 className="mt-3 font-display text-2xl font-semibold text-kh-primary">{b.title}</h3>
                <p className="mt-3 text-sm leading-6 text-kh-muted">{b.caption}</p>
                {i === 2 && (
                  <p className="mt-4 break-all font-mono text-sm text-kh-mint">{CIPHER}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  /* ---------------- beat math ---------------- */
  const p = progress;
  const beat = Math.min(3, Math.floor(p * 4));
  const b1 = clamp01(p * 4);
  const b2 = clamp01(p * 4 - 1);
  const b3 = clamp01(p * 4 - 2);
  const b4 = clamp01(p * 4 - 3);

  const bullets = '•'.repeat(Math.floor(b1 * 8.999));
  const packet1X = 215 + 180 * clamp01(b1 * 1.12);
  const packet1Opacity = p > 0.02 && b1 < 0.97 ? 1 : 0;
  const browserGlow = clamp01((p - 0.18) * 5) * 0.85;
  const iterations = Math.floor(b2 * 600_000).toLocaleString('en-US');
  const hexSettle = Math.floor(clamp01((b2 - 0.45) * 2.2) * HEX_KEY.length);
  const cardIn = clamp01(b3 * 4); // 0→1 over first quarter of beat 3
  const scrambleT = clamp01((b3 - 0.2) / 0.55);
  const cipherSettle = Math.floor(scrambleT * CIPHER.length);
  const packet3X = 645 + 130 * clamp01((b3 - 0.55) * 2.2);
  const packet3Opacity = b3 > 0.55 && b3 < 0.99 ? 1 : 0;
  const lockScale = clamp01((b4 - 0.3) * 1.8);
  const keyPulse = b4 > 0 ? 0.6 + 0.4 * Math.sin(p * 60) : 0;

  return (
    // GSAP pins the <section> by moving it into a spacer div; this React-owned
    // wrapper keeps React able to remove the page when navigating away (KH-06).
    <div>
      <section ref={sectionRef} className="relative border-t border-kh-line">
        <div className="flex h-[100dvh] flex-col items-center justify-center overflow-hidden px-6">
          <p className="font-mono text-eyebrow text-kh-faint">ZERO-KNOWLEDGE, IN FOUR BEATS</p>

          {/* beat title (cross-fade) */}
          <div className="relative mt-4 h-[44px] w-full max-w-[720px]">
            {BEATS.map((b, i) => (
              <h2
                key={b.title}
                className="absolute inset-0 text-center font-display text-[clamp(22px,3.4vw,34px)] font-bold tracking-[-0.015em] text-kh-primary transition-all duration-300"
                style={{
                  opacity: beat === i ? 1 : 0,
                  transform: `translateY(${beat === i ? 0 : 12}px)`,
                }}
              >
                {b.title}
              </h2>
            ))}
          </div>

          {/* diagram stage */}
          <div className="relative mt-4 w-full max-w-[1000px]">
            <svg viewBox="0 0 1000 420" className="w-full" role="img" aria-label="Diagram: your password derives a key in your browser; only ciphertext reaches storage.">
              <defs>
                <linearGradient id="zk-pipe" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#35F0A1" />
                  <stop offset="55%" stopColor="#38E1FF" />
                  <stop offset="100%" stopColor="#8B7CFF" />
                </linearGradient>
              </defs>

              {/* ===== zone labels ===== */}
              <text x={130} y={52} textAnchor="middle" fill="#5C6B84" fontSize={11} letterSpacing={2} fontFamily={MONO}>YOU</text>
              <text x={520} y={52} textAnchor="middle" fill="#5C6B84" fontSize={11} letterSpacing={2} fontFamily={MONO}>YOUR BROWSER</text>
              <text x={870} y={52} textAnchor="middle" fill="#5C6B84" fontSize={11} letterSpacing={2} fontFamily={MONO}>STORAGE · THIS DEVICE</text>

              {/* ===== YOU: person glyph ===== */}
              <circle cx={130} cy={100} r={18} fill="none" stroke="#93A1B8" strokeWidth={2} />
              <path d="M98 162 C98 136 112 126 130 126 C148 126 162 136 162 162" fill="none" stroke="#93A1B8" strokeWidth={2} strokeLinecap="round" />

              {/* master password field */}
              <rect x={50} y={195} width={160} height={46} rx={10} fill="#030509" stroke="rgba(148,178,255,.18)" strokeWidth={1.5} />
              <text x={130} y={224} textAnchor="middle" fill="#EAF0FA" fontSize={16} letterSpacing={3} fontFamily={MONO}>{bullets}</text>
              {beat === 0 && (
                <rect x={136 + bullets.length * 9} y={206} width={2} height={22} fill="#35F0A1" className="animate-caret-blink" />
              )}
              <text x={130} y={262} textAnchor="middle" fill="#5C6B84" fontSize={10} fontFamily={MONO}>master password — never stored</text>

              {/* the only key lives here */}
              <KeyGlyph x={130} y={330} opacity={b4 > 0 ? 1 : 0.25} glow={keyPulse} />
              <text x={130} y={380} textAnchor="middle" fill={b4 > 0 ? '#35F0A1' : '#5C6B84'} fontSize={10} fontFamily={MONO}>the only key</text>

              {/* ===== pipe 1 (You → Browser) ===== */}
              <line x1={215} y1={218} x2={395} y2={218} stroke="rgba(148,178,255,.14)" strokeWidth={2} />
              <line x1={215} y1={218} x2={395} y2={218} stroke="url(#zk-pipe)" strokeWidth={2} strokeDasharray="4 16" strokeDashoffset={-p * 260} opacity={0.6} />
              <circle cx={packet1X} cy={218} r={5.5} fill="#EAF0FA" opacity={packet1Opacity} />

              {/* ===== BROWSER box ===== */}
              <rect x={400} y={90} width={240} height={300} rx={16} fill="#0A0F1C" stroke="rgba(148,178,255,.18)" strokeWidth={1.5} />
              <rect x={400} y={90} width={240} height={300} rx={16} fill="none" stroke="#35F0A1" strokeWidth={1.5} opacity={browserGlow} />

              {/* KDF readout */}
              <Gear x={460} y={150} rotation={b2 * 540} opacity={beat >= 1 ? 1 : 0.2} />
              <text x={495} y={146} fill="#38E1FF" fontSize={12} fontFamily={MONO} opacity={beat >= 1 ? 1 : 0}>PBKDF2-SHA256</text>
              <text x={495} y={168} fill="#5C6B84" fontSize={11} fontFamily={MONO} opacity={beat >= 1 ? 1 : 0}>
                iter {iterations}
              </text>
              <text x={420} y={205} fill="#FFB84D" fontSize={11} fontFamily={MONO} opacity={b2 > 0.4 ? 1 : 0}>
                key{' '}
                {HEX_KEY.split('').map((c, i) => (i < hexSettle ? c : GLYPHS[(i * 5 + Math.floor(b2 * 30)) % GLYPHS.length])).join('')}
              </text>

              {/* demo entry card */}
              <g opacity={cardIn} transform={`translate(0 ${24 * (1 - cardIn)})`}>
                <rect x={425} y={225} width={190} height={92} rx={10} fill="#030509" stroke="rgba(148,178,255,.18)" strokeWidth={1.5} />
                <rect x={425} y={225} width={190} height={92} rx={10} fill="none" stroke="#35F0A1" strokeWidth={1.5} opacity={scrambleT >= 1 ? 0.8 : scrambleT * 0.3} />
                <text x={441} y={255} fill="#EAF0FA" fontSize={13} fontFamily={MONO} opacity={1 - scrambleT}>Netflix</text>
                <text x={441} y={278} fill="#93A1B8" fontSize={11} fontFamily={MONO} opacity={1 - scrambleT}>alex@mail.com</text>
                <text x={441} y={268} fill="#35F0A1" fontSize={12} fontFamily={MONO} opacity={scrambleT > 0 ? 1 : 0}>
                  {CIPHER.split('').map((c, i) => (i < cipherSettle ? c : GLYPHS[(i * 7 + Math.floor(scrambleT * 40)) % GLYPHS.length])).join('')}
                </text>
                <text x={441} y={300} fill="#5C6B84" fontSize={9} fontFamily={MONO} opacity={scrambleT >= 1 ? 1 : 0}>
                  sealed · AES-256-GCM
                </text>
              </g>
              <text x={520} y={355} textAnchor="middle" fill="#38E1FF" fontSize={10} fontFamily={MONO} opacity={beat === 2 ? 1 : 0}>
                AES-256-GCM
              </text>

              {/* ===== pipe 2 (Browser → Storage) ===== */}
              <line x1={645} y1={218} x2={775} y2={218} stroke="rgba(148,178,255,.14)" strokeWidth={2} />
              <line x1={645} y1={218} x2={775} y2={218} stroke="url(#zk-pipe)" strokeWidth={2} strokeDasharray="4 16" strokeDashoffset={-p * 260} opacity={0.6} />
              <circle cx={packet3X} cy={218} r={5.5} fill="#35F0A1" opacity={packet3Opacity} />

              {/* ===== STORAGE cylinder ===== */}
              <g opacity={0.55 + 0.45 * clamp01(b4 * 2)}>
                <path d="M800 160 L800 300 A70 18 0 0 0 940 300 L940 160" fill="#101828" stroke="rgba(148,178,255,.18)" strokeWidth={1.5} />
                <ellipse cx={870} cy={160} rx={70} ry={18} fill="#101828" stroke="rgba(148,178,255,.18)" strokeWidth={1.5} />
              </g>
              {STORAGE_ROWS.map((row, i) => (
                <text
                  key={row}
                  x={812}
                  y={205 + i * 26}
                  fill="#38E1FF"
                  fontSize={10}
                  fontFamily={MONO}
                  opacity={b4 > i * 0.22 ? 0.55 : 0}
                >
                  {row}
                </text>
              ))}
              <LockGlyph x={870} y={128} scale={lockScale} />
              <text x={870} y={352} textAnchor="middle" fill="#5C6B84" fontSize={10} fontFamily={MONO} opacity={b4 > 0.5 ? 1 : 0}>
                only ciphertext, ever
              </text>
            </svg>

            {/* beat progress dots */}
            <div className="absolute -left-2 top-1/2 hidden -translate-y-1/2 flex-col gap-2.5 md:flex" aria-hidden>
              {BEATS.map((b, i) => (
                <span
                  key={b.title}
                  className={cn(
                    'h-2 w-2 rounded-full transition-colors duration-300',
                    p * 4 > i ? 'bg-kh-mint' : 'bg-kh-elevated',
                  )}
                />
              ))}
            </div>
          </div>

          {/* caption cards (cross-fade) */}
          <div className="relative mt-6 h-[86px] w-full max-w-[560px]">
            {BEATS.map((b, i) => (
              <div
                key={b.title}
                className="absolute inset-0 rounded-2xl border border-kh-line bg-kh-surface/80 px-6 py-4 backdrop-blur-[8px] transition-all duration-300"
                style={{
                  opacity: beat === i ? 1 : 0,
                  transform: `translateY(${beat === i ? 0 : 24}px)`,
                  pointerEvents: beat === i ? 'auto' : 'none',
                }}
              >
                <p className="text-sm leading-6 text-kh-muted">
                  <span className="mr-2 font-mono text-xs text-kh-mint">0{i + 1}</span>
                  {b.caption}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
