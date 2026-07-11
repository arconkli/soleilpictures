// ReferralNudge — a soft, once-per-account "build this together" nudge at the
// activation beat. Mirrors FirstValueUpgradeBanner (non-blocking bottom banner,
// same fv-banner styles) but pushes INVITING A COLLABORATOR into the board the
// user just populated — a second human in the workspace is the strongest
// return + growth signal we have.
//
// Tier-aware (both honest about a REAL reward, kept as the supporting line):
//   demo → viewer invites are free (editor invites are the ShareModal's
//          upgrade pitch — not duplicated here); friend gets +25 cards, you
//          earn 25 when they start (migration 0163).
//   paid → a free month when a friend upgrades (migration 0167).
//
// Trigger: App.jsx dispatches `soleil:collab-nudge` once the current board
// crosses the activation bar (≥3 genuine cards, never mid-tour). De-duped per
// account via a per-tier key in settings.referral_prompts (invite_/paid_
// nudge_shown_at — same keys as the old 5-card referral banner, so anyone who
// already saw that one is never re-nudged).
//
// State + persistence live here (like UpgradeChip owns the FV banner). The CTA
// delegates to the parent's onCollaborate, which opens the Share panel on the
// current board (Invite People is its first section).

import { useEffect, useRef, useState } from 'react';
import { getOwnProfile, updateOwnSettings } from '../lib/boardsApi.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

export function ReferralNudge({ tier, onCollaborate }) {
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
  const fvFiredAtRef = useRef(0);  // last soleil:first-value dispatch (stacking guard)
  const leaveTimer = useRef(null);

  // Track the first-value upsell's dispatch. When cards 2 and 3 land in one
  // batch, both events fire in the same synchronous effect — the fv banner
  // isn't in the DOM yet when ours triggers, so the DOM check below can't see
  // it. The timestamp covers that ordering gap.
  useEffect(() => {
    const onFv = () => { fvFiredAtRef.current = Date.now(); };
    window.addEventListener('soleil:first-value', onFv);
    return () => window.removeEventListener('soleil:first-value', onFv);
  }, []);

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

  // Show once on the collab-nudge signal.
  useEffect(() => {
    if (!eligible) return;
    const trigger = () => {
      if (firedRef.current || shownAtRef.current) return; // this session / a prior one
      // Never stack over the first-value upsell (it fires at 2 cards, this at
      // 3 — one multi-photo drop can land both in the same beat). Skipping
      // WITHOUT consuming the once-flag is safe: App re-dispatches on every
      // genuine-card change past the bar, so we retry on the next one.
      if (document.querySelector('.fv-banner')) return;
      if (fvFiredAtRef.current && Date.now() - fvFiredAtRef.current < 60_000) return;
      firedRef.current = true;
      const at = new Date().toISOString();
      shownAtRef.current = at;
      setShow(true);
      logEvent(EV.INVITE_NUDGE_VIEW, { surface });
      // Persist on show so it's truly once-per-account. Spread the existing
      // prompts so a per-tier key never clobbers its sibling. Best-effort.
      updateOwnSettings({ referral_prompts: { ...promptsRef.current, [settingsKey]: at } }).catch(() => {});
    };
    window.addEventListener('soleil:collab-nudge', trigger);
    return () => window.removeEventListener('soleil:collab-nudge', trigger);
  }, [eligible, settingsKey, surface]);

  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  if (!eligible || !show) return null;

  const dismiss = () => {
    if (leaving) return;
    setLeaving(true);
    logEvent(EV.INVITE_NUDGE_DISMISS, { surface });
    leaveTimer.current = setTimeout(() => setShow(false), 190);
  };
  const invite = () => {
    logEventNow(EV.INVITE_NUDGE_CTA, { surface }); // must-land: panel opens
    setShow(false);
    onCollaborate?.(surface);
  };

  return (
    <div className={`fv-banner surface-frosted${leaving ? ' is-leaving' : ''}`}
         role="dialog" aria-label="Invite someone to build this cluster with you">
      <div className="fv-banner-spark" aria-hidden="true">🤝</div>
      <div className="fv-banner-copy">
        <div className="fv-banner-title">Build this together?</div>
        <div className="fv-banner-body">
          {isPaid
            ? 'Invite someone into this cluster — and when a friend you invite upgrades, you get a free month.'
            : 'Invite someone to see this cluster — they can follow along free. They start with 25 free cards, and you earn 25 when they place their first.'}
        </div>
      </div>
      <div className="fv-banner-actions">
        <button className="fv-banner-cta" onClick={invite}>Invite someone</button>
        <button className="fv-banner-dismiss" onClick={dismiss}>Maybe later</button>
      </div>
    </div>
  );
}
