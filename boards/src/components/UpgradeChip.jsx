// UpgradeChip — the demo-tier upgrade overlay (top-right of the app shell).
//
// Visible only for tier='demo'. Renders:
//   • the persistent `Upgrade · N/100` pill (click → in-app PricingModal), and
//   • the one-time "first value" nudge — a soft banner shown the first time the
//     user places a genuine card (App.jsx dispatches `soleil:first-value`), which
//     opens the PricingModal with the warm 'first-value' framing + surface tag.
//
// Living here (rather than in App.jsx) means the nudge renders in both real mode
// AND the ?local=1 QA harness, since TierRouter mounts this overlay in both.
// Hidden entirely for admin / paid / waitlist tiers.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { PricingModal } from './PricingModal.jsx';
import { FirstValueUpgradeBanner } from './FirstValueUpgradeBanner.jsx';
import { getOwnProfile, updateOwnSettings } from '../lib/boardsApi.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { qaForceFirstValue } from '../lib/localMode.js';
import { DEMO_CARD_LIMIT } from '../lib/demoCardCap.js';

export function UpgradeChip() {
  const { user } = useAuth();
  const { tier, demoCardCount } = useMyTier({ userId: user?.id });
  const [open, setOpen] = useState(false);       // chip-opened modal
  const [fvBanner, setFvBanner] = useState(false); // first-value banner
  const [fvModal, setFvModal] = useState(false);   // first-value modal
  // Once-per-account flag (settings.upgrade_prompts.first_value_shown_at):
  // undefined while loading, null = never shown, string = shown a prior session.
  const fvShownAtRef = useRef(undefined);
  const firedRef = useRef(false);

  // Read the once-flag for demo users (no migration: profiles.settings is jsonb).
  useEffect(() => {
    if (tier !== 'demo') return;
    let cancelled = false;
    getOwnProfile()
      .then((p) => { if (!cancelled) fvShownAtRef.current = p?.settings?.upgrade_prompts?.first_value_shown_at || null; })
      .catch(() => { if (!cancelled) fvShownAtRef.current = null; });
    return () => { cancelled = true; };
  }, [tier]);

  // Show the banner on the first-value signal (or the dev/test force-flag), once.
  useEffect(() => {
    if (tier !== 'demo') return;
    const trigger = () => {
      if (firedRef.current || fvShownAtRef.current) return; // this session / prior session
      firedRef.current = true;
      const at = new Date().toISOString();
      fvShownAtRef.current = at;
      setFvBanner(true);
      logEvent(EV.FIRST_VALUE_UPGRADE_VIEW, {});
      // Persist on show so it's truly once-per-account. Best-effort.
      updateOwnSettings({ upgrade_prompts: { first_value_shown_at: at } }).catch(() => {});
    };
    window.addEventListener('soleil:first-value', trigger);
    if (qaForceFirstValue()) trigger();
    return () => window.removeEventListener('soleil:first-value', trigger);
  }, [tier]);

  if (tier !== 'demo') return null;

  const near = demoCardCount >= 90;
  const onSeeCreator = () => {
    logEventNow(EV.FIRST_VALUE_UPGRADE_CTA, {}); // must-land: a redirect may follow from the modal
    setFvBanner(false);
    setFvModal(true);
  };
  const onDismiss = () => {
    logEvent(EV.FIRST_VALUE_UPGRADE_DISMISS, {});
    setFvBanner(false);
  };

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
        <span className="upgrade-chip-count">{demoCardCount}/{DEMO_CARD_LIMIT}</span>
      </button>
      {open && <PricingModal onClose={() => setOpen(false)} header={null} />}
      {fvBanner && <FirstValueUpgradeBanner onSeeCreator={onSeeCreator} onDismiss={onDismiss} />}
      {fvModal && <PricingModal onClose={() => setFvModal(false)} header="first-value" surface="first_value" />}
    </>
  );
}
