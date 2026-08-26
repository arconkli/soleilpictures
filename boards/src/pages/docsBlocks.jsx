// Block + inline renderers for the AST that scripts/gen-docs.mjs emits.
//
// Shared by DocsPage and ChangelogPage. They render different documents from
// the same parser, and the parity that the whole registry design exists to
// protect — server-rendered HTML and hydrated React saying the same words —
// only holds if there is ONE client-side implementation of it. A second private
// copy in ChangelogPage would have turned a two-way invariant (this file and
// `inlineHtml`/`blocksToHtml` in gen-docs.mjs) into a three-way one, and the
// third copy is always the one that falls behind.
//
// Anything parseMarkdown can produce must render here, or the page silently
// differs from the crawlable HTML the Worker injected. docsite.test.mjs asserts
// the two agree.

import { useEffect, useState } from 'react';

// Recursive: strong/em/link carry `children` so bold-wrapping-code and bold
// links render as markup rather than literal asterisks and backticks. Code
// spans are terminal by design — `**` inside backticks must stay literal.
// Must stay in lockstep with inlineHtml() in scripts/gen-docs.mjs.
export function Inline({ nodes }) {
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
export function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="docs-code">
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

export function Block({ b }) {
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
    case 'code':    return <CodeBlock code={b.code} />;
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
