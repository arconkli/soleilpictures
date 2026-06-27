// ReferralNudge — a soft, once-per-account nudge inviting a user to share
// Clusters after they've clearly gotten value. Mirrors FirstValueUpgradeBanner
// (non-blocking bottom banner, same fv-banner styles) but pushes INVITING.
//
// Tier-aware (both honest about a REAL reward):
//   demo → "+25 cards each" (the bonus-card loop raises their demo cap).
//   paid → "a free month when a friend upgrades" (migration 0167 — their cards
//          reward would be inert, so we lead with the conversion reward).
//
// Trigger: App.jsx dispatches `soleil:referral-nudge` once the user crosses a
// comfortable genuine-card bar (≥5) — strictly past the first-value upgrade
// banner's bar (2 cards) so the two never stack. De-duped per account via a
// per-tier key in settings.referral_prompts (invite_/paid_nudge_shown_at).
//
// State + persistence live here (like UpgradeChip owns the FV banner). The CTA
// delegates to the parent's onInvite, which opens the "Invite & earn" tab.

import { useEffect, useRef, useState } from 'react';
import { getOwnProfile, updateOwnSettings } from '../lib/boardsApi.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

export function ReferralNudge({ tier, onInvite }) {
  const isPaid = tier === 'paid';
  const eligible = tier === 'demo' || tier === 'paid';
  const settingsKey = isPaid ? 'paid_nudge_shown_at' : 'invite_nudge_shown_at';
  const surface = isPaid ? 'paid_nudge' : 'nudge';

  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // undefined = still loading the flag, null = never shown, string = shown before.
  const shownAtRef = useRef(undefined);
  const promptsRef = useRef({});   // full referral_prompts so we never wipe sibling keys
  const firedRef = useRef(false);
  const leaveTimer = useRef(null);

  // Read the once-per-account flag (profiles.settings is jsonb).
  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    getOwnProfile()
      .then((p) => {
        if (cancelled) return;
        promptsRef.current = p?.settings?.referral_prompts || {};
        shownAtRef.current = promptsRef.current[settingsKey] || null;
      })
      .catch(() => { if (!cancelled) shownAtRef.current = null; });
    return () => { cancelled = true; };
  }, [eligible, settingsKey]);

  // Show once on the referral-nudge signal.
  useEffect(() => {
    if (!eligible) return;
    const trigger = () => {
      if (firedRef.current || shownAtRef.current) return; // this session / a prior one
      firedRef.current = true;
      const at = new Date().toISOString();
      shownAtRef.current = at;
      setShow(true);
      logEvent(EV.REFERRAL_NUDGE_VIEW, { surface });
      // Persist on show so it's truly once-per-account. Spread the existing
      // prompts so a per-tier key never clobbers its sibling. Best-effort.
      updateOwnSettings({ referral_prompts: { ...promptsRef.current, [settingsKey]: at } }).catch(() => {});
    };
    window.addEventListener('soleil:referral-nudge', trigger);
    return () => window.removeEventListener('soleil:referral-nudge', trigger);
  }, [eligible, settingsKey, surface]);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  if (!eligible || !show) return null;

  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    logEvent(EV.REFERRAL_NUDGE_DISMISS, { surface });
    leaveTimer.current = setTimeout(() => setShow(false), 190);
  };
  const invite = () => {
    logEventNow(EV.REFERRAL_NUDGE_CTA, { surface }); // must-land: panel opens
    setShow(false);
    onInvite?.(surface);
  };

  return (
    <div className={`fv-banner surface-frosted${leaving ? ' is-leaving' : ''}`}
         role="dialog" aria-label="Invite friends to Clusters">
      <div className="fv-banner-spark" aria-hidden="true">🎁</div>
      <div className="fv-banner-copy">
        <div className="fv-banner-title">
          {isPaid ? 'Love Clusters? Invite a friend.' : 'Enjoying Clusters? Invite a friend.'}
        </div>
        <div className="fv-banner-body">
          {isPaid
            ? 'They start with 25 free cards — and when a friend you invite upgrades to a paid plan, you get a free month.'
            : 'They start with 25 free cards — and you earn 25 more when they do. No limit.'}
        </div>
      </div>
      <div className="fv-banner-actions">
        <button className="fv-banner-cta" onClick={invite}>Invite friends</button>
        <button className="fv-banner-dismiss" onClick={dismiss}>Maybe later</button>
      </div>
    </div>
  );
}
