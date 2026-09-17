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
import { stampUpgradePrompt, readUpgradePrompts } from '../lib/upgradePrompts.js';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { qaForceFirstValue, qaForceCapWall, qaForceImportAsk } from '../lib/localMode.js';
import { ImportCapDialog } from './ImportCapDialog.jsx';
import { DEMO_CARD_LIMIT, rejectedNoun } from '../lib/demoCardCap.js';
import { COPY_REV, PRICE_FROM_LABEL, TRIAL_FROM_LABEL } from '../lib/billingCopy.js';
import { creatorTrialEligibility } from '../lib/creatorTrial.js';
import { evaluateUpsell, atCapWall, ELIGIBILITY_REV } from '../lib/upsellEligibility.js';
import { claimUpsellSlot } from '../lib/upsellSlot.js';
import { markPriceSeen } from '../lib/upsellLatches.js';

export function UpgradeChip() {
  const { user } = useAuth();
  const { tier, demoCardCount, serverCardCount, effectiveCardLimit, creatorTrialStartedAt } =
    useMyTier({ userId: user?.id });
  const cardLimit = effectiveCardLimit || DEMO_CARD_LIMIT;
  // Days since signup — the one retention signal available without a server
  // round-trip, and enough (with cap fraction) to qualify everyone the richer
  // active-days signal would have.
  const accountAgeDays = user?.created_at
    ? Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000))
    : 0;
  const elig = evaluateUpsell({ tier, demoCardCount, cardLimit, accountAgeDays });
  // Is this viewer owed the invitation rather than the request?
  //
  // Decided on serverCardCount, NOT demoCardCount. The optimistic count is
  // what the canvas believes mid-session: it goes stale for a whole session
  // after a bulk drop and runs BACKWARDS on delete, so a chip keyed on it
  // would offer a trial the server then refuses — a broken button. PricingModal
  // decides the same way, which is what keeps the two in agreement when the
  // modal opens from this pill. Null until the tier resolves → not eligible,
  // which fails closed to the price.
  const trialDecision = creatorTrialEligibility({
    tier, cards: serverCardCount, cardLimit, trialStartedAt: creatorTrialStartedAt,
  });
  const trialOffer = trialDecision.eligible;
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
  // Writes never reuse what this read returned: stampUpgradePrompt re-reads and
  // serialises, because a locally-held copy is `{}` until this resolves and the
  // chip's own impression effect can fire in the same commit that starts it.
  useEffect(() => {
    if (tier !== 'demo') return;
    let cancelled = false;
    readUpgradePrompts()
      .then((prompts) => { if (!cancelled) fvShownAtRef.current = prompts.first_value_shown_at || null; })
      .catch(() => { if (!cancelled) fvShownAtRef.current = null; });
    return () => { cancelled = true; };
  }, [tier]);

  // The first time THIS account is shown a price on this device: one event row
  // and one profile stamp, then silence. Until now the only price impression
  // in the data was the modal's pricing_view, and most of the people who
  // filled a board never opened the modal — so "how many people near the limit
  // have seen the price" had no honest answer. The pill, the banner and the
  // near-cap toast now carry the number, and each calls this when it does.
  const notePriceSeen = (surface) => {
    if (!user?.id || tier !== 'demo') return;
    if (!markPriceSeen(user.id, surface)) return;
    const at = new Date().toISOString();
    logEvent(EV.PRICE_SEEN, {
      surface, count: demoCardCount, limit: cardLimit, cap_pct: elig.capPct, acct_days: accountAgeDays,
      elig_rev: ELIGIBILITY_REV, copy_rev: COPY_REV,
    });
    stampUpgradePrompt({ price_seen_at: at, price_seen_surface: surface });
  };

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
      // Persist on show so it's truly once-per-account. Best-effort, and
      // through the shared writer so it cannot erase a sibling stamp.
      stampUpgradePrompt({ first_value_shown_at: at });
      // The banner carries the price — unless it is carrying the trial
      // instead, in which case no number was shown and stamping price_seen
      // would be a lie the reach metric then repeats back to us.
      if (!trialOffer) notePriceSeen('first_value');
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
  }, [tier, elig.eligible, elig.reason, elig.capPct, demoCardCount, cardLimit, accountAgeDays, user?.id, trialOffer]);

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
  const showChip = tier === 'demo' && elig.eligible;

  const near = elig.pressure === 'urgent';
  const showCount = elig.pressure === 'urgent' || elig.pressure === 'count';
  // Once the pill is a meter it also says what lifting the ceiling costs. A
  // label that just reads "Get Creator" sends the one number that decides
  // anything behind a click most people never take.
  const showPrice = (showCount || near) && !trialOffer;

  // The trial shows from the moment the chip does, at ANY pressure — and that
  // is deliberate, not an oversight of the pressure ladder.
  //
  // The ladder exists because "a meter is information; a price is a request.
  // Don't send the request early." A trial is neither: it is a gift, and the
  // objection to asking early does not apply to giving early. It is also the
  // only way this reaches the band it is aimed at — trial eligibility starts at
  // the absolute body-of-work floor, which on the current cap is about a
  // quarter of the way up, well below the halfway line where `count` pressure
  // begins. Gating the trial behind pressure would show it only to people
  // already most of the way to the wall, which is the exact mistiming this
  // pass exists to fix: most committed boards are built in a single sitting
  // and finished within a day or two, long before any ceiling is in view.
  const showTrial = trialOffer;

  // Record the IMPRESSION. The chip had no view row, so whether an eligible
  // user actually had the pill in front of them could only be inferred from
  // the absence of a suppression row on that pageload — an inference that was
  // read wrong at least once. Once per pageload per state (label vs priced),
  // never per render.
  useEffect(() => {
    if (!showChip) return;
    // `trial_shown` is the field that keeps the two offers separable once the
    // trial starts replacing the price here. Without it, a fall in price_seen
    // reads as lost reach when it is actually the trial landing.
    logEventOnce(`up_chip_view:${showTrial ? 'trial' : showPrice ? 'price' : 'label'}`, EV.UP_CHIP_VIEW, {
      near, count: demoCardCount, limit: cardLimit, pressure: elig.pressure,
      elig_reason: elig.reason, cap_pct: elig.capPct,
      price_shown: showPrice, trial_shown: showTrial, trial_reason: trialDecision.reason,
      server_cards: Number.isFinite(serverCardCount) ? serverCardCount : null,
      elig_rev: ELIGIBILITY_REV, copy_rev: COPY_REV,
    });
    if (showPrice) notePriceSeen('chip');
    // notePriceSeen is a plain closure over render state; the latch makes it
    // idempotent, so re-running on a count change is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChip, showPrice, showTrial, near, elig.pressure]);

  if (tier !== 'demo') return null;
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
        <UpgradePill
          innerRef={chipRef}
          near={near}
          count={demoCardCount}
          limit={cardLimit}
          showCount={showCount}
          showPrice={showPrice}
          showTrial={showTrial}
          onClick={() => {
            // Was dark: only the downstream modal pricing_view fired, so chip
            // clicks were indistinguishable from every other modal entry.
            logEvent(EV.UP_CHIP_CLICK, {
              near, count: demoCardCount, limit: cardLimit,
              pressure: elig.pressure, elig_reason: elig.reason, cap_pct: elig.capPct,
              trial_shown: showTrial, price_shown: showPrice,
            });
            setOpen(true);
          }} />
      )}
      {open && <PricingModal onClose={() => setOpen(false)} header={null} via="chip" />}
      {fvBanner && <FirstValueUpgradeBanner trialOffer={trialOffer} onSeeCreator={onSeeCreator} onDismiss={onDismiss} />}
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

