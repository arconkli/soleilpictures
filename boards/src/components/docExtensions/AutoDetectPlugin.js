import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { changedRange, decorateAll, redecorate, sameRangesOutside, textblocksIn } from './textblockDecorations.js';

export const AUTO_DETECT_KEY = new PluginKey('autoDetect');

// Watches the doc for typed phrases matching workspace entity names.
// Adds dotted underline decorations on candidates. Skips text that's
// already inside a `link` mark, inline `code` mark, or `codeBlock` node.
//
//   options = {
//     getIndex(): NameIndex | null,
//     getIgnored?(): Set<string>           // per-doc ignored terms, lowered
//     getAppliedRangeSet?(doc): Array<{from,to}> // applied tag ranges, as
//                                          // absolute positions in `doc` (the
//                                          // doc being decorated). Decorations
//                                          // whose [start,end) overlap any
//                                          // active range are suppressed —
//                                          // the colored underline wins.
//   }
export function makeAutoDetectPlugin({ getIndex, getIgnored, getAppliedRangeSet }) {
  // The underlines of one textblock. Text in a code block, or already wrapped
  // in a link or inline code mark, is left alone.
  const decorator = (index, ignored, applied) => (block, blockPos) => {
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
        // Per-doc ignore list — kill the decoration if the matched
        // text is in the doc's "don't auto-link here" suppression
        // list. Workspace-wide ignore lives in the trie itself.
        if (ignored && ignored.has(text.slice(m.start, m.end).toLowerCase())) continue;
        const absStart = pos + m.start;
        const absEnd = pos + m.end;
        // Suppress if any applied tag range covers this match — the
        // colored underline is already showing on top of it.
        if (rangesOverlap(applied, absStart, absEnd)) continue;
        // Universal hairline visual — `tt-link tt-link-auto` shares
        // styling with manual links (just lower opacity at rest).
        // The data-records attr carries the candidate matches so
        // hover handlers can hydrate them into refs.
        decos.push(Decoration.inline(absStart, absEnd, {
          class: 'tt-link tt-link-auto',
          'data-records': JSON.stringify(m.records),
        }));
      }
    });
    return decos;
  };

  // What the underlines were drawn from, with them. The applied ranges are
  // the absolute [from, to) boxes of the doc being decorated; decorations
  // overlapping one are suppressed — the colored underline wins.
  const build = (doc) => {
    const index = getIndex?.() || null;
    const ignored = getIgnored?.() || null;
    const applied = (index && getAppliedRangeSet?.(doc)) || [];
    const set = index ? decorateAll(doc, decorator(index, ignored, applied)) : DecorationSet.empty;
    return { set, index, ignored, applied };
  };

  return new Plugin({
    key: AUTO_DETECT_KEY,
    state: {
      init(_config, state) { return build(state.doc); },
      apply(tr, old, oldState, newState) {
        // Re-walk only when the doc changed or the owner says the index /
        // ignore list / applied ranges moved (a tr with this key's meta —
        // DocPageEditor sends one). A caret move or selection change used to
        // re-run the trie over every text node and JSON.stringify every
        // match, per arrow key.
        if (!tr.docChanged && !tr.getMeta(AUTO_DETECT_KEY)) return old;
        if (tr.getMeta(AUTO_DETECT_KEY)) return build(newState.doc);
        // A doc change redraws only the textblocks it touched
        // (textblockDecorations.js) — unless what the rest were drawn from
        // moved too: a new index or ignore list, or an applied range that
        // appeared, vanished or moved by itself outside them.
        const index = getIndex?.() || null;
        const ignored = getIgnored?.() || null;
        if (!index || index !== old.index || ignored !== old.ignored) return build(newState.doc);
        const change = changedRange(oldState.doc, newState.doc);
        if (!change) return old;
        const touched = textblocksIn(newState.doc, change.from, change.to);
        const applied = getAppliedRangeSet?.(newState.doc) || [];
        if (!sameRangesOutside(old.applied, applied, change.mapping, touched)) return build(newState.doc);
        const set = redecorate(old.set, change.mapping, newState.doc, touched, decorator(index, ignored, applied));
        return { set, index, ignored, applied };
      },
    },
    props: {
      decorations(state) { return this.getState(state).set; },
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
