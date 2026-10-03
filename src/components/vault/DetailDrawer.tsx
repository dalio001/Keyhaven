/**
 * DetailDrawer — entry detail view (vault.md §4). Fields in bg-inset rows
 * with trailing copy buttons; live TOTP with 30s ring; StrengthMeter with
 * entropy + crack-time caption; password history accordion; Edit / Delete
 * footer with inline confirm. Switching entries cross-fades content (200ms)
 * without re-sliding the panel.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Globe, Pencil, Star, Trash2 } from 'lucide-react';
import LetterAvatar from '@/components/LetterAvatar';
import LinkedSubscriptions from '@/components/subscriptions/LinkedSubscriptions';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useVault } from '@/providers/VaultProvider';
import { cn } from '@/lib/utils';
import MaskedSecret from './MaskedSecret';
import StrengthMeter from './StrengthMeter';
import TotpDisplay from './TotpDisplay';
import VaultDrawer from './VaultDrawer';
import { CATEGORY_META, monthYear, timeAgo, totpSecretFor } from './vault-utils';
import type { EntryExt } from './vault-utils';

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

function FieldLabel({ children }: { children: string }) {
  return <p className="text-eyebrow mb-1.5 text-kh-faint">{children}</p>;
}

function CopyIconButton({ text, label }: { text: string; label: string }) {
  const { copyWithAutoClear } = useVault();
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => void copyWithAutoClear(text, label)}
      className="shrink-0 rounded-md p-1.5 text-kh-faint transition-colors hover:bg-kh-elevated hover:text-kh-primary"
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2.5">
      {children}
    </div>
  );
}

function DetailBody({
  entry,
  onEdit,
}: {
  entry: EntryExt;
  onEdit: (e: EntryExt) => void;
}) {
  const { settings } = useVault();
  const [notesExpanded, setNotesExpanded] = useState(false);
  const secret = totpSecretFor(entry);
  const meta = CATEGORY_META[entry.category];
  const history = entry.passwordHistory ?? [];

  const fields = [
    { key: 'username', node: (
      <section aria-label="Username">
        <FieldLabel>Username</FieldLabel>
        <FieldRow>
          <span className="min-w-0 flex-1 truncate text-sm text-kh-primary">{entry.username}</span>
          <CopyIconButton text={entry.username} label="Copy username" />
        </FieldRow>
      </section>
    ) },
    { key: 'password', node: (
      <section aria-label="Password">
        <div className="flex items-center justify-between">
          <FieldLabel>Password</FieldLabel>
          <button
            type="button"
            onClick={() => onEdit(entry)}
            className="text-xs font-medium text-kh-cyan transition-colors hover:text-kh-mint"
          >
            Edit
          </button>
        </div>
        <FieldRow>
          <span className="min-w-0 flex-1">
            <MaskedSecret secret={entry.password} remaskSeconds={settings.remaskSeconds} />
          </span>
          <CopyIconButton text={entry.password} label="Copy password" />
        </FieldRow>
        <StrengthMeter password={entry.password} showCrackTime className="mt-2 px-0.5" />
      </section>
    ) },
    ...(secret ? [{ key: 'totp', node: (
      <section aria-label="Two-factor code">
        <FieldLabel>2FA code</FieldLabel>
        <FieldRow>
          <TotpDisplay secret={secret} className="w-full" />
        </FieldRow>
      </section>
    ) }] : []),
    { key: 'category', node: (
      <section aria-label="Category">
        <FieldLabel>Category</FieldLabel>
        <div>
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-medium"
            style={{ backgroundColor: `${meta.color}1A`, color: meta.color, border: `1px solid ${meta.color}33` }}
          >
            {meta.label}
          </span>
        </div>
      </section>
    ) },
    { key: 'subscriptions', node: <LinkedSubscriptions entry={entry} /> },
    ...(entry.notes ? [{ key: 'notes', node: (
      <section aria-label="Notes">
        <FieldLabel>Notes</FieldLabel>
        <div className="rounded-xl border border-kh-line bg-kh-inset px-3.5 py-2.5">
          <p className={cn('text-sm leading-[22px] text-kh-muted', !notesExpanded && 'line-clamp-3')}>
            {entry.notes}
          </p>
          {entry.notes.length > 140 && (
            <button
              type="button"
              onClick={() => setNotesExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-kh-cyan transition-colors hover:text-kh-mint"
            >
              {notesExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      </section>
    ) }] : []),
  ];

  return (
    <div className="flex flex-col gap-5 p-6 pt-0">
      {fields.map((f, i) => (
        <motion.div
          key={f.key}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE, delay: 0.08 + i * 0.05 }}
        >
          {f.node}
        </motion.div>
      ))}

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="font-mono text-[11px] leading-relaxed text-kh-faint"
      >
        Added {monthYear(entry.updatedAt)} · Updated {timeAgo(entry.updatedAt)} · Last used{' '}
        {timeAgo(entry.lastUsedAt)}
      </motion.p>

      {history.length > 0 && (
        <Accordion type="single" collapsible>
          <AccordionItem value="history" className="border-kh-line">
            <AccordionTrigger className="py-2 text-sm text-kh-muted hover:text-kh-primary hover:no-underline">
              <span className="flex items-center gap-2">
                Password history
                <span className="rounded-full bg-kh-surface px-1.5 font-mono text-[11px] text-kh-faint">
                  {history.length}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="flex flex-col gap-2 pt-1">
                {history.map((h, i) => (
                  <li
                    key={`${h.changedAt}-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-kh-line bg-kh-inset px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs tracking-[0.12em] text-kh-faint">
                      {'•'.repeat(Math.max(8, Math.min(h.password.length, 12)))}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-kh-faint">
                      {monthYear(h.changedAt)}
                    </span>
                    <CopyIconButton text={h.password} label="Copy previous password" />
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}

export default function DetailDrawer({
  entry,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: EntryExt | null;
  onClose: () => void;
  onEdit: (e: EntryExt) => void;
  onDelete: (e: EntryExt) => void;
}) {
  const { toggleFavorite } = useVault();
  const [confirming, setConfirming] = useState(false);

  // reset the inline delete confirm whenever another entry is shown
  const entryId = entry?.id ?? null;
  const [lastEntryId, setLastEntryId] = useState(entryId);
  if (entryId !== lastEntryId) {
    setLastEntryId(entryId);
    setConfirming(false);
  }

  return (
    <VaultDrawer
      open={entry !== null}
      onClose={onClose}
      labelledBy="entry-detail-title"
      footer={
        entry ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onEdit(entry)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-kh-lineStrong bg-kh-surface px-4 py-2.5 text-sm font-medium text-kh-primary transition-all hover:-translate-y-px hover:border-kh-cyan/40"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
            </button>
            {confirming ? (
              <div className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onDelete(entry)}
                  className="flex-1 rounded-xl bg-kh-danger px-3 py-2.5 text-sm font-semibold text-[#1A0509] transition-all hover:brightness-110"
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-xl border border-kh-line px-3 py-2.5 text-sm text-kh-muted transition-colors hover:text-kh-primary"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-kh-danger/40 px-4 py-2.5 text-sm font-medium text-kh-danger transition-all hover:-translate-y-px hover:bg-kh-danger/10"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      {entry && (
        <>
          <header className="flex items-start gap-4 p-6 pb-5">
            <LetterAvatar name={entry.title} size={56} />
            <div className="min-w-0 flex-1 pr-8">
              <div className="flex items-center gap-2">
                <h3
                  id="entry-detail-title"
                  className="truncate font-display text-2xl font-semibold tracking-[-0.01em] text-kh-primary"
                >
                  {entry.title}
                </h3>
                <button
                  type="button"
                  aria-label={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
                  aria-pressed={entry.favorite}
                  onClick={() => toggleFavorite(entry.id)}
                  className={cn(
                    'shrink-0 rounded-lg p-1.5 transition-colors hover:bg-kh-surface',
                    entry.favorite ? 'text-kh-warning' : 'text-kh-faint hover:text-kh-warning',
                  )}
                >
                  <Star size={18} fill={entry.favorite ? 'currentColor' : 'none'} />
                </button>
              </div>
              {entry.url && (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-flex max-w-full items-center gap-1.5 text-sm text-kh-cyan transition-colors hover:text-kh-mint"
                >
                  <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{entry.url.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
            </div>
          </header>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={entry.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <DetailBody entry={entry} onEdit={onEdit} />
            </motion.div>
          </AnimatePresence>
        </>
      )}
    </VaultDrawer>
  );
}