// The pill itself, split out from UpgradeChip so its three pressure states can
// be rendered from fabricated numbers. UpgradeChip takes no props at all —
// every label it shows is derived internally from live tier state — so without
// this split the admin Surface Gallery could only ever show whichever state
// the previewing account happened to be in, which for an admin is none of
// them. Presentational: no hooks, no analytics, no tier reads.
export function UpgradePill({ innerRef = null, near, count, limit, showCount, showPrice, showTrial = false, onClick }) {
  return (
    <button
      ref={innerRef}
      className={`upgrade-chip ${near ? 'upgrade-chip-near' : ''}`}
      onClick={onClick}
      aria-label="Upgrade to Creator"
      title="Upgrade your demo to Creator"
    >
      {/* The chip earns its pressure. It used to read "Get Creator" forever
          and only reveal the count within 10 of the wall, so the ceiling was
          invisible right up until it stopped you. Now the count appears once
          usage is genuinely underway, and the ask sharpens only near the end. */}
      <span className="upgrade-chip-label">
        {near ? `${Math.max(0, limit - count)} cards left` : 'Get Creator'}
      </span>
      {showCount && !near && (
        <>
          <span className="upgrade-chip-sep">·</span>
          <span className="upgrade-chip-count">{count}/{limit}</span>
        </>
      )}
      {/* The trial and the price are mutually exclusive by construction
          (UpgradeChip clears showPrice whenever the trial is on offer): the
          pill has room for one of them, and an invitation beside a request
          reads as a discount rather than a gift. */}
      {showTrial ? (
        <>
          <span className="upgrade-chip-sep">·</span>
          <span className="upgrade-chip-trial">{TRIAL_FROM_LABEL}</span>
        </>
      ) : showPrice && (
        <>
          <span className="upgrade-chip-sep">·</span>
          <span className="upgrade-chip-price">{PRICE_FROM_LABEL}</span>
        </>
      )}
    </button>
  );
}
