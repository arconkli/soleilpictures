// UpgradeModal — convenience wrapper that renders PricingModal with a
// context-specific header. App.jsx maps its `upgradeReason` state into
// a header variant:
//   'cap-hit'     → demo card cap copy
//   'first-value' → warm "you're building something" copy (the first-value nudge)
//   'storage'     → "Room for everything you make" copy (the file-upload paywall)
//   'manual' / null → generic "Everything your work deserves" copy
//
// (The old 'shared-edit' reason died with migration 0188 — editing shared
// clusters is no longer a paid gate — so it's no longer mapped here.)
//
// The first-value path also tags checkout with surface='first_value' so the
// banner→modal→checkout funnel is attributable end-to-end; every other reason
// keeps the existing surface='modal'.

import { PricingModal } from './PricingModal.jsx';

export function UpgradeModal({ onClose, reason = null }) {
  const header = reason === 'cap-hit' ? 'cap-hit'
               : reason === 'first-value' ? 'first-value'
               : reason === 'storage' ? 'storage'
               : null;
  const surface = reason === 'first-value' ? 'first_value' : 'modal';
  // `via` = the entry point, for the up_* exposure envelope (which trigger put
  // this pitch in front of the user).
  const via = reason === 'cap-hit' ? 'cap_hit'
            : reason === 'storage' ? 'storage_gate'
            : reason === 'first-value' ? 'first_value_banner'
            : null;
  return <PricingModal onClose={onClose} header={header} surface={surface} via={via} />;
}
