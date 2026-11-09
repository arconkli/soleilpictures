import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Mapping } from '@tiptap/pm/transform';
import { changedRange, decorateAll, redecorate, sameRangesOutside, textblocksIn } from './textblockDecorations.js';

export const CANDIDATE_NAME_KEY = new PluginKey('candidateName');

// Paints a soft dotted underline under "candidate names" — recurring
// capitalized proper nouns that aren't tags yet (from get_candidate_names,
// indexed by useCandidateNames). Tapping one opens CandidatePromptPopover
// to promote it to a character/setting tag or dismiss it.
//
// Modeled on AutoDetectPlugin: inputs are read through closures, so swapping
// the index (async load, or after a promote/dismiss) is picked up at the next
// edit, which then redraws the whole doc; any other edit redraws only the
// textblocks it touched (textblockDecorations.js). The editor forces an
// immediate repaint by dispatching an empty transaction with this plugin's
// meta when the index identity changes.
//
// While a word is composed (iOS predictive text, Android keyboards, an IME)
// nothing is redrawn: the underlines move with the text, and the span typed is
// held and redrawn once the composition ends (see `held`).
//
//   options = {
//     getIndex(): NameIndex | null,               // candidate-name trie
//     getAppliedRangeSet?(doc): Array<{from,to}>, // applied tag ranges to suppress under
//     getMentionIndex?(): NameIndex | null,       // workspace entity trie — mentions win
//   }
export function makeCandidateNamePlugin({ getIndex, getAppliedRangeSet, getMentionIndex }) {
  // The candidate underlines of one textblock. Text in a code block, or
  // already wrapped in a link or inline code mark, is left alone.
  const decorator = (index, applied, mentions) => (block, blockPos) => {
    if (block.type.name === 'codeBlock') return [];
    const decos = [];
    block.descendants((node, offset) => {
      if (!node.isText) return;
      for (const m of node.marks) {
        if (m.type.name === 'link' || m.type.name === 'code') return;
      }
      const text = node.text;
      const pos = blockPos + 1 + offset;
      for (const m of index.findMatches(text)) {
        const absStart = pos + m.start;
        const absEnd = pos + m.end;
        // A colored tag range already covers this — the tag wins.
        if (rangesOverlap(applied, absStart, absEnd)) continue;
        // The name is already a real entity (e.g. just promoted, or a
        // card/board name) — its own mention underline wins; don't
        // double-paint the candidate dotted line on top.
        if (mentions) {
          const mm = mentions.longestMatchAt(text, m.start);
          if (mm && mm.start === m.start && mm.end === m.end) continue;
        }
        const rec = (m.records && m.records[0]) || {};
        decos.push(Decoration.inline(absStart, absEnd, {
          class: 'tt-candidate',
          'data-name': rec.name || text.slice(m.start, m.end),
          'data-count': String(rec.n ?? ''),
          'data-sample': rec.sample || '',
          'data-type': rec.entityType || '',
        }));
      }
    });
    return decos;
  };

  const build = (doc) => {
    const index = getIndex?.() || null;
    const mentions = getMentionIndex?.() || null;
    const applied = (index && getAppliedRangeSet?.(doc)) || [];
    const set = index ? decorateAll(doc, decorator(index, applied, mentions)) : DecorationSet.empty;
    return { set, index, mentions, applied, held: null };
  };

  // The span typed while composing, moved through `mapping`.
  const mapHeld = (held, mapping) => (held
    ? { from: mapping.map(held.from, -1), to: mapping.map(held.to, 1) }
    : null);

  return new Plugin({
    key: CANDIDATE_NAME_KEY,
    state: {
      // Nothing until the first edit or meta: the index arrives later.
      init() { return { set: DecorationSet.empty, index: undefined, mentions: undefined, applied: [], held: null }; },
      apply(tr, old, oldState, newState) {
        const meta = tr.getMeta(CANDIDATE_NAME_KEY);
        // Typing through an input method: ProseMirror marks each of its
        // transactions "composition". Drawing an underline around the word
        // being composed replaces its text node, which ends the composition
        // mid-word (the suggestion strip resets, a letter can double). So
        // until it ends the underlines only move with the text, and the span
        // typed is held for the compositionend handler below to redraw.
        if (tr.docChanged && tr.getMeta('composition') && !meta) {
          const change = changedRange(oldState.doc, newState.doc);
          let held = mapHeld(old.held, tr.mapping);
          if (change) {
            held = held
              ? { from: Math.min(held.from, change.from), to: Math.max(held.to, change.to) }
              : { from: change.from, to: change.to };
          }
          return { ...old, set: old.set.map(tr.mapping, newState.doc), held };
        }
        // The composition ended: redraw the textblocks it touched.
        if (meta?.composed) {
          if (!old.held) return old;
          const index = getIndex?.() || null;
          const mentions = getMentionIndex?.() || null;
          if (!index || index !== old.index || mentions !== old.mentions) return build(newState.doc);
          const size = newState.doc.content.size;
          const touched = textblocksIn(newState.doc, Math.min(old.held.from, size), Math.min(old.held.to, size));
          const applied = getAppliedRangeSet?.(newState.doc) || [];
          const set = redecorate(old.set, new Mapping(), newState.doc, touched, decorator(index, applied, mentions));
          return { set, index, mentions, applied, held: null };
        }
        // Re-walk only when the doc changed OR a meta says the candidate
        // index / applied ranges moved (cursor moves and selection changes
        // don't need a rebuild).
        if (!tr.docChanged && !meta) return old;
        if (meta) return build(newState.doc);
        const index = getIndex?.() || null;
        const mentions = getMentionIndex?.() || null;
        if (!index || index !== old.index || mentions !== old.mentions) return build(newState.doc);
        const change = changedRange(oldState.doc, newState.doc);
        if (!change) return old;
        // A span still held from a composition is redrawn with this edit's.
        const held = mapHeld(old.held, tr.mapping);
        const touched = textblocksIn(newState.doc,
          held ? Math.min(held.from, change.from) : change.from,
          held ? Math.max(held.to, change.to) : change.to);
        const applied = getAppliedRangeSet?.(newState.doc) || [];
        if (!sameRangesOutside(old.applied, applied, change.mapping, touched)) return build(newState.doc);
        const set = redecorate(old.set, change.mapping, newState.doc, touched, decorator(index, applied, mentions));
        return { set, index, mentions, applied, held: null };
      },
    },
    props: {
      decorations(state) { return this.getState(state).set; },
      handleDOMEvents: {
        // ProseMirror settles a composition ~20ms after this event
        // (scheduleComposeEnd); redraw the held span after that, unless the
        // next one has already begun (its own end redraws then).
        compositionend(view) {
          setTimeout(() => {
            if (view.isDestroyed || view.composing) return;
            if (!CANDIDATE_NAME_KEY.getState(view.state)?.held) return;
            view.dispatch(view.state.tr.setMeta(CANDIDATE_NAME_KEY, { composed: true }));
          }, 40);
          return false;
        },
      },
    },
  });
}

function rangesOverlap(ranges, a, b) {
  if (!ranges || ranges.length === 0) return false;
  for (const r of ranges) {
    if (a < r.to && b > r.from) return true;
  }
  return false;
}
