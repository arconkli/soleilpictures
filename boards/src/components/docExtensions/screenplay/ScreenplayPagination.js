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
import { computeAutoContd, computeSceneNumbers } from './screenplayFlow.js';

const key = new PluginKey('screenplayPagination');

function makeContdEl() {
  const s = document.createElement('span');
  s.className = 'sp-auto-contd';
  s.contentEditable = 'false';
  s.textContent = " (CONT'D)";
  return s;
}

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
  // Top-level blocks (screenplay or otherwise) with their positions + sizes.
  const blocks = [];
  doc.forEach((node, offset) => {
    const isSp = node.type.name === 'screenplayBlock';
    blocks.push({
      element: isSp ? (node.attrs.element || 'action') : 'action',
      text: node.textContent,
      sceneNumber: isSp ? (node.attrs.sceneNumber || null) : null,
      pos: offset,
      size: node.nodeSize,
    });
  });
  if (blocks.length < 1) return DecorationSet.empty;

  const flat = blocks.map(b => ({ element: b.element, text: b.text }));
  const decos = [];

  // Scene numbers in the left + right gutters (gated to visible by the
  // `.show-scene-numbers` class on .doc-paper). Auto by order, or locked A/B.
  const sceneNums = computeSceneNumbers(blocks.map(b => ({ element: b.element, sceneNumber: b.sceneNumber })));
  sceneNums.forEach((num, idx) => {
    const blk = blocks[idx];
    if (!blk) return;
    decos.push(Decoration.node(blk.pos, blk.pos + blk.size, { 'data-scene-number': num, class: 'sp-scene-numbered' }));
  });

  // Auto (CONT'D) on a character cue resuming the same speaker — render-time
  // suffix, shown even on a single-page script. Never edits the stored text.
  const contdSet = computeAutoContd(flat);
  contdSet.forEach((idx) => {
    const blk = blocks[idx];
    if (!blk) return;
    const endPos = Math.max(0, Math.min(blk.pos + blk.size - 1, doc.content.size));
    decos.push(Decoration.widget(endPos, makeContdEl, { side: 1, key: `sp-contd-${idx}` }));
  });

  // Page-break markers (only when there's more than one page).
  const { pages } = paginate(flat);
  if (pages.length >= 2) {
    pages.forEach((frags, p) => {
      if (p > 0 && frags.length) {
        const f = frags[0];
        const blk = blocks[f.index];
        if (blk) {
          // srcStart is the exact character offset into the source block where
          // this fragment begins (0 = whole block; >0 = a mid-block continuation).
          const off = f.srcStart || 0;
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
    });
  }
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
