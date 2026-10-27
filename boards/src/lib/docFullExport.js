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
  readPages, getPageSheetIds, getOrCreateSheetContent,
} from './docState.js';
import { getLink } from './links.js';
import { resolveSrc } from './r2.js';
// The pure half — the page order, the node walk and the Markdown — is shared
// with the API's doc read, which has no editor to lean on.
import { flattenPages, mapNodes, jsonToMarkdown } from './docMarkdown.js';

export { jsonToMarkdown };

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
