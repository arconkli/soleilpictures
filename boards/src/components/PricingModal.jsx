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
import { checkoutErrorMessage } from '../lib/checkoutErrors.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { FeatureList, PlanToggle, CreatorPriceRow } from './PricingBits.jsx';
import { CTA, CREATOR_FEATURES, PRICING, COPY_REV, capHitSummary } from '../lib/billingCopy.js';
import { useStorageUsage } from '../hooks/useStorageUsage.js';
import { evaluateUpsell } from '../lib/upsellEligibility.js';
import { trackViewContent } from '../lib/metaPixel.js';

export function PricingModal({ onClose, header = null, surface = 'modal', via = null, clusterCount = null, rejected = null }) {
  const { user } = useAuth();
  const { tier, demoCardCount, effectiveCardLimit, grantActive } = useMyTier({ userId: user?.id });
  // Only the wall gets personalized, so only the wall pays for the extra RPC.
  const storage = useStorageUsage({ enabled: header === 'cap-hit' });
  const capStats = header === 'cap-hit'
    ? capHitSummary({ cards: demoCardCount, clusters: clusterCount, storageBytes: storage.used })
    : null;
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
      plan, surface, already_paid: alreadyPaid, copy_rev: COPY_REV,
      header, via, exposure_n: up.envelope().exposure_n, ...up.timing(),
    });
    try {
      if (alreadyPaid) await startPortal({ surface });
      else             await startCheckout({ plan, surface });
    } catch (err) {
      redirectingRef.current = false;
      up.noteError();
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

        <div className="upgrade-intro">
          {header === 'cap-hit' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">Your work outgrew the demo.</h2>
              {/* Their numbers, not ours. This is the one screen where the
                  reader is provably motivated — and provably not reading the
                  feature list — so it leads with what they've actually built. */}
              {capStats && <p className="upgrade-caphit-stats t-body">You've built {capStats}.</p>}
              {/* What the cap just cost them, in the units they were working in.
                  A large photo drop that silently lands only part of itself is
                  the most common way this screen is reached, and until now the
                  screen said nothing about it — users were left to notice the
                  gap themselves, and the traces show them re-dropping the same
                  folder and then deleting their own cards to make room. */}
              {rejected?.n > 0 && (
                <p className="upgrade-caphit-lost t-body">
                  {rejected.n} {rejected.noun} couldn't be added.
                </p>
              )}
              <p className="upgrade-sub t-body">Creator lifts the cap — and every card you've already made stays exactly where it is.</p>
            </>
          ) : header === 'first-value' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">You're building something.</h2>
              <p className="upgrade-sub t-body">Your first cluster is taking shape. Creator is the complete studio — unlimited cards, any file type, any size. Everything your work deserves.</p>
            </>
          ) : header === 'storage' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">Room for everything you make.</h2>
              <p className="upgrade-sub t-body">Drop any file, any size — video, design files, docs — straight onto your clusters, backed by your own 100GB drive.</p>
            </>
          ) : (
            <>
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">Everything your work deserves.</h2>
              <p className="upgrade-sub t-body">The complete studio — unlimited cards, and any file you make, any type, any size.</p>
            </>
          )}
        </div>

        <article className="pricing-card pricing-card-creator upgrade-card">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Creator</div>
            {!alreadyPaid && <PlanToggle plan={plan} setPlan={onPlanToggle} disabled={busy} />}
          </div>

          {!alreadyPaid && <CreatorPriceRow plan={plan} />}

          {/* At the wall the feature list moves BELOW the CTA so the price, the
              user's own totals and the button are the whole of the first read.
              It is demoted rather than deleted: the rows keep their data-up-feat
              markers, so up_feature_hover can still say whether the demotion
              changed what gets read. Row indices are unaffected by the move. */}
          {header !== 'cap-hit' && <FeatureList features={CREATOR_FEATURES} />}

          {error && <div className="auth-error t-meta">{error}</div>}

          <button className="pricing-cta pricing-cta-primary" data-up-cta="creator" onClick={onCta} disabled={busy || grantBacked}>
            {busy && <span className="cta-spinner" aria-hidden="true" />}
            {grantBacked
              ? 'Complimentary access — nothing to manage'
              : busy
                ? (alreadyPaid ? CTA.manageBillingBusy : CTA.getCreatorBusy)
                : (alreadyPaid ? CTA.manageBilling : CTA.getCreator)}
          </button>

          {header === 'cap-hit' && <FeatureList features={CREATOR_FEATURES} className="pricing-features upgrade-features-after" />}
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
            className="upgrade-invite-alt"
            style={{
              // Neutral ink, not --soleil: the gold accent is reserved for the
              // CTA / active / focus states, and an accent-colored alternative
              // competes with the primary button it sits beneath.
              background: 'none', border: 'none', cursor: 'pointer', marginTop: 2,
              color: 'var(--ink-2)', fontSize: 13, fontWeight: 600,
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}
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
