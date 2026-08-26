// The public changelog (/changelog). Renders every entry from the GENERATED
// registries built out of content/changelog/*.md by scripts/gen-docs.mjs.
//
// ONE page, every entry, anchored at #YYYY-MM-DD — not one route per week. A
// week of changes is a thin page on its own, and the readers this page is for
// (someone deciding whether the product is maintained, an assistant checking
// whether a feature exists yet) want the whole recency picture in one fetch
// rather than a crawl.
//
// The Worker has already injected the title/description/canonical/OG, the
// crawlable server-rendered HTML and the JSON-LD from the SAME markdown parse,
// so a crawler sees this pre-rendered and React hydrates over it. That parity is
// the point of the registry design — see the header of scripts/lib/markdown.mjs.
//
// Code-split (loaded only on /changelog) and dependency-light: the brand mark,
// the two registries, the shared block renderers, and nothing else.

import { useEffect, useRef, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { CHANGELOG_ENTRIES, CHANGELOG_META } from '../lib/changelogIndex.js';
import { CHANGELOG_CONTENT } from '../lib/changelogContent.js';
import { Block } from './docsBlocks.jsx';
import './docsite.css';

const prettyDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
  year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
});

export function ChangelogPage() {
  const [navOpen, setNavOpen] = useState(false);
  const [activeId, setActiveId] = useState(CHANGELOG_ENTRIES[0]?.date || null);
  const scrollRef = useRef(null);

  useEffect(() => { document.title = CHANGELOG_META.title; }, []);

  // A #YYYY-MM-DD arriving from an RSS item or a shared link cannot be honoured
  // by the browser: at document load the anchor lives in the Worker's crawlable
  // <main>, which React replaces on mount. Re-run the jump ourselves once the
  // hydrated entries exist.
  useEffect(() => {
    const id = decodeURIComponent((window.location.hash || '').slice(1));
    if (!id) return;
    document.getElementById(id)?.scrollIntoView();
  }, []);

  // Highlight the entry being read in the date rail. Same approach as DocsPage:
  // a scroll handler, not an IntersectionObserver, because what you want is
  // "the last entry I scrolled past" — a position question, not a visibility
  // one — and the root is the scroll CONTAINER, since html/body/#root are
  // position:fixed with overflow:hidden app-wide (styles.css).
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return undefined;
    const entries = [...root.querySelectorAll('.changelog-entry[id]')];
    if (!entries.length) return undefined;

    let frame = 0;
    const update = () => {
      frame = 0;
      const line = root.getBoundingClientRect().top + 120;
      let current = entries[0];
      for (const el of entries) {
        if (el.getBoundingClientRect().top <= line) current = el; else break;
      }
      setActiveId(current.id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };

    update();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { root.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, []);

  return (
    // Same dark commitment as /docs and the marketing pages, so the whole
    // signed-out world is continuous rather than a set of separate sites.
    <div className="public-dark docs-root">
      <header className="docs-topbar">
        <a className="docs-brand" href="/changelog" aria-label="Soleil Clusters changelog">
          <ClustersMark />
          <span>Changelog</span>
        </a>
        <span className="changelog-topnav">
          <a href="/docs">Docs</a>
          <a href="/changelog.xml">RSS</a>
        </span>
        <button
          type="button"
          className="docs-nav-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
        >{navOpen ? 'Close' : 'Menu'}</button>
        <a className="docs-cta" href="/?utm_source=changelog&utm_medium=nav&utm_campaign=changelog_header">
          Open Clusters
        </a>
      </header>

      <div className="docs-body">
        <nav className={`docs-nav${navOpen ? ' is-open' : ''}`} aria-label="Changelog entries">
          <ul className="changelog-jump">
            {CHANGELOG_ENTRIES.map((e) => (
              <li key={e.date}>
                <a
                  href={`#${e.date}`}
                  className={e.date === activeId ? 'is-active' : undefined}
                  aria-current={e.date === activeId ? 'true' : undefined}
                  onClick={() => setNavOpen(false)}
                >
                  <time dateTime={e.date}>{prettyDate(e.date)}</time>
                  <span>{e.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="docs-scroll" ref={scrollRef}>
          <main className="docs-main changelog-main">
            <article className="docs-article">
              <div className="docs-hero">
                <h1>{CHANGELOG_META.h1}</h1>
                {/* The extractable answer, same contract as every docs page:
                    what a reader needs if they read nothing else, and the block
                    answer engines lift. */}
                <p className="docs-answer">{CHANGELOG_META.answer}</p>
                <p className="docs-meta">
                  <a href="/changelog.md">View as Markdown</a>
                  {' · '}
                  <a href="/changelog.xml">Subscribe by RSS</a>
                </p>
              </div>

              {CHANGELOG_ENTRIES.map((e) => (
                <section className="changelog-entry" id={e.date} key={e.date}>
                  <p className="changelog-date">
                    <a href={`#${e.date}`} className="docs-anchor" aria-label={`Link to ${e.date}`}>#</a>
                    <time dateTime={e.date}>{prettyDate(e.date)}</time>
                  </p>
                  <h2 className="changelog-title">{e.title}</h2>
                  <p className="changelog-summary">{e.summary}</p>
                  {(CHANGELOG_CONTENT[e.date] || []).map((b, i) => <Block key={i} b={b} />)}
                </section>
              ))}
            </article>
          </main>

          <footer className="docs-footer">
            <span>Machine-readable: <a href="/changelog.md">changelog.md</a> · <a href="/changelog.xml">RSS</a> · <a href="/llms.txt">llms.txt</a></span>
            <span><a href="/docs">Docs</a> · <a href="/pricing">Pricing</a> · <a href="/explore">Explore</a></span>
          </footer>
        </div>
      </div>
    </div>
  );
}
