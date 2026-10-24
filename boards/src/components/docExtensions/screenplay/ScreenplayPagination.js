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
import { changedRange } from '../textblockDecorations.js';

const key = new PluginKey('screenplayPagination');
const breakKey = new PluginKey('screenplayPageBreaks');

// Re-paginating runs paginate() over the whole script, a few ms on a feature
// script and more on a phone. Doing it per keystroke made long scripts lag
// behind typing, so edits map the existing page markers and the full pass runs
// once typing pauses this long. (Scene numbers and auto CONT'D are one cheap
// linear pass and stay in step with every keystroke.)
const PAGINATE_IDLE_MS = 150;

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

// Top-level blocks (screenplay or otherwise) with their positions + sizes.
function readBlocks(doc) {
  const blocks = [];
  doc.forEach((node, offset) => {
    const isSp = node.type.name === 'screenplayBlock';
    // A horizontal rule is the forced page break (whole-doc export separator /
    // Fountain `===`) — mirror docJSONToBlocks so the on-screen breaks match.
    const element = isSp ? (node.attrs.element || 'action')
      : node.type.name === 'horizontalRule' ? 'pagebreak' : 'action';
    blocks.push({
      element,
      text: node.textContent,
      sceneNumber: isSp ? (node.attrs.sceneNumber || null) : null,
      dual: isSp ? (node.attrs.dual || null) : null,
      pos: offset,
      size: node.nodeSize,
    });
  });
  return blocks;
}

const flatOf = (blocks) => blocks.map(b => ({ element: b.element, text: b.text, dual: b.dual }));

// Scene numbers + auto (CONT'D): which block shows which, by index, and a
// signature of the lot to tell whether an edit changed any of them.
function readMarks(doc) {
  const blocks = readBlocks(doc);
  const sceneNums = computeSceneNumbers(blocks.map(b => ({ element: b.element, sceneNumber: b.sceneNumber })));
  const contdSet = computeAutoContd(flatOf(blocks));
  const sig = `${blocks.length}|${[...sceneNums].map(([i, n]) => `${i}=${n}`).join(',')}|${[...contdSet].join(',')}`;
  return { blocks, sceneNums, contdSet, sig };
}

function drawMarks(doc, { blocks, sceneNums, contdSet }) {
  if (blocks.length < 1) return DecorationSet.empty;
  const decos = [];

  // Scene numbers in the left + right gutters (gated to visible by the
  // `.show-scene-numbers` class on .doc-paper). Auto by order, or locked A/B.
  sceneNums.forEach((num, idx) => {
    const blk = blocks[idx];
    if (!blk) return;
    decos.push(Decoration.node(blk.pos, blk.pos + blk.size, { 'data-scene-number': num, class: 'sp-scene-numbered' }));
  });

  // Auto (CONT'D) on a character cue resuming the same speaker — render-time
  // suffix, shown even on a single-page script. Never edits the stored text.
  contdSet.forEach((idx) => {
    const blk = blocks[idx];
    if (!blk) return;
    const endPos = Math.max(0, Math.min(blk.pos + blk.size - 1, doc.content.size));
    decos.push(Decoration.widget(endPos, makeContdEl, { side: 1, key: `sp-contd-${idx}` }));
  });
  return DecorationSet.create(doc, decos);
}

function computeMarks(doc) {
  const marks = readMarks(doc);
  return { set: drawMarks(doc, marks), sig: marks.sig };
}

// Whether an edit stayed inside the text of one block and left the block
// itself (its element, its scene number) alone: then every mark it didn't
// change sits where it was, moved with the text.
function insideOneBlock(prev, next, change) {
  if (prev.childCount !== next.childCount) return false;
  const ends = [prev.resolve(change.from), prev.resolve(change.toA), next.resolve(change.from), next.resolve(change.to)];
  if (ends.some(($p) => $p.depth < 1)) return false;
  const i = ends[0].index(0);
  return ends.every(($p) => $p.index(0) === i) && prev.child(i).sameMarkup(next.child(i));
}

