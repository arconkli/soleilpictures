// PricingModal — in-app upgrade UI. Wraps the same Creator-card content
// as the public PricingPage (via the shared PricingBits), but in a modal
// shell so demo users can upgrade without leaving their workspace.
//
// Presentations by `header` (all in the confident "Studio" voice):
//   • null          → generic ("Everything your work deserves")
//   • "cap-hit"     → demo card cap reached
//   • "first-value" → first genuine card placed (warm nudge)
//   • "storage"     → paid-only file/upload gate
//
// Already-paid users (paid/admin) get the "Manage billing" path to the
// Stripe Customer Portal instead of a second checkout.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockScroll, unlockScroll } from './Modal.jsx';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { useUpsellExposure } from '../hooks/useUpsellExposure.js';
import { startCheckout, startPortal } from '../lib/checkout.js';
import { checkoutErrorMessage, checkoutErrorKind } from '../lib/checkoutErrors.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { BenefitGrid, PlanToggle, CreatorPriceRow } from './PricingBits.jsx';
import { CTA, PRICING, COPY_REV, creatorBenefits, ownWorkSummary, trialNote } from '../lib/billingCopy.js';
import { OwnWorkStrip } from './OwnWorkStrip.jsx';
import { readOwnWork } from '../lib/ownWork.js';
import { useStorageUsage } from '../hooks/useStorageUsage.js';
import { evaluateUpsell } from '../lib/upsellEligibility.js';
import { trackViewContent } from '../lib/metaPixel.js';
import { markPriceSeen } from '../lib/upsellLatches.js';
import { stampUpgradePrompt } from '../lib/upgradePrompts.js';
import { creatorTrialEligibility } from '../lib/creatorTrial.js';

