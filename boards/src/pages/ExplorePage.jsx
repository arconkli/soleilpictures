// Public board index (/explore) — a crawlable hub linking to every published
// /c/<slug> marketing board (migration 0136). The Cloudflare Worker already
// server-renders this same list into #seo-fallback for crawlers / no-JS; this
// component is the JS hydration with brand chrome + a signup CTA.
//
// Code-split (loaded only on /explore) and yjs-free — it imports just the
// supabase-backed publicBoardsApi, keeping it out of the heavy editor chunk.
// Shares the .seo-* / .exp-* stylesheet with the SEO landing pages so the two
// marketing surfaces stay one visual system.

import { useEffect, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { SoleilMark } from '../components/primitives.jsx';
import { getPublicBoards } from '../lib/publicBoardsApi.js';
import { SEO_LANDING_PAGES, EXPLORE_INTRO, matchToolPath } from '../lib/seoLanding.js';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import './seoLanding.css';

const CTA = '/?utm_source=public_board&utm_medium=explore&utm_campaign=explore_index';

export function ExplorePage() {
  const [boards, setBoards] = useState(null);   // null = loading, [] = none

  useEffect(() => {
    let cancelled = false;
    document.title = 'Explore Boards — Soleil Clusters';
    getPublicBoards()
      .then((rows) => { if (!cancelled) setBoards(rows); })
      .catch(() => { if (!cancelled) setBoards([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (boards) logEventOnce('explore_view', EV.EXPLORE_VIEW, { count: boards.length });
  }, [boards]);

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href={CTA} title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-board-name">Explore</div>
        <div className="public-topbar-actions">
          <a className="public-cta" href={CTA}>Try Clusters free</a>
        </div>
      </div>

      <div className="seo-scroll">
        <div className="exp-main">
          <header>
            <p className="seo-eyebrow">Made with Clusters</p>
            <h1 className="exp-h1">Explore boards</h1>
            <p className="exp-intro">{EXPLORE_INTRO}</p>
          </header>

          {/* Intro + tools nav mirror the worker's crawlable #seo-fallback (hub-
              and-spoke: /explore must link every landing page or they orphan). */}
          <nav className="exp-tools" aria-label="Make it with Clusters">
            {SEO_LANDING_PAGES.map((s) => (
              <a key={s.path} className="exp-chip" href={s.path}>{s.h1}</a>
            ))}
            <a className="exp-chip" href="/pricing">Pricing</a>
          </nav>

          {boards === null ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: '12vh 0', gap: 12 }}>
              <SoleilMark size={36} color="var(--soleil)" glow />
              <div style={{ color: 'var(--ink-2)' }}>Loading boards…</div>
            </div>
          ) : boards.length === 0 ? (
            <div style={{ color: 'var(--ink-2)' }}>No public boards yet — check back soon.</div>
          ) : (
            <ul className="pubgrid exp-grid">
              {boards.map((b, i) => {
                // Always request the thumb: /api/public-thumb falls back to the
                // board's og_image_key server-side, so boards without a rendered
                // composite thumbnail (thumb_key) still show their cover image
                // instead of a black placeholder.
                const v = encodeURIComponent(b.thumb_updated_at || '');
                const toolPath = matchToolPath(b.target_keyword || b.seo_title);
                return (
                  <li key={b.slug} className={i === 0 ? 'exp-feat' : undefined}>
                    <a className="pubcard" href={`/c/${b.slug}`}>
                      <img src={`/api/public-thumb/${b.slug}?v=${v}`}
                           alt={b.seo_title || b.slug} loading={i === 0 ? 'eager' : 'lazy'}
                           width="320" height="180" />
                      <div className="exp-card-body">
                        <span className="pubcard-title">{b.seo_title || b.slug}</span>
                        {b.seo_description && <div className="exp-card-desc">{b.seo_description}</div>}
                      </div>
                    </a>
                    {toolPath && <a className="exp-make" href={toolPath}>Make your own →</a>}
                  </li>
                );
              })}
            </ul>
          )}

          <section className="seo-cta-band" style={{ marginTop: 48 }}>
            <h2 className="seo-cta-headline">Start your own board</h2>
            <a className="seo-cta-primary" href={CTA}>Try Clusters free</a>
            <span className="seo-cta-sub2">No credit card. Your first board in seconds.</span>
          </section>
        </div>
      </div>
    </div>
  );
}
