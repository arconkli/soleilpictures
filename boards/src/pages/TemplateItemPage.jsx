// A template store item page (/templates/<slug>).
//
// A PRODUCT PAGE, not a landing page. Preview, name, one line of what it is for,
// the specs, and a button. There is no body prose and no FAQ — not trimmed away,
// never authored: gen-docs treats a body in a template file as an error rather
// than dropping it silently.
//
// That is the deliberate trade. A page of invented copy per template is what
// makes a catalogue read as filler, and answer engines quote the machine-readable
// twin (/templates/<slug>.md, llms.txt) rather than on-page marketing anyway. What
// keeps these from being doorway clones is not length but difference, enforced by
// src/lib/templates.test.mjs.
//
// The labels are drawn INSIDE the boxes, the way the card draws them, so the
// preview answers "what goes where" by looking like the thing you are about to
// place. There is no legend beside it: with the labels in the boxes a numbered
// list is the same information twice, and on a nine-box casting board it is nine
// repeated words of noise. The Worker's crawlable body keeps an <ol> because a
// crawler cannot read SVG text, and the SVG's aria-label carries them for
// assistive tech — three renderings, one source, all from the same preset id.

import { useEffect } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { getTemplateSpec } from '../lib/templateIndex.js';
import { TEMPLATE_CARDS, TEMPLATE_CATEGORIES } from '../lib/templateCards.js';
import { GridLayoutThumb } from '../components/GridLayoutThumb.jsx';
import { layoutById } from '../lib/templateLayouts.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import { encodeRemixParam } from '../lib/remix.js';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import './seoLanding.css';

// Sign up, then get THIS template. Rides the same rails /c/ and /share use — the
// part that survives the OTP magic-link hop. `k_` resolves in the bundle, so
// unlike a share token or a gallery slug it needs no network call and cannot 404.
function addHref(slug) {
  const base = `/?utm_source=templates&utm_medium=item&utm_campaign=${encodeURIComponent(slug)}`;
  const param = encodeRemixParam({ kind: 'curated', value: slug });
  return param ? `${base}&remix=${encodeURIComponent(param)}` : base;
}

export function TemplateItemPage({ path }) {
  const item = getTemplateSpec(path);

  useEffect(() => {
    if (!item) return;
    document.title = item.title;
    logEventOnce(`tpl_item_${item.slug}`, EV.SEO_LANDING_VIEW, { path: item.path, kind: 'template' });
  }, [item]);

  // The Worker already served this URL with a real 404, so rendering content
  // here would be a soft-404 — content at a URL whose status says gone.
  if (!item) return <NotFoundPage />;

  const preset = layoutById(item.preset);
  const hints = item.hints || [];
  const category = TEMPLATE_CATEGORIES.find((c) => c.id === item.category);
  const siblings = TEMPLATE_CARDS.filter((t) => t.category === item.category && t.slug !== item.slug).slice(0, 4);

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Clusters home">
          <ClustersMark size={18} />
          <span>Soleil Clusters</span>
        </a>
        <div className="public-topbar-right">
          <a className="public-cta" href={addHref(item.slug)}>Use this template</a>
        </div>
      </div>

      <div className="seo-scroll">
        <article className="seo-main tplitem">
          <nav className="tplitem-crumbs" aria-label="Breadcrumb">
            <a href="/templates">Grid templates</a> <span aria-hidden="true">›</span> {item.h1}
          </nav>

          {/* The product: shape on the left, everything you need to decide on
              the right. No section headings — there is only one thing here. */}
          <div className="tplitem-hero">
            <div className="tplitem-shot">
              {preset && (
                <GridLayoutThumb
                  tree={preset.tree}
                  title={item.h1}
                  size={item.size || preset.size}
                  labels={hints.length ? hints : null}
                />
              )}
            </div>
            <div className="tplitem-detail">
              <h1 className="tplitem-h1">{item.h1}</h1>
              <p className="tplitem-lead">{item.answer}</p>
              <p className="tplitem-specs">
                {item.cells} {item.cells === 1 ? 'box' : 'boxes'}
                {category && <> · {category.label}</>}
              </p>

              <a className="seo-cta-primary tplitem-add" href={addHref(item.slug)}>Add to my templates</a>
              <span className="seo-cta-sub2">
                Free. It lands in the grid tool, ready to place.
                {hints.length > 0 && ' Labels vanish as you fill each box.'}
              </span>
            </div>
          </div>

          {siblings.length > 0 && (
            <section className="seo-section">
              <h2 className="seo-h2">More in {category ? category.label.toLowerCase() : 'this category'}</h2>
              <ul className="pubgrid tplstore-grid">
                {siblings.map((t) => {
                  const p = layoutById(t.preset);
                  return (
                    <li key={t.slug}>
                      <a className="tplstore-card" href={t.path}>
                        {/* Labelled, exactly as on the store front — a sibling
                            tile is the same product on the same shelf, and an
                            unlabelled twin of it reads as a different thing. */}
                        <span className="tplstore-stage">
                          {p && (
                            <GridLayoutThumb
                              tree={p.tree}
                              title={t.h1}
                              size={t.size || p.size}
                              labels={t.hints?.length ? t.hints : null}
                            />
                          )}
                        </span>
                        <span className="tplstore-title">{t.h1}</span>
                        <span className="tplstore-blurb">{t.blurb}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
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
