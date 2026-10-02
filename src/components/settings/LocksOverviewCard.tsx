/**
 * Settings → Security methods → "How your vault is protected" overview.
 * Status rows for the master password (the only key to the encryption), the
 * authenticator (an extra check by the app) and passkeys (disabled);
 * actions scroll to (and expand) the target card.
 */

import { Fingerprint, KeyRound, Smartphone } from 'lucide-react';
import { motion } from 'framer-motion';
import { useVault } from '@/providers/VaultProvider';
import { EASE, KhButton, SectionCard, StatusChip } from './ui';

function scrollToCard(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export default function LocksOverviewCard({ onChangePassword }: { onChangePassword: () => void }) {
  const { totpEnabled } = useVault();

  const rows = [
    {
      icon: KeyRound,
      name: 'Master password',
      status: <StatusChip tone="mint">Encrypts your vault</StatusChip>,
      action: (
        <KhButton variant="ghost" className="px-3 py-1.5 text-xs" onClick={onChangePassword}>
          Change
        </KhButton>
      ),
    },
    {
      icon: Smartphone,
      name: 'Authenticator app (TOTP)',
      status: totpEnabled ? (
        <StatusChip tone="mint">Extra check on</StatusChip>
      ) : (
        <StatusChip tone="faint">Not set up</StatusChip>
      ),
      action: (
        <KhButton variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => scrollToCard('totp')}>
          Manage
        </KhButton>
      ),
    },
    {
      icon: Fingerprint,
      name: 'Passkey unlock',
      status: (
        <span title="The previous passkey design stored data that could open the vault without the authenticator, so it was removed. A redesign that uses secrets held by the authenticator itself is planned.">
          <StatusChip tone="faint">Turned off for now</StatusChip>
        </span>
      ),
      action: null,
    },
  ];


  return (
    <SectionCard
      className="rounded-3xl"
      title="How your vault is protected"
      helper="Your master password is the only key to your vault's encryption. The authenticator is an extra check this app makes after it — useful against someone who learns your password and tries to unlock here, but it does not change the encryption."
    >
      <div className="-mt-2 divide-y divide-kh-line">
        {rows.map((row, i) => {
          const Icon = row.icon;
          return (
            <motion.div
              key={row.name}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.07 * i + 0.05, duration: 0.45, ease: EASE }}
              className="flex items-center gap-3 py-3.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-kh-line bg-kh-inset">
                <Icon className="h-4 w-4 text-kh-cyan" />
              </span>
              <span className="flex-1 text-sm font-medium text-kh-primary">{row.name}</span>
              {row.status}
              {row.action}
            </motion.div>
          );
        })}
      </div>
    </SectionCard>
  );
}
