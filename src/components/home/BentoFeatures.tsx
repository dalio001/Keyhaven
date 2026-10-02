/**
 * Home §3 — Features bento. Six cards: zero-knowledge encryption (with a
 * live type→ciphertext demo), passkey status (animated VaultRing), TOTP
 * (live 30s code + countdown ring), Watchtower, password generator (live
 * regenerate + scramble), encrypted export/import.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  Dices,
  Download,
  EyeOff,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  Smartphone,
  Upload,
} from 'lucide-react';
import GlowCard from '@/components/GlowCard';
import ScrambleText from '@/components/ScrambleText';
import LiveScramble from '@/components/LiveScramble';
import VaultRing from '@/components/VaultRing';
import { generatePassword } from '@/lib/crypto';
import { getTotpCode } from '@/lib/totp';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];
const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXP'; // classic "Hello!" demo secret

function LearnMore({ to }: { to: string }) {
  return (
    <Link
      to={to}
      className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-medium text-kh-cyan transition-colors hover:text-kh-primary"
    >
      Learn more <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

/* ---- Card A demo: typed text scrambles into "ciphertext" ---- */
function CipherDemo() {
  const [text, setText] = useState('SunnyDay!2024');
  const fakeCipher = text
    .split('')
    .map((c) => ((c.charCodeAt(0) * 7 + 19) % 256).toString(16).padStart(2, '0'))
    .join(' ');
  return (
    <div className="flex h-full flex-col justify-center">
      <label htmlFor="cipher-demo" className="text-eyebrow text-kh-faint">
        Try it
      </label>
      <div className="mt-3 flex items-center rounded-xl border border-kh-line bg-kh-inset px-4 focus-within:border-kh-cyan/60">
        <input
          id="cipher-demo"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 24))}
          className="h-11 w-full bg-transparent font-mono text-[15px] text-kh-primary outline-none placeholder:text-kh-faint"
          placeholder="Type anything…"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="ml-2 h-5 w-px animate-caret-blink bg-kh-mint" />
      </div>
      <div className="mt-3 min-h-[72px] rounded-xl border border-kh-line bg-kh-inset p-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-kh-faint">Stored in your vault</p>
        <LiveScramble
          text={fakeCipher || '—'}
          className="mt-1 block break-all font-mono text-sm leading-6 text-kh-mint"
          speed={30}
        />
      </div>
      <p className="mt-3 text-xs leading-5 text-kh-faint">
        This is exactly how your vault is saved — unreadable noise. (Demo only, never stored.)
      </p>
    </div>
  );
}

/* ---- Card C demo: live TOTP code with countdown ring ---- */
function TotpDemo() {
  const [code, setCode] = useState('------');
  const [secondsLeft, setSecondsLeft] = useState(30);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const { code: c, secondsLeft: s } = await getTotpCode(DEMO_TOTP_SECRET);
      if (!alive) return;
      setCode(c);
      setSecondsLeft(s);
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className="mt-4 flex items-center gap-4">
      <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(148,178,255,.12)" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="#35F0A1"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - secondsLeft / 30)}
          transform="rotate(-90 32 32)"
          style={{ transition: 'stroke-dashoffset 1s linear' }}
        />
        <text x="32" y="36" textAnchor="middle" className="fill-kh-muted font-mono" fontSize="12">
          {secondsLeft}s
        </text>
      </svg>
      <div>
        <motion.span
          key={code}
          initial={{ rotateX: 90, opacity: 0 }}
          animate={{ rotateX: 0, opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="block font-mono text-[26px] font-medium tracking-[0.14em] text-kh-primary"
        >
          {code.slice(0, 3)} {code.slice(3)}
        </motion.span>
        <span className="text-xs text-kh-faint">regenerates every 30 seconds</span>
      </div>
    </div>
  );
}

/* ---- Card E demo: live mini generator ---- */
function GeneratorDemo() {
  const [password, setPassword] = useState(() => generatePassword({ length: 18 }));
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl border border-kh-line bg-kh-inset px-4 py-3">
      <LiveScramble
        key={password}
        text={password}
        className="min-w-0 flex-1 break-all font-mono text-[15px] text-kh-mint"
      />
      <button
        onClick={() => setPassword(generatePassword({ length: 18 }))}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-kh-line text-kh-muted transition-all hover:border-kh-lineStrong hover:text-kh-mint active:scale-95"
        aria-label="Regenerate password"
      >
        <Dices className="h-4 w-4" />
      </button>
    </div>
  );
}

