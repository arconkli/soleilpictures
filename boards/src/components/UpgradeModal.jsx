// UpgradeModal — convenience wrapper that renders PricingModal with a
// context-specific header. App.jsx maps its `upgradeReason` state into
// a header variant:
//   'cap-hit'     → 100-card demo cap copy
//   'shared-edit' → "Editing shared boards is a Creator feature" copy
//   'manual' / null → generic "Unlock everything" copy

import { PricingModal } from './PricingModal.jsx';

export function UpgradeModal({ onClose, reason = null }) {
  const header = reason === 'cap-hit' ? 'cap-hit'
               : reason === 'shared-edit' ? 'shared-edit'
               : null;
  return <PricingModal onClose={onClose} header={header} />;
}
