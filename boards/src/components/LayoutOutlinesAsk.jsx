// LayoutOutlinesAsk — "Help improve Clusters?", a plain yes or no.
//
// If the person says yes, Clusters keeps weekly outlines (plain boxes: where a
// card sits and how big it is, never what is in it) of the clusters they make
// from then on. See lib/layoutOutlines.js for the consent rules and
// /docs/account/data-and-privacy#layout-outlines for what is kept.
//
// PROPS CONTRACT
//   userId            string | null   the signed-in user's id (unused for logic;
//                                     reserved so the mount mirrors ReturnReasonAsk)
//   settings          object | null   profiles.settings of the signed-in user
//                                     (App.jsx's `mySettings` from useResolvedDefaults)
//   settingsLoaded    boolean         App.jsx's `mySettingsLoaded`; the ask never
//                                     arms before the profile has loaded
//   accountCreatedAt  string | null   user.created_at (ISO)
//   onAsked(nextAsks) function        called once, after the ask has been on a
//                                     live screen for 4 s, with { n, last }
//
// HOW App.jsx MOUNTS IT (the lead does this; nothing here edits App.jsx)
//   Right after <ReturnReasonAsk/> (App.jsx ~12620):
//     <LayoutOutlinesAsk
//       userId={user?.id || null}
//       settings={mySettings}
//       settingsLoaded={mySettingsLoaded}
//       accountCreatedAt={user?.created_at || null}
//       onAsked={handleLayoutAsked}
//     />
//   with, beside the other settings writers:
//     const handleLayoutAsked = useCallback(async (nextAsks) => {
//       try {
//         await updateOwnSettings({ layout_outlines_asks: nextAsks });
//         setMySettings((s) => ({ ...(s || {}), layout_outlines_asks: nextAsks }));
//       } catch (_) { /* asked again next visit at worst, never more than 3 total */ }
//     }, []);
//   `mySettings` is the object useResolvedDefaults returns; if it has no setter,
//   the hook needs one (or a refetch) so the local copy shows the new counter.
//   updateOwnSettings replaces the key whole, so pass the full { n, last }.
//   The answer itself is NOT written from the client's settings path: this
//   component calls set_layout_outlines and then dispatches soleil:layout-outlines
//   ({ detail: { ok } }); App.jsx may listen to it to merge
//   layout_outlines: { ok } into its local copy so a later render does not ask.
//
// WHAT KEEPS IT FROM BEING A NAG (modelled on ReturnReasonAsk)
//   • 20 s of VISIBLE time first, then quiet() for 1.5 s (or 8 s, then quiet),
//     giving up after 90 s without counting an ask
//   • routed through the shared upsell slot ('layout-ask', an ambient kind)
//   • counts as asked only after 4 s actually on screen (not hidden by clean or
//     focus mode, not in a background tab)
//   • at most three asks, on different days, never in the first 24 h, and never
//     again once answered (shouldAskLayoutOutlines)
//   • no close X and no icon: "No thanks" and "Sure" are the two answers

import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../lib/errorReporting.js';
import { getOwnProfile } from '../lib/boardsApi.js';
import { claimUpsellSlot } from '../lib/upsellSlot.js';
import { anyModalOpen } from '../lib/modalGuard.js';
import { isEditablePointerTarget } from '../lib/isEditableTarget.js';
import {
  LAYOUT_OUTLINES_DOC, LAYOUT_OUTLINES_EVENT, layoutOutlinesAsks, localDateKey,
  setLayoutOutlines, shouldAskLayoutOutlines,
} from '../lib/layoutOutlines.js';

