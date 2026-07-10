// The editorial article under the public /c/<slug> canvas hero.
//
// Renders the SAME page model the worker injected as crawlable HTML into
// #seo-fallback (window.__publicPageModel) — one structure, two renderers,
// anti-cloaking parity by construction (see src/lib/publicPageModel.js).
//
// The article drives the canvas: section chips and gallery images dispatch
// the app's `soleil-flash-card` event, which pans the read-only canvas to
// that card — the page itself demonstrates what the product does.

import { Fragment, useCallback, useEffect, useState } from 'react';

function flashCard(boardId, cardId, heroSelector = '.public-canvas-host') {
  const hero = document.querySelector(heroSelector);
  if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Let the scroll start before the pan so both motions read as one gesture.
  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('soleil-flash-card', { detail: { boardId, cardId } }));
  }, 60);
}

function Swatch({ hex, name }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    try { navigator.clipboard?.writeText(hex); } catch (_) { /* older browsers: no-op */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [hex]);
  return (
    <button type="button" className="pa-swatch" onClick={copy} title={`Copy ${hex}`}>
      <span className="pa-swatch-chip" style={{ background: hex }} aria-hidden="true" />
      <span className="pa-swatch-name">{name || hex}</span>
      <code className="pa-swatch-hex">{copied ? 'Copied!' : hex}</code>
    </button>
  );
}

function Item({ item, slug, boardId }) {
  switch (item.kind) {
    case 'image':
      return (
        <figure className="pa-figure">
          <img
            src={`/api/public-img/${slug}?i=${item.legacy_i}`}
            alt={item.media?.alt || item.title || ''}
            loading="lazy" width="640" height="480"
            onClick={() => flashCard(boardId, item.card_id)}
          />
          {(item.title || item.body) && (
            <figcaption>
              {item.title && <b>{item.title}</b>}
              {item.title && item.body ? ' — ' : ''}
              {item.body}
            </figcaption>
          )}
        </figure>
      );
    case 'palette':
      return (
        <div className="pa-palette">
          {item.title && <h3>{item.title}</h3>}
          <div className="pa-swatches">
            {(item.swatches || []).map((s, i) => <Swatch key={i} hex={s.hex} name={s.name} />)}
          </div>
        </div>
      );
    case 'schedule':
      return (
        <div className="pa-table">
          {item.title && <h3>{item.title}</h3>}
          <table><tbody>
            {(item.rows || []).map((r, i) => (
              <tr key={i}><td>{r.day}</td><td>{r.what}</td><td>{r.loc}</td></tr>
            ))}
          </tbody></table>
        </div>
      );
    case 'grid': {
      const texts = (item.cells || []).filter((c) => c && c.type === 'text' && (c.text || '').trim());
      const imgs = (item.cells || []).filter((c) => c && c.type === 'image').length;
      return (
        <div className="pa-grid-note">
          {item.title && !imgs && <h3>{item.title}</h3>}
          {imgs > 0 && (
            <p>
              A {item.grid_dims?.rows}×{item.grid_dims?.cols} visual grid
              {item.title ? <> — {item.title}</> : null} ({imgs} images
              {texts.length ? ` and ${texts.length} notes` : ''}) —{' '}
              <button type="button" className="pa-jump" onClick={() => flashCard(boardId, item.card_id)}>
                view it on the board
              </button>.
            </p>
          )}
          {texts.length > 0 && <ul>{texts.map((c, i) => <li key={i}>{c.text}</li>)}</ul>}
        </div>
      );
    }
    case 'link': {
      const safe = /^https?:\/\//i.test(item.href || '');
      return (
        <div className="pa-link">
          {safe
            ? <a href={item.href} rel="noopener nofollow" target="_blank">{item.title || item.href}</a>
            : <span>{item.title || item.href}</span>}
          {item.body && <p>{item.body}</p>}
        </div>
      );
    }
    case 'doc':
      return (
        <div className="pa-doc">
          {item.title && <h3>{item.title}</h3>}
          {(item.body || '').split('\n').filter(Boolean).map((l, i) => <p key={i}>{l}</p>)}
        </div>
      );
    case 'video':
      return (
        <p className="pa-video">
          ▶ {item.title ? <b>{item.title}</b> : 'Video'}
          {item.body ? <> — {item.body}</> : null}{' '}
          <button type="button" className="pa-jump" onClick={() => flashCard(boardId, item.card_id)}>
            plays on the board
          </button>
        </p>
      );
    case 'shape':
      return item.label ? <p className="pa-shape">{item.label}</p> : null;
    case 'board':
    case 'boardlink':
      return (
        <p className="pa-board">
          Includes a nested board{item.title ? <>: <b>{item.title}</b></> : null}
          {item.body ? <> — {item.body}</> : null}{' '}
          <button type="button" className="pa-jump" onClick={() => flashCard(boardId, item.card_id)}>
            open it from the canvas
          </button>
        </p>
      );
    case 'note':
    default: {
      const lines = (item.body || '').split('\n').filter(Boolean);
      if (!lines.length) return null;
      return (
        <div className="pa-note">
          {item.title && <h3>{item.title}</h3>}
          <p>{lines.map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>)}</p>
        </div>
      );
    }
  }
}

