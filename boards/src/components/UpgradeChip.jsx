// UpgradeChip — small persistent pill in the top-right of the app shell.
//
// Visible only for tier='demo'. Shows `Upgrade · N/100` where N is the
// current card count. Hover transitions to gold; click opens the
// in-app PricingModal. Hidden for admin / paid / waitlist tiers.

import { useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { PricingModal } from './PricingModal.jsx';

export function UpgradeChip() {
  const { user } = useAuth();
  const { tier, demoCardCount } = useMyTier({ userId: user?.id });
  const [open, setOpen] = useState(false);

  if (tier !== 'demo') return null;

  const near = demoCardCount >= 90;
  return (
    <>
      <button
        className={`upgrade-chip ${near ? 'upgrade-chip-near' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Upgrade to Creator"
        title="Upgrade your demo to Creator"
      >
        <span className="upgrade-chip-label">Upgrade</span>
        <span className="upgrade-chip-sep">·</span>
        <span className="upgrade-chip-count">{demoCardCount}/100</span>
      </button>
      {open && <PricingModal onClose={() => setOpen(false)} header={null} />}
    </>
  );
}
