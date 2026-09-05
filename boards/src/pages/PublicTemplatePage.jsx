// A published community template (/templates/g/<slug>).
//
// THIS PAGE DID NOT EXIST, AND ITS ABSENCE WAS INVISIBLE.
//
// The Worker has served this URL properly since the store shipped: real meta, a
// crawlable body, canonical → /templates, x-robots-tag: noindex. But the React
// router had no matcher for it — isTemplatePath only ever matched ONE path
// segment — so `/templates/g/<slug>` fell through to a null landing spec and
// rendered NotFound. A crawler got the page; a person clicking their own
// published template got "Page not found". Nothing failed loudly, because both
// halves were individually behaving as written.
//
// So this is the client half of a page that was already half-shipped, and it
// renders the same things the Worker's body does — title, description, box
// count, the labels — from the same RPC.
//
// Unlike one of ours, the shape is NOT in the bundle: a community template is a
// row someone else wrote, so it arrives over get_public_grid_layout (granted to
// `anon`, which is what lets this render signed out — the whole point is that a
// tile in the store goes somewhere real rather than to a signup wall).

import { useEffect, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { GridLayoutThumb } from '../components/GridLayoutThumb.jsx';
import { NotFoundPage } from './NotFoundPage.jsx';
import { encodeRemixParam } from '../lib/remix.js';
import { sanitizeLayout, leafIds } from '../lib/gridLayout.js';
import { sanitizeHints, sanitizeSize } from '../lib/gridLayoutLibrary.js';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import './seoLanding.css';

// Rides the `p_` rail — a published gallery SLUG, claimed by
// use_public_grid_layout. Distinct from `k_` (one of ours, resolved in the
// bundle) and `g_` (a private share token) because they are different RPCs with
// different authorization; see lib/remix.js. On the far side of signup this now
// lands on the board with the "place it" prompt, same as any other template.
function addHref(slug) {
  const base = `/?utm_source=templates&utm_medium=community&utm_campaign=${encodeURIComponent(slug)}`;
  const param = encodeRemixParam({ kind: 'gallery', value: slug });
  return param ? `${base}&remix=${encodeURIComponent(param)}` : base;
}

export function PublicTemplatePage({ slug }) {
  const [state, setState] = useState({ status: 'loading', item: null });

  useEffect(() => {
    let on = true;
    setState({ status: 'loading', item: null });
    // Lazy, like the store's community fetch: the supabase client and the layout
    // math stay out of this chunk's critical path.
    import('../lib/gridLayoutsApi.js')
      .then((api) => api.getPublicGridLayout(slug))
      .then((row) => {
        if (!on) return;
        // Everything here was authored by a stranger and crosses a trust
        // boundary exactly once — here. computeCellRects recurses without a
        // depth guard, hints are free text, and a size drives a real card.
        const tree = row ? sanitizeLayout(row.body?.layout) : null;
        if (!tree) { setState({ status: 'missing', item: null }); return; }
        setState({
          status: 'ok',
          item: {
            slug: row.slug,
            title: String(row.title || 'Untitled template').slice(0, 120),
            description: row.description ? String(row.description).slice(0, 400) : '',
            tree,
            hints: sanitizeHints(row.body?.hints),
            size: sanitizeSize(row.body?.size),
            cells: leafIds(tree).length,
            useCount: Number(row.use_count) > 0 ? Number(row.use_count) : 0,
          },
        });
      })
      .catch(() => { if (on) setState({ status: 'missing', item: null }); });
    return () => { on = false; };
  }, [slug]);

  const item = state.item;

  useEffect(() => {
    if (!item) return;
    document.title = `${item.title} — a grid template on Soleil Clusters`;
    logEventOnce(`tpl_pub_${item.slug}`, EV.SEO_LANDING_VIEW, { path: `/templates/g/${item.slug}`, kind: 'community' });
  }, [item]);

  // The Worker already 404s an unresolvable slug, so rendering content here
  // would be a soft-404 — content at a URL whose status says gone.
  if (state.status === 'missing') return <NotFoundPage />;

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Clusters home">
          <ClustersMark size={18} />
          <span>Soleil Clusters</span>
        </a>
        <div className="public-topbar-right">
          {item && <a className="public-cta" href={addHref(item.slug)}>Use this template</a>}
        </div>
      </div>

      <div className="seo-scroll">
        <article className="seo-main tplitem">
          <nav className="tplitem-crumbs" aria-label="Breadcrumb">
            <a href="/templates">Grid templates</a> <span aria-hidden="true">›</span>{' '}
            {item ? item.title : 'Loading…'}
          </nav>

          {/* A skeleton rather than nothing: this page always needs a round-trip,
              and a blank frame reads as the 404 it used to be. */}
          {state.status === 'loading' && <div className="tplitem-shot is-loading" aria-hidden="true" />}

          {item && (
            <div className={`tplitem-hero${item.cells >= 12 ? ' is-big' : ''}`}>
              <div className="tplitem-shot">
                <GridLayoutThumb
                  tree={item.tree}
                  title={item.title}
                  size={item.size}
                  labels={item.hints?.length ? item.hints : null}
                />
              </div>
              <div className="tplitem-detail">
                <h1 className="tplitem-h1">{item.title}</h1>
                {item.description && <p className="tplitem-lead">{item.description}</p>}
                <p className="tplitem-specs">
                  {item.cells} {item.cells === 1 ? 'box' : 'boxes'} · Community
                  {item.useCount > 0 && <> · {item.useCount} download{item.useCount === 1 ? '' : 's'}</>}
                </p>

                <a className="seo-cta-primary tplitem-add" href={addHref(item.slug)}>Add to my templates</a>
                <span className="seo-cta-sub2">
                  Free. You get your own copy, so it stays yours even if this one is taken down.
                  {item.hints?.some((h) => h) && ' Labels vanish as you fill each box.'}
                </span>
              </div>
            </div>
          )}

          <footer className="seo-footer">
            <nav className="seo-related" aria-label="Related pages">
              <div className="seo-related-label">Keep exploring</div>
              <ul>
                <li><a href="/templates">All grid templates</a></li>
                <li><a href="/docs/canvas/grids">Grids documentation</a></li>
              </ul>
            </nav>
          </footer>
        </article>
      </div>
    </div>
  );
}
