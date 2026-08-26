// "N Best X" listicle pages (/best/*) — renders a spec from lib/seoListicles.js.
// The Cloudflare Worker injects this page's meta + crawlable server-rendered
// HTML + JSON-LD (Article + ItemList + BreadcrumbList + FAQPage) from the SAME
// spec via lib/seoListicleHtml.js, so crawlers see the content pre-rendered and
// React hydrates the rich version — anti-cloaking parity by construction.
//
// Code-split like SeoLandingPage: loaded only on a /best/ path. Section ids
// here MUST match listicleToc()'s ids and the items' anchors — the worker's
// crawlable TOC links to the same targets.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { getListicleSpec, listicleToc, listicleTrustChips, formatRating } from '../lib/seoListicles.js';
import { getLandingSpec } from '../lib/seoLanding.js';
import { SEO_LISTICLE_INDEX } from '../lib/seoListicleIndex.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import './seoLanding.css';
import './seoListicle.css';

const humanize = (slug) => String(slug || '')
  .replace(/-/g, ' ')
  .replace(/\b\w/g, (c) => c.toUpperCase());

// Related-spoke label: landing h1, listicle h1 (via the light index), or path.
const relatedLabel = (p) => getLandingSpec(p)?.h1
  || SEO_LISTICLE_INDEX.find((x) => x.path === p)?.h1
  || p;

const prettyDate = (iso) => new Date(iso + 'T00:00:00Z')
  .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// A table cell that is already an authored score ("9.2/10") gets the pill
// treatment; anything else renders as plain text, so no column-order assumption.
const SCORE_CELL = /^\d+(?:\.\d+)?\/10$/;

