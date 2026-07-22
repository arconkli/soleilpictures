// Public board index (/explore) — a crawlable hub linking to every published
// /c/<slug> marketing board (migration 0136). The Cloudflare Worker already
// server-renders this same list into #seo-fallback for crawlers / no-JS; this
// component is the JS hydration with brand chrome, a signup CTA, and the
// interactive browse layer (search / sort / topic filters — all client-side
// over the full RPC result; the catalog is curated + admin-approved, so it
// stays small enough that in-memory filtering beats a server round-trip).
//
// Code-split (loaded only on /explore) and yjs-free — it imports just the
// supabase-backed publicBoardsApi, keeping it out of the heavy editor chunk.
// Shares the .seo-* / .exp-* stylesheet with the SEO landing pages so the two
// marketing surfaces stay one visual system.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { getPublicBoards } from '../lib/publicBoardsApi.js';
import { SEO_LANDING_PAGES, EXPLORE_INTRO, matchToolPath } from '../lib/seoLanding.js';
import { logEvent, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import './seoLanding.css';

const CTA = '/?utm_source=public_board&utm_medium=explore&utm_campaign=explore_index';

// Browsable topic buckets, derived from each board's target keyword via the
// same matcher that powers the "Make your own" links. Chips render only for
// topics that actually have boards, so the row grows with the catalog.
const TOPICS = [
  { key: 'mood-boards', label: 'Mood boards', path: '/tools/mood-board-maker' },
  { key: 'look-books',  label: 'Look books',  path: '/tools/look-book-maker' },
  { key: 'shot-lists',  label: 'Shot lists',  path: '/tools/shot-list-maker' },
  { key: 'storyboards', label: 'Storyboards', path: '/tools/storyboard-maker' },
];

// 'featured' preserves the RPC order (priority desc, published_at desc).
const SORTS = [
  { key: 'featured', label: 'Featured' },
  { key: 'new',      label: 'Newest' },
  { key: 'az',       label: 'A–Z' },
];

function boardTopic(b) {
  const path = matchToolPath(b.target_keyword || b.seo_title);
  return TOPICS.find((t) => t.path === path) || null;
}

function matchesQuery(b, tokens) {
  if (!tokens.length) return true;
  const hay = `${b.seo_title || ''} ${b.seo_description || ''} ${b.target_keyword || ''} ${b.slug || ''}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// First case-insensitive occurrence of the query in the title gets a <mark>
// (mirrors the command palette's one-off highlight).
function highlightTitle(title, query) {
  const q = query.trim();
  if (!q) return title;
  const i = title.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return title;
  return (
    <>
      {title.slice(0, i)}
      <mark className="exp-mark">{title.slice(i, i + q.length)}</mark>
      {title.slice(i + q.length)}
    </>
  );
}

// Browse state round-trips through the URL (?q=&sort=&topic=) so a filtered
// view is shareable/bookmarkable; defaults are omitted to keep /explore
// canonical for crawlers.
function readUrlState() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') || '',
    sort: SORTS.some((s) => s.key === p.get('sort')) ? p.get('sort') : 'featured',
    topic: TOPICS.some((t) => t.key === p.get('topic')) ? p.get('topic') : 'all',
  };
}

export function ExplorePage() {
  const [boards, setBoards] = useState(null);   // null = loading, [] = none
  const [{ q, sort, topic }, setBrowse] = useState(readUrlState);

  // Uniform lp_* engagement package; the page scrolls .seo-scroll (shared with
  // the SEO landing pages), not the window.
  const scrollRef = useRef(null);
  const lp = useLandingEngagement({
    page: '/explore', pageKind: 'explore',
    getScrollEl: () => scrollRef.current,
  });
  const setQ = (v) => setBrowse((s) => ({ ...s, q: v }));
  const setSort = (v) => setBrowse((s) => ({ ...s, sort: v }));
  const setTopic = (v) => setBrowse((s) => ({ ...s, topic: v }));

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

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (sort !== 'featured') p.set('sort', sort);
    if (topic !== 'all') p.set('topic', topic);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `/explore?${qs}` : '/explore');
  }, [q, sort, topic]);

  // Log the settled query once per session (what visitors look for = what the
  // catalog is missing).
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) return;
    const t = setTimeout(() => logEventOnce('explore_search', EV.EXPLORE_SEARCH, { q: s.slice(0, 80) }), 800);
    return () => clearTimeout(t);
  }, [q]);

  // "/" focuses search from anywhere on the page (never steals from an input).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      document.getElementById('exp-search-input')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const topicChips = useMemo(() => {
    if (!boards) return [];
    const present = new Set(boards.map((b) => boardTopic(b)?.key).filter(Boolean));
    return TOPICS.filter((t) => present.has(t.key));
  }, [boards]);

  const shown = useMemo(() => {
    if (!boards) return null;
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let rows = boards.filter((b) => matchesQuery(b, tokens));
    if (topic !== 'all') rows = rows.filter((b) => boardTopic(b)?.key === topic);
    if (sort === 'new') {
      rows = [...rows].sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
    } else if (sort === 'az') {
      rows = [...rows].sort((a, b) => (a.seo_title || a.slug).localeCompare(b.seo_title || b.slug));
    }
    return rows;
  }, [boards, q, sort, topic]);

  const filtering = Boolean(q.trim()) || topic !== 'all';
  // The 2-col featured hero only applies to the untouched default view — once
  // the visitor searches/sorts/filters, every result renders equal-weight.
  const plainView = !filtering && sort === 'featured';

  const clearAll = () => setBrowse((s) => ({ ...s, q: '', topic: 'all' }));

  const onCardClick = (b, i) => {
    logEvent(EV.EXPLORE_CARD_CLICK, {
      slug: b.slug, pos: i, sort, topic, has_query: Boolean(q.trim()),
    });
    lp.exampleClick(b.slug, i);
  };

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href={CTA} title="Clusters home">
          <ClustersMark size={20} />
          <span className="public-brand-name">Clusters</span>
        </a>
        <div className="public-board-name">Explore</div>
        <div className="public-topbar-actions">
          <a className="public-cta" href={CTA} {...lp.ctaProps('topbar', CTA)}>Try Clusters free</a>
        </div>
      </div>

      <div className="seo-scroll" ref={scrollRef}>
        <div className="exp-main">
          <header>
            <p className="seo-eyebrow">Made with Clusters</p>
            <h1 className="exp-h1">Explore boards</h1>
            <p className="exp-intro">{EXPLORE_INTRO}</p>
          </header>

          <div className="exp-toolbar" role="search">
            <div className="exp-search">
              <svg className="exp-search-ico" width="15" height="15" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input
                id="exp-search-input"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search boards…"
                aria-label="Search public boards"
                autoComplete="off"
                spellCheck="false"
              />
              {q && (
                <button className="exp-clear" onClick={() => setQ('')} aria-label="Clear search">×</button>
              )}
            </div>
            <div className="exp-sorts" role="group" aria-label="Sort boards">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  className={`exp-sort-btn${sort === s.key ? ' is-on' : ''}`}
                  aria-pressed={sort === s.key}
                  onClick={() => setSort(s.key)}
                >{s.label}</button>
              ))}
            </div>
            {shown !== null && (
              <span className="exp-count" aria-live="polite">
                {filtering ? `${shown.length} of ${boards.length}` : `${boards.length} board${boards.length === 1 ? '' : 's'}`}
              </span>
            )}
          </div>

          {topicChips.length >= 2 && (
            <div className="exp-topics" role="group" aria-label="Filter by board type">
              <button
                className={`exp-chip exp-topic${topic === 'all' ? ' is-on' : ''}`}
                aria-pressed={topic === 'all'}
                onClick={() => setTopic('all')}
              >All</button>
              {topicChips.map((t) => (
                <button
                  key={t.key}
                  className={`exp-chip exp-topic${topic === t.key ? ' is-on' : ''}`}
                  aria-pressed={topic === t.key}
                  onClick={() => setTopic(topic === t.key ? 'all' : t.key)}
                >{t.label}</button>
              ))}
            </div>
          )}

          {shown === null ? (
            <ul className="pubgrid exp-grid" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="exp-skel">
                  <div className="exp-skel-img" />
                  <div className="exp-skel-line" />
                  <div className="exp-skel-line short" />
                </li>
              ))}
            </ul>
          ) : boards.length === 0 ? (
            <div className="exp-noresults">
              <p>No public boards yet — check back soon, or be the first to publish one.</p>
              <a className="exp-chip" href={CTA}>Start a board</a>
            </div>
          ) : shown.length === 0 ? (
            <div className="exp-noresults">
              <p>
                No boards match{' '}
                {q.trim() ? <>“<strong>{q.trim()}</strong>”</> : 'this filter'}.
              </p>
              <button className="exp-chip" onClick={clearAll}>Clear search</button>
            </div>
          ) : (
            <ul className="pubgrid exp-grid">
              {shown.map((b, i) => {
                // Always request the thumb: /api/public-thumb falls back to the
                // board's og_image_key server-side, so boards without a rendered
                // composite thumbnail (thumb_key) still show their cover image
                // instead of a black placeholder.
                const v = encodeURIComponent(b.thumb_updated_at || '');
                const toolPath = matchToolPath(b.target_keyword || b.seo_title);
                const t = boardTopic(b);
                return (
                  <li key={b.slug} className={plainView && i === 0 ? 'exp-feat' : undefined}>
                    <a className="pubcard" href={`/c/${b.slug}`} onClick={() => onCardClick(b, i)}>
                      <span className="exp-thumb">
                        <img src={`/api/public-thumb/${b.slug}?v=${v}`}
                             alt={b.seo_title || b.slug} loading={i === 0 ? 'eager' : 'lazy'}
                             width="320" height="180" />
                      </span>
                      <div className="exp-card-body">
                        <span className="pubcard-title">{highlightTitle(b.seo_title || b.slug, q)}</span>
                        {b.seo_description && <div className="exp-card-desc">{b.seo_description}</div>}
                        {(t || b.card_count > 0) && (
                          <div className="exp-card-meta">
                            {t && <span className="exp-tag">{t.label}</span>}
                            {b.card_count > 0 && <span className="exp-cards">{b.card_count} cards</span>}
                          </div>
                        )}
                      </div>
                    </a>
                    {toolPath && <a className="exp-make" href={toolPath}>Make your own →</a>}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Tools nav mirrors the worker's crawlable #seo-fallback (hub-and-
              spoke: /explore must link every landing page or they orphan). It
              sits below the grid so browsing stays front-and-center. */}
          <section className="exp-tools-band">
            <h2 className="exp-h2">Make it with Clusters</h2>
            <nav className="exp-tools" aria-label="Make it with Clusters">
              {SEO_LANDING_PAGES.map((s) => (
                <a key={s.path} className="exp-chip" href={s.path}>{s.h1}</a>
              ))}
              <a className="exp-chip" href="/pricing">Pricing</a>
            </nav>
          </section>

          <section className="seo-cta-band" style={{ marginTop: 48 }}>
            <h2 className="seo-cta-headline">Start your own board</h2>
            <a className="seo-cta-primary" href={CTA} {...lp.ctaProps('band', CTA)}>Try Clusters free</a>
            <span className="seo-cta-sub2">No credit card. Your first board in seconds.</span>
          </section>
        </div>
      </div>
    </div>
  );
}
