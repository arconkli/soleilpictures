// Whole-document export. The doc editor binds ONE Tiptap editor per visible
// sheet, and DocExportMenu historically exported only the focused sheet —
// silently dropping every other sheet and every other page (real data loss at
// export). This collects EVERY page × EVERY sheet straight from the Yjs
// fragments (no live editor needed), resolves assets, and serializes to
// HTML / Markdown / a printable shell.
//
// Asset resolution fixes the other export-fidelity bugs:
//   - images stored as `r2:<key>` sentinels are inlined as data: URIs (durable)
//   - link marks (which store only a linkId) get their real href written back
//   - comment marks (an editing artifact) are stripped
//   - board embeds (empty <div> via NodeView) become a labeled placeholder

import { generateHTML, mergeAttributes } from '@tiptap/core';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { baseDocExtensions } from '../components/docExtensions/baseExtensions.js';
import { LinkMark } from '../components/docExtensions/LinkMark.js';
import {
  readPages, buildPageTree, getPageSheetIds, getOrCreateSheetContent,
} from './docState.js';
import { getLink } from './links.js';
import { resolveSrc } from './r2.js';

// The live LinkMark renders an href-less <span> (a runtime plugin paints the
// href). For a self-contained export we need a real <a href>, so swap in a
// link variant that renders the resolved href (set by resolveDocAssets).
const ExportLinkMark = LinkMark.extend({
  addAttributes() {
    return {
      linkId: { default: null, renderHTML: () => ({}) },
      href: { default: null, renderHTML: (a) => (a.href ? { href: a.href } : {}) },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes({ class: 'tt-link', rel: 'noopener noreferrer' }, HTMLAttributes), 0];
  },
});
const EXPORT_EXTENSIONS = baseDocExtensions.map((e) => (e?.name === 'link' ? ExportLinkMark : e));

// Flatten the page tree into depth-first render order.
function flattenPages(pages) {
  const tree = buildPageTree(pages);
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

// Ordered list of every sheet across every page: { pageId, pageName, sheetId, json }.
export function collectSheets(ydoc, scope) {
  const pages = flattenPages(readPages(ydoc, scope));
  const out = [];
  for (const p of pages) {
    const sheetIds = getPageSheetIds(ydoc, p.id, scope);
    for (const sid of sheetIds) {
      const frag = getOrCreateSheetContent(ydoc, p.id, sid, scope);
      if (!frag) continue;
      let json;
      try { json = yXmlFragmentToProsemirrorJSON(frag); }
      catch (_) { json = { type: 'doc', content: [] }; }
      out.push({ pageId: p.id, pageName: p.name || '', sheetId: sid, json });
    }
  }
  return out;
}

// One combined ProseMirror doc JSON spanning all sheets/pages (page breaks
// inserted as horizontalRule). Used by Markdown export + tests.
export function collectFullDocJSON(ydoc, scope) {
  const sheets = collectSheets(ydoc, scope);
  const content = [];
  sheets.forEach((s, i) => {
    if (i > 0) content.push({ type: 'horizontalRule' });
    for (const node of (s.json.content || [])) content.push(node);
  });
  return { type: 'doc', content };
}

// Walk a JSON node tree applying a visitor that may return a replacement node
// (or null to drop it). Depth-first; visitor sees each node after children.
function mapNodes(node, visit) {
  if (!node || typeof node !== 'object') return node;
  let next = node;
  if (Array.isArray(next.content)) {
    next = { ...next, content: next.content.map(c => mapNodes(c, visit)).filter(c => c !== null) };
  }
  return visit(next);
}

// Resolve assets in a combined doc JSON. Async because images are fetched +
// inlined. Returns a new JSON object (input not mutated).
async function resolveDocAssets(doc, ydoc) {
  // 1) Collect every image src that needs resolving (r2: sentinels + http(s)).
  const imageSrcs = new Set();
  const collect = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'image' && n.attrs?.src) imageSrcs.add(n.attrs.src);
    (n.content || []).forEach(collect);
  };
  collect(doc);
  const srcToData = new Map();
  await Promise.all([...imageSrcs].map(async (src) => {
    try {
      const url = await resolveSrc(src);
      if (!url) return;
      const res = await fetch(url);
      const blob = await res.blob();
      const dataUri = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
      });
      srcToData.set(src, dataUri);
    } catch (_) { /* leave the original src */ }
  }));

  // 2) Rewrite nodes/marks.
  const linkHref = (linkId) => {
    if (!ydoc || !linkId) return null;
    try {
      const link = getLink(ydoc, linkId);
      const t = (link?.targets || []).find(t => t && (t.href || t.url || t.source));
      return t ? (t.href || t.url || t.source) : null;
    } catch (_) { return null; }
  };
  const fixMarks = (marks) => {
    if (!Array.isArray(marks)) return marks;
    const out = [];
    for (const m of marks) {
      if (m?.type === 'comment') continue; // strip editing artifact
      if (m?.type === 'link') {
        const href = m.attrs?.href || linkHref(m.attrs?.linkId);
        if (href) out.push({ type: 'link', attrs: { ...m.attrs, href } });
        // No resolvable target → drop the (href-less) mark, keep the text.
        continue;
      }
      out.push(m);
    }
    return out;
  };
  return mapNodes(doc, (n) => {
    if (n.type === 'image' && n.attrs?.src && srcToData.has(n.attrs.src)) {
      return { ...n, attrs: { ...n.attrs, src: srcToData.get(n.attrs.src) } };
    }
    if (n.type === 'boardEmbed') {
      const label = n.attrs?.label || (n.attrs?.cardId ? 'Card' : 'Board');
      return { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: `↗ ${label}` }] }] };
    }
    if (Array.isArray(n.marks)) return { ...n, marks: fixMarks(n.marks) };
    return n;
  });
}

