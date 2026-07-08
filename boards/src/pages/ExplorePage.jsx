// Public board index (/explore) — a crawlable hub linking to every published
// /c/<slug> marketing board (migration 0136). The Cloudflare Worker already
// server-renders this same list into #seo-fallback for crawlers / no-JS; this
// component is the JS hydration with brand chrome + a signup CTA.
//
// Code-split (loaded only on /explore) and yjs-free — it imports just the
// supabase-backed publicBoardsApi, keeping it out of the heavy editor chunk.

import { useEffect, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { SoleilMark } from '../components/primitives.jsx';
import { getPublicBoards } from '../lib/publicBoardsApi.js';
import { SEO_LANDING_PAGES, EXPLORE_INTRO, matchToolPath } from '../lib/seoLanding.js';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

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
    <div className="public-shell" style={{ background: 'var(--bg-0)' }}>
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

      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '7vh 24px 64px' }}>
          <h1 style={{ fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.01em', margin: '0 0 .4em' }}>
            Explore Boards
          </h1>
          {/* Intro + tools nav mirror the worker's crawlable #seo-fallback (hub-
              and-spoke: /explore must link every landing page or they orphan). */}
          <p style={{ color: 'var(--text-soft, #b7b1a6)', margin: '0 0 1.6em', maxWidth: 680, lineHeight: 1.55 }}>
            {EXPLORE_INTRO}
          </p>
          <nav aria-label="Make it with Clusters" style={{ margin: '0 0 2.2em' }}>
            <div style={{ font: '600 12px/1 var(--font-sans)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-3, #5a5a60)', marginBottom: 10 }}>
              Make it with Clusters
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
              {SEO_LANDING_PAGES.map((s) => (
                <a key={s.path} href={s.path} style={{ color: 'var(--soleil)', textDecoration: 'none', font: '500 .95rem/1.3 var(--font-sans)' }}>
                  {s.h1}
                </a>
              ))}
              <a href="/pricing" style={{ color: 'var(--soleil)', textDecoration: 'none', font: '500 .95rem/1.3 var(--font-sans)' }}>Pricing</a>
            </div>
          </nav>

          {boards === null ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: '12vh 0', gap: 12 }}>
              <SoleilMark size={36} color="var(--soleil)" glow />
              <div style={{ color: 'var(--text-soft, #b7b1a6)' }}>Loading boards…</div>
            </div>
          ) : boards.length === 0 ? (
            <div style={{ color: 'var(--text-soft, #b7b1a6)' }}>No public boards yet — check back soon.</div>
          ) : (
            <ul style={{
              listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 18,
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            }}>
              {boards.map((b) => {
                const v = encodeURIComponent(b.thumb_updated_at || '');
                const thumb = b.thumb_key ? `/api/public-thumb/${b.slug}?v=${v}` : null;
                return (
                  <li key={b.slug}>
                    <a href={`/c/${b.slug}`} style={{
                      display: 'block', textDecoration: 'none', color: 'inherit',
                      border: '1px solid var(--border, #2a2722)', borderRadius: 12, overflow: 'hidden',
                      background: 'var(--bg-1, #14110d)',
                    }}>
                      <div style={{ aspectRatio: '16 / 9', background: '#0a0908', overflow: 'hidden' }}>
                        {thumb && (
                          <img src={thumb} alt={b.seo_title || b.slug} loading="lazy"
                               style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        )}
                      </div>
                      <div style={{ padding: '12px 14px 14px' }}>
                        <div style={{ fontWeight: 600, fontSize: '1.02rem', lineHeight: 1.3 }}>
                          {b.seo_title || b.slug}
                        </div>
                        {b.seo_description && (
                          <div style={{
                            color: 'var(--text-soft, #b7b1a6)', fontSize: '.88rem', marginTop: 4,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {b.seo_description}
                          </div>
                        )}
                      </div>
                    </a>
                    {matchToolPath(b.target_keyword || b.seo_title) && (
                      <a
                        href={matchToolPath(b.target_keyword || b.seo_title)}
                        style={{ display: 'inline-block', marginTop: 6, color: 'var(--soleil)', textDecoration: 'none', font: '500 .85rem/1.3 var(--font-sans)' }}
                      >
                        Make your own →
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
