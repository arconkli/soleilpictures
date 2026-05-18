// UpgradeModal — convenience wrapper that renders PricingModal with the
// "cap-hit" intro. Used by the addCard / addCards pre-flight check in
// App.jsx when a demo user tries to exceed their 100-card limit.

import { PricingModal } from './PricingModal.jsx';

export function UpgradeModal({ onClose }) {
  return <PricingModal onClose={onClose} header="cap-hit" />;
}
