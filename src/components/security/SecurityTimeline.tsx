/**
 * SecurityTimeline — Watchtower §4. Vertical timeline of recent security
 * events derived from real vault state (this session's unlock, the latest
 * password update, a stored per-login 2FA code). No invented events.
 * The 2px gradient line draws down on scroll into view; nodes pop and rows
 * fade+rise as the line "passes" them.
 */

import { motion } from 'framer-motion';
import { KeyRound, Lock, Smartphone } from 'lucide-react';
import type { VaultEntry } from '@/lib/vault';

const EXPO = [0.16, 1, 0.3, 1] as [number, number, number, number];

interface TimelineEvent {
  id: string;
  icon: typeof Lock;
  color: string;
  title: string;
  when: string;
}

function relDay(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Recently';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 31) return `${Math.round(days / 7)} weeks ago`;
  const months = Math.round(days / 30.44);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function SecurityTimeline({ entries }: { entries: VaultEntry[] }) {
  const events: TimelineEvent[] = [
    {
      id: 'unlock',
      icon: Lock,
      color: '#35F0A1',
      title: 'Vault unlocked in this browser',
      when: `Today ${nowTime()}`,
    },
  ];

  const byUpdated = [...entries].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (byUpdated[0]) {
    events.push({
      id: `update-${byUpdated[0].id}`,
      icon: KeyRound,
      color: '#38E1FF',
      title: `Password updated: ${byUpdated[0].title}`,
      when: relDay(byUpdated[0].updatedAt),
    });
  }

  const totpEntry = entries.find((e) => e.totp);
  if (totpEntry) {
    events.push({
      id: `totp-${totpEntry.id}`,
      icon: Smartphone,
      color: '#38E1FF',
      title: `Two-factor code added: ${totpEntry.title}`,
      when: relDay(totpEntry.updatedAt),
    });
  }

  return (
    <section aria-label="Recent security events">
      <motion.h2
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ duration: 0.5, ease: EXPO }}
        className="font-display text-[clamp(24px,3vw,32px)] font-semibold tracking-[-0.015em] text-kh-primary"
      >
        Recent security events
      </motion.h2>

      <div className="relative mt-8 pl-8">
        {/* drawing line */}
        <motion.span
          aria-hidden
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true, margin: '-20% 0px' }}
          transition={{ duration: 1.2, ease: EXPO }}
          className="absolute left-[5px] top-1 bottom-1 w-[2px] origin-top"
          style={{ background: 'linear-gradient(#35F0A1, #38E1FF 55%, #8B7CFF)' }}
        />
        <ul className="space-y-5">
          {events.map((ev, i) => (
            <motion.li
              key={ev.id}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-12% 0px' }}
              transition={{ duration: 0.45, delay: 0.15 + i * 0.1, ease: EXPO }}
              className="group relative flex items-center gap-4 rounded-xl px-3 py-2 transition-colors hover:bg-kh-elevated/70"
            >
              {/* node */}
              <motion.span
                initial={{ scale: 0 }}
                whileInView={{ scale: 1 }}
                viewport={{ once: true, margin: '-12% 0px' }}
                transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.15 + i * 0.1 }}
                className="absolute -left-8 top-1/2 flex h-3 w-3 -translate-y-1/2 items-center justify-center rounded-full border-2 border-kh-base"
                style={{ backgroundColor: ev.color, boxShadow: `0 0 12px ${ev.color}80` }}
                aria-hidden
              />
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${ev.color}14`, border: `1px solid ${ev.color}30` }}
              >
                <ev.icon style={{ color: ev.color, width: 15, height: 15 }} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-kh-primary transition-colors group-hover:text-white">
                {ev.title}
              </span>
              <span className="shrink-0 font-mono text-[12px] text-kh-faint">{ev.when}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
