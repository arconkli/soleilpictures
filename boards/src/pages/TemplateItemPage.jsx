// A template store item page (/templates/<slug>).
//
// Deliberately lean. The page is a diagram, its labels, one paragraph saying
// what the shape is for, and a button that puts it in your library. Anything
// beyond that is written only where there is genuinely something to say —
// there is no minimum length anywhere in this family, because padding an item
// page to hit a word count is exactly what makes a catalogue read as filler.
//
// What keeps these from being doorway clones is not length but difference, and
// that is enforced mechanically by src/lib/templates.test.mjs.
//
// The diagram, the numbered label list and the grid the button places all derive
// from the SAME `preset` id, so the page cannot show one shape and hand over
// another. Numbering follows reading order, which is not always left-to-right —
// readingOrder bands cells by their centre — but the diagram and the list are
// drawn from one call, so a reader sees one consistent thing.

import { useEffect } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { getTemplateSpec } from '../lib/templateIndex.js';
import { TEMPLATE_CARDS } from '../lib/templateCards.js';
import { TEMPLATE_CONTENT } from '../lib/templateContent.js';
import { Block } from './docsBlocks.jsx';
import { GridLayoutThumb } from '../components/GridLayoutThumb.jsx';
import { presetById } from '../lib/gridLayout.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import { encodeRemixParam } from '../lib/remix.js';
import { logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import './seoLanding.css';

// Sign up, then get THIS template in your library. Rides the same rails /c/ and
// /share use, which is the part that survives the OTP magic-link hop; `k_`
// resolves in the bundle, so unlike a share link or a gallery slug it cannot
// 404 and needs no network call.
function addHref(item) {
  const base = `/?utm_source=templates&utm_medium=item&utm_campaign=${encodeURIComponent(item.slug)}`;
  const param = encodeRemixParam({ kind: 'curated', value: item.slug });
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

  const preset = presetById(item.preset);
  const blocks = TEMPLATE_CONTENT[item.path] || [];
  const hints = item.hints || [];
  const siblings = TEMPLATE_CARDS.filter((t) => t.category === item.category && t.slug !== item.slug).slice(0, 4);

  return (
    <div className="public-shell seo-shell public-dark">
      <div className="public-topbar">
        <a className="public-brand" href="/" title="Clusters home">
          <ClustersMark size={18} />
          <span>Soleil Clusters</span>
        </a>
        <div className="public-topbar-right">
          <a className="public-cta" href={addHref(item)}>Use this template</a>
        </div>
      </div>

      <div className="seo-scroll">
        <article className="seo-main tplitem">
          <nav className="tplitem-crumbs" aria-label="Breadcrumb">
            <a href="/templates">Grid templates</a> <span aria-hidden="true">›</span> {item.h1}
          </nav>

          <h1 className="seo-h1">{item.h1}</h1>
          <p className="seo-answer">{item.answer}</p>

          {/* The layout IS the product description. */}
          {preset && (
            <section className="seo-section tplitem-layout">
              <div className="seo-tpl-layout-row">
                <GridLayoutThumb tree={preset.tree} title={item.h1} numbered={hints.length > 0} />
                <div>
                  <p className="seo-body">{item.presetLabel} — {item.cells} {item.cells === 1 ? 'box' : 'boxes'}.</p>
                  {hints.length > 0 && (
                    <>
                      <ol className="seo-tpl-hints">
                        {hints.map((h, i) => <li key={`${h}-${i}`}>{h}</li>)}
                      </ol>
                      <p className="seo-body">
                        Each label shows only while its box is empty, and is never written into the box.
                      </p>
                    </>
                  )}
                  <a className="seo-cta-primary tplitem-add" href={addHref(item)}>Add to my templates</a>
                  <span className="seo-cta-sub2">Free. It lands in the grid tool, ready to place.</span>
                </div>
              </div>
            </section>
          )}

          {blocks.length > 0 && (
            <section className="seo-section">
              {blocks.map((b, i) => <Block key={i} b={b} />)}
            </section>
          )}

          {item.faq.length > 0 && (
            <section className="seo-section seo-faq">
              <h2 className="seo-h2">Questions</h2>
              {item.faq.map((f, i) => (
                <details key={i}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </section>
          )}

          {siblings.length > 0 && (
            <section className="seo-section">
              <h2 className="seo-h2">More like this</h2>
              <ul className="pubgrid tplstore-grid">
                {siblings.map((t) => {
                  const p = presetById(t.preset);
                  return (
                    <li key={t.slug}>
                      <a className="tplstore-card" href={t.path}>
                        {p && <GridLayoutThumb tree={p.tree} title={t.h1} />}
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
                {item.related.filter((r) => !r.startsWith('/templates/')).map((r) => (
                  <li key={r}><a href={r}>{r}</a></li>
                ))}
                <li><a href="/docs/canvas/grids">Grids documentation</a></li>
              </ul>
            </nav>
          </footer>
        </article>
      </div>
    </div>
  );
}
