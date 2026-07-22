// Self-authored SEO landing page (tool pages, "alternative to" pages, the hub).
// Renders a spec from lib/seoLanding.js. The Cloudflare Worker already injects
// this page's <title>/description/canonical/OG + crawlable server-rendered HTML
// + JSON-LD (SoftwareApplication + FAQPage + BreadcrumbList) from the SAME spec,
// so crawlers get the content pre-rendered and React hydrates the rich version.
//
// Code-split (loaded only on a landing path) and dependency-light — it imports
// just the brand mark and the shared registry, staying out of the editor chunk.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { SEO_LANDING_PAGES, getLandingSpec } from '../lib/seoLanding.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import './seoLanding.css';

// path → short link label, for related-page spokes in the footer.
const TITLE_BY_PATH = new Map(
  SEO_LANDING_PAGES.map((p) => [p.path, p.h1]),
);

const humanize = (slug) => String(slug || '')
  .replace(/-/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

// Stable section id for lp_section: ordinal + heading slug, so copy tweaks
// shift history gracefully instead of orphaning it.
const sectionId = (i, heading) => `s${i}-` + String(heading || '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

// Renders a feature section, slipping ONE quiet CTA strip in after the second
// section — a single mid-read ask between the value copy and the how-to.
function SectionWithMidCta({ index, cta, midCtaProps, children }) {
  return (
    <>
      {children}
      {index === 1 && (
        <aside className="seo-midcta">
          <span className="seo-midcta-copy"><b>Try it on your next project.</b> Free to start — nothing to install.</span>
          <a className="seo-cta-primary seo-cta-small" href={cta.href || '/'} {...(midCtaProps || {})}>{cta.label || 'Start free'}</a>
        </aside>
      )}
    </>
  );
}

// "Yes" / "Yes (Creator)" cells in the compare table get a gold check so the
// Clusters column scans as a column of wins.
const yesCheck = (text) => (/^yes\b/i.test(String(text || '').trim())
  ? <><span className="seo-check" aria-hidden="true">✓</span>{text}</>
  : text);

export function SeoLandingPage({ spec: specProp, path }) {
  // Accept a spec directly, or resolve it from a path (router passes one or
  // the other). An unknown landing-shaped path renders the branded NotFound —
  // the Worker has already served this document with a real HTTP 404, so
  // falling back to page content here would be a soft-404 (content at a URL
  // whose status says "gone").
  const spec = specProp || getLandingSpec(path) || null;

  useEffect(() => {
    if (!spec) return;
    document.title = spec.title;
    logEventOnce(`seo_landing_${spec.path}`, EV.SEO_LANDING_VIEW, { path: spec.path, kind: spec.kind });
  }, [spec]);

  // Uniform lp_* engagement package (scroll / dwell / CTA / sections / trace).
  // The page scrolls the .seo-scroll overflow container, not the window.
  const scrollRef = useRef(null);
  const lp = useLandingEngagement({
    page: spec?.path, pageKind: spec?.kind,
    getScrollEl: () => scrollRef.current,
  });

  // Live board titles + thumb cache-busters for the example cards. Loaded
  // lazily (dynamic import keeps the supabase client out of this chunk's
  // critical path); cards render immediately with humanized-slug fallbacks.
  const [pubBoards, setPubBoards] = useState(null);
  useEffect(() => {
    if (!spec?.exampleSlugs?.length) return undefined;
    let on = true;
    import('../lib/publicBoardsApi.js')
      .then((m) => m.getPublicBoards())
      .then((bs) => { if (on) setPubBoards(Array.isArray(bs) ? bs : []); })
      .catch(() => {});
    return () => { on = false; };
  }, [spec]);
  const examples = useMemo(() => {
    const slugs = spec?.exampleSlugs || [];
    return slugs.map((slug) => {
      const b = (pubBoards || []).find((x) => x.slug === slug);
      return {
        slug,
        title: b?.seo_title || humanize(slug),
        v: b?.thumb_updated_at ? `?v=${encodeURIComponent(b.thumb_updated_at)}` : '',
      };
    });
  }, [spec, pubBoards]);

  if (!spec) return <NotFoundPage />;

  const cta = spec.cta || {};
  const related = (spec.related || []).filter((p) => TITLE_BY_PATH.has(p));
  const hero = examples[0] || null;
  const nSec = (spec.sections || []).length;   // lp_section idx base for the tail sections

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href={cta.href || '/'} title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-topbar-spacer" />
        <div className="public-topbar-actions">
          <a className="public-signin-quiet" href="/explore" {...lp.ctaProps('topbar_explore', '/explore', { intent: 'nav' })}>Explore</a>
          <a className="public-signin-quiet" href="/pricing" {...lp.ctaProps('topbar_pricing', '/pricing', { intent: 'nav' })}>Pricing</a>
          <a className="public-cta" href={cta.href || '/'} {...lp.ctaProps('topbar', cta.href || '/')}>Try Clusters free</a>
        </div>
      </div>

      <div className="seo-scroll" ref={scrollRef}>
        <article className="seo-main">
          {/* Hero — the answer block is the 40–60-word direct answer AI answer
              engines can lift verbatim; keep it above the CTA. Directly below,
              a LIVE example board in a browser frame (visual proof → /c/<slug>). */}
          <header className="seo-hero" ref={lp.sectionRef('hero', 0)}>
            {spec.eyebrow && <p className="seo-eyebrow">{spec.eyebrow}</p>}
            <h1 className="seo-h1">{spec.h1}</h1>
            <p className="seo-subhead">{spec.subhead}</p>
            {spec.answer && <p className="seo-answer">{spec.answer}</p>}
            <div className="seo-hero-cta">
              <a className="seo-cta-primary" href={cta.href || '/'} {...lp.ctaProps('hero', cta.href || '/')}>{cta.label || 'Start free'}</a>
              {hero && <a className="seo-cta-secondary" href="#live-example" {...lp.ctaProps('hero_secondary', '#live-example', { intent: 'nav' })}>See a real board ↓</a>}
            </div>
            <div className="seo-trust">
              {cta.sub && <span>{cta.sub}</span>}
              <span>Built by a film studio, for real productions.</span>
            </div>
            {spec.updated && (
              <div className="seo-updated">
                Updated {new Date(spec.updated + 'T00:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
              </div>
            )}
          </header>

          {/* The product, full width: a real published board inside a minimal
              browser frame. The static shot ships with the app (public/landing/)
              so it renders instantly; clicking opens the live board. */}
          {hero && (
            <figure className="seo-frame" id="live-example" ref={lp.sectionRef('frame', 1)}>
              <div className="seo-frame-bar" aria-hidden="true">
                <span className="seo-frame-dots"><i /><i /><i /></span>
                <span className="seo-frame-url">clusters.soleilpictures.com/c/{hero.slug}</span>
              </div>
              <a className="seo-frame-shot" href={`/c/${hero.slug}`} onClick={() => lp.exampleClick(hero.slug, 'frame')}>
                <img src={`/landing/${hero.slug}.webp`}
                     alt={`${hero.title} — a real board made with Clusters, open in the app`}
                     width="2048" height="1000" fetchPriority="high" />
              </a>
              <figcaption className="seo-frame-cap">
                This is a real board published from Clusters — <b>open it live</b>, pan around, and copy its palettes.
              </figcaption>
            </figure>
          )}

          {/* Feature / value sections, with one quiet CTA strip mid-read */}
          {(spec.sections || []).map((s, i) => (
            <SectionWithMidCta key={i} index={i} cta={cta} midCtaProps={lp.ctaProps('mid', cta.href || '/')}>
              <section className="seo-section" ref={lp.sectionRef(sectionId(i, s.heading), 2 + i)}>
                <h2 className="seo-h2">{s.heading}</h2>
                <p className="seo-body">{s.body}</p>
                {Array.isArray(s.bullets) && s.bullets.length > 0 && (
                  <ul className="seo-bullets">
                    {s.bullets.map((b, j) => <li key={j}>{b}</li>)}
                  </ul>
                )}
              </section>
            </SectionWithMidCta>
          ))}

          {/* How-to steps (tool pages) — captures informational intent */}
          {Array.isArray(spec.steps) && spec.steps.length > 0 && (
            <section className="seo-section" ref={lp.sectionRef('steps', 2 + nSec)}>
              <h2 className="seo-h2">{spec.stepsHeading || 'How it works'}</h2>
              <ol className="seo-steps">
                {spec.steps.map((s, i) => (
                  <li key={i}>
                    <span className="seo-step-t">{s.t}</span>
                    <span className="seo-step-d">{s.d}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Comparison table (alternative-to pages) */}
          {spec.compare && (
            <section className="seo-section" ref={lp.sectionRef('compare', 3 + nSec)}>
              <h2 className="seo-h2">Clusters vs {spec.compare.competitor}</h2>
              {spec.compare.intro && <p className="seo-body">{spec.compare.intro}</p>}
              <div className="seo-compare-wrap">
                <table className="seo-compare">
                  <thead>
                    <tr>
                      <th scope="col">Feature</th>
                      <th scope="col" className="seo-us-col">Clusters</th>
                      <th scope="col">{spec.compare.competitor}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spec.compare.rows.map((r, i) => (
                      <tr key={i}>
                        <th scope="row">{r.feature}</th>
                        <td className="seo-us">{yesCheck(r.us)}</td>
                        <td className="seo-them">{r.them}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Visual proof: published example boards, live and explorable. */}
          {examples.length > 0 && (
            <section className="seo-section seo-examples" ref={lp.sectionRef('examples', 4 + nSec)}>
              <h2 className="seo-h2">Made with Clusters</h2>
              <p className="seo-body">
                Real boards published from the canvas — open one and explore it live: pan the board,
                copy the palettes, read the notes.
              </p>
              <ul className="pubgrid">
                {examples.map((e, i) => (
                  <li key={e.slug}>
                    <a className="pubcard" href={`/c/${e.slug}`} onClick={() => lp.exampleClick(e.slug, i)}>
                      <img src={`/api/public-thumb/${e.slug}${e.v}`}
                           alt={`${e.title} — example board made with Clusters`}
                           loading="lazy" width="320" height="180" />
                      <span className="pubcard-title">{e.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <a className="seo-examples-more" href="/explore" {...lp.ctaProps('explore_more', '/explore', { intent: 'nav' })}>Explore all example boards →</a>
            </section>
          )}

          {/* FAQ — mirrors the FAQPage JSON-LD the Worker injects */}
          {Array.isArray(spec.faq) && spec.faq.length > 0 && (
            <section className="seo-section seo-faq" ref={lp.sectionRef('faq', 5 + nSec)}>
              <h2 className="seo-h2">Frequently asked questions</h2>
              {spec.faq.map((f, i) => (
                <details className="seo-faq-item" key={i}
                         onToggle={(ev) => { if (ev.currentTarget.open) lp.faqOpen(i, f.q); }}>
                  <summary className="seo-faq-q">{f.q}</summary>
                  <p className="seo-faq-a">{f.a}</p>
                </details>
              ))}
            </section>
          )}

          {/* Closing CTA */}
          <section className="seo-cta-band" ref={lp.sectionRef('closing', 6 + nSec)}>
            <h2 className="seo-cta-headline">
              {spec.kind === 'compare' ? 'See it for yourself' : 'Your next board is 30 seconds away'}
            </h2>
            <a className="seo-cta-primary" href={cta.href || '/'} {...lp.ctaProps('closing', cta.href || '/')}>{cta.label || 'Start free'}</a>
            {cta.sub && <span className="seo-cta-sub2">{cta.sub}</span>}
          </section>

          {/* Internal-linking footer */}
          <footer className="seo-footer">
            {related.length > 0 && (
              <nav className="seo-related" aria-label="Related pages">
                <div className="seo-related-label">Keep exploring</div>
                <ul>
                  {related.map((p) => (
                    <li key={p}><a href={p}>{TITLE_BY_PATH.get(p)}</a></li>
                  ))}
                  <li><a href="/explore">Explore example boards</a></li>
                  <li><a href="/pricing">Pricing</a></li>
                </ul>
              </nav>
            )}
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
