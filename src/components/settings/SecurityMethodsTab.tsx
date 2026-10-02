/**
 * Settings tab 1 — Security methods: locks overview, authenticator (TOTP),
 * authenticator backup codes, master password, auto-lock & clipboard.
 * (Passkey unlock is disabled — see LocksOverviewCard / docs/security-model.md.)
 */

import { useState } from 'react';
import LocksOverviewCard from './LocksOverviewCard';
import TotpCard from './TotpCard';
import RecoveryCodesCard from './RecoveryCodesCard';
import MasterPasswordCard from './MasterPasswordCard';
import AutoLockCard from './AutoLockCard';

export default function SecurityMethodsTab() {
  const [masterExpanded, setMasterExpanded] = useState(false);

  return (
    <div className="space-y-6">
      <LocksOverviewCard
        onChangePassword={() => {
          setMasterExpanded(true);
          document.getElementById('master-password')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />
      <TotpCard />
      <RecoveryCodesCard />
      <MasterPasswordCard expanded={masterExpanded} onExpandedChange={setMasterExpanded} />
      <AutoLockCard />
    </div>
  );
}
