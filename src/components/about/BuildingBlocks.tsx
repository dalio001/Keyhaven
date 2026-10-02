/**
 * About §3 — The building blocks. 2×2 card grid: AES-256-GCM, PBKDF2,
 * WebAuthn passkeys (paused), TOTP — each with a plain-language explanation, a mono
 * spec footer, and a "Where do I use this?" link to the real surface.
 */

import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { ArrowUpRight, Fingerprint, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
import GlowCard from '@/components/GlowCard';
import VaultRing from '@/components/VaultRing';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const BLOCKS = [
  {
    icon: ShieldCheck,
    name: 'AES-256-GCM',
    tagline: 'The vault lock.',
    body: 'Encrypts your logins so only the right key opens them; any tampering breaks the seal visibly.',
    spec: 'NIST standard · Web Crypto API',
    link: { label: 'Where do I use this?', to: '/settings', hint: 'Settings → Vault & data' },
  },
  {
    icon: KeyRound,
    name: 'PBKDF2 · 600,000×',
    tagline: 'The key maker.',
    body: 'Stretches your master password with deliberately slow, repeated hashing — a blink for you, costly for every guess an attacker makes.',
    spec: '600k iterations · SHA-256 · OWASP 2023',
    link: { label: 'Where do I use this?', to: '/unlock', hint: 'Every unlock' },
  },
  {
    icon: Fingerprint,
    name: 'WebAuthn passkeys',
    tagline: 'Paused, for good reason.',
    body: 'Passkey unlock is turned off. The earlier design stored data that could open the vault without the passkey, so it was removed and existing vaults are re-encrypted. It returns only when the key comes from the authenticator itself.',
    spec: 'paused · redesign on authenticator-held keys (PRF)',
    link: { label: 'Read the details', to: '/settings', hint: 'Settings → Security methods' },
  },
  {
    icon: Smartphone,
    name: 'TOTP (RFC 6238)',
    tagline: 'The extra check.',
    body: 'Google Authenticator & friends generate a new 6-digit code every 30 seconds. KeyHaven asks for it after your master password — a check made by the app, not part of the encryption.',
    spec: '30s window · HMAC-SHA1 · offline',
    link: { label: 'Where do I use this?', to: '/settings', hint: 'Settings → Security methods' },
  },
];

export default function BuildingBlocks() {
  return (
    <section className="border-t border-kh-line py-24 md:py-28">
      <div className="mx-auto max-w-marketing px-6">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20%' }}
          transition={{ duration: 0.5, ease: EASE }}
          className="font-display text-[40px] font-bold leading-[48px] tracking-[-0.02em] text-kh-primary"
        >
          The parts, honestly labeled.
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20%' }}
          transition={{ delay: 0.1, duration: 0.5, ease: EASE }}
          className="mt-4 max-w-[56ch] text-lg leading-[30px] text-kh-muted"
        >
          No mystery ingredients — these are the same reviewed primitives banks and governments
          use, running entirely inside your browser tab.
        </motion.p>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {BLOCKS.map((block, i) => {
            const Icon = block.icon;
            return (
              <motion.div
                key={block.name}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-20%' }}
                transition={{ delay: 0.09 * i, duration: 0.55, ease: EASE }}
              >
                <GlowCard className="h-full">
                  <div className="flex h-full flex-col p-7">
                    <div className="group/icon relative">
                      <VaultRing size={56} muted>
                        <Icon className="h-5 w-5 text-kh-mint" />
                      </VaultRing>
                    </div>
                    <h3 className="mt-5 font-display text-2xl font-semibold text-kh-primary">
                      {block.name}
                      <span className="ml-2.5 align-middle font-mono text-xs font-normal text-kh-cyan">
                        {block.tagline}
                      </span>
                    </h3>
                    <p className="mt-3 flex-1 text-sm leading-6 text-kh-muted">{block.body}</p>
                    <div className="mt-6 flex items-center justify-between gap-3 border-t border-kh-line pt-4">
                      <span className="font-mono text-[11px] text-kh-faint">{block.spec}</span>
                      <Link
                        to={block.link.to}
                        className="group flex shrink-0 items-center gap-1 text-xs font-medium text-kh-cyan transition-colors hover:text-kh-primary"
                        title={block.link.hint}
                      >
                        {block.link.label}
                        <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                  </div>
                </GlowCard>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
