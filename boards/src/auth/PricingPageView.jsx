// PricingPageView — the /pricing page, shared by both routes that serve it.
//
// There are two: PublicPricingPage (signed out, routed before AuthGate) and
// PricingPage (signed in, routed by TierRouter). They have always rendered the
// same two plan cards from the same PricingBits, and they still render the same
// page here — the differences are entirely in what the buttons do and what the
// footer says, which is what the props are for. A third design is how the two
// drift apart.
//
// WHY THIS LOOKS LIKE AN SEO LANDING PAGE. It is built on the public shell,
// with the same browser-framed board, comparison table and FAQ furniture, for a
// concrete reason: essentially all of this page's traffic arrives from
// /vs/pureref and its siblings, which are built exactly that way. Before this
// the page was built on .pricing-screen — `position: fixed; inset: 0;
// justify-content: center`, a declaration block it shares with .welcome-screen
// and .app-error-panel — so the second page of the journey was, structurally,
// the error screen with two plan cards in it.
//
// Importing seoLanding.css is deliberate rather than convenient. Vite hoists it
// to the shared CSS asset those landing pages already load, so for this page's
// actual audience it is usually a cache hit; and matching the page they just
// came from is the entire point of the change. Nothing here overrides a .seo-*
// rule — the pricing-specific bits are all .pp-*, in styles.css — so the two
// stylesheets' injection order cannot matter.

import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { FeatureList, BenefitGrid, PlanToggle, CreatorPriceRow } from '../components/PricingBits.jsx';
import { DEMO_FEATURES, PRICING_PAGE, PLAN_COMPARISON, PRICING_FAQ, PLAN_NAME, CREATOR_BENEFITS } from '../lib/billingCopy.js';
import '../pages/seoLanding.css';

const NO_PROPS = () => ({});

