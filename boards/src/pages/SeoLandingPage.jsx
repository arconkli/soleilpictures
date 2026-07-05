// Self-authored SEO landing page (tool pages, "alternative to" pages, the hub).
// Renders a spec from lib/seoLanding.js. The Cloudflare Worker already injects
// this page's <title>/description/canonical/OG + crawlable server-rendered HTML
// + JSON-LD (SoftwareApplication + FAQPage + BreadcrumbList) from the SAME spec,
// so crawlers get the content pre-rendered and React hydrates the rich version.
//
// Code-split (loaded only on a landing path) and dependency-light — it imports
// just the brand mark and the shared registry, staying out of the editor chunk.

import { useEffect } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { SEO_LANDING_PAGES, getLandingSpec } from '../lib/seoLanding.js';
import { logEventOnce } from '../lib/analytics.js';
import './seoLanding.css';

// path → short link label, for related-page spokes in the footer.
const TITLE_BY_PATH = new Map(
  SEO_LANDING_PAGES.map((p) => [p.path, p.h1]),
);

export function SeoLandingPage({ spec: specProp, path }) {
  // Accept a spec directly, or resolve it from a path (router passes one or the
  // other). Fall back to the mood-board page so a bad deep link never blanks.
  const spec = specProp || getLandingSpec(path) || getLandingSpec('/tools/mood-board-maker');

  useEffect(() => {
    if (!spec) return;
    document.title = spec.title;
    logEventOnce(`seo_landing_${spec.path}`, 'seo_landing_view', { path: spec.path, kind: spec.kind });
  }, [spec]);

  if (!spec) return null;

  const cta = spec.cta || {};
  const related = (spec.related || []).filter((p) => TITLE_BY_PATH.has(p));

  return (
    <div className="public-shell seo-shell">
      <div className="public-topbar">
        <a className="public-brand" href={cta.href || '/'} title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-topbar-spacer" />
        <div className="public-topbar-actions">
          <a className="public-signin-quiet" href="/explore">Explore</a>
          <a className="public-signin-quiet" href="/pricing">Pricing</a>
          <a className="public-cta" href={cta.href || '/'}>Try Clusters free</a>
        </div>
      </div>

      <div className="seo-scroll">
        <article className="seo-main">
          {/* Hero */}
          <header className="seo-hero">
            <h1 className="seo-h1">{spec.h1}</h1>
            <p className="seo-subhead">{spec.subhead}</p>
            <div className="seo-hero-cta">
              <a className="seo-cta-primary" href={cta.href || '/'}>{cta.label || 'Start free'}</a>
              {cta.sub && <span className="seo-cta-sub">{cta.sub}</span>}
            </div>
          </header>

          {/* Feature / value sections */}
          {(spec.sections || []).map((s, i) => (
            <section className="seo-section" key={i}>
              <h2 className="seo-h2">{s.heading}</h2>
              <p className="seo-body">{s.body}</p>
              {Array.isArray(s.bullets) && s.bullets.length > 0 && (
                <ul className="seo-bullets">
                  {s.bullets.map((b, j) => <li key={j}>{b}</li>)}
                </ul>
              )}
            </section>
          ))}

          {/* How-to steps (tool pages) — captures informational intent */}
          {Array.isArray(spec.steps) && spec.steps.length > 0 && (
            <section className="seo-section">
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
            <section className="seo-section">
              <h2 className="seo-h2">Clusters vs {spec.compare.competitor}</h2>
              {spec.compare.intro && <p className="seo-body">{spec.compare.intro}</p>}
              <div className="seo-compare-wrap">
                <table className="seo-compare">
                  <thead>
                    <tr>
                      <th scope="col">Feature</th>
                      <th scope="col">Clusters</th>
                      <th scope="col">{spec.compare.competitor}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spec.compare.rows.map((r, i) => (
                      <tr key={i}>
                        <th scope="row">{r.feature}</th>
                        <td className="seo-us">{r.us}</td>
                        <td className="seo-them">{r.them}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* FAQ — mirrors the FAQPage JSON-LD the Worker injects */}
          {Array.isArray(spec.faq) && spec.faq.length > 0 && (
            <section className="seo-section seo-faq">
              <h2 className="seo-h2">Frequently asked questions</h2>
              {spec.faq.map((f, i) => (
                <details className="seo-faq-item" key={i}>
                  <summary className="seo-faq-q">{f.q}</summary>
                  <p className="seo-faq-a">{f.a}</p>
                </details>
              ))}
            </section>
          )}

          {/* Closing CTA */}
          <section className="seo-cta-band">
            <h2 className="seo-h2">{spec.kind === 'compare' ? 'See it for yourself' : 'Ready to start?'}</h2>
            <a className="seo-cta-primary" href={cta.href || '/'}>{cta.label || 'Start free'}</a>
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