// Same clock as ReturnReasonAsk, without its 'soleil:returned' trigger.
const VISIBLE_MS = 20_000;
const TICK_MS = 500;
const SETTLE_MS = 1_500;
const SETTLE_GRACE_MS = 8_000;
const SETTLE_GIVE_UP_MS = 90_000;
// If another ambient surface owns the slot, try again after it clears.
const RETRY_MS = 70_000;
const RETRIES = 2;
// Counts as asked once it has been truly on screen this long.
const DELIVERED_MS = 4_000;
// Matches .fv-banner.is-leaving (180 ms).
const LEAVE_MS = 190;

export function LayoutOutlinesAsk({ userId = null, settings = null, settingsLoaded = false, accountCreatedAt = null, onAsked } = {}) {
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Answered (or its event seen) in this session: stays hidden even if the
  // settings copy in App has not caught up yet.
  const [answered, setAnswered] = useState(false);

  const timerRef = useRef(null);
  const settleRef = useRef(null);
  const deliveredRef = useRef(null);
  const rootRef = useRef(null);
  const pointerDownRef = useRef(false);
  const askedRef = useRef(false);
  const answeredRef = useRef(false);
  // The latest props, read by the timers without re-arming them.
  const liveRef = useRef({});
  liveRef.current = { settings, accountCreatedAt, onAsked, userId };
  // The settings read fresh from the account just before showing: another tab
  // or device may have asked today, and this copy would not know.
  const freshRef = useRef(null);

  useEffect(() => {
    const down = () => { pointerDownRef.current = true; };
    const up = () => { pointerDownRef.current = false; };
    window.addEventListener('pointerdown', down, { capture: true, passive: true });
    window.addEventListener('pointerup', up, { capture: true, passive: true });
    window.addEventListener('pointercancel', up, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointerup', up, { capture: true });
      window.removeEventListener('pointercancel', up, { capture: true });
    };
  }, []);

  // An answer from anywhere (this banner, Settings) retires the ask.
  useEffect(() => {
    const onAnswer = () => { answeredRef.current = true; setAnswered(true); setOpen(false); };
    window.addEventListener(LAYOUT_OUTLINES_EVENT, onAnswer);
    return () => window.removeEventListener(LAYOUT_OUTLINES_EVENT, onAnswer);
  }, []);

  // Is this a moment we can take? Same rules as ReturnReasonAsk.
  const quiet = useCallback(() => {
    if (typeof document === 'undefined') return false;
    if (document.hidden) return false;
    if (pointerDownRef.current) return false;
    if (anyModalOpen()) return false;
    if (document.querySelector('.is-dragging')) return false;
    if (isEditablePointerTarget({ target: document.activeElement })) return false;
    return true;
  }, []);

  const eligible = useCallback(() => {
    if (answeredRef.current || askedRef.current) return false;
    const { settings: s, accountCreatedAt: born } = liveRef.current;
    return shouldAskLayoutOutlines({ settings: s, today: localDateKey(), accountCreatedAt: born, now: Date.now() });
  }, []);

  // Arm once the profile has loaded and the person is still eligible.
  const armed = settingsLoaded && !!userId && shouldAskLayoutOutlines({
    settings, today: localDateKey(), accountCreatedAt, now: Date.now(),
  });

  useEffect(() => {
    if (!armed || answered) return undefined;

    let tries = 0;
    let visible = 0;
    let settled = 0;
    let waited = 0;

    let cancelled = false;

    const retry = () => {
      tries += 1;
      if (tries <= RETRIES) timerRef.current = setTimeout(show, RETRY_MS);
      else timerRef.current = null;
    };

    const show = async () => {
      if (!eligible()) return;
      // A dialog already open is a deferral, checked before the claim so a
      // retry never takes the slot it will not use.
      if (!quiet()) { retry(); return; }
      // Another tab or device may have asked since this copy loaded. A failed
      // read never shows the ask.
      let fresh;
      try { fresh = await getOwnProfile({ userId: liveRef.current.userId }); } catch (_) { timerRef.current = null; return; }
      if (cancelled) return;
      const s = fresh?.settings || null;
      if (!shouldAskLayoutOutlines({ settings: s, today: localDateKey(), accountCreatedAt: liveRef.current.accountCreatedAt, now: Date.now() })) {
        timerRef.current = null;
        return;
      }
      if (!quiet() || !claimUpsellSlot('layout-ask')) { retry(); return; }
      freshRef.current = s;
      timerRef.current = null;
      setOpen(true);
    };

    const settle = () => {
      settleRef.current = setTimeout(() => {
        waited += TICK_MS;
        settled = quiet() ? settled + TICK_MS : 0;
        if (settled >= SETTLE_MS || (waited >= SETTLE_GRACE_MS && quiet())) {
          settleRef.current = null;
          show();
          return;
        }
        // Still busy: stand down for this session without counting an ask.
        if (waited >= SETTLE_GIVE_UP_MS) { settleRef.current = null; return; }
        settle();
      }, TICK_MS);
    };

    // Phase 1: visible time only.
    const tick = () => {
      timerRef.current = setTimeout(() => {
        if (!eligible()) { timerRef.current = null; return; }
        if (!document.hidden) visible += TICK_MS;
        if (visible >= VISIBLE_MS) { timerRef.current = null; settle(); return; }
        tick();
      }, TICK_MS);
    };
    tick();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (settleRef.current) clearTimeout(settleRef.current);
      timerRef.current = null;
      settleRef.current = null;
    };
  }, [armed, answered, quiet, eligible]);

  // DELIVERY: counts as asked once it has been genuinely visible for 4 s.
  useEffect(() => {
    if (!open) return undefined;
    let onScreen = 0;
    deliveredRef.current = setInterval(() => {
      if (document.hidden) return;
      const el = rootRef.current;
      if (!el || el.getClientRects().length === 0) return; // clean or focus mode
      onScreen += TICK_MS;
      if (onScreen < DELIVERED_MS) return;
      clearInterval(deliveredRef.current);
      deliveredRef.current = null;
      if (askedRef.current) return;
      askedRef.current = true;
      const { n } = layoutOutlinesAsks(freshRef.current || liveRef.current.settings);
      try { liveRef.current.onAsked?.({ n: n + 1, last: localDateKey() }); } catch (_) {}
    }, TICK_MS);
    return () => { if (deliveredRef.current) clearInterval(deliveredRef.current); deliveredRef.current = null; };
  }, [open]);

  if (!open || answered) return null;

  const answer = async (ok) => {
    answeredRef.current = true;
    setLeaving(true);
    setTimeout(() => { setOpen(false); setAnswered(true); }, LEAVE_MS);
    try {
      await setLayoutOutlines(ok);
    } catch (e) {
      // Stays answered locally for this session; the ask comes round on a
      // later day if the server never heard (three asks at most).
      try { reportError(e, { kind: 'save', op: 'set_layout_outlines' }); } catch (_) {}
    }
  };

  // Only while focus is inside the banner, so Escape still clears a selection
  // on the canvas otherwise.
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); setLeaving(true); setTimeout(() => setOpen(false), LEAVE_MS); }
  };

  return (
    <div
      ref={rootRef}
      className={`fv-banner surface-frosted lo-ask${leaving ? ' is-leaving' : ''}`}
      role="dialog"
      aria-label="Help improve Clusters?"
      onKeyDown={onKeyDown}
    >
      <div className="fv-banner-copy">
        <div className="fv-banner-title">Help improve Clusters?</div>
        <div className="fv-banner-body">
          <a className="lo-ask-link" href={LAYOUT_OUTLINES_DOC} target="_blank" rel="noopener noreferrer">Learn more</a>
        </div>
      </div>
      <div className="fv-banner-actions">
        <button type="button" className="fv-banner-dismiss" onClick={() => answer(false)} disabled={leaving}>No thanks</button>
        <button type="button" className="lo-ok" onClick={() => answer(true)} disabled={leaving}>Sure</button>
      </div>
    </div>
  );
}