// Per-sheet HTML, asset-resolved, joined with page-break separators.
export async function collectFullDocHtml(ydoc, scope) {
  const sheets = collectSheets(ydoc, scope);
  const parts = [];
  for (let i = 0; i < sheets.length; i++) {
    const resolved = await resolveDocAssets(sheets[i].json, ydoc);
    let html = '';
    try { html = generateHTML(resolved, EXPORT_EXTENSIONS); }
    catch (_) { html = ''; }
    if (i > 0) parts.push('<div style="break-after:page;page-break-after:always"></div>');
    parts.push(html);
  }
  return parts.join('\n');
}

export async function collectFullDocMarkdown(ydoc, scope) {
  const doc = collectFullDocJSON(ydoc, scope);
  const resolved = await resolveDocAssets(doc, ydoc);
  return jsonToMarkdown(resolved);
}

// ── Tiptap JSON → GFM Markdown ──────────────────────────────────────────────
// (Moved out of DocExportMenu so the whole-doc path + tests share it.)
// Covers paragraph/heading/lists/taskList/blockquote/codeBlock/code/marks/
// link/image/hardBreak/horizontalRule/table + sub/superscript + boardEmbed.
export function jsonToMarkdown(doc) {
  const out = [];
  const renderInline = (nodes = []) => nodes.map(renderInlineNode).join('');
  const renderInlineNode = (n) => {
    if (n.type === 'text') return wrapMarks(n.text || '', n.marks || []);
    if (n.type === 'hardBreak') return '  \n';
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
  const renderBlock = (node, depth = 0) => {
    if (!node) return;
    switch (node.type) {
      case 'doc': (node.content || []).forEach(c => renderBlock(c, depth)); break;
      case 'paragraph': out.push(renderInline(node.content)); out.push(''); break;
      case 'heading': {
        const lvl = Number(node.attrs?.level) || 1;
        out.push('#'.repeat(Math.min(6, lvl)) + ' ' + renderInline(node.content));
        out.push('');
        break;
      }
      case 'bulletList': (node.content || []).forEach((li) => renderListItem(li, '-', depth)); out.push(''); break;
      case 'orderedList': (node.content || []).forEach((li, i) => renderListItem(li, `${i + 1}.`, depth)); out.push(''); break;
      case 'taskList': (node.content || []).forEach(li => renderTaskItem(li, depth)); out.push(''); break;
      case 'blockquote': (node.content || []).forEach(c => {
        const before = out.length;
        renderBlock(c, depth);
        for (let i = before; i < out.length; i++) out[i] = '> ' + out[i];
      }); out.push(''); break;
      case 'codeBlock': {
        const lang = node.attrs?.language || '';
        const text = (node.content || []).map(c => c.text || '').join('');
        out.push('```' + lang); out.push(text); out.push('```'); out.push('');
        break;
      }
      case 'horizontalRule': out.push('---'); out.push(''); break;
      case 'image': out.push(`![${node.attrs?.alt || ''}](${node.attrs?.src || ''})`); out.push(''); break;
      case 'boardEmbed': {
        const label = node.attrs?.label || (node.attrs?.cardId ? 'Card' : 'Board');
        out.push(`> ↗ ${label}`); out.push('');
        break;
      }
      case 'table': renderTable(node); out.push(''); break;
      default: if (node.content) (node.content).forEach(c => renderBlock(c, depth));
    }
  };
  const renderListItem = (li, marker, depth) => {
    const indent = '  '.repeat(depth);
    const inner = [];
    (li.content || []).forEach((child) => {
      if (child.type === 'paragraph') inner.push(renderInline(child.content));
      else {
        const save = out.length;
        renderBlock(child, depth + 1);
        const lines = out.splice(save).filter(Boolean);
        inner.push(lines.join('\n'));
      }
    });
    out.push(indent + marker + ' ' + (inner[0] || ''));
    for (let i = 1; i < inner.length; i++) out.push(indent + '  ' + inner[i]);
  };
  const renderTaskItem = (li, depth) => {
    const indent = '  '.repeat(depth);
    const checked = li.attrs?.checked ? '[x]' : '[ ]';
    const text = (li.content || [])
      .filter(c => c.type === 'paragraph')
      .map(c => renderInline(c.content)).join(' ');
    out.push(indent + '- ' + checked + ' ' + text);
  };
  // Serialize a table cell's FULL block content (not just first-paragraph text),
  // escaping pipes and joining blocks with <br> so multi-paragraph / list cells
  // survive.
  const renderCell = (cell) => {
    const save = out.length;
    (cell.content || []).forEach(c => renderBlock(c, 0));
    const lines = out.splice(save).filter(Boolean);
    return lines.join(' ').replace(/\|/g, '\\|').trim();
  };
  const renderTable = (table) => {
    const rows = (table.content || []).map(row => (row.content || []).map(renderCell));
    if (!rows.length) return;
    out.push('| ' + rows[0].join(' | ') + ' |');
    out.push('|' + rows[0].map(() => '---').join('|') + '|');
    for (let i = 1; i < rows.length; i++) out.push('| ' + rows[i].join(' | ') + ' |');
  };
  renderBlock(doc);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