export default function PublicArticle({ model, boardId, remixUrl, tryHref, onCta }) {
  // Scroll affordance fades once the reader starts moving.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => { if (window.scrollY > 40) setScrolled(true); };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  if (!model) return null;
  const chips = model.sections.filter((s) => s.heading);

  return (
    <div className="pa-wrap">
      <div className={`pa-scroll-hint${scrolled ? ' is-gone' : ''}`} aria-hidden="true">
        Explore the details <span className="pa-scroll-arrow">↓</span>
      </div>

      <article className="public-article" itemScope>
        <header className="pa-head">
          <h1>{model.h1}</h1>
          {model.answer ? <p className="pa-answer">{model.answer}</p>
            : model.description ? <p className="pa-answer">{model.description}</p> : null}
          {model.updated && (
            <p className="pa-updated">Updated <time dateTime={model.updated}>{model.updatedText || model.updated}</time></p>
          )}
          {model.body && <p className="pa-body">{model.body}</p>}
        </header>

        {chips.length > 1 && (
          <nav className="pa-chips" aria-label="Board sections">
            {chips.map((s) => (
              <button key={s.id} type="button" className="pa-chip"
                      onClick={() => flashCard(boardId, s.id)}>
                {s.heading}
              </button>
            ))}
          </nav>
        )}

        {model.sections.map((sec, i) => (
          <Fragment key={sec.id}>
            <section className="pa-section">
              {sec.heading && (
                <h2>
                  <button type="button" className="pa-h2-jump" title="Show on the board"
                          onClick={() => flashCard(boardId, sec.id)}>
                    {sec.heading}
                  </button>
                </h2>
              )}
              {sec.sub && <p className="pa-deck">{sec.sub}</p>}
              <div className="pa-items">
                {sec.items.map((item) => <Item key={item.card_id} item={item} slug={model.slug} boardId={boardId} />)}
              </div>
            </section>
            {/* One quiet mid-read ask after the first section (mirrored in the
                worker's renderArticleHtml — parity by construction). */}
            {i === 0 && model.sections.length > 1 && tryHref && (
              <aside className="pa-midcta">
                <span><b>Make a board like this — free.</b> Images, notes, palettes, and connections on one canvas.</span>
                <a className="public-cta" href={tryHref} onClick={onCta ? onCta('article_mid') : undefined}>Start a board</a>
              </aside>
            )}
          </Fragment>
        ))}

        {model.faq.length > 0 && (
          <section className="pa-faq">
            <h2>Frequently asked questions</h2>
            {model.faq.map((f, i) => (
              <details key={i}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </section>
        )}

        {model.credits && <p className="pa-credits">{model.credits}</p>}

        {model.related.length > 0 && (
          <nav className="pa-related" aria-label="Related boards">
            <h2>Related boards</h2>
            <ul className="pubgrid pubgrid-compact">
              {model.related.map((r) => (
                <li key={r.slug}>
                  <a className="pubcard" href={`/c/${r.slug}`}>
                    <img src={`/api/public-thumb/${r.slug}`} alt="" loading="lazy" width="320" height="180" />
                    <span className="pubcard-title">{r.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="pa-cta">
          {model.isTemplate ? (
            <>
              <div className="pa-cta-copy">
                <b>This board is a working template.</b> Use it in a free Clusters workspace —
                every card, arrow, and note stays editable.
              </div>
              <div className="pa-cta-actions">
                {remixUrl && <a className="public-cta" href={remixUrl} onClick={onCta ? onCta('article_remix') : undefined}>Use this template — free</a>}
                {tryHref && <a className="public-signin-quiet" href={tryHref} onClick={onCta ? onCta('article_try') : undefined}>Or start blank</a>}
                {model.toolPath && <a className="pa-toollink" href={model.toolPath}>How boards like this are made</a>}
              </div>
            </>
          ) : (
            <>
              <div className="pa-cta-copy">
                <b>Made with Clusters.</b> Boards like this take an afternoon, not a design degree —
                images, notes, palettes, and connections on one canvas.
              </div>
              <div className="pa-cta-actions">
                {tryHref && <a className="public-cta" href={tryHref} onClick={onCta ? onCta('article_try') : undefined}>Start your own board — free</a>}
                {model.toolPath && <a className="pa-toollink" href={model.toolPath}>How boards like this are made</a>}
              </div>
            </>
          )}
          <div className="pa-hubnav">
            <a href="/use-cases">What you can make with Clusters</a>
            <a href="/explore">Explore more boards</a>
          </div>
        </div>
      </article>
    </div>
  );
}