export function PricingModal({ onClose, header = null, surface = 'modal', via = null, clusterCount = null, rejected = null, tierPreview = null, ownWorkPreview = null }) {
  const { user } = useAuth();
  // `tierPreview` is the admin Surface Gallery's seam and nothing else's. Which
  // of the four headers you get is a prop, but whether the TRIAL is offered is
  // derived from live tier state — so an admin previewing "the trial screen"
  // would otherwise always see the non-trial CTA, because an admin is never
  // trial-eligible. Substituting the tier shape renders the real component,
  // real copy rules and real eligibility function against fabricated inputs,
  // which is the only honest way to show a state you cannot be in.
  const live = useMyTier({ userId: user?.id });
  const { tier, demoCardCount, serverCardCount, effectiveCardLimit, grantActive, creatorTrialStartedAt } =
    tierPreview || live;
  // Set when the server declines a trial we offered. Creator itself is still
  // for sale, so the button falls back to the plain purchase rather than
  // re-sending a request that can only be refused again — without this, one
  // 403 left the only in-product buy button permanently unable to buy.
  const [trialRefused, setTrialRefused] = useState(false);
  // The Creator trial is offered HERE and only here: this modal mounts only
  // in-product (chip, banner, wall, storage gate, Settings), never on the
  // public pricing page, so an offer on it is an invitation to someone who has
  // built something rather than a banner for anyone passing.
  //
  // Decided on the SERVER's card count, not the optimistic one. The server
  // re-decides this exact rule against card_index, and the threshold is an
  // exact boundary: a card placed two seconds ago is in useMyTier's delta and
  // not yet in the server's count, so using the optimistic number offers a
  // trial that is then refused.
  const trialDecision = creatorTrialEligibility({
    tier, cards: serverCardCount, cardLimit: effectiveCardLimit, trialStartedAt: creatorTrialStartedAt,
  });
  const trialOffer = !trialRefused && trialDecision.eligible;
  // Storage bytes cost an RPC, so only the two headers that are ABOUT capacity
  // pay for it. The ambient headers still name what the reader has built; they
  // just do it in cards and clusters, which are already in hand.
  const storage = useStorageUsage({ enabled: header === 'cap-hit' || header === 'storage' });
  // What this person has actually made, on every header rather than only at the
  // wall. The finding that put it on the wall — that the abstract feature list
  // goes unread by a reader who has spent real time building — was never
  // specific to the wall; the wall was just the one place we had bothered to be
  // specific. See ownWorkSummary in billingCopy.js.
  const ownStats = ownWorkSummary({
    cards: demoCardCount,
    clusters: clusterCount,
    storageBytes: storage.used,
  });
  // The cards benefit names a ceiling, and in-app we know which one. A demo
  // account grandfathered at 100 (or started at 75 by a referral) reads its own
  // chip saying "84/100" and would otherwise open a modal asserting its ceiling
  // is 50 — the one number on that screen it can check, wrong.
  const benefits = creatorBenefits({ cardLimit: effectiveCardLimit });

  // The pictures, taken once at mount. A snapshot rather than a subscription:
  // re-rendering the offer because a thumbnail regenerated behind it would be
  // motion nobody asked for. `ownWorkPreview` is the Surface Gallery's seam,
  // the same role tierPreview plays one field up — an admin has no demo boards,
  // so without it the strip could only ever be previewed empty.
  const [ownWork] = useState(() => ownWorkPreview || readOwnWork());
  // Recomputed here rather than passed in: PricingModal is mounted from five
  // places, and every exposure should carry the same targeting state whether or
  // not its caller happened to thread it through.
  const elig = evaluateUpsell({
    tier,
    demoCardCount,
    cardLimit: effectiveCardLimit,
    accountAgeDays: user?.created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000))
      : 0,
  });
  const [plan, setPlan]   = useState('monthly'); // monthly-first: annual-default drove pricing abandons (24/28 in 30d)
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const redirectingRef = useRef(false);   // suppress abandon while a checkout redirect is in flight
  const modalRef = useRef(null);

  // up_* exposure telemetry — what the user DOES on this pitch before leaving
  // (feature-row reads, toggles, dismiss method, dwell → up_exposure_summary).
  // Card counts gate on a RESOLVED tier: useMyTier's pre-fetch placeholders
  // (demoCardCount 0 / limit 100) must never be recorded as measured values —
  // the envelope emits null until real, and the summary self-heals via the
  // hook's update effect once the RPC lands.
  const up = useUpsellExposure({
    surface, header, via,
    uid: user?.id, tier,
    userState: tier != null
      ? {
          demoCardCount, cardLimit: effectiveCardLimit, signupAt: user?.created_at,
          elig: elig.eligible, eligReason: elig.reason, pressure: elig.pressure,
          // The trial half of the exposure. `trial` is what the button actually
          // said; serverCards is the count it was decided on, which is NOT
          // demoCardCount — see the comment on trialOffer above.
          trial: trialOffer, trialReason: trialDecision.reason,
          serverCards: Number.isFinite(serverCardCount) ? serverCardCount : null,
        }
      : { signupAt: user?.created_at },
    getRootEl: () => modalRef.current,
  });

  useEffect(() => {
    // surface stays 'modal' in pricing_view for continuity with historical rows
    // (the first-value mount is distinguished by header, and by envelope.surface
    // on the up_* rows); the envelope adds via/exposure_n/tier/cap_pct/acct_days.
    logEventOnce(`pricing_view:modal:${header || 'generic'}`, EV.PRICING_VIEW, { ...up.envelope(), surface: 'modal', header, copy_rev: COPY_REV });
    // Meta ViewContent — mid-funnel ad-optimization signal. Matches the
    // monthly-first default plan.
    trackViewContent({ content_name: 'Creator', value: PRICING.monthly.billed, currency: 'USD' });
  }, [header, up]);
  // First price impression for this account on this device, whichever surface
  // got there first. The modal was the ONLY place a number appeared until the
  // pill, banner and toast learned to carry one; the stamp is what lets the
  // reach read ("has this person ever seen the price?") stop depending on it.
  useEffect(() => {
    if (!user?.id || tier !== 'demo') return;
    if (markPriceSeen(user.id, 'modal')) {
      logEvent(EV.PRICE_SEEN, { surface: 'modal', header, via, count: demoCardCount, limit: effectiveCardLimit, cap_pct: elig.capPct });
      // The device latch is shared by all four price surfaces, so whichever
      // gets there first has to write the durable stamp as well — otherwise it
      // silently prevents every other surface from ever writing it.
      stampUpgradePrompt({ price_seen_at: new Date().toISOString(), price_seen_surface: 'modal' });
    }
    // Once per mount is the intent; the latch makes repeats no-ops anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tier]);
  useDwellTime(EV.PRICING_DWELL, () => ({ surface: 'modal', header }));

  const alreadyPaid = tier === 'paid' || tier === 'admin';
  // Comped (admin-granted) access has no Stripe subscription behind it —
  // "Manage billing" would round-trip to create-portal-session's 404. Show
  // the truth on the button instead of a dead end.
  const grantBacked = alreadyPaid && Boolean(grantActive);
  const onPlanToggle = (p) => {
    const t = up.planToggle(p);
    logEvent(EV.PRICING_PLAN_TOGGLE, { plan: p, surface: 'modal', header, ...t });
    setPlan(p);
  };

  const onCta = async () => {
    setError(null);
    setBusy(true);
    redirectingRef.current = true;
    // Only a real upgrade click is a CTA outcome — an already-paid user's
    // "Manage billing" must not inflate the scorecard's CTA rate.
    if (!alreadyPaid) up.outcome('cta', { plan });
    logEventNow(EV.PRICING_CREATOR_INTENT, {
      plan, surface, already_paid: alreadyPaid, copy_rev: COPY_REV, trial: trialOffer,
      header, via, exposure_n: up.envelope().exposure_n, ...up.timing(),
    });
    try {
      if (alreadyPaid) await startPortal({ surface });
      else             await startCheckout({ plan, surface, header, via, trial: trialOffer });
    } catch (err) {
      redirectingRef.current = false;
      up.noteError();
      // A declined trial is not a dead end. Drop back to the plain purchase so
      // the next click can actually create a checkout, and say so.
      if (checkoutErrorKind(err) === 'trial') setTrialRefused(true);
      setError(checkoutErrorMessage(err));
      setBusy(false);
    }
  };

  // Closing without a redirect in flight = abandon. `method` records HOW the
  // user left ('x' | 'backdrop' | 'maybe_later' | 'esc') — which dismiss
  // affordance wins is a pitch signal ("Maybe later" is a considered no;
  // backdrop/esc is a bounce).
  const handleClose = (method = 'x') => {
    if (!redirectingRef.current) {
      up.outcome('dismiss', { method });
      logEvent(EV.PRICING_ABANDON, {
        header, plan, surface: 'modal', method,
        exposure_n: up.envelope().exposure_n, ...up.timing(),
      });
    }
    onClose?.();
  };

  // Escape-to-close + body scroll-lock. This modal keeps its own
  // upgrade-backdrop DOM (its z-index can't move onto <Modal> without a CSS
  // reshuffle), so it shares Modal's ref-counted scroll lock directly.
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  useEffect(() => {
    lockScroll();
    const onKey = (e) => { if (e.key === 'Escape') handleCloseRef.current('esc'); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); unlockScroll(); };
  }, []);

  return createPortal(
    <div className="upgrade-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose('backdrop'); }}>
      <div className="upgrade-modal" ref={modalRef}>
        <button className="upgrade-close" onClick={() => handleClose('x')} aria-label="Close">×</button>

        {/* Four headers, one shape. They were four near-identical JSX branches
            that each re-declared the same eyebrow; the only things that ever
            differed are the title and the closing sentence, so those are the
            only things that vary now. Copy is unchanged, byte for byte. */}
        <div className="upgrade-intro">
          <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
          <h2 className="upgrade-title">
            {header === 'cap-hit'     ? 'Your work outgrew the demo.'
             : header === 'first-value' ? "You're building something."
             : header === 'storage'   ? 'Room for everything you make.'
             : 'Everything your work deserves.'}
          </h2>

          {/* Their work, then their numbers — before a word about ours. This
              used to run on the wall alone, where the reader is provably
              motivated and provably not reading the feature list. That was
              never a fact about the wall. The strip renders nothing when there
              is nothing to show, so a brand-new account is not told it has
              built nothing on the screen asking it to pay for more room. */}
          <OwnWorkStrip items={ownWork} summary={ownStats} />

          {/* What the cap just cost them, in the units they were working in.
              A large photo drop that silently lands only part of itself is
              the most common way this screen is reached, and until now the
              screen said nothing about it — users were left to notice the
              gap themselves, and the traces show them re-dropping the same
              folder and then deleting their own cards to make room. */}
          {header === 'cap-hit' && rejected?.n > 0 && (
            <p className="upgrade-caphit-lost t-body">
              {rejected.n} {rejected.noun} couldn't be added.
            </p>
          )}

          {/* The sub says what just HAPPENED. It used to describe the product,
              and once every benefit grew a body that description was the same
              claim twice in different words — "unlimited cards, any file type,
              any size" three lines above a grid that says exactly that, with
              the cap-hit version even repeating the cards body verbatim. The
              grid is better at describing the product than a sentence is, so
              the sentence does the one thing the grid cannot: name the moment
              this person is in. Where nothing happened — the pill, the
              first-value nudge — there is nothing to say, and the offer starts
              immediately instead of clearing its throat. */}
          {header === 'storage' && (
            <p className="upgrade-sub t-body">
              That file needs a paid plan — free accounts take standard media, under the size caps below.
            </p>
          )}
          {header === 'first-value' && (
            <p className="upgrade-sub t-body">Your first cluster is taking shape.</p>
          )}
        </div>

        <article className="pricing-card pricing-card-creator upgrade-card">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Creator</div>
            {!alreadyPaid && <PlanToggle plan={plan} setPlan={onPlanToggle} disabled={busy} />}
          </div>

          {!alreadyPaid && <CreatorPriceRow plan={plan} />}

          {/* At the wall the benefits move BELOW the CTA so the price, the
              user's own totals and the button are the whole of the first read.
              Demoted rather than deleted: the rows keep their data-up-feat
              markers, so up_feature_hover can still say whether the demotion
              changed what gets read. Row indices are unaffected by the move. */}
          {header !== 'cap-hit' && <BenefitGrid benefits={benefits} />}

          {error && <div className="auth-error t-meta">{error}</div>}

          <button className="pricing-cta pricing-cta-primary" data-up-cta="creator" data-trial={trialOffer ? '1' : undefined} onClick={onCta} disabled={busy || grantBacked}>
            {busy && <span className="cta-spinner" aria-hidden="true" />}
            {grantBacked
              ? 'Complimentary access — nothing to manage'
              : busy
                ? (alreadyPaid ? CTA.manageBillingBusy : CTA.getCreatorBusy)
                : (alreadyPaid ? CTA.manageBilling : (trialOffer ? CTA.tryCreator : CTA.getCreator))}
          </button>
          {trialOffer && !alreadyPaid && (
            <p className="upgrade-trial-note t-meta">{trialNote(plan)}</p>
          )}

          {header === 'cap-hit' && <BenefitGrid benefits={benefits} className="pricing-benefits upgrade-features-after" />}
        </article>

        {/* Card-count contexts, EXCEPT the wall itself: bonus cards from inviting
            friends unlock the SAME thing the first-value paywall is about, so the
            alternative belongs on the warm nudges. It is deliberately NOT offered
            on 'cap-hit' — at the wall it is the only thing competing with the
            sale, and it is where a blocked user is most likely to take the free
            exit instead of deciding. Not shown for storage, which is genuinely
            paid-only. Decoupled via a window event so it works from every mount. */}
        {!alreadyPaid && tier === 'demo' && (header === 'first-value' || header === null) && (
          <button
            type="button"
            /* Styled by .upgrade-invite-alt in styles.css. It used to carry an
               inline style object that said the same things, which meant the
               rule added for it was dead on arrival — inline wins. */
            className="upgrade-invite-alt"
            onClick={() => {
              logEvent(EV.UP_INVITE_ALT_CLICK, { ...up.envelope(), plan, dwell_ms: up.timing().dwell_ms });
              up.outcome('invite_alt');
              try { window.dispatchEvent(new CustomEvent('soleil:open-invite', { detail: { surface: 'cap_modal' } })); } catch (_) {}
              onClose?.();
            }}
          >
            Or invite friends to earn more free cards →
          </button>
        )}

        <button className="upgrade-later" onClick={() => handleClose('maybe_later')}>Maybe later</button>
      </div>
    </div>,
    document.body,
  );
}
