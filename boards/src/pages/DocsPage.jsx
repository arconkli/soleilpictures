// Public documentation (/docs/*). Renders one page from the GENERATED
// registries built out of content/docs/**.md by scripts/gen-docs.mjs.
//
// The Worker has already injected this page's title/description/canonical/OG +
// crawlable server-rendered HTML + JSON-LD from the SAME markdown parse, so a
// crawler sees the content pre-rendered and React hydrates the interactive
// version on top. That parity is the point of the whole registry design — see
// the header of scripts/lib/markdown.mjs for why this renders a block AST
// rather than an HTML string.
//
// Code-split (loaded only on a /docs path) and dependency-light: the brand
// mark, the two registries, and nothing else.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ClustersMark } from '../components/SoleilWordmark.jsx';
import { DOCS_PAGES, DOCS_SECTIONS, getDocsPage } from '../lib/docsiteIndex.js';
import { DOCS_CONTENT } from '../lib/docsiteContent.js';
import { NotFoundPage } from './NotFoundPage.jsx';
import './docsite.css';

// ── Inline + block rendering ────────────────────────────────────────────────
// One component per node type in the AST that gen-docs.mjs emits. Anything the
// parser can produce must render here, or the page would silently differ from
// the crawlable HTML the Worker injected.

// Recursive: strong/em/link carry `children` so bold-wrapping-code and bold
// links render as markup rather than literal asterisks and backticks. Code
// spans are terminal by design — `**` inside backticks must stay literal.
// Must stay in lockstep with inlineHtml() in scripts/gen-docs.mjs.
function Inline({ nodes }) {
  return (nodes || []).map((n, i) => {
    const inner = n.children ? <Inline nodes={n.children} /> : n.v;
    if (n.t === 'code') return <code key={i}>{n.v}</code>;
    if (n.t === 'strong') return <strong key={i}>{inner}</strong>;
    if (n.t === 'em') return <em key={i}>{inner}</em>;
    if (n.t === 'link') {
      const external = /^https?:/i.test(n.href);
      return (
        <a key={i} href={n.href}
           {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {inner}
        </a>
      );
    }
    return <span key={i}>{n.v}</span>;
  });
}

// Copy-to-clipboard on every code block: these docs are mostly commands and
// payloads, and selecting a multi-line <pre> by hand is a small tax paid on
// every single visit.
function CodeBlock({ code, lang }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="docs-code">
      {lang && <span className="docs-code-lang">{lang}</span>}
      <button
        type="button"
        className="docs-copy"
        onClick={() => {
          navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => {});
        }}
      >{copied ? 'Copied' : 'Copy'}</button>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function Block({ b }) {
  switch (b.type) {
    case 'heading': {
      const Tag = b.depth === 2 ? 'h2' : b.depth === 3 ? 'h3' : 'h4';
      // Self-linking headings: a docs anchor is something people send to each
      // other, so it should be one click to get.
      return (
        <Tag id={b.id} className="docs-heading">
          <a href={`#${b.id}`} className="docs-anchor" aria-label={`Link to ${b.text}`}>#</a>
          <Inline nodes={b.inline} />
        </Tag>
      );
    }
    case 'para':    return <p><Inline nodes={b.inline} /></p>;
    case 'list':    return b.ordered
      ? <ol>{b.items.map((it, i) => <li key={i}><Inline nodes={it} /></li>)}</ol>
      : <ul>{b.items.map((it, i) => <li key={i}><Inline nodes={it} /></li>)}</ul>;
    case 'code':    return <CodeBlock code={b.code} lang={b.lang} />;
    case 'callout': return (
      <aside className={`docs-callout docs-callout-${b.variant}`}>
        <Inline nodes={b.inline} />
      </aside>
    );
    case 'hr':      return <hr />;
    case 'table':   return (
      // Wrapped so a wide table scrolls itself instead of the page.
      <div className="docs-table-wrap">
        <table>
          <thead><tr>{b.head.map((c, i) => <th key={i}><Inline nodes={c} /></th>)}</tr></thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}><Inline nodes={c} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    default:        return null;
  }
}

// ── Navigation ──────────────────────────────────────────────────────────────

function Nav({ current, currentSection, query, onNavigate }) {
  const q = query.trim().toLowerCase();
  const sections = useMemo(() => DOCS_SECTIONS.map((s) => ({
    ...s,
    pages: DOCS_PAGES.filter((p) => p.section === s.id && (
      !q || p.h1.toLowerCase().includes(q) || p.navLabel.toLowerCase().includes(q)
      || p.metaDescription.toLowerCase().includes(q) || p.answer.toLowerCase().includes(q)
    )),
  })).filter((s) => s.pages.length), [q]);

  // Only the section you are in is open. Eleven sections and fifty-odd pages
  // expanded at once is a wall you scroll past rather than a map you read.
  // A search expands everything that matched, because a hit hidden inside a
  // collapsed section is a search that looks broken.
  const [opened, setOpened] = useState(() => new Set([currentSection]));
  useEffect(() => { setOpened(new Set([currentSection])); }, [currentSection]);

  if (!sections.length) {
    return <p className="docs-nav-empty">Nothing matches “{query}”.</p>;
  }

  return sections.map((s) => {
    const open = !!q || opened.has(s.id);
    return (
      <div className={`docs-nav-section${open ? ' is-open' : ''}`} key={s.id}>
        <button
          type="button"
          className="docs-nav-head"
          aria-expanded={open}
          onClick={() => setOpened((prev) => {
            const next = new Set(prev);
            if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
            return next;
          })}
        >
          <span>{s.label}</span>
          <span className="docs-nav-caret" aria-hidden="true" />
        </button>
        {open && (
          <ul>
            {s.pages.map((p) => (
              <li key={p.path}>
                <a
                  href={p.path}
                  aria-current={p.path === current ? 'page' : undefined}
                  onClick={onNavigate}
                >{p.navLabel}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  });
}

export function DocsPage({ path }) {
  const page = getDocsPage(path || (typeof window !== 'undefined' ? window.location.pathname : ''));
  const [query, setQuery] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => { if (page) document.title = page.title; }, [page]);

  // Highlight the section being read in the "On this page" rail. On a long
  // reference page the TOC is otherwise a list of places you might be, which is
  // not much use — the whole value is knowing where you are.
  //
  // The root is the scroll CONTAINER, not the viewport: html/body/#root are
  // position:fixed with overflow:hidden app-wide (styles.css), so nothing here
  // scrolls the window and a viewport-rooted observer would never fire.
  // Deliberately a scroll handler and not an IntersectionObserver. An observer
  // only reports headings that are ON SCREEN, so anywhere in the middle of a
  // long section — the common case while reading — nothing intersects and the
  // rail highlights nothing. What you want is "the last heading I scrolled
  // past", which is a position question, not a visibility one.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !page) return undefined;
    const headings = [...root.querySelectorAll('.docs-article h2[id]')];
    if (!headings.length) return undefined;

    let frame = 0;
    const update = () => {
      frame = 0;
      const line = root.getBoundingClientRect().top + 100;   // just under the top bar
      let current = headings[0];
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = h; else break;
      }
      setActiveId(current.id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };

    update();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => { root.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [page]);

  // A new page means a new document: start at the top of the scroller rather
  // than wherever the previous page happened to leave it.
  useEffect(() => { scrollRef.current?.scrollTo?.(0, 0); }, [page?.path]);

  // Prev/next within the flat reading order the generator already sorted.
  const { prev, next } = useMemo(() => {
    const i = DOCS_PAGES.findIndex((p) => p.path === page?.path);
    return { prev: i > 0 ? DOCS_PAGES[i - 1] : null, next: i >= 0 ? DOCS_PAGES[i + 1] : null };
  }, [page]);

  // An unknown /docs path was already served with a real HTTP 404 by the
  // Worker. Rendering page content here would be a soft-404 — content at a URL
  // whose status says it is gone.
  if (!page) return <NotFoundPage />;

  const blocks = DOCS_CONTENT[page.path] || [];
  const toc = blocks.filter((b) => b.type === 'heading' && b.depth === 2);
  const section = DOCS_SECTIONS.find((s) => s.id === page.section);

  return (
    // Same dark commitment as the other public surfaces (SeoLandingPage uses
    // public-shell + public-dark), so docs, marketing and the front door are
    // one continuous world rather than three.
    <div className="public-dark docs-root">
      <header className="docs-topbar">
        <a className="docs-brand" href="/docs" aria-label="Soleil Clusters documentation">
          <ClustersMark />
          <span>Docs</span>
        </a>
        <input
          className="docs-search"
          type="search"
          placeholder="Search the docs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the documentation"
        />
        <button
          type="button"
          className="docs-nav-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
        >{navOpen ? 'Close' : 'Menu'}</button>
        <a className="docs-cta" href="/?utm_source=docs&utm_medium=nav&utm_campaign=docs_header">
          Open Clusters
        </a>
      </header>

      {/* THE SCROLL ARCHITECTURE, and why it is not just `overflow: auto` on
          the page: html/body/#root are position:fixed + overflow:hidden app-wide
          so iOS cannot pan the canvas as a unit (styles.css). Nothing here can
          scroll the window. So the shell is a fixed-height flex column and the
          nav and the content each own a scroll region — which is also the right
          docs layout: the sidebar stays put while you read. */}
      <div className="docs-body">
        <nav className={`docs-nav${navOpen ? ' is-open' : ''}`} aria-label="Documentation">
          <Nav
            current={page.path}
            currentSection={page.section}
            query={query}
            onNavigate={() => setNavOpen(false)}
          />
        </nav>

        <div className="docs-scroll" ref={scrollRef}>
          <main className="docs-main">
          <article className="docs-article">
            <div className="docs-hero">
              {section && <p className="docs-eyebrow">{section.label}</p>}
              <h1>{page.h1}</h1>
              {/* The extractable answer: what a reader needs if they read
                  nothing else, and the block AI answer engines lift. Given its
                  own surface so it reads as the summary it is. */}
              <p className="docs-answer">{page.answer}</p>
              <p className="docs-meta">
                <time dateTime={page.updated}>
                  Updated {new Date(page.updated + 'T00:00:00Z').toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
                  })}
                </time>
                {' · '}
                <a href={`${page.path}.md`}>View as Markdown</a>
              </p>
            </div>

            {blocks.map((b, i) => <Block key={i} b={b} />)}

            {!!page.faq?.length && (
              <section className="docs-faq">
                <h2 id="faq" className="docs-heading">
                  <a href="#faq" className="docs-anchor" aria-label="Link to FAQ">#</a>
                  Frequently asked questions
                </h2>
                {page.faq.map((f, i) => (
                  <details key={i}>
                    <summary>{f.q}</summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </section>
            )}

            {!!page.related?.length && (
              <nav className="docs-related" aria-label="Related pages">
                <h2>Related</h2>
                <ul>
                  {page.related.map((r) => {
                    const t = getDocsPage(r);
                    return <li key={r}><a href={r}>{t ? t.h1 : r}</a></li>;
                  })}
                </ul>
              </nav>
            )}

            <nav className="docs-prevnext" aria-label="Previous and next">
              {prev
                ? <a className="docs-prev" href={prev.path}>
                    <span className="docs-prevnext-dir">← Previous</span>
                    <span className="docs-prevnext-label">{prev.navLabel}</span>
                  </a>
                : <span />}
              {next
                ? <a className="docs-next" href={next.path}>
                    <span className="docs-prevnext-dir">Next →</span>
                    <span className="docs-prevnext-label">{next.navLabel}</span>
                  </a>
                : <span />}
            </nav>
          </article>

          {toc.length > 1 && (
            <aside className="docs-toc" aria-label="On this page">
              <h2>On this page</h2>
              <ul>
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className={h.id === activeId ? 'is-active' : undefined}>
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </aside>
          )}
          </main>

          {/* Inside the scroller, so it sits at the end of the reading rather
              than pinned across the bottom of every page. */}
          <footer className="docs-footer">
            <span>Machine-readable: <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> · <a href="/api/v1/openapi.json">OpenAPI</a></span>
            <span><a href="/pricing">Pricing</a> · <a href="/explore">Explore</a> · <a href="/legal/privacy">Privacy</a></span>
          </footer>
        </div>
      </div>
    </div>
  );
}
