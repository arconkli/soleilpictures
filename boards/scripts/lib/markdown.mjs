// markdown.mjs — a deliberately small Markdown parser for the docs site.
//
// WHY NOT `marked`/`remark`: the output of this parser is consumed by TWO
// renderers that must produce identical text — React (pages/DocsPage.jsx) and
// the Worker's crawlable HTML injection. That parity is the whole reason the
// docs registry exists; it is the anti-cloaking property seoLanding.js was
// built to protect. A general-purpose Markdown library hands back HTML strings,
// which React can only render via dangerouslySetInnerHTML — at which point the
// two renderers are running different code paths over different data and the
// parity is asserted by hope. Emitting a small block AST instead means both
// renderers walk the same tree, and a test can prove their text matches.
//
// It also keeps the docs build dependency-free, matching the discipline the
// rest of this repo's pure-data registries and *.test.mjs tier already follow.
//
// The supported subset is exactly what technical documentation needs:
//   ## / ###          headings (with stable slug ids for TOC + deep links)
//   paragraphs
//   - / * / 1.        lists (single level — nested lists are a smell in docs)
//   ```lang           fenced code
//   | a | b |         tables
//   > **Note:** …     callouts (note / warning / tip)
//   ---               thematic break
// Inline: `code`, **strong**, *em*, [text](href).
//
// Anything outside the subset is passed through as literal text rather than
// silently dropped, so a doc that reaches for an unsupported construct looks
// wrong on the page instead of quietly losing content.

// ── Inline ──────────────────────────────────────────────────────────────────
// Returns an array of {t,v[,href][,children]} nodes.
//
// Order matters: code spans are matched FIRST and are TERMINAL — never
// re-scanned — so `**` inside backticks stays literal, which matters a lot in
// API docs full of `**kwargs` and shell globs.
//
// Everything else nests. Technical writing reaches for bold-wrapping-code
// constantly ("**`read_board` truncates by default.**") and for bold links
// ("**[`⌘K`](/docs/organize/search)**"); rendering those as literal asterisks
// and backticks looks broken, and there are 27 of them in this corpus alone.
// So strong/em/link carry `children` (recursively parsed) alongside `v` (the
// flattened text, kept so simple consumers can ignore the tree).
const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;

export function parseInline(src) {
  const out = [];
  let last = 0;
  const s = String(src);
  for (const m of s.matchAll(INLINE_RE)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    const tok = m[0];
    if (m[1]) {
      out.push({ t: 'code', v: tok.slice(1, -1) });          // terminal
    } else if (m[2]) {
      const inner = tok.slice(2, -2);
      out.push({ t: 'strong', v: inner, children: parseInline(inner) });
    } else if (m[3]) {
      const inner = tok.slice(1, -1);
      out.push({ t: 'em', v: inner, children: parseInline(inner) });
    } else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out.push({ t: 'link', v: link[1], href: link[2], children: parseInline(link[1]) });
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out.length ? out : [{ t: 'text', v: '' }];
}

// Plain text of an inline run — used for llms-full.txt, the extractable answer,
// heading slugs, and the React/Worker parity assertion. Descends into children
// so nested markup flattens to the words a reader would see, not the source.
export function inlineText(nodes) {
  return (nodes || []).map((n) => (n.children ? inlineText(n.children) : n.v)).join('');
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const splitRow = (line) => line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

// ── Blocks ──────────────────────────────────────────────────────────────────
export function parseMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  const seenIds = new Map();   // slug -> count, so duplicate headings get -2, -3…
  let i = 0;

  // Headings carry BOTH forms. `inline` is the parsed run, because API docs are
  // full of `## \`POST /boards/:id/cards\`` and rendering the backticks
  // literally looks broken. `text` is the flattened plain string, which is what
  // the slug, the table of contents and the search index want — a TOC entry
  // wrapped in punctuation is noise.
  const pushHeading = (depth, raw) => {
    const inline = parseInline(raw);
    const text = inlineText(inline);
    const base = slugify(text);
    const n = (seenIds.get(base) || 0) + 1;
    seenIds.set(base, n);
    blocks.push({ type: 'heading', depth, text, inline, id: n === 1 ? base : `${base}-${n}` });
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // Fenced code. Unterminated fences consume to EOF rather than throwing —
    // a truncated code block is obvious on the page; a build crash on a typo
    // in prose is not a good trade.
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || null;
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', lang, code: buf.join('\n') });
      continue;
    }

    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (h) { pushHeading(h[1].length, h[2].trim()); i++; continue; }

    if (/^---+$/.test(line.trim())) { blocks.push({ type: 'hr' }); i++; continue; }

    // Table: a header row followed by a |---|---| delimiter.
    if (line.trim().startsWith('|') && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const head = splitRow(line.trim()).map(parseInline);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i].trim()).map(parseInline));
        i++;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    // Callout. `> **Note:** body` — the bold lead picks the variant so authors
    // never hand-write a class name.
    if (line.trim().startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      const text = buf.join(' ').trim();
      const lead = text.match(/^\*\*(Note|Warning|Tip|Important)[:.]?\*\*\s*/i);
      const variant = lead ? lead[1].toLowerCase() : 'note';
      blocks.push({
        type: 'callout',
        variant: variant === 'important' ? 'warning' : variant,
        inline: parseInline(lead ? text.slice(lead[0].length) : text),
      });
      continue;
    }

    // Lists. Single level by design; a continuation line indented under an item
    // joins that item so long entries can wrap in the source.
    const li = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
    if (li) {
      const ordered = !!li[2];
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
        if (m && !!m[2] === ordered) {
          items.push(m[3].trim());
          i++;
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*(?:[-*]|\d+\.)\s/.test(lines[i])) {
            items[items.length - 1] += ' ' + lines[i].trim();
            i++;
          }
        } else break;
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) });
      continue;
    }

    // Paragraph: run to the next blank line or block-opening token.
    const buf = [];
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].startsWith('```') && !/^#{2,4}\s/.test(lines[i]) &&
      !lines[i].trim().startsWith('>') && !lines[i].trim().startsWith('|') &&
      !/^\s*(?:[-*]|\d+\.)\s/.test(lines[i]) && !/^---+$/.test(lines[i].trim())
    ) { buf.push(lines[i].trim()); i++; }
    if (buf.length) blocks.push({ type: 'para', inline: parseInline(buf.join(' ')) });
  }

  return blocks;
}

// Flatten a block list to plain prose — llms-full.txt, search index, and the
// crawlable/React parity check all read text, not markup.
export function blocksToText(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'heading') out.push(b.text);
    else if (b.type === 'para') out.push(inlineText(b.inline));
    else if (b.type === 'callout') out.push(inlineText(b.inline));
    else if (b.type === 'list') out.push(b.items.map(inlineText).join('\n'));
    else if (b.type === 'code') out.push(b.code);
    else if (b.type === 'table') {
      out.push([b.head, ...b.rows].map((r) => r.map(inlineText).join(' | ')).join('\n'));
    }
  }
  return out.join('\n\n');
}

// Every internal link in a page, for the link checker. Descends into children,
// or a link nested inside bold would never be checked.
export function blockLinks(blocks) {
  const hrefs = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.t === 'link') hrefs.push(n.href);
      if (n.children) walk(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === 'para' || b.type === 'callout') walk(b.inline);
    else if (b.type === 'list') b.items.forEach(walk);
    else if (b.type === 'table') [b.head, ...b.rows].forEach((r) => r.forEach(walk));
  }
  return hrefs;
}
