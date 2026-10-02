/**
 * Home §8 — FAQ. Left sticky header; right accordion (6 items). Open row gets
 * a mint left-edge bar; chevron rotates 180° (via data-state selectors).
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
    q: 'Can KeyHaven (or anyone else) see my passwords?',
    a: 'No. Encryption and decryption happen only in your browser. What gets stored is ciphertext. There is no KeyHaven server holding anything.',
  },
  {
    q: 'What if I forget my master password?',
    a: "No one can recover it — not us, and not a backup code. Your vault key is derived only from your master password. Keep it somewhere safe; encrypted backups open with the password that was in use when you exported them.",
  },
  {
    q: 'How does Google Authenticator work here?',
    a: 'At setup you scan a QR code; your app then shows a new 6-digit code every 30 seconds, and KeyHaven asks for it after your master password. It is a check made by KeyHaven: it stops someone who only knows your password from unlocking in the app, but your vault is encrypted with the master password alone.',
  },
  {
    q: 'Can I unlock with a passkey?',
    a: 'Not right now. The earlier passkey design stored data that could open the vault without the passkey, so it was turned off and existing vaults are re-encrypted with a fresh key. It will return only with keys held by the authenticator itself.',
  },
  {
    q: 'Where is my vault stored?',
    a: "Encrypted, in your browser's IndexedDB storage on this device. Export an encrypted backup file anytime and import it elsewhere.",
  },
  {
    q: 'Is it really free?',
    a: 'Yes. No account, no subscription, no ads, no tracking.',
  },
];

export default function FaqSection() {
  return (
    <section id="faq" className="border-t border-kh-line py-24 md:py-32">
      <div className="mx-auto grid max-w-marketing gap-12 px-6 lg:grid-cols-[1fr_1.4fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20%' }}
            transition={{ duration: 0.5, ease: EASE }}
            className="font-display text-[40px] font-bold leading-[48px] tracking-[-0.02em] text-kh-primary"
          >
            Honest answers.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-20%' }}
            transition={{ delay: 0.1, duration: 0.5, ease: EASE }}
            className="mt-4 max-w-[38ch] text-lg leading-[30px] text-kh-muted"
          >
            No marketing fog — here's exactly how it works.
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
