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
import { FeatureList, PlanToggle, CreatorPriceRow } from '../components/PricingBits.jsx';
import { DEMO_FEATURES, PRICING_PAGE, PLAN_COMPARISON, PRICING_FAQ, PLAN_NAME } from '../lib/billingCopy.js';
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
          {/* The price is in the subhead, high and plainly stated — people who
              open a pricing page came for the number and burying it is the
              worse read. The ACTION is the free start: this page has never
              produced a purchase, its visitors arrive from pages promising a
              free tier with no card, and its Creator button could only ever
              send a signed-out visitor to sign in anyway. */}
          <header className="seo-hero">
            <h1 className="seo-h1">{PRICING_PAGE.h1}</h1>
            <p className="seo-subhead">{PRICING_PAGE.subhead}</p>
            {/* The jump link is always here; the free button is not. A
                signed-in demo account is already on the free plan, so offering
                it "Start free" would be nonsense — but it still wants the one
                thing this page is for, which is down the page. */}
            <div className="seo-hero-cta">
              {freeCta && (
                <button type="button" className="seo-cta-primary" onClick={() => freeCta.onClick('hero_demo')} disabled={freeCta.disabled}>
                  {freeCta.label}
                </button>
              )}
              <a className={freeCta ? 'seo-cta-secondary' : 'seo-cta-primary'} href="#plans"
                 {...ctaProps('hero_secondary', '#plans', { intent: 'nav' })}>
                What {PLAN_NAME} changes ↓
              </a>
            </div>
            <div className="seo-trust">
              <span>{PRICING_PAGE.startFreeSub}</span>
              <span>Built by a film studio, for real productions.</span>
            </div>
          </header>

          {/* The product, full width. A real published board in a browser
              frame — the same shot and the same frame the comparison pages
              use, from public/landing/, so it renders instantly and the page
              the visitor just left is visually continuous with this one. The
              offer used to show nothing at all of what is being sold. */}
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
            <h2 className="seo-h2">{PRICING_PAGE.freeHeading}</h2>
            <p className="seo-body">{PRICING_PAGE.freeBody}</p>
            <FeatureList features={DEMO_FEATURES} className="pricing-features pp-free-list" />
          </section>

          <section className="seo-section" id="plans">
            <h2 className="seo-h2">{PRICING_PAGE.paidHeading}</h2>
            <p className="seo-body">{PRICING_PAGE.paidBody}</p>

            {/* Three rows, because three is the number of gates that exist.
                Same table furniture as the competitor comparisons, which is
                the honest shape for it: this is a comparison. */}
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
                  {/* data-up-feat / data-up-featkey carry the same markers the
                      bullet list used to, so up_feature_hover keeps working —
                      on rows far likelier to be read than the bullets were.
                      The keys match CREATOR_FEATURE_KEYS, so a hover here is
                      comparable with one in the modal. */}
                  {PLAN_COMPARISON.map((r, i) => (
                    <tr key={r.key} data-up-feat={i} data-up-featkey={r.key}>
                      <th scope="row">{r.label}</th>
                      <td className="seo-them">{r.demo}</td>
                      <td className="seo-us">{r.creator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* The fourth claim, which is not a limit and so has no row above. */}
            <p className="seo-body pp-workspace" data-up-feat={PLAN_COMPARISON.length} data-up-featkey="workspace">
              {PRICING_PAGE.workspaceNote}
            </p>

            <div className="pp-buy">
              <div className="pp-buy-head">
                <div className="pricing-card-name">{PLAN_NAME}</div>
                {showPlanToggle && onPlanToggle && <PlanToggle plan={plan} setPlan={onPlanToggle} />}
              </div>
              {showPrice && <CreatorPriceRow plan={plan} />}
              {stateLine}
              {error && <div className="auth-error t-meta">{error}</div>}
              <button
                className="pricing-cta pricing-cta-primary pp-buy-cta"
                data-lp-cta="creator"
                data-up-cta="creator"
                onClick={creatorCta.onClick}
                disabled={creatorCta.disabled}
              >
                {creatorCta.busy && <span className="cta-spinner" aria-hidden="true" />}
                {creatorCta.label}
              </button>
            </div>
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