// Page-break markers (only when there's more than one page) — the full
// paginate() of the script.
function computePageBreaks(doc) {
  const blocks = readBlocks(doc);
  if (blocks.length < 1) return DecorationSet.empty;
  const decos = [];
  const { pages } = paginate(flatOf(blocks));
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
          // (MORE) belongs to the bottom of the PREVIOUS page and only for a
          // split DIALOGUE — the paginator's `more` flag. (A split action
          // block must not show it; the PDF correctly omits it there.)
          const prevFrags = pages[p - 1];
          const more = !!(prevFrags && prevFrags.length && prevFrags[prevFrags.length - 1].more);
          // Mid-block: break inside the text (blk.pos + 1 enters block content,
          // + char offset). Otherwise: break before the block.
          const breakPos = midBlock ? (blk.pos + 1 + off) : blk.pos;
          const safePos = Math.max(0, Math.min(breakPos, doc.content.size));
          // The key carries everything the marker shows: ProseMirror reuses
          // a widget whose key matches, so a key of the page index alone kept
          // a stale "JON (CONT'D)" after the cue was renamed.
          decos.push(Decoration.widget(safePos, () => makeBreakEl(p + 1, more, f.contd || null), {
            side: -1, key: `sp-pb-${p}-${more ? 1 : 0}-${f.contd || ''}`,
          }));
        }
      }
    });
  }
  return DecorationSet.create(doc, decos);
}

// The page the caret is on and how many there are, as the markers on screen
// stand (a marker sits where its page starts), and how many scenes: what the
// doc look's footer says of a script.
export function screenplayCounts(state) {
  const breaks = breakKey.getState(state)?.find() || [];
  const at = state.selection.from;
  let scenes = 0;
  state.doc.forEach((node) => {
    if (node.type.name === 'screenplayBlock' && node.attrs.element === 'scene') scenes += 1;
  });
  return { page: 1 + breaks.filter((d) => d.from <= at).length, of: breaks.length + 1, scenes };
}

export const ScreenplayPagination = Extension.create({
  name: 'screenplayPagination',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => computeMarks(doc),
          apply: (tr, old, oldState, newState) => {
            if (!tr.docChanged) return old;
            // A key typed into a speech changes no number and no CONT'D:
            // keep the drawn marks and move them, rather than draw a fresh
            // set (several ms a key on a feature script) for the view to
            // compare against the old one block by block.
            const marks = readMarks(newState.doc);
            const change = changedRange(oldState.doc, newState.doc);
            if (!change) return old;
            if (marks.sig === old.sig && insideOneBlock(oldState.doc, newState.doc, change)) {
              return { set: old.set.map(change.mapping, newState.doc), sig: marks.sig };
            }
            return { set: drawMarks(newState.doc, marks), sig: marks.sig };
          },
        },
        props: {
          decorations(state) { return key.getState(state).set; },
        },
      }),
      new Plugin({
        key: breakKey,
        state: {
          init: (_, { doc }) => computePageBreaks(doc),
          apply: (tr, old) => {
            const fresh = tr.getMeta(breakKey);
            if (fresh) return fresh;
            return tr.docChanged ? old.map(tr.mapping, tr.doc) : old;
          },
        },
        props: {
          decorations(state) { return breakKey.getState(state); },
        },
        view() {
          let timer = 0;
          let destroyed = false;
          const run = (view) => {
            timer = 0;
            if (destroyed || view.isDestroyed) return;
            const decos = computePageBreaks(view.state.doc);
            view.dispatch(view.state.tr.setMeta(breakKey, decos).setMeta('addToHistory', false));
          };
          return {
            update(view, prevState) {
              if (prevState.doc === view.state.doc) return;
              clearTimeout(timer);
              timer = setTimeout(() => run(view), PAGINATE_IDLE_MS);
            },
            destroy() { destroyed = true; clearTimeout(timer); },
          };
        },
      }),
    ];
  },
});
