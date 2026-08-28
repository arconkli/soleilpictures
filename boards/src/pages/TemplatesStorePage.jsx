// The template store front (/templates).
//
// Structurally this is ExplorePage with different inventory — same search box,
// same sort buttons, same facet chips, same ?q/?sort/?category URL state written
// with replaceState so defaults are omitted and /templates stays canonical. That
// similarity is deliberate: browsing is a solved problem here and a second
// dialect of it would be a worse one.
//
// Three differences, all because the catalogue is IN THE BUNDLE rather than
// behind an RPC:
//
//   1. No loading state and no skeletons. The grid is complete on first paint.
//   2. Facets are the authored `category` from content/templates/*.md, not a
//      regex classifier over titles the way /explore's topics have to be.
//   3. The store's static prose renders ABOVE the toolbar — the thing that makes
//      the page rank is the first thing in the document, and it is the same text
//      the Worker injects for crawlers.
//
// The filter is an enhancement over links that are already in the server-rendered
// HTML, which is what keeps the two renderings one document.

import { useEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATE_CARDS, TEMPLATE_CATEGORIES } from '../lib/templateCards.js';
import { GridLayoutThumb } from '../components/GridLayoutThumb.jsx';
import { presetById } from '../lib/gridLayout.js';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

const SORTS = [
  { key: 'featured', label: 'Featured' },
  { key: 'az', label: 'A–Z' },
  { key: 'boxes', label: 'Fewest boxes' },
];

function readUrlState() {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get('q') || '',
    sort: SORTS.some((s) => s.key === p.get('sort')) ? p.get('sort') : 'featured',
    category: TEMPLATE_CATEGORIES.some((c) => c.id === p.get('category')) ? p.get('category') : 'all',
  };
}

// Every whitespace-separated token must match somewhere. Same rule ExplorePage
// uses, and the same reason: "shot list film" should find the shot list without
// the words having to be adjacent.
function matchesQuery(t, q) {
  if (!q) return true;
  const hay = `${t.h1} ${t.blurb} ${(t.hints || []).join(' ')} ${t.category}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((tok) => hay.includes(tok));
}

export function TemplatesStorePage() {
  const [state, setState] = useState(readUrlState);
  const { q, sort, category } = state;
  const set = (patch) => setState((s) => ({ ...s, ...patch }));
  const searchRef = useRef(null);

  // Defaults are omitted from the URL so /templates stays the canonical form
  // and a shared link is the shortest thing that reproduces the view.
  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (sort !== 'featured') p.set('sort', sort);
    if (category !== 'all') p.set('category', category);
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `/templates?${qs}` : '/templates');
  }, [q, sort, category]);

  // "/" focuses search, unless you are already typing somewhere.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = useMemo(() => {
    let list = TEMPLATE_CARDS.filter((t) => matchesQuery(t, q.trim()));
    if (category !== 'all') list = list.filter((t) => t.category === category);
    if (sort === 'az') list = [...list].sort((a, b) => a.h1.localeCompare(b.h1));
    else if (sort === 'boxes') list = [...list].sort((a, b) => a.cells - b.cells || a.h1.localeCompare(b.h1));
    return list;
  }, [q, sort, category]);

  // What people search for is what the catalogue is missing. Once per session,
  // on the settled query rather than every keystroke.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return undefined;
    const t = setTimeout(() => {
      logEventOnce(`tpl_search_${term.toLowerCase()}`, EV.SEO_LANDING_VIEW, { path: '/templates', q: term });
    }, 900);
    return () => clearTimeout(t);
  }, [q]);

  const filtering = !!q.trim() || category !== 'all';

  return (
    <section className="seo-section exp-store">
      <h2 className="seo-h2">Every template</h2>

      <div className="exp-toolbar" role="search">
        <div className="exp-search">
          <input
            ref={searchRef}
            id="tpl-search-input"
            type="search"
            value={q}
            placeholder="Search templates — try “storyboard” or “nine”"
            aria-label="Search templates"
            onChange={(e) => set({ q: e.target.value })}
          />
          {q && (
            <button type="button" className="exp-clear" aria-label="Clear search" onClick={() => set({ q: '' })}>×</button>
          )}
        </div>
        <div className="exp-sorts">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`exp-sort-btn${sort === s.key ? ' is-on' : ''}`}
              aria-pressed={sort === s.key}
              onClick={() => set({ sort: s.key })}
            >{s.label}</button>
          ))}
        </div>
        <div className="exp-count" aria-live="polite">
          {filtering ? `${shown.length} of ${TEMPLATE_CARDS.length}` : `${TEMPLATE_CARDS.length} templates`}
        </div>
      </div>

      {/* Chips only earn their space with something to choose between. */}
      {TEMPLATE_CATEGORIES.length >= 2 && (
        <div className="exp-topics">
          <button
            type="button"
            className={`exp-chip exp-topic${category === 'all' ? ' is-on' : ''}`}
            aria-pressed={category === 'all'}
            onClick={() => set({ category: 'all' })}
          >All</button>
          {TEMPLATE_CATEGORIES.map((c) => {
            const n = TEMPLATE_CARDS.filter((t) => t.category === c.id).length;
            if (!n) return null;
            return (
              <button
                key={c.id}
                type="button"
                className={`exp-chip exp-topic${category === c.id ? ' is-on' : ''}`}
                aria-pressed={category === c.id}
                title={c.blurb}
                onClick={() => set({ category: c.id })}
              >{c.label} <span className="exp-chip-n">{n}</span></button>
            );
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="exp-noresults">
          <p>Nothing matches “{q}”.</p>
          <button type="button" className="exp-sort-btn" onClick={() => set({ q: '', category: 'all' })}>
            Show all {TEMPLATE_CARDS.length}
          </button>
        </div>
      ) : (
        <ul className="pubgrid tplstore-grid">
          {shown.map((t) => {
            const preset = presetById(t.preset);
            return (
              <li key={t.slug}>
                <a className="tplstore-card" href={t.path}>
                  {preset && <GridLayoutThumb tree={preset.tree} title={t.h1} />}
                  <span className="tplstore-title">{t.h1}</span>
                  <span className="tplstore-blurb">{t.blurb}</span>
                  <span className="tplstore-meta">{t.cells} {t.cells === 1 ? 'box' : 'boxes'}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