const CARDS = [
  {
    key: 'passkey',
    span: 'md:col-span-6 lg:col-span-4',
    icon: <Fingerprint className="h-6 w-6 text-kh-violet" />,
    ring: true,
    title: 'Passkeys — coming back',
    body: 'Passkey unlock is paused: the earlier design stored data that could open a vault without the passkey. It returns only with keys held by the authenticator itself.',
    to: '/about',
  },
  {
    key: 'totp',
    span: 'md:col-span-6 lg:col-span-4',
    icon: <Smartphone className="h-6 w-6 text-kh-cyan" />,
    demo: <TotpDemo />,
    title: 'Google Authenticator & TOTP',
    body: 'An extra 6-digit check after your master password — works with Google Authenticator, Authy, and more.',
    to: '/about',
  },
  {
    key: 'watchtower',
    span: 'md:col-span-6 lg:col-span-4',
    icon: <AlertTriangle className="h-6 w-6 text-kh-warning" />,
    title: 'Watchtower alerts',
    body: 'Get flagged when a password is weak, reused, or shows up in a known breach — then fix it in one tap.',
    to: '/about',
  },
  {
    key: 'generator',
    span: 'md:col-span-6',
    icon: <Dices className="h-6 w-6 text-kh-mint" />,
    demo: <GeneratorDemo />,
    title: 'Password generator',
    body: 'Strong by default — one click, cryptographically random.',
    to: '/generator',
  },
  {
    key: 'export',
    span: 'md:col-span-6',
    icon: (
      <span className="flex gap-1.5">
        <Download className="h-6 w-6 text-kh-cyan" />
        <Upload className="h-6 w-6 text-kh-violet" />
      </span>
    ),
    title: 'Yours to take anywhere',
    body: 'Export an encrypted backup file anytime. Import it on any device. No cloud required, no lock-in.',
    to: '/about',
  },
];

export default function BentoFeatures() {
  return (
    <section id="features" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-marketing px-6">
        <div className="mx-auto max-w-[720px] text-center">
          <p className="text-eyebrow font-mono text-kh-mint">WHY KEYHAVEN</p>
          <h2 className="mt-4 font-display text-[40px] font-bold leading-[48px] tracking-[-0.02em] text-kh-primary">
            <ScrambleText text="Built like a vault. Feels like nothing." />
          </h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20%' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="mt-4 text-lg leading-[30px] text-kh-muted"
          >
            Everything a password manager should do — without an account, a subscription, or a server
            that could ever leak you.
          </motion.p>
        </div>

        <div className="mt-14 grid grid-cols-12 gap-4">
          {/* Card A — zero-knowledge encryption (wide) */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20%' }}
            transition={{ duration: 0.65, ease: EASE }}
            className="col-span-12"
          >
            <GlowCard className="min-h-[480px]">
              <div className="grid h-full gap-10 p-8 md:p-10 lg:grid-cols-2">
                <div className="flex flex-col">
                  <h3 className="font-display text-2xl font-semibold leading-8 text-kh-primary">
                    Encrypted before it's ever stored
                  </h3>
                  <p className="mt-3 leading-[26px] text-kh-muted">
                    Your master password derives the key (PBKDF2, 600,000 iterations). Your logins are
                    sealed with AES-256-GCM inside your browser. What gets saved is unreadable noise —
                    even to us.
                  </p>
                  <ul className="mt-6 space-y-4">
                    {[
                      { icon: <ShieldCheck className="h-5 w-5 text-kh-mint" />, text: 'AES-256-GCM — the same encryption banks use' },
                      { icon: <KeyRound className="h-5 w-5 text-kh-cyan" />, text: 'PBKDF2 600,000-iteration key derivation — brute-force resistant' },
                      { icon: <EyeOff className="h-5 w-5 text-kh-violet" />, text: 'We literally cannot read your vault' },
                    ].map((b) => (
                      <li key={b.text} className="flex items-start gap-3 text-sm leading-6 text-kh-muted">
                        <span className="mt-0.5 shrink-0">{b.icon}</span>
                        {b.text}
                      </li>
                    ))}
                  </ul>
                  <LearnMore to="/about" />
                </div>
                <CipherDemo />
              </div>
            </GlowCard>
          </motion.div>

          {/* Cards B–F */}
          {CARDS.map((card, i) => (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-20%' }}
              transition={{ duration: 0.65, ease: EASE, delay: 0.09 * (i + 1) }}
              className={`col-span-12 ${card.span}`}
            >
              <GlowCard className="h-full min-h-[280px]">
                <div className="flex h-full flex-col p-8">
                  {card.ring ? (
                    <VaultRing size={72} muted>
                      {card.icon}
                    </VaultRing>
                  ) : (
                    card.icon
                  )}
                  <h3 className="mt-5 font-display text-xl font-semibold text-kh-primary">{card.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-kh-muted">{card.body}</p>
                  {card.demo}
                  <LearnMore to={card.to} />
                </div>
              </GlowCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
