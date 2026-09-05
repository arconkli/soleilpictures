// The template store front (/templates).
//
// Structurally this is ExplorePage with different inventory — same search box,
// same sort buttons, same facet chips, same ?q/?sort/?category URL state written
// with replaceState so defaults are omitted and /templates stays canonical. That
// similarity is deliberate: browsing is a solved problem here and a second
// dialect of it would be a worse one.
//
// ONE catalogue: the templates we ship (in the bundle) and the ones people have
// published (an RPC), in one grid with one search. A published template is
// inventory, not a footnote in a strip below the real store — that separation is
// what made publishing feel like posting into a side channel.
//
// Differences from ExplorePage:
//
//   1. Ours render on first paint with no loading state; community rows arrive
//      after and simply extend the grid. There is no skeleton because the store
//      is never empty.
//   2. Facets are the authored `category` from content/templates/*.md, not a
//      regex classifier over titles the way /explore's topics have to be.
//   3. The grid sits directly under the page title. The prose lives BELOW it —
//      a shop shows the goods first.
//
// The filter is an enhancement over links that are already in the server-rendered
// HTML, which is what keeps the two renderings one document.

import { useEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATE_CARDS, TEMPLATE_CATEGORIES } from '../lib/templateCards.js';
import { GridLayoutThumb, minHintFontFor } from '../components/GridLayoutThumb.jsx';
import { layoutById } from '../lib/templateLayouts.js';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// "Most downloaded" is OFFERED CONDITIONALLY (see `hasDownloads`). A sort button
// that orders sixteen zeroes is not a sort, and it advertises an emptiness the
// store does not need to advertise — the same reason the Community chip only
// appears once there is something behind it.
const SORTS = [
  { key: 'featured', label: 'Featured' },
  { key: 'downloads', label: 'Most downloaded', needsDownloads: true },
  { key: 'az', label: 'A–Z' },
  { key: 'boxes', label: 'Fewest boxes' },
];

// Ours and everyone's in ONE list. A published template is inventory, not a
// footnote in a strip below the real store — that separation is what made
// publishing feel like posting into a side channel.
const COMMUNITY = 'community';

// When a template gets a double-width tile. TWO tests, because either kind of
// density makes a preview unreadable at one column:
//
//   BIG_CELLS   sheer count — a 36-frame contact sheet has nothing legible in a
//               250px tile even though none of its frames carries a label.
//   SMALL_LABEL the thin-band case, in viewbox units. Measured on the shelf: the
//               smallest label on every one-column template lands at 9px except
//               the vertical storyboard's caption strip, which lands at 4.9.
//               Only a font under 8 units gets there, and asking the thumb keeps
//               the rule tied to the formula that actually sets the size.
const BIG_CELLS = 12;
const SMALL_LABEL = 8;

// A community tile's destination. There is deliberately no author identity
// anywhere in this system (0266: "a template is a shape, not a person"), so the
// badge names the source rather than a person.
function communityHref(slug) {
  const base = `/templates/g/${encodeURIComponent(slug)}`;
  return base;
}

// Signing in is the only way to have a grid to share, so the invitation goes
// through the front door rather than to a page that would just ask again.
function contributeHref() {
  return '/?utm_source=templates&utm_medium=contribute&utm_campaign=share_your_own';
}

