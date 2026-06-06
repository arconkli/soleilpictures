// UpgradeModal — convenience wrapper that renders PricingModal with a
// context-specific header. App.jsx maps its `upgradeReason` state into
// a header variant:
//   'cap-hit'     → 100-card demo cap copy
//   'shared-edit' → "Editing shared boards is a Creator feature" copy
//   'first-value' → warm "you're off the ground" copy (the first-value nudge)
//   'manual' / null → generic "Unlock everything" copy
//
// The first-value path also tags checkout with surface='first_value' so the
// banner→modal→checkout funnel is attributable end-to-end; every other reason
// keeps the existing surface='modal'.

import { PricingModal } from './PricingModal.jsx';

export function UpgradeModal({ onClose, reason = null }) {
  const header = reason === 'cap-hit' ? 'cap-hit'
               : reason === 'shared-edit' ? 'shared-edit'
               : reason === 'first-value' ? 'first-value'
               : null;
  const surface = reason === 'first-value' ? 'first_value' : 'modal';
  return <PricingModal onClose={onClose} header={header} surface={surface} />;
}