export function PricingPageView({
  scrollRef = null,
  plan = 'monthly',
  onPlanToggle = null,
  // lp.ctaProps on the public page (landing-engagement beacons); absent when
  // signed in, where the lp_* family does not apply.
  ctaProps = NO_PROPS,
  onFaqOpen = null,
  // { label, onClick, disabled } — the free action. Null hides it, which is
  // what a signed-in demo user gets: they are already on it.
  //
  // onClick receives the POSITION of the button that was pressed. All three —
  // topbar, hero, closing band — used to report the same lp_cta_click pos, so
  // the page could say how many people started free and never which invitation
  // did it, which is the only thing that would tell us where the page works.
  freeCta = null,
  // { label, onClick, disabled, busy }
  creatorCta,
  // A line under the price for an account that already has a plan.
  stateLine = null,
  error = null,
  showPlanToggle = true,
  showPrice = true,
  footer = null,
}) {
  const shot = PRICING_PAGE.shot;

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-topbar-spacer" />
        <div className="public-topbar-actions">
          <a className="public-signin-quiet" href="/explore" {...ctaProps('topbar_explore', '/explore', { intent: 'nav' })}>Explore</a>
          <a className="public-signin-quiet" href="/docs" {...ctaProps('topbar_docs', '/docs', { intent: 'nav' })}>Docs</a>
          {freeCta && (
            <button type="button" className="public-cta" onClick={() => freeCta.onClick('topbar_demo')}>{freeCta.label}</button>
          )}
        </div>
      </div>

      <div className="seo-scroll" ref={scrollRef}>
        <article className="seo-main">
          {/* Short, because the two plan cards are directly under it. This
              hero used to be the landing pages' ceremonial one — a 77px display
              headline over a three-line subhead carrying both prices, the cap,
              the collaborator rule and two promises about what free is not —
              and it pushed the first actual PLAN 1,400px down a page whose
              median visit is under five seconds. `is-pricing` dials the
              headline and the vertical rhythm down; nothing else on the shell
              moves, so the comparison pages keep the hero they were built for. */}
          <header className="seo-hero is-pricing">
            <h1 className="seo-h1">{PRICING_PAGE.h1}</h1>
            <p className="seo-subhead">{PRICING_PAGE.subhead}</p>
          </header>

          {/* THE PLANS, side by side, first. This is the thing a pricing page
              is, and until now this one did not have it: the free tier was a
              prose section, the paid tier was a table, and the only actual buy
              surface was a 620px box sitting alone in the left two-thirds of
              an otherwise empty screen, 2,300px down. Nobody could compare two
              plans because the page never put two plans next to each other. */}
          <section className="pp-plans" id="plans">
            <article className="pp-plan pp-plan-free">
              <div className="pp-plan-name">{PRICING_PAGE.freeCardName}</div>
              <div className="pp-plan-price">
                {PRICING_PAGE.freeCardPrice}
                <span className="pp-plan-unit">{PRICING_PAGE.freeCardUnit}</span>
              </div>
              <p className="pp-plan-sub t-meta">{PRICING_PAGE.freeCardSub}</p>
              <FeatureList features={DEMO_FEATURES} className="pricing-features pp-free-list" />
              {freeCta
                ? (
                  <button type="button" className="pricing-cta pp-plan-cta"
                          onClick={() => freeCta.onClick('plan_free')} disabled={freeCta.disabled}>
                    {freeCta.label}
                  </button>
                )
                : (
                  /* A signed-in demo account is already here. Offering it
                     "Start free" would be nonsense, and leaving the slot empty
                     would misalign the two cards' buttons — so the card states
                     the fact and holds the row. */
                  <div className="pp-plan-current">Your current plan</div>
                )}
            </article>

            {/* .pp-buy is this card, not a separate block: it is still the one
                place on the page where a purchase starts, and the specs that
                locate the price, the toggle and the CTA by it are asserting
                exactly that. */}
            <article className="pp-plan pp-plan-creator pp-buy">
              <div className="pp-plan-head">
                <div className="pp-plan-name">{PLAN_NAME}</div>
                {showPlanToggle && onPlanToggle && <PlanToggle plan={plan} setPlan={onPlanToggle} />}
              </div>
              {showPrice && <CreatorPriceRow plan={plan} />}
              <p className="pp-plan-sub t-meta">{PRICING_PAGE.paidCardSub}</p>
              {/* The benefits carry the data-up-feat markers HERE, and the
                  comparison table below is rendered bare. Both would double
                  every up_feature_hover — one read of the cards line counted
                  twice — and this is the copy on the page a reader is far
                  likelier to reach. Keys are unchanged, so the history holds. */}
              <BenefitGrid benefits={CREATOR_BENEFITS} className="pricing-benefits pp-plan-benefits" />
              {stateLine}
              {error && <div className="auth-error t-meta">{error}</div>}
              <button
                className="pricing-cta pricing-cta-primary pp-plan-cta pp-buy-cta"
                data-lp-cta="creator"
                data-up-cta="creator"
                onClick={creatorCta.onClick}
                disabled={creatorCta.disabled}
              >
                {creatorCta.busy && <span className="cta-spinner" aria-hidden="true" />}
                {creatorCta.label}
              </button>
            </article>
          </section>

          <div className="seo-trust pp-trust">
            <span>{PRICING_PAGE.startFreeSub}</span>
            <span>Built by a film studio, for real productions.</span>
          </div>

          {/* The product, full width. A real published board in a browser
              frame — the same shot and the same frame the comparison pages
              use, from public/landing/, so it renders instantly and the page
              the visitor just left is visually continuous with this one. It
              sits BELOW the plans now: it is proof that the thing being sold
              exists, which is an argument you make after the offer, not the
              1,000px of scrolling you make someone do before seeing one. */}
          <figure className="seo-frame">
            <div className="seo-frame-bar" aria-hidden="true">
              <span className="seo-frame-dots"><i /><i /><i /></span>
              <span className="seo-frame-url">clusters.soleilpictures.com/c/{shot.slug}</span>
            </div>
            <a className="seo-frame-shot" href={`/c/${shot.slug}`}
               {...ctaProps('frame', `/c/${shot.slug}`, { intent: 'nav' })}>
              <img src={`/landing/${shot.slug}.webp`}
                   alt="A real board made with Clusters, open in the app"
                   width="2048" height="1000" fetchPriority="high" />
            </a>
            <figcaption className="seo-frame-cap">{shot.caption}</figcaption>
          </figure>

          <section className="seo-section">
            <h2 className="seo-h2">{PRICING_PAGE.paidHeading}</h2>
            <p className="seo-body">{PRICING_PAGE.paidBody}</p>

            {/* Three rows, because three is the number of gates that exist.
                Same table furniture as the competitor comparisons, which is
                the honest shape for it: this is a comparison. Bare of
                data-up-feat — see the Creator card above, which carries them. */}
            <div className="seo-compare-wrap">
              <table className="seo-compare">
                <thead>
                  <tr>
                    <th scope="col">&nbsp;</th>
                    <th scope="col">Free</th>
                    <th scope="col" className="seo-us-col">{PLAN_NAME}</th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_COMPARISON.map((r) => (
                    <tr key={r.key}>
                      <th scope="row">{r.label}</th>
                      <td className="seo-them">{r.demo}</td>
                      <td className="seo-us">{r.creator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="seo-body pp-workspace">{PRICING_PAGE.workspaceNote}</p>
          </section>

          <section className="seo-section seo-faq">
            <h2 className="seo-h2">Frequently asked questions</h2>
            {PRICING_FAQ.map((f, i) => (
              <details className="seo-faq-item" key={i}
                       onToggle={(ev) => { if (ev.currentTarget.open) onFaqOpen?.(i, f.q); }}>
                <summary className="seo-faq-q">{f.q}</summary>
                <p className="seo-faq-a">{f.a}</p>
              </details>
            ))}
          </section>

          {freeCta && (
            <section className="seo-cta-band">
              <h2 className="seo-cta-headline">{PRICING_PAGE.closing}</h2>
              <button type="button" className="seo-cta-primary" onClick={() => freeCta.onClick('closing_demo')} disabled={freeCta.disabled}>
                {freeCta.label}
              </button>
              <span className="seo-cta-sub2">{PRICING_PAGE.closingSub}</span>
            </section>
          )}

          <footer className="seo-footer">
            {footer}
            <div className="seo-footer-brand">
              <ClustersMark size={16} />
              <span>Soleil Clusters — a creative workspace &amp; moodboard for production teams.</span>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}