function readUrlState() {
  const p = new URLSearchParams(window.location.search);
  const cat = p.get('category');
  return {
    q: p.get('q') || '',
    sort: SORTS.some((s) => s.key === p.get('sort')) ? p.get('sort') : 'featured',
    category: (cat === COMMUNITY || TEMPLATE_CATEGORIES.some((c) => c.id === cat)) ? cat : 'all',
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
  const [community, setCommunity] = useState([]);
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

  // Published templates, lazily. Same discipline the old strip used: the
  // supabase client and the layout math stay out of this chunk's critical path,
  // and a failure leaves the shipped catalogue intact rather than emptying the
  // store. Limit MUST match the Worker's or the two documents disagree about
  // the catalogue on the day the 121st template is published.
  useEffect(() => {
    let on = true;
    Promise.all([
      import('../lib/gridLayoutsApi.js'),
      import('../lib/gridLayout.js'),
      import('../lib/gridLayoutLibrary.js'),
    ])
      .then(async ([api, geom, lib]) => {
        const rows = await api.listPublicGridLayouts(120);
        if (!on) return;
        setCommunity(rows
          // Sanitize on the way OUT as well as in — these trees, labels and
          // dimensions were authored by other people, and computeCellRects
          // recurses without a depth guard.
          .map((r) => {
            const tree = geom.sanitizeLayout(r.body?.layout);
            return {
              slug: r.slug,
              path: communityHref(r.slug),
              h1: r.title,
              blurb: r.description || 'A layout someone published.',
              category: COMMUNITY,
              tree,
              hints: r.body?.hints || null,
              size: lib.sanitizeSize(r.body?.size),
              // Counted, not zero: `cells` is what the "Fewest boxes" sort reads,
              // and a hard 0 sorted every community template above a one-box
              // template of ours.
              cells: tree ? geom.leafIds(tree).length : 0,
              useCount: r.use_count || 0,
              source: COMMUNITY,
            };
          })
          .filter((r) => r.tree));
      })
      .catch(() => {});
    return () => { on = false; };
  }, []);

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

  const all = useMemo(() => [...TEMPLATE_CARDS, ...community], [community]);

  // Only community templates carry a real count: use_public_grid_layout bumps
  // public_grid_layouts.use_count when someone takes a copy. Our own sixteen have
  // no counter behind them at all, so they sort as zero rather than as a number
  // somebody made up.
  const hasDownloads = useMemo(() => all.some((t) => (t.useCount || 0) > 0), [all]);

  const shown = useMemo(() => {
    let list = all.filter((t) => matchesQuery(t, q.trim()));
    if (category !== 'all') list = list.filter((t) => t.category === category);
    if (sort === 'az') list = [...list].sort((a, b) => a.h1.localeCompare(b.h1));
    else if (sort === 'boxes') list = [...list].sort((a, b) => (a.cells || 99) - (b.cells || 99) || a.h1.localeCompare(b.h1));
    else if (sort === 'downloads') list = [...list].sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || a.h1.localeCompare(b.h1));
    return list;
  }, [all, q, sort, category]);

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
          {SORTS.filter((s) => !s.needsDownloads || hasDownloads).map((s) => (
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
            const n = all.filter((t) => t.category === c.id).length;
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
          {/* Only offered once there is something behind it — a chip that
              filters to nothing is worse than no chip. */}
          {community.length > 0 && (
            <button
              type="button"
              className={`exp-chip exp-topic${category === COMMUNITY ? ' is-on' : ''}`}
              aria-pressed={category === COMMUNITY}
              title="Templates people have published"
              onClick={() => set({ category: COMMUNITY })}
            >Community <span className="exp-chip-n">{community.length}</span></button>
          )}
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
        // `is-featured` turns on the mixed-size shelf (see seoLanding.css): dense
        // layouts take two columns, and `dense` packing backfills the gaps that
        // leaves. Only under the default sort — A–Z and Fewest boxes are
        // promises about order, and dense packing would visibly break them.
        <ul className={`pubgrid tplstore-grid${sort === 'featured' ? ' is-featured' : ''}`}>
          {shown.map((t) => {
            // Ours carry a layout id; a published one carries its own tree.
            const layout = t.tree ? null : layoutById(t.preset);
            const tree = t.tree || layout?.tree;
            // Drawn at the layout's real proportions, so a 3:4 posting grid and a
            // 3:2 contact sheet are not the same picture on the shelf.
            const size = t.size || layout?.size || null;
            const isCommunity = t.source === COMMUNITY;
            const isBig = (t.cells || 0) >= BIG_CELLS
              || minHintFontFor(tree, size, t.hints) < SMALL_LABEL;
            return (
              <li key={`${t.category}:${t.slug}`} className={isBig ? 'is-big' : undefined}>
                <a className="tplstore-card" href={t.path}>
                  {/* The preview sits ON a fixed-height stage rather than
                      filling the tile, so the row stays level while each layout
                      keeps its own proportions. */}
                  <span className="tplstore-stage">
                    {tree && <GridLayoutThumb tree={tree} title={t.h1} size={size} labels={t.hints?.length ? t.hints : null} />}
                  </span>
                  <span className="tplstore-title">{t.h1}</span>
                  <span className="tplstore-blurb">{t.blurb}</span>
                  <span className="tplstore-meta">
                    {isCommunity && <span className="tplstore-badge">Community</span>}
                    {t.cells > 0 && <>{isCommunity ? ' · ' : ''}{t.cells} {t.cells === 1 ? 'box' : 'boxes'}</>}
                    {/* Shown only when it is a real number. A shelf of "0
                        downloads" reads as a dead shop, and the fix for that is
                        to say nothing until there is something to say — not to
                        put a number there that nobody earned. */}
                    {t.useCount > 0 && (
                      <> · <span className="tplstore-dl">{t.useCount} download{t.useCount === 1 ? '' : 's'}</span></>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {/* The upload invitation. One quiet line under the goods rather than a
          banner above them — a shop asks you to stock it after you have seen
          what is on the shelf. */}
      <p className="tplstore-contribute">
        Built a layout you keep reusing?{' '}
        <a href={contributeHref()}>Share it in the store</a> — save any grid as a
        template and tick the box. Whoever adds it gets their own copy.
      </p>
    </section>
  );
}
