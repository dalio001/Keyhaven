/**
 * About §6 — Security FAQ (deep-dive). Same accordion pattern as the home
 * FAQ: sticky left header, mint edge bar on the open row, rotating chevron.
 */

import { motion } from 'framer-motion';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

const FAQS = [
  {
    q: 'If there’s no server, how do I move to a new computer?',
    a: 'Export an encrypted backup (Settings → Vault & data), move the file, import, enter your master password. Done — the file itself is ciphertext the whole way.',
  },
  {
    q: 'Is browser storage really safe enough?',
    a: 'It only ever holds ciphertext sealed with AES-256-GCM. Without your master password it’s indistinguishable from random noise. Anyone with access to your browser profile can copy that ciphertext, so a long, unique master password is what protects it.',
  },
  {
    q: 'Which unlock method should I use?',
    a: 'A long, unique master password is the key to everything. Add Google Authenticator for an extra check at unlock, and save its one-time backup codes in case you lose your phone. Passkey unlock is paused for now.',
  },
  {
    q: 'Can someone bypass the authenticator with my laptop?',
    a: 'Not without your master password. The vault is encrypted with a key from your master password only; the authenticator is an extra check the app makes. Someone who had your master password AND a copy of your vault data could decrypt it without the authenticator — so the master password is what really protects you.',
  },
  {
    q: 'What happens if I lose everything?',
    a: 'If you forget your master password, the vault can’t be decrypted — by anyone. Keep the password somewhere safe and keep encrypted backups. Authenticator backup codes only help if you lose your phone.',
  },
  {
    q: 'Is the code auditable?',
    a: 'Yes — the app is open and uses only standard, reviewed primitives (Web Crypto, PBKDF2 600k, RFC 6238). No home-grown crypto, nothing to take on faith.',
  },
];

export default function AboutFaq() {
  return (
    <section id="faq" className="border-t border-kh-line py-24 md:py-28">
      <div className="mx-auto grid max-w-marketing gap-12 px-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20%' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="font-display text-[40px] font-bold leading-[48px] tracking-[-0.02em] text-kh-primary"
          >
            Security questions, straight up.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20%' }}
            transition={{ delay: 0.1, duration: 0.5, ease: EASE }}
            className="mt-4 max-w-[38ch] text-lg leading-[30px] text-kh-muted"
          >
            The deep-dive version — no hand-waving.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20%' }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <Accordion type="single" collapsible className="w-full">
            {FAQS.map((faq, i) => (
              <AccordionItem
                key={faq.q}
                value={`item-${i}`}
                className="border-b border-kh-line px-4 data-[state=open]:border-l-2 data-[state=open]:border-l-kh-mint"
              >
                <AccordionTrigger className="h-14 text-left text-[15px] font-medium text-kh-primary hover:no-underline [&[data-state=open]>svg]:rotate-180">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-6 text-kh-muted">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}
