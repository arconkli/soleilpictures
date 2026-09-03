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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { PricingModal } from './PricingModal.jsx';
import { FirstValueUpgradeBanner } from './FirstValueUpgradeBanner.jsx';
import { getOwnProfile, updateOwnSettings } from '../lib/boardsApi.js';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { qaForceFirstValue, qaForceCapWall, qaForceImportAsk } from '../lib/localMode.js';
import { ImportCapDialog } from './ImportCapDialog.jsx';
import { DEMO_CARD_LIMIT, rejectedNoun } from '../lib/demoCardCap.js';
import { COPY_REV } from '../lib/billingCopy.js';
import { evaluateUpsell, atCapWall, ELIGIBILITY_REV } from '../lib/upsellEligibility.js';
import { claimUpsellSlot } from '../lib/upsellSlot.js';

export function UpgradeChip() {
  const { user } = useAuth();
  const { tier, demoCardCount, effectiveCardLimit } = useMyTier({ userId: user?.id });
  const cardLimit = effectiveCardLimit || DEMO_CARD_LIMIT;
  // Days since signup — the one retention signal available without a server
  // round-trip, and enough (with cap fraction) to qualify everyone the richer
  // active-days signal would have.
  const accountAgeDays = user?.created_at
    ? Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000))
    : 0;
  const elig = evaluateUpsell({ tier, demoCardCount, cardLimit, accountAgeDays });
  const capWallQa = qaForceCapWall();             // dev-only render seam, 0 in prod
  const importAskQa = qaForceImportAsk();         // dev-only render seam, null in prod
  const [open, setOpen] = useState(false);       // chip-opened modal
  const [fvBanner, setFvBanner] = useState(false); // first-value banner
  const [fvModal, setFvModal] = useState(false);   // first-value modal
  // Once-per-account flag (settings.upgrade_prompts.first_value_shown_at):
  // undefined while loading, null = never shown, string = shown a prior session.
  const fvShownAtRef = useRef(undefined);
  const firedRef = useRef(false);
  const chipRef = useRef(null);

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
      // Eligibility is checked HERE, before the once-per-account stamp is
      // burned. App.jsx now re-dispatches on every card change, so a user who
      // isn't ready at card #2 simply gets the banner later, at the first card
      // placed after they qualify. Gating at the dispatch site instead would
      // consume the one-shot on an ineligible user and kill the surface for
      // good — the banner would never fire, for anyone, ever again.
      // qaForceFirstValue is a RENDER seam, not a gate seam: the banner spec
      // exercises how the banner looks and dismisses, not who qualifies for it
      // (that's upsellEligibility.test.mjs's job), so it bypasses the check.
      // Distinct from the chip's suppression row: this user reached the
      // first-value moment (2+ genuine cards) and was still held back, which
      // is a different and more interesting silence than "never qualified".
      // Keyed per REASON so all three are legible in one page-load without
      // becoming a per-render beacon.
      const standDown = (reason) => {
        logEventOnce(`up_suppressed:first_value:${reason}`, EV.UP_SUPPRESSED, {
          surface: 'first_value',
          reason,
          cap_pct: elig.capPct,
          demo_cards: demoCardCount,
          limit: cardLimit,
          acct_days: accountAgeDays,
          elig_rev: ELIGIBILITY_REV,
          copy_rev: COPY_REV,
        });
      };

      if (!elig.eligible && !qaForceFirstValue()) { standDown(elig.reason); return; }

      // Every return below this line must leave the once-per-account stamp
      // UNWRITTEN. Deferring is not declining: App re-dispatches on every card
      // change, so a banner that stands down here arrives at the next card.
      // Burning the one-shot on a deferral retires the surface for this account
      // permanently — the exact shape of the dead-gate bug from 2026-08-04.

      // A bulk import crosses 0% to 100% of the cap in one second, which makes
      // this user `invested` (so eligible, correctly) in the very tick their
      // next card gets refused. "You're building something" is the wrong
      // sentence for somebody who is blocked; the cap-hit modal owns that
      // moment and says something true about it.
      if (atCapWall({ demoCardCount, cardLimit }) && !qaForceFirstValue()) {
        standDown('cap_reached');
        return;
      }

      // Somebody else (the invite nudge, or the wall) already has this moment.
      if (!claimUpsellSlot('first-value') && !qaForceFirstValue()) {
        standDown('slot_busy');
        return;
      }

      firedRef.current = true;
      const at = new Date().toISOString();
      fvShownAtRef.current = at;
      setFvBanner(true);
      logEvent(EV.FIRST_VALUE_UPGRADE_VIEW, { copy_rev: COPY_REV, elig_reason: elig.reason, cap_pct: elig.capPct });
      // Persist on show so it's truly once-per-account. Best-effort.
      updateOwnSettings({ upgrade_prompts: { first_value_shown_at: at } }).catch(() => {});
      // Local mirror of the same fact. App.jsx's activation effect reads this
      // key to stop re-dispatching once the banner has actually been shown —
      // the stamp lives here, at the point of showing, rather than at the
      // dispatch site where it would be burned on users who never saw it.
      try { if (user?.id) localStorage.setItem(`soleil_firstvalue_${user.id}`, '1'); } catch { /* ignore */ }
    };
    window.addEventListener('soleil:first-value', trigger);
    if (qaForceFirstValue()) trigger();
    return () => window.removeEventListener('soleil:first-value', trigger);
    // elig.eligible is a dependency: the listener closes over it, and a user
    // crosses the threshold mid-session. firedRef keeps the re-registration
    // idempotent, and qaForceFirstValue stays a render seam that bypasses the
    // gate so the banner spec doesn't need to construct an eligible user.
  }, [tier, elig.eligible, elig.reason, elig.capPct, demoCardCount, cardLimit, accountAgeDays, user?.id]);

  // Publish the chip's measured width to --upgrade-chip-gutter so the topbar's
  // right cluster (.tb-right) can reserve exactly enough room and never sit
  // under this fixed top-right overlay. The property is 0 whenever no demo chip
  // is mounted, so non-demo users (and topbar-less screens) reserve nothing.
  // useLayoutEffect runs before paint → no overlap flash; ResizeObserver keeps
  // the gutter in lockstep as the N/limit count widens or the web font reflows.
  useLayoutEffect(() => {
    const el = chipRef.current;
    const root = document.documentElement;
    // Also covers the suppressed case: without `!elig.eligible` here the
    // topbar would keep reserving room for a chip that never renders.
    if (tier !== 'demo' || !elig.eligible || !el) {
      root.style.setProperty('--upgrade-chip-gutter', '0px');
      return;
    }
    const apply = () => root.style.setProperty('--upgrade-chip-gutter', (el.offsetWidth + 16) + 'px');
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--upgrade-chip-gutter', '0px');
    };
  }, [tier, elig.eligible]);

  // Record the suppression itself. Without this, "nobody converted" and "nobody
  // was ever asked" are indistinguishable in the data, and the change made here
  // would be unmeasurable. logEventOnce keys per page-load, so this is ~1 row
  // per session per surface — analytics_events INSERT is anon-open, and a
  // per-render beacon would make this the highest-volume event in the family.
  useEffect(() => {
    if (tier !== 'demo' || elig.eligible) return;
    logEventOnce('up_suppressed:chip', EV.UP_SUPPRESSED, {
      surface: 'chip',
      reason: elig.reason,
      cap_pct: elig.capPct,
      demo_cards: demoCardCount,
      limit: cardLimit,
      acct_days: accountAgeDays,
      elig_rev: ELIGIBILITY_REV,
      copy_rev: COPY_REV,
    });
  }, [tier, elig.eligible, elig.reason, elig.capPct, demoCardCount, cardLimit, accountAgeDays]);

  if (tier !== 'demo') return null;

  // The CHIP is what eligibility gates: below the bar, the persistent ask
  // disappears. The pitch is a finite resource, and spending it on someone with
  // three cards on their first day is what taught this audience to dismiss it
  // on sight.
  //
  // The banner and modals below are NOT gated here — they own their own
  // entry conditions (the first-value listener checks eligibility before it
  // burns the once-per-account stamp; the modals only exist once something
  // opened them). Returning null for the whole component would silently break
  // both, since a suppressed chip would also unmount an already-open modal.
  const showChip = elig.eligible;

  const near = elig.pressure === 'urgent';
  const showCount = elig.pressure === 'urgent' || elig.pressure === 'count';
  const onSeeCreator = () => {
    logEventNow(EV.FIRST_VALUE_UPGRADE_CTA, { copy_rev: COPY_REV }); // must-land: a redirect may follow from the modal
    setFvBanner(false);
    setFvModal(true);
  };
  const onDismiss = () => {
    logEvent(EV.FIRST_VALUE_UPGRADE_DISMISS, {});
    setFvBanner(false);
  };

  return (
    <>
      {showChip && (
      <button
        ref={chipRef}
        className={`upgrade-chip ${near ? 'upgrade-chip-near' : ''}`}
        onClick={() => {
          // Was dark: only the downstream modal pricing_view fired, so chip
          // clicks were indistinguishable from every other modal entry.
          logEvent(EV.UP_CHIP_CLICK, {
            near, count: demoCardCount, limit: cardLimit,
            pressure: elig.pressure, elig_reason: elig.reason, cap_pct: elig.capPct,
          });
          setOpen(true);
        }}
        aria-label="Upgrade to Creator"
        title="Upgrade your demo to Creator"
      >
        {/* The chip earns its pressure. It used to read "Get Creator" forever
            and only reveal the count within 10 of the wall, so the ceiling was
            invisible right up until it stopped you. Now the count appears once
            usage is genuinely underway, and the ask sharpens only near the end. */}
        <span className="upgrade-chip-label">
          {near ? `${Math.max(0, cardLimit - demoCardCount)} cards left` : 'Get Creator'}
        </span>
        {showCount && !near && (
          <>
            <span className="upgrade-chip-sep">·</span>
            <span className="upgrade-chip-count">{demoCardCount}/{cardLimit}</span>
          </>
        )}
      </button>
      )}
      {open && <PricingModal onClose={() => setOpen(false)} header={null} via="chip" />}
      {fvBanner && <FirstValueUpgradeBanner onSeeCreator={onSeeCreator} onDismiss={onDismiss} />}
      {fvModal && <PricingModal onClose={() => setFvModal(false)} header="first-value" surface="first_value" via="first_value_banner" />}
      {/* Dev-only render seam for the cap-hit wall (?local=1&capwall=28). The
          real mount is App.jsx's UpgradeModal, which the QA harness never
          reaches — see qaForceCapWall. Dropped from production bundles by the
          import.meta.env.DEV literal inside the reader. */}
      {capWallQa > 0 && (
        <PricingModal
          onClose={() => {}}
          header="cap-hit"
          via="cap_hit"
          rejected={{ n: capWallQa, noun: rejectedNoun({ image: capWallQa }, capWallQa) }}
        />
      )}
      {/* Dev-only render seam for the over-cap import question
          (?local=1&importask=76,50,0,50). Its real mount is App.jsx, behind
          preflightImport — see qaForceImportAsk. Same DEV literal, same
          dead-code elimination in production. */}
      {importAskQa && (
        <ImportCapDialog
          open
          n={importAskQa.n}
          take={importAskQa.take}
          over={importAskQa.over}
          count={importAskQa.count}
          limit={importAskQa.limit}
          kinds={{ image: importAskQa.n }}
          onTakePartial={() => {}}
          onUpgrade={() => {}}
          onCancel={() => {}}
        />
      )}
    </>
  );
}
