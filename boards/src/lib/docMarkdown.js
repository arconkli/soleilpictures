// docMarkdown — a doc card's pages as Markdown, from its Yjs fragments alone:
// no editor, no DOM, no network. The app's export (docFullExport.js) and the
// API's doc read (GET /api/v1/boards/:id/cards/:cardId/doc) share it, so the
// two never disagree about what a doc says.
//
// Reading only: nothing here creates a page, a sheet or a fragment, because
// the API reads a board that may be live, and a read that wrote would reach
// everyone in the room.

import * as Y from 'yjs';
import { readPages, buildPageTree, getPageSheetIds } from './docState.js';
import { getLink } from './links.js';
import { contentHash } from './clusterMath.js';

// The page tree depth-first, the order the page list shows it, each page with
// its depth (0 for a top-level page).
export function flattenPages(pages) {
  const out = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      out.push({ ...n, depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(buildPageTree(pages), 0);
  return out;
}

// y-prosemirror's yXmlFragmentToProsemirrorJSON without ProseMirror: the
// Worker reads docs too, and prosemirror-view is a lot of browser to carry for
// a tree walk. Overlapping marks of one type are stored as `name--<hash>`
// attributes, and the suffix is dropped as y-prosemirror drops it.
const HASHED_MARK = /(.*)(--[a-zA-Z0-9+/=]{8})$/;
export function fragmentToJSON(frag) {
  const serialize = (item) => {
    if (item instanceof Y.XmlText) {
      return item.toDelta().map((d) => {
        const text = { type: 'text', text: d.insert };
        if (d.attributes) {
          text.marks = Object.keys(d.attributes).map((k) => ({
            type: HASHED_MARK.exec(k)?.[1] ?? k,
            attrs: d.attributes[k],
          }));
        }
        return text;
      });
    }
    if (item instanceof Y.XmlElement) {
      const node = { type: item.nodeName };
      const attrs = item.getAttributes();
      if (Object.keys(attrs).length) node.attrs = attrs;
      const children = item.toArray();
      if (children.length) node.content = children.map(serialize).flat();
      return node;
    }
    return [];
  };
  return { type: 'doc', content: frag ? frag.toArray().map(serialize).flat() : [] };
}

// Walk a JSON node tree applying a visitor that may return a replacement node
// (or null to drop it). Depth-first; visitor sees each node after children.
export function mapNodes(node, visit) {
  if (!node || typeof node !== 'object') return node;
  let next = node;
  if (Array.isArray(next.content)) {
    next = { ...next, content: next.content.map(c => mapNodes(c, visit)).filter(c => c !== null) };
  }
  return visit(next);
}

// Marks as a reader should get them: comment marks are an editing artifact and
// go; a link mark stores only its link's id, and its href is looked up in the
// board's links map (a link with no target keeps its text and loses the mark).
export function resolveDocMarks(doc, ydoc) {
  const hrefOf = (linkId) => {
    if (!ydoc || !linkId) return null;
    try {
      const link = getLink(ydoc, linkId);
      const t = (link?.targets || []).find(x => x && (x.href || x.url || x.source));
      return t ? (t.href || t.url || t.source) : null;
    } catch (_) { return null; }
  };
  return mapNodes(doc, (n) => {
    if (!Array.isArray(n.marks)) return n;
    const marks = [];
    for (const m of n.marks) {
      if (m?.type === 'comment') continue;
      if (m?.type === 'link') {
        const href = m.attrs?.href || hrefOf(m.attrs?.linkId);
        if (href) marks.push({ type: 'link', attrs: { ...m.attrs, href } });
        continue;
      }
      marks.push(m);
    }
    return { ...n, marks };
  });
}

// ── Tiptap JSON → GFM Markdown ──────────────────────────────────────────────
// (Moved out of DocExportMenu so the whole-doc path + tests share it.)
// Covers paragraph/heading/lists/taskList/blockquote/codeBlock/code/marks/
// link/image/hardBreak/horizontalRule/table + sub/superscript + boardEmbed,
// and a screenplay's lines, one paragraph each with scene headings in bold.
//
// Written to be read back (docWrite.js reads it, and matches a page's blocks
// by it): every line of a block inside a list item or a quote carries the
// item's indent or the quote's `>`, a line break is a trailing backslash (two
// in a row can't turn into a blank line, as trailing spaces would), and a
// code block's lines go out exactly as they are.
const INLINE = new Set(['text', 'hardBreak', 'image']);
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
export function jsonToMarkdown(doc) {
  const out = [];
  // One blank line between blocks, never two (Markdown has no empty block).
  const blank = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  const renderInline = (nodes = []) => {
    // A break that ends a block shows nothing, and a backslash there would.
    let end = nodes.length;
    while (end > 0 && nodes[end - 1]?.type === 'hardBreak') end--;
    return nodes.slice(0, end).map(renderInlineNode).join('');
  };
  const renderInlineNode = (n) => {
    if (n.type === 'text') return wrapMarks(n.text || '', n.marks || []);
    if (n.type === 'hardBreak') return '\\\n';
    if (n.type === 'image') return `![${n.attrs?.alt || ''}](${n.attrs?.src || ''})`;
    return '';
  };
  const wrapMarks = (text, marks) => {
    let s = text;
    for (const m of marks) {
      if (m.type === 'bold') s = `**${s}**`;
      else if (m.type === 'italic') s = `*${s}*`;
      else if (m.type === 'strike') s = `~~${s}~~`;
      else if (m.type === 'code') s = `\`${s}\``;
      else if (m.type === 'underline') s = `<u>${s}</u>`;
      else if (m.type === 'subscript') s = `<sub>${s}</sub>`;
      else if (m.type === 'superscript') s = `<sup>${s}</sup>`;
      else if (m.type === 'link') s = `[${s}](${m.attrs?.href || ''})`;
      else if (m.type === 'highlight') s = `==${s}==`;
    }
    return s;
  };
  const line = (s) => { if (s) out.push(s); blank(); };
  const renderBlock = (node) => {
    if (!node) return;
    switch (node.type) {
      case 'doc': (node.content || []).forEach(renderBlock); break;
      case 'paragraph': line(renderInline(node.content)); break;
      case 'heading': {
        const lvl = Number(node.attrs?.level) || 1;
        line('#'.repeat(Math.min(6, lvl)) + ' ' + renderInline(node.content));
        break;
      }
      case 'bulletList': renderList(node, () => '-'); break;
      case 'orderedList': {
        const start = Number.isInteger(node.attrs?.start) && node.attrs.start >= 0 ? node.attrs.start : 1;
        renderList(node, (i) => `${start + i}.`);
        break;
      }
      case 'taskList': renderList(node, (_i, li) => `- [${li.attrs?.checked ? 'x' : ' '}]`, 2); break;
      case 'blockquote': {
        const lines = [];
        (node.content || []).forEach((c, i) => {
          if (i) lines.push('');
          lines.push(...blockLines(c));
        });
        lines.forEach((l) => out.push(l ? `> ${l}` : '>'));
        blank();
        break;
      }
      case 'codeBlock': {
        const lang = node.attrs?.language || '';
        const text = (node.content || []).map(c => c.text || '').join('');
        out.push('```' + lang, ...(text ? text.split('\n') : []), '```');
        blank();
        break;
      }
      case 'horizontalRule': line('---'); break;
      case 'image': line(`![${node.attrs?.alt || ''}](${node.attrs?.src || ''})`); break;
      case 'boardEmbed': {
        const label = node.attrs?.label || (node.attrs?.cardId ? 'Card' : 'Board');
        line(`> ↗ ${label}`);
        break;
      }
      case 'table': renderTable(node); blank(); break;
      case 'screenplayBlock': {
        const text = renderInline(node.content);
        line(node.attrs?.element === 'scene' && text ? `**${text}**` : text);
        break;
      }
      default:
        if (!node.content) break;
        // A block this does not know still has words in it: a run of inline
        // content reads as a paragraph rather than vanishing.
        if (node.content.every(c => INLINE.has(c.type))) line(renderInline(node.content));
        else node.content.forEach(renderBlock);
    }
  };
  // One block on its own, as lines, with no blank line after it.
  const blockLines = (node) => {
    const save = out.length;
    renderBlock(node);
    const lines = out.splice(save).join('\n').split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  // Each item's blocks: the first beside its marker, every other line indented
  // to where the item's text starts, so it stays in the item when read back. A
  // blank line keeps a second block its own (a paragraph would otherwise run
  // on into the first); a list inside an item follows straight on.
  const renderList = (list, markerOf, width = null) => {
    (list.content || []).forEach((li, i) => {
      const marker = markerOf(i, li);
      const pad = ' '.repeat(width ?? marker.length + 1);
      const lines = [];
      (li.content || []).forEach((child, k) => {
        const own = blockLines(child);
        const tight = LISTS.has(child.type) && !(child.type === 'orderedList' && (child.attrs?.start ?? 1) !== 1);
        if (k && !tight && lines.some(Boolean)) lines.push('');
        lines.push(...own);
      });
      const [first = '', ...rest] = lines;
      out.push(`${marker} ${first}`);
      for (const l of rest) out.push(l ? pad + l : '');
    });
    blank();
  };
  // A cell's whole content on its one row: its blocks and line breaks joined
  // by <br>, pipes escaped.
  const renderCell = (cell) => (cell.content || [])
    .map((c) => blockLines(c).map((l) => l.replace(/\\$/, '').trimEnd()).filter(Boolean).join('<br>'))
    .filter(Boolean).join('<br>').replace(/\|/g, '\\|').trim();
  const renderTable = (table) => {
    const rows = (table.content || []).map(row => (row.content || []).map(renderCell));
    if (!rows.length) return;
    out.push('| ' + rows[0].join(' | ') + ' |');
    out.push('|' + rows[0].map(() => '---').join('|') + '|');
    for (let i = 1; i < rows.length; i++) out.push('| ' + rows[i].join(' | ') + ' |');
  };
  renderBlock(doc);
  return out.join('\n').trim() + '\n';
}

// ── A doc's pages, for a reader ─────────────────────────────────────────────

// How much Markdown one read hands back: a page of a treatment is a few
// thousand characters, a feature screenplay a couple of hundred thousand.
export const DOC_READ = { defaultChars: 20_000, maxChars: 200_000 };

// Every page of a doc in page-list order, each as Markdown with a hash of that
// Markdown (what an If-Match on a later write compares against). `pageId`
// reads one page. `maxChars` bounds the Markdown handed back across all pages:
// pages fill in order, the one that crosses the line is cut and marked
// `truncated`, and any after it come back with `markdown: null`, so a reader
// always learns every page exists and how long it is, and can ask for the rest
// one page at a time. `total` counts the doc's pages either way. Null when the
// doc has no such page.
export function readDocPages(ydoc, scope, { pageId = null, maxChars = Infinity } = {}) {
  const all = flattenPages(readPages(ydoc, scope));
  const pages = pageId != null ? all.filter(p => p.id === pageId) : all;
  if (pageId != null && !pages.length) return null;
  let left = maxChars;
  return { total: all.length, pages: pages.map((p) => {
    // A page's sheets (legacy stacks; one fragment since the single-flow
    // migration) read in order, joined as the export joins them.
    const content = [];
    getPageSheetIds(ydoc, p.id, scope).forEach((sid, i) => {
      const frag = sid === p.id ? scope?.content?.get?.(p.id) : scope?.sheetContent?.get?.(sid);
      if (!frag) return;
      if (i > 0 && content.length) content.push({ type: 'horizontalRule' });
      content.push(...fragmentToJSON(frag).content);
    });
    const markdown = content.length
      ? jsonToMarkdown(resolveDocMarks({ type: 'doc', content }, ydoc))
      : '';
    const page = {
      id: p.id,
      title: p.name || '',
      parent_id: p.parent_id || null,
      depth: p.depth,
      chars: markdown.length,
      hash: contentHash(markdown),
    };
    if (left <= 0) return { ...page, markdown: null, truncated: false };
    if (markdown.length > left) {
      const cut = { ...page, markdown: markdown.slice(0, left), truncated: true };
      left = 0;
      return cut;
    }
    left -= markdown.length;
    return { ...page, markdown, truncated: false };
  }) };
}