// Editorial score: the numeral carries the meaning, the meter is decoration.
// The fill is neutral ink for EVERY tool including ours — a gold bar on the one
// entry we wrote about ourselves would read as rigged.
function Score({ rating, className }) {
  const n = formatRating(rating);
  if (n == null) return null;
  const pct = Math.max(0, Math.min(100, rating * 10));
  return (
    <span className={className ? `seo-li-score ${className}` : 'seo-li-score'}>
      <span className="seo-li-score-n">{n}</span>
      <span className="seo-li-score-d">/10</span>
      <span className="seo-li-score-track" aria-hidden="true">
        <span className="seo-li-score-fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

// One quiet conversion strip between reviews — same material as the landing
// pages' mid-read ask (.seo-midcta), used at most twice per page.
function Interstitial({ cta, ctaProps, copy }) {
  return (
    <aside className="seo-midcta seo-li-inter">
      <span className="seo-midcta-copy">{copy}</span>
      <a className="seo-cta-primary seo-cta-small" href={cta.href || '/'} {...ctaProps}>{cta.label || 'Start free'}</a>
    </aside>
  );
}

export function SeoListiclePage({ path }) {
  const spec = getListicleSpec(path) || null;

  useEffect(() => {
    if (!spec) return;
    document.title = spec.title;
    logEventOnce(`seo_landing_${spec.path}`, EV.SEO_LANDING_VIEW, { path: spec.path, kind: spec.kind });
  }, [spec]);

  const scrollRef = useRef(null);
  const lp = useLandingEngagement({
    page: spec?.path, pageKind: spec?.kind,
    getScrollEl: () => scrollRef.current,
  });

  // Live board titles + thumb cache-busters for the template strip (same lazy
  // load as SeoLandingPage — keeps the supabase client off the critical path).
  const [pubBoards, setPubBoards] = useState(null);

  // Deep-linked hash: hydration replaces the server-rendered fallback, so a
  // #anchor arrival needs a post-mount nudge to land on its section.
  //
  // It needs a SECOND nudge once pubBoards resolves. That fetch adds the
  // template strip's thumbnails ABOVE most anchors, so the page grows after the
  // first jump and the reader ends up ~63px short of the section they asked
  // for — measured, not guessed: the first jump landed at 187px and a re-jump
  // after settling landed at 124px like every other anchor. Harmless-looking,
  // and precisely wrong for the head-to-head anchors, which exist to be arrived
  // at from a search result.
  //
  // Guarded on the user not having scrolled yet: re-running scrollIntoView
  // under someone who has started reading would yank the page out from them.
  const userScrolledRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onScroll = () => { userScrolledRef.current = true; };
    // Only a real input marks the reader as in control — our own
    // scrollIntoView fires 'scroll' too and would immediately disarm the fix.
    el.addEventListener('wheel', onScroll, { passive: true });
    el.addEventListener('touchmove', onScroll, { passive: true });
    window.addEventListener('keydown', onScroll);
    return () => {
      el.removeEventListener('wheel', onScroll);
      el.removeEventListener('touchmove', onScroll);
      window.removeEventListener('keydown', onScroll);
    };
  }, [spec]);

  useEffect(() => {
    if (!spec) return;
    const id = (window.location.hash || '').slice(1);
    if (!id || userScrolledRef.current) return;
    requestAnimationFrame(() => {
      if (userScrolledRef.current) return;
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    });
  }, [spec, pubBoards]);
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

  // Hero credibility chips — derived in the shared registry so the crawlable
  // HTML shows the reader exactly the same receipts.
  const trustChips = useMemo(() => (spec ? listicleTrustChips(spec) : []), [spec]);

  if (!spec) return <NotFoundPage />;

  const cta = spec.cta || {};
  const toc = listicleToc(spec);
  const heroShot = spec.exampleSlugs?.[0] || null;
  const nItems = spec.items.length;
  // lp_section indices are page-ORDER ordinals, so the two optional head
  // sections have to push everything after them along. Derived rather than
  // renumbered by hand so a page without them keeps its existing numbering
  // exactly — only /best/pureref-alternatives shifts, and it shifts because its
  // page order genuinely changed.
  const nHead = (spec.headToHead ? 1 : 0) + (spec.platforms ? 1 : 0);
  const tailBase = 6 + nHead + nItems;   // lp_section idx base for post-review sections

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href={cta.href || '/'} title="Clusters home" {...lp.ctaProps('brand', cta.href || '/')}>
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
        <article className="seo-main seo-li-main">
          {/* Hero: eyebrow, h1, subhead, studio byline + honest date pair */}
          <header className="seo-hero" ref={lp.sectionRef('hero', 0)}>
            {spec.eyebrow && <p className="seo-eyebrow">{spec.eyebrow}</p>}
            <h1 className="seo-h1">{spec.h1}</h1>
            <p className="seo-subhead">{spec.subhead}</p>
            <p className="seo-li-byline">
              By <b>{spec.author.name}</b>
              <span className="seo-li-byline-dot">·</span>
              Published {prettyDate(spec.published)}
              {spec.updated !== spec.published && (
                <><span className="seo-li-byline-dot">·</span>Updated {prettyDate(spec.updated)}</>
              )}
            </p>
            <ul className="seo-li-trust">
              {trustChips.map((t) => <li key={t}>{t}</li>)}
            </ul>
            <div className="seo-hero-cta">
              <a className="seo-cta-primary" href={cta.href || '/'} {...lp.ctaProps('hero', cta.href || '/')}>{cta.label || 'Start free'}</a>
              <a className="seo-cta-secondary" href="#picks" {...lp.ctaProps('hero_secondary', '#picks', { intent: 'nav' })}>Skip to the rankings ↓</a>
            </div>
            <div className="seo-trust">
              {cta.sub && <span>{cta.sub}</span>}
              <span>Built by a film studio, for real productions.</span>
            </div>
          </header>

          {/* Quick answer — the extractable block — plus the disclosure box
              and the ranked pick cards (top three carded, the rest compact). */}
          <section className="seo-section" id="answer" ref={lp.sectionRef('answer', 1)}>
            <h2 className="seo-h2">{spec.answerHeading}</h2>
            <p className="seo-answer seo-li-answer">{spec.answer}</p>
            <aside className="seo-li-disclosure">{spec.disclosure}</aside>
            <ol className="seo-li-ranklist">
              {spec.items.map((it) => (
                <li key={it.anchor} className={`${it.rank <= 3 ? 'is-podium' : 'is-row'}${it.isUs ? ' is-us' : ''}`}>
                  <span className="seo-li-rank">{it.rank}</span>
                  <span className="seo-li-pick-body">
                    <a className="seo-li-pick-name" href={`#${it.anchor}`} {...lp.ctaProps(`toc:${it.anchor}`, `#${it.anchor}`, { intent: 'nav' })}>
                      {it.name}
                      {it.isUs && <span className="seo-li-uschip">our app</span>}
                    </a>
                    <span className="seo-li-ranklist-for">{it.bestFor}</span>
                  </span>
                  <Score rating={it.rating} className="seo-li-pick-score" />
                  {it.isUs && (
                    <a className="seo-cta-primary seo-cta-small seo-li-pick-cta" href={cta.href || '/'} {...lp.ctaProps('pick:clusters', cta.href || '/')}>
                      {cta.label || 'Start free'}
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </section>

          {/* Table of contents — derived, same ids as the crawlable HTML */}
          <nav className="seo-li-toc" aria-label="Table of contents" ref={lp.sectionRef('toc', 2)}>
            <div className="seo-li-toc-label">Table of contents</div>
            <ol>
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} {...lp.ctaProps(`toc:${t.id}`, `#${t.id}`, { intent: 'nav' })}>{t.label}</a>
                </li>
              ))}
            </ol>
          </nav>

          {/* Comparison table — every tool, one scannable grid */}
          <section className="seo-section" id="table" ref={lp.sectionRef('table', 3)}>
            <h2 className="seo-h2">Comparison table</h2>
            {spec.tableIntro && <p className="seo-body">{spec.tableIntro}</p>}
            <div className="seo-compare-wrap seo-li-tablewrap">
              <table className="seo-compare seo-li-table">
                <thead>
                  <tr>
                    <th scope="col">Tool</th>
                    {spec.columns.map((c) => <th scope="col" key={c}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {spec.items.map((it) => (
                    <tr key={it.anchor} className={it.isUs ? 'seo-li-usrow' : undefined}>
                      <th scope="row">
                        <a href={`#${it.anchor}`} {...lp.ctaProps(`table:${it.anchor}`, `#${it.anchor}`, { intent: 'nav' })}>{it.name}</a>
                        {it.isUs && <span className="seo-li-uschip">our app</span>}
                      </th>
                      {(spec.tableCells[it.anchor] || []).map((cell, j) => (
                        <td key={j}>
                          {SCORE_CELL.test(cell) ? <span className="seo-li-scorepill">{cell}</span> : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Head-to-head (optional). ABOVE the thesis and the reviews on
              purpose: a reader who arrived on "beeref vs pureref" should not
              have to scroll past ten reviews to reach their answer, which is
              what the previous FAQ-only treatment amounted to. Each matchup
              carries its own id so it deep-links and so the heading itself is
              the query. */}
          {spec.headToHead && (
            <section className="seo-section" id="head-to-head" ref={lp.sectionRef('head-to-head', 4)}>
              <h2 className="seo-h2">{spec.headToHead.heading}</h2>
              {spec.headToHead.intro && <p className="seo-body">{spec.headToHead.intro}</p>}
              {spec.headToHead.matchups.map((m) => (
                <section className="seo-li-h2h" id={m.slug} key={m.slug}>
                  <h3 className="seo-li-h2h-h">{m.heading}</h3>
                  <p className="seo-body seo-li-h2h-verdict">{m.verdict}</p>
                  {m.paras.map((p, i) => <p className="seo-body" key={i}>{p}</p>)}
                  {m.rows?.length > 0 && (
                    <div className="seo-compare-wrap seo-li-tablewrap">
                      <table className="seo-compare seo-li-table">
                        <thead>
                          <tr>
                            <th scope="col">Attribute</th>
                            <th scope="col">{m.left}</th>
                            <th scope="col">{m.right}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.rows.map((r) => (
                            <tr key={r.feature}>
                              <th scope="row">{r.feature}</th>
                              <td>{r.left}</td>
                              <td>{r.right}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              ))}
            </section>
          )}

          {/* Platform matrix (optional) — the answer to "does X run on
              iPad/Android/Linux", which the comparison table above never had a
              column for. */}
          {spec.platforms && (
            <section className="seo-section" id="platforms" ref={lp.sectionRef('platforms', 4 + (spec.headToHead ? 1 : 0))}>
              <h2 className="seo-h2">{spec.platforms.heading}</h2>
              {spec.platforms.intro && <p className="seo-body">{spec.platforms.intro}</p>}
              <div className="seo-compare-wrap seo-li-tablewrap">
                <table className="seo-compare seo-li-table">
                  <thead>
                    <tr>
                      <th scope="col">Tool</th>
                      {spec.platforms.columns.map((c) => <th scope="col" key={c}>{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {spec.platforms.rows.map((r) => (
                      <tr key={r.name}>
                        <th scope="row">
                          {r.anchor
                            ? <a href={`#${r.anchor}`} {...lp.ctaProps(`platforms:${r.anchor}`, `#${r.anchor}`, { intent: 'nav' })}>{r.name}</a>
                            : r.name}
                        </th>
                        {r.cells.map((c, j) => <td key={j}>{c}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(spec.platforms.notes || []).map((n) => (
                <p className="seo-body" key={n.lead}><strong>{n.lead}.</strong> {n.body}</p>
              ))}
            </section>
          )}

          {/* Thesis — the framework the whole ranking argues */}
          <section className="seo-section" id="thesis" ref={lp.sectionRef('thesis', 4 + nHead)}>
            <h2 className="seo-h2">{spec.thesis.heading}</h2>
            {spec.thesis.paras.map((p, i) => <p className="seo-body" key={i}>{p}</p>)}
          </section>

          {/* Methodology */}
          <section className="seo-section" id="method" ref={lp.sectionRef('method', 5 + nHead)}>
            <h2 className="seo-h2">{spec.methodology.heading}</h2>
            <p className="seo-body">{spec.methodology.intro}</p>
            <ol className="seo-steps seo-li-criteria">
              {spec.methodology.criteria.map((c, i) => (
                <li key={i}>
                  <span className="seo-step-t">{c.name}</span>
                  <span className="seo-step-d">{c.why}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* The ranked reviews */}
          <section className="seo-section" id="picks" ref={lp.sectionRef('picks-head', 6 + nHead)}>
            <h2 className="seo-h2">{spec.itemsHeading}</h2>
          </section>
          {spec.items.map((it, i) => (
            <div key={it.anchor}>
              <section
                className={`seo-li-item${it.isUs ? ' seo-li-item-us' : ''}`}
                id={it.anchor}
                ref={lp.sectionRef(`item-${it.rank}-${it.anchor}`, 7 + nHead + i)}
              >
                <h3 className="seo-li-item-h">
                  <span className="seo-li-rank">{it.rank}</span>
                  <span className="seo-li-item-name">{it.name}</span>
                  {it.isUs && <span className="seo-li-uschip">our app</span>}
                  <Score rating={it.rating} className="seo-li-item-score" />
                </h3>
                <dl className="seo-li-specs">
                  <dt>Best for</dt>
                  <dd>{it.bestFor}</dd>
                  <dt>Verdict</dt>
                  <dd>{it.verdict}</dd>
                </dl>
                {it.isUs && heroShot && (
                  <figure className="seo-frame seo-li-frame">
                    <div className="seo-frame-bar" aria-hidden="true">
                      <span className="seo-frame-dots"><i /><i /><i /></span>
                      <span className="seo-frame-url">clusters.soleilpictures.com/c/{heroShot}</span>
                    </div>
                    <a className="seo-frame-shot" href={`/c/${heroShot}`} onClick={() => lp.exampleClick(heroShot, 'item-shot')}>
                      <img src={`/landing/${heroShot}.webp`}
                           alt={`${humanize(heroShot)} — a real board made with Clusters, open in the app`}
                           loading="lazy" width="2048" height="1000" />
                    </a>
                    <figcaption className="seo-frame-cap">
                      A real board published from Clusters — <b>open it live</b>.
                    </figcaption>
                  </figure>
                )}
                {it.paras.map((p, j) => <p className="seo-body" key={j}>{p}</p>)}
                {it.features?.length > 0 && (
                  <>
                    <p className="seo-li-minih">Key features</p>
                    <ul className="seo-bullets">{it.features.map((f, j) => <li key={j}>{f}</li>)}</ul>
                  </>
                )}
                <p className="seo-li-pricing">
                  <b>Pricing:</b> {it.pricing.summary}
                  <span className="seo-li-asof"> (as of {it.pricing.asOf})</span>
                </p>
                <div className="seo-li-proscons">
                  <div className="seo-li-pros">
                    <p className="seo-li-minih">Pros</p>
                    <ul>{it.pros.map((x, j) => <li key={j}>{x}</li>)}</ul>
                  </div>
                  <div className="seo-li-cons">
                    <p className="seo-li-minih">Cons</p>
                    <ul>{it.cons.map((x, j) => <li key={j}>{x}</li>)}</ul>
                  </div>
                </div>
                {it.isUs && (
                  <p className="seo-li-itemcta">
                    <a className="seo-cta-primary seo-cta-small" href={cta.href || '/'} {...lp.ctaProps('item:clusters', cta.href || '/')}>{cta.label}</a>
                    {cta.sub && <span className="seo-li-asof"> {cta.sub}</span>}
                  </p>
                )}
              </section>
              {it.isUs && (
                <Interstitial cta={cta} ctaProps={lp.ctaProps('inter:1', cta.href || '/')}
                  copy={<><b>Skip the roundup — try the board.</b> Free to start, nothing to install.</>} />
              )}
              {it.rank === 6 && !it.isUs && (
                <Interstitial cta={cta} ctaProps={lp.ctaProps('inter:2', cta.href || '/')}
                  copy={<><b>Still comparing?</b> Open a real Clusters board and judge it in two minutes.</>} />
              )}
            </div>
          ))}

          {/* Personas */}
          <section className="seo-section" id="personas" ref={lp.sectionRef('personas', tailBase + 1)}>
            <h2 className="seo-h2">Which one fits you?</h2>
            <ul className="seo-li-personas">
              {spec.personas.map((p, i) => (
                <li key={i}>
                  <span className="seo-li-persona-who">{p.who}</span>
                  <span className="seo-li-persona-pick">{p.pick}</span>
                  <span className="seo-li-persona-why">{p.why}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Honorable mentions */}
          <section className="seo-section" id="mentions" ref={lp.sectionRef('mentions', tailBase + 2)}>
            <h2 className="seo-h2">Honorable mentions</h2>
            <ul className="seo-li-mentions">
              {spec.honorableMentions.map((m, i) => (
                <li key={i}><b>{m.name}:</b> {m.note}</li>
              ))}
            </ul>
          </section>

          {/* Honest accounting — where the incumbent still wins */}
          <section className="seo-section" id="honest" ref={lp.sectionRef('honest', tailBase + 3)}>
            <h2 className="seo-h2">{spec.honestAccounting.heading}</h2>
            {spec.honestAccounting.paras.map((p, i) => <p className="seo-body" key={i}>{p}</p>)}
            {spec.honestAccounting.points?.length > 0 && (
              <ul className="seo-bullets">{spec.honestAccounting.points.map((x, i) => <li key={i}>{x}</li>)}</ul>
            )}
          </section>

          {/* Template strip — the low-commitment conversion path */}
          {examples.length > 0 && (
            <section className="seo-section seo-examples" ref={lp.sectionRef('templates', tailBase + 4)}>
              <h2 className="seo-h2">Steal these boards</h2>
              <p className="seo-body">
                Real boards published from Clusters — open one live, pan around, and use it as a template for your own project.
              </p>
              <ul className="pubgrid">
                {examples.map((e) => (
                  <li key={e.slug}>
                    <a className="pubcard" href={`/c/${e.slug}`} onClick={() => lp.exampleClick(e.slug, 'tpl')}>
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
          <section className="seo-section seo-faq" id="faq" ref={lp.sectionRef('faq', tailBase + 5)}>
            <h2 className="seo-h2">Frequently asked questions</h2>
            {spec.faq.map((f, i) => (
              <details className="seo-faq-item" key={i}
                       onToggle={(ev) => { if (ev.currentTarget.open) lp.faqOpen(i, f.q); }}>
                <summary className="seo-faq-q">{f.q}</summary>
                <p className="seo-faq-a">{f.a}</p>
              </details>
            ))}
          </section>

          {/* Closing CTA */}
          <section className="seo-cta-band" ref={lp.sectionRef('closing', tailBase + 6)}>
            <h2 className="seo-cta-headline">Judge it on a real board</h2>
            <a className="seo-cta-primary" href={cta.href || '/'} {...lp.ctaProps('closing', cta.href || '/')}>{cta.label || 'Start free'}</a>
            {cta.sub && <span className="seo-cta-sub2">{cta.sub}</span>}
          </section>

          {/* Author box + internal-linking footer */}
          <footer className="seo-footer">
            <div className="seo-li-author">
              <span className="seo-li-author-mark" aria-hidden="true"><ClustersMark size={22} /></span>
              <div className="seo-li-author-body">
                <div className="seo-li-author-name">{spec.author.name}</div>
                <div className="seo-li-author-role">{spec.author.role}</div>
                <p className="seo-li-author-bio">{spec.author.bio}</p>
              </div>
            </div>
            {spec.related.length > 0 && (
              <nav className="seo-related" aria-label="Related pages">
                <div className="seo-related-label">Keep exploring</div>
                <ul>
                  {spec.related.map((p) => (
                    <li key={p}><a href={p} {...lp.ctaProps(`related:${p}`, p, { intent: 'nav' })}>{relatedLabel(p)}</a></li>
                  ))}
                  <li><a href="/explore" {...lp.ctaProps('related:/explore', '/explore', { intent: 'nav' })}>Explore example boards</a></li>
                  <li><a href="/pricing" {...lp.ctaProps('related:/pricing', '/pricing', { intent: 'nav' })}>Pricing</a></li>
                  {/* The pages that rank are comparisons, and the question
                      underneath every comparison is whether this thing is
                      actually maintained. The changelog is the answer, so it is
                      linked from here rather than only from /docs. */}
                  <li><a href="/changelog" {...lp.ctaProps('related:/changelog', '/changelog', { intent: 'nav' })}>Changelog</a></li>
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
