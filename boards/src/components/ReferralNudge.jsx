// ReferralNudge — the "build this together" nudge at the activation beat.
// Mirrors FirstValueUpgradeBanner (non-blocking bottom banner, same fv-banner
// styles) but pushes INVITING A COLLABORATOR into the board the user just
// populated — a second human in the workspace is the strongest return +
// growth signal we have. Since 0188 editor collaboration is FREE on every
// tier, so the pitch is genuinely "build together", not a viewer teaser.
//
// Reward lines stay honest (both are real):
//   demo → friend gets +25 cards, you earn 25 when they place their first
//          (migration 0163; invite-link claims feed the same ledger, 0189).
//   paid → a free month when a friend you invite upgrades (migration 0167).
//
// Trigger: App.jsx dispatches `soleil:collab-nudge` with {boardId} once the
// current board crosses the activation bar (≥3 genuine cards, never
// mid-tour). Eligibility lives in settings.collab_nudge (NOT the legacy
// referral-prompts keys — those were shared with the retired 5-card banner
// and permanently muted most of the base):
//   { count, last_at, boards: [] }
//   • once per BOARD (boards[], FIFO-capped) — each newly populated cluster
//     is a fresh reason to invite
//   • 7-day cooldown between shows
//   • lifetime cap of 3 — after three passes it's a "no", stop asking
//
// The CTA delegates to the parent's onCollaborate(surface, boardId), which
// opens the Share panel on that board scrolled to the invite-link section.

import { useEffect, useRef, useState } from 'react';
import { getOwnProfile, updateOwnSettings } from '../lib/boardsApi.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;  // between shows
const LIFETIME_CAP = 3;                       // total shows per account
const BOARDS_KEPT = 20;                       // FIFO cap on the per-board list

export function ReferralNudge({ tier, onCollaborate }) {
  const isPaid = tier === 'paid';
  const eligible = tier === 'demo' || tier === 'paid';
  const surface = isPaid ? 'paid_nudge' : 'nudge';

  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // undefined = still loading; object = the collab_nudge settings blob.
  const stateRef = useRef(undefined);
  const settingsRef = useRef({});  // full profiles.settings so siblings survive
  const firedRef = useRef(false);  // once per session
  const boardIdRef = useRef(null); // board the shown nudge is about (CTA target)
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

  // Load eligibility state (profiles.settings is jsonb).
  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    getOwnProfile()
      .then((p) => {
        if (cancelled) return;
        settingsRef.current = p?.settings || {};
        const s = settingsRef.current.collab_nudge || {};
        stateRef.current = {
          count: Number(s.count) || 0,
          lastAt: Date.parse(s.last_at || '') || 0,
          boards: Array.isArray(s.boards) ? s.boards : [],
        };
      })
      .catch(() => { if (!cancelled) stateRef.current = { count: 0, lastAt: 0, boards: [] }; });
    return () => { cancelled = true; };
  }, [eligible]);

  // Show on the collab-nudge signal when this board + the cadence allow it.
  useEffect(() => {
    if (!eligible) return;
    const trigger = (e) => {
      const st = stateRef.current;
      if (firedRef.current || !st) return;          // this session / still loading
      const boardId = e?.detail?.boardId || null;
      if (st.count >= LIFETIME_CAP) return;          // three passes = a "no"
      if (st.lastAt && Date.now() - st.lastAt < COOLDOWN_MS) return;
      if (boardId && st.boards.includes(boardId)) return; // asked for this one already
      // Never stack over the first-value upsell (it fires at 2 cards, this at
      // 3 — one multi-photo drop can land both in the same beat). Skipping
      // WITHOUT persisting is safe: App re-dispatches on every genuine-card
      // change past the bar, so we retry on the next one.
      if (document.querySelector('.fv-banner')) return;
      if (fvFiredAtRef.current && Date.now() - fvFiredAtRef.current < 60_000) return;
      firedRef.current = true;
      boardIdRef.current = boardId;
      const at = new Date().toISOString();
      const next = {
        count: st.count + 1,
        last_at: at,
        boards: boardId ? [...st.boards, boardId].slice(-BOARDS_KEPT) : st.boards,
      };
      stateRef.current = { count: next.count, lastAt: Date.parse(at), boards: next.boards };
      setShow(true);
      logEvent(EV.INVITE_NUDGE_VIEW, { surface, board_id: boardId });
      // Persist on show. Spread the existing settings sibling-safe (the
      // updateOwnSettings merge is shallow at the top level). Best-effort.
      updateOwnSettings({ collab_nudge: next }).catch(() => {});
    };
    window.addEventListener('soleil:collab-nudge', trigger);
    return () => window.removeEventListener('soleil:collab-nudge', trigger);
  }, [eligible, surface]);

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
    onCollaborate?.(surface, boardIdRef.current);
  };

  return (
    <div className={`fv-banner surface-frosted${leaving ? ' is-leaving' : ''}`}
         role="dialog" aria-label="Invite someone to build this cluster with you">
      <div className="fv-banner-spark" aria-hidden="true">🤝</div>
      <div className="fv-banner-copy">
        <div className="fv-banner-title">Build this together?</div>
        <div className="fv-banner-body">
          {isPaid
            ? 'Grab an invite link and pull someone into this cluster — and when a friend you invite upgrades, you get a free month.'
            : 'Grab an invite link and pull someone into this cluster — editing together is free. They start with 25 free cards, and you earn 25 when they place their first.'}
        </div>
      </div>
      <div className="fv-banner-actions">
        <button className="fv-banner-cta" onClick={invite}>Invite someone</button>
        <button className="fv-banner-dismiss" onClick={dismiss}>Maybe later</button>
      </div>
    </div>
  );
}
