// On-screen line-accurate pagination for screenplay mode. A ProseMirror
// decoration plugin that runs the SAME paginate() the PDF uses and paints a
// page-break marker (with page number + (MORE)/CHARACTER (CONT'D)) at each
// computed boundary — so what you see on screen matches the exported PDF.
//
// Added to the editor only in screenplay mode. Operates on the editor's own doc
// (one per sheet); for a fresh screenplay that's a single continuous flow with
// the sheet auto-append disabled (DocSurface), so the markers are the only
// page boundaries.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { paginate } from '../../../lib/screenplayPaginate.js';

const key = new PluginKey('screenplayPagination');

function makeBreakEl(pageNum, more, contd) {
  const el = document.createElement('div');
  el.className = 'sp-page-break';
  el.contentEditable = 'false';
  if (more) {
    const m = document.createElement('div');
    m.className = 'sp-page-break-more';
    m.textContent = '(MORE)';
    el.appendChild(m);
  }
  const rule = document.createElement('div');
  rule.className = 'sp-page-break-rule';
  rule.setAttribute('data-page', String(pageNum));
  el.appendChild(rule);
  if (contd) {
    const c = document.createElement('div');
    c.className = 'sp-page-break-contd';
    c.textContent = `${contd} (CONT'D)`;
    el.appendChild(c);
  }
  return el;
}

function computeDecorations(doc) {
  // Top-level blocks (screenplay or otherwise) with their positions.
  const blocks = [];
  doc.forEach((node, offset) => {
    blocks.push({
      element: node.type.name === 'screenplayBlock' ? (node.attrs.element || 'action') : 'action',
      text: node.textContent,
      pos: offset,
    });
  });
  if (blocks.length < 1) return DecorationSet.empty;

  const { pages } = paginate(blocks.map(b => ({ element: b.element, text: b.text })));
  if (pages.length < 2) return DecorationSet.empty;

  const decos = [];
  const placedChars = {}; // block index → chars already placed on earlier pages
  pages.forEach((frags, p) => {
    if (p > 0 && frags.length) {
      const f = frags[0];
      const blk = blocks[f.index];
      if (blk) {
        const off = placedChars[f.index] || 0;
        const midBlock = off > 0 || !!f.contd;
        // Mid-block: break inside the text (blk.pos + 1 enters block content,
        // + char offset). Otherwise: break before the block.
        const breakPos = midBlock ? (blk.pos + 1 + off) : blk.pos;
        const safePos = Math.max(0, Math.min(breakPos, doc.content.size));
        decos.push(Decoration.widget(safePos, () => makeBreakEl(p + 1, midBlock, f.contd || null), {
          side: -1, key: `sp-pb-${p}`,
        }));
      }
    }
    frags.forEach(f => {
      // Account for placed text length (+1 for the line join) so the next
      // page's continuation offset lands at the right character.
      placedChars[f.index] = (placedChars[f.index] || 0) + (f.text ? f.text.length + 1 : 0);
    });
  });
  return DecorationSet.create(doc, decos);
}

export const ScreenplayPagination = Extension.create({
  name: 'screenplayPagination',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => computeDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? computeDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) { return key.getState(state); },
        },
      }),
    ];
  },
});
