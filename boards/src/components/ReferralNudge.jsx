// ReferralNudge — a soft, once-per-account nudge inviting a demo user to share
// Clusters after they've clearly gotten value. Mirrors FirstValueUpgradeBanner
// (non-blocking bottom banner, same fv-banner styles) but pushes INVITING (free,
// two-sided) rather than UPGRADING (paid).
//
// Trigger: App.jsx dispatches `soleil:referral-nudge` once the user crosses a
// comfortable genuine-card bar (≥5) — strictly past the first-value upgrade
// banner's bar (2 cards) so the two never stack. Gated to tier==='demo' and
// de-duped per account via settings.referral_prompts.invite_nudge_shown_at.
//
// State + persistence live here (like UpgradeChip owns the FV banner). The CTA
// delegates to the parent's onInvite, which opens the "Invite & earn" tab.

import { useEffect, useRef, useState } from 'react';
import { getOwnProfile, updateOwnSettings } from '../lib/boardsApi.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

export function ReferralNudge({ tier, onInvite }) {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // undefined = still loading the flag, null = never shown, string = shown before.
  const shownAtRef = useRef(undefined);
  const firedRef = useRef(false);
  const leaveTimer = useRef(null);

  // Read the once-per-account flag for demo users (profiles.settings is jsonb).
  useEffect(() => {
    if (tier !== 'demo') return;
    let cancelled = false;
    getOwnProfile()
      .then((p) => { if (!cancelled) shownAtRef.current = p?.settings?.referral_prompts?.invite_nudge_shown_at || null; })
      .catch(() => { if (!cancelled) shownAtRef.current = null; });
    return () => { cancelled = true; };
  }, [tier]);

  // Show once on the referral-nudge signal.
  useEffect(() => {
    if (tier !== 'demo') return;
    const trigger = () => {
      if (firedRef.current || shownAtRef.current) return; // this session / a prior one
      firedRef.current = true;
      const at = new Date().toISOString();
      shownAtRef.current = at;
      setShow(true);
      logEvent(EV.REFERRAL_NUDGE_VIEW, {});
      // Persist on show so it's truly once-per-account. Best-effort.
      updateOwnSettings({ referral_prompts: { invite_nudge_shown_at: at } }).catch(() => {});
    };
    window.addEventListener('soleil:referral-nudge', trigger);
    return () => window.removeEventListener('soleil:referral-nudge', trigger);
  }, [tier]);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  if (tier !== 'demo' || !show) return null;

  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    logEvent(EV.REFERRAL_NUDGE_DISMISS, {});
    leaveTimer.current = setTimeout(() => setShow(false), 190);
  };
  const invite = () => {
    logEventNow(EV.REFERRAL_NUDGE_CTA, { surface: 'nudge' }); // must-land: panel opens
    setShow(false);
    onInvite?.('nudge');
  };

  return (
    <div className={`fv-banner surface-frosted${leaving ? ' is-leaving' : ''}`}
         role="dialog" aria-label="Invite friends to earn free cards">
      <div className="fv-banner-spark" aria-hidden="true">🎁</div>
      <div className="fv-banner-copy">
        <div className="fv-banner-title">Enjoying Clusters? Invite a friend.</div>
        <div className="fv-banner-body">
          They start with 25 free cards — and you earn 25 more when they do. No limit.
        </div>
      </div>
      <div className="fv-banner-actions">
        <button className="fv-banner-cta" onClick={invite}>Invite friends</button>
        <button className="fv-banner-dismiss" onClick={dismiss}>Maybe later</button>
      </div>
    </div>
  );
}
