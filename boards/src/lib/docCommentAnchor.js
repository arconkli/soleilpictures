// docCommentAnchor — the words a comment inside a doc is on, for the API.
//
// In the app a thread inside a doc starts from a selection: the editor puts a
// CommentMark on the selected text (components/docExtensions/CommentMark.js)
// and files the thread in the card's docComments (docState.addCommentThread).
// The mark rides inside the page's Y.XmlFragment, so the words keep their
// thread through any edit around them.
//
// Here a thread starts from a quote instead: the words as a reader of the doc
// has them (fetch, GET …/doc), found on the page, and marked exactly as the
// editor's binding marks them (y-prosemirror), so the editor reads the mark as
// one of its own. docCommentAnchor.test pins the mark to y-prosemirror's own
// writer and the real schema. Taking a thread away takes its mark off too, as
// the app's delete does (CommentMark's removeCommentById).
//
// Pure (yjs and lib0 only): the routes call these inside the board's live write
// (lib/scoutBoard.js editBoardLive).

import * as Y from 'yjs';
import * as sha256 from 'lib0/hash/sha256';
import * as buf from 'lib0/buffer';
import { cardScope, readPages, getPageSheetIds } from './docState.js';

// ── The mark ────────────────────────────────────────────────────────────────

// y-prosemirror files a mark that may overlap itself (CommentMark's
// excludes: '') under `<name>--<hash of the mark's JSON>`, so two threads on
// the same words each keep theirs (sync-plugin.js marksToAttributes,
// utils.hashOfJSON: sha256, folded to 6 bytes, base64). The mark's JSON is
// ProseMirror's Mark.toJSON: its type, then its attrs.
export function commentMarkKey(id) {
  const digest = sha256.digest(buf.encodeAny({ type: 'comment', attrs: { id } }));
  const N = 6;
  for (let i = N; i < digest.length; i++) digest[i % N] ^= digest[i];
  return `comment--${buf.toBase64(digest.slice(0, N))}`;
}

const isCommentKey = (k) => k === 'comment' || k.startsWith('comment--');

// What can't carry a comment in the doc editor's schema: text in a code block
// (it takes no marks), and text marked as code (the code mark excludes every
// other). ProseMirror's addMark leaves both out of a selection being
// commented, so a comment covers the rest; a mark put there anyway would make
// a block the editor can no longer edit. The test holds these to the schema.
export const COMMENT_BARRED = Object.freeze({ blocks: Object.freeze(['codeBlock']), marks: Object.freeze(['code']) });
const markName = (key) => key.replace(/--[a-zA-Z0-9+/=]{8}$/, '');

// ── Where the words are ─────────────────────────────────────────────────────

// A fragment's text, and where each piece of it lives: a run of text with the
// same marks in one Y.XmlText (`index` into it), and whether it can carry a
// comment (`barred`). A line break goes between blocks and in place of
// anything inline that isn't text (a line break, a picture), so no quote
// reaches across one unnoticed.
export function fragmentLayout(frag) {
  let text = '';
  const runs = [];
  const gap = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const walk = (node, block) => {
    if (node instanceof Y.XmlText) {
      let index = 0;
      for (const op of node.toDelta()) {
        const s = typeof op.insert === 'string' ? op.insert : '\n';
        const barred = COMMENT_BARRED.blocks.includes(block)
          || Object.keys(op.attributes || {}).some((k) => COMMENT_BARRED.marks.includes(markName(k)));
        runs.push({ ytext: node, index, start: text.length, end: text.length + s.length, barred });
        text += s;
        index += s.length;
      }
      return;
    }
    if (node instanceof Y.XmlElement) {
      gap();
      for (const child of node.toArray()) walk(child, node.nodeName);
      gap();
    }
  };
  for (const node of frag?.toArray?.() || []) walk(node, null);
  return { text, runs };
}

const STRAIGHT = new Map([
  ...[...'‘’‚‛′'].map((c) => [c, '\'']),
  ...[...'“”„‟″'].map((c) => [c, '"']),
]);

// Text as a quote is matched against it: each run of whitespace one space (a
// break between blocks too), curly quotes straight, nothing at either end.
// `at[i]` is where the i-th character of `text` came from.
export function foldText(s) {
  let text = '';
  const at = [];
  let gap = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (gap < 0) gap = i;
      continue;
    }
    if (gap >= 0 && text) {
      text += ' ';
      at.push(gap);
    }
    gap = -1;
    text += STRAIGHT.get(c) || c;
    at.push(i);
  }
  return { text, at };
}

// The words of a quote copied out of the Markdown a doc reads as
// (docMarkdown.jsonToMarkdown): its marks, links and line-break backslashes
// taken off, and each line's heading, quote, list or checkbox marker.
export function markdownWords(s) {
  return String(s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(?:>[ \t]?)*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)?/gm, '')
    .replace(/<\/?(?:u|sub|sup)>/g, '')
    .replace(/(\*\*|~~|==)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '$1')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/\\\n/g, '\n');
}

// Every fragment of a doc card's page, in order: the page, then its sheets.
function pageFragments(scope, pageId) {
  return getPageSheetIds(null, pageId, scope)
    .map((sid) => (sid === pageId ? scope.content?.get?.(sid) : scope.sheetContent?.get?.(sid)))
    .filter((f) => f && typeof f.toArray === 'function');
}

// Where `quote` is in a doc card's pages: on `pageId` when given, else on any
// page, and in one place only, or it says why not.
//
//   { pageId, pageName, quote, ranges: [{ ytext, index, length }] } — the one place
//   { problem: 'page' }                                     — no such page
//   { problem: 'none' }                                     — not there
//   { problem: 'many', count, pages: [title, …] }           — more than once
//   { problem: 'code' }                                     — all of it code
//
// The ranges leave out what can't carry a comment (COMMENT_BARRED), as the
// editor does.
//
// Matched as foldText folds it; when the quote as given isn't there, the
// words of it read as Markdown are tried (a quote copied from fetch).
export function findQuote(cardYMap, quote, { pageId = null } = {}) {
  const scope = cardScope(cardYMap);
  const all = readPages(null, scope);
  const pages = pageId == null ? all : all.filter((p) => p.id === pageId);
  if (pageId != null && !pages.length) return { problem: 'page' };
  const laid = [];
  for (const page of pages) {
    for (const frag of pageFragments(scope, page.id)) {
      const layout = fragmentLayout(frag);
      laid.push({ page, layout, folded: foldText(layout.text) });
    }
  }
  const asked = foldText(String(quote || '')).text;
  const words = foldText(markdownWords(quote)).text;
  for (const q of [asked, words !== asked ? words : '']) {
    if (!q) continue;
    const hits = [];
    for (const one of laid) {
      for (let at = one.folded.text.indexOf(q); at >= 0; at = one.folded.text.indexOf(q, at + 1)) {
        hits.push({ ...one, start: one.folded.at[at], end: one.folded.at[at + q.length - 1] + 1 });
      }
    }
    if (hits.length > 1) {
      return { problem: 'many', count: hits.length, pages: [...new Set(hits.map((h) => h.page.name || 'Untitled'))] };
    }
    if (hits.length === 1) {
      const [{ page, layout, start, end }] = hits;
      const ranges = [];
      for (const run of layout.runs) {
        const a = Math.max(start, run.start);
        const b = Math.min(end, run.end);
        if (b <= a || run.barred) continue;
        const index = run.index + (a - run.start);
        const last = ranges[ranges.length - 1];
        // One range for what lies together in one Y.XmlText.
        if (last && last.ytext === run.ytext && last.index + last.length === index) last.length += b - a;
        else ranges.push({ ytext: run.ytext, index, length: b - a });
      }
      if (!ranges.length) return { problem: 'code' };
      return { pageId: page.id, pageName: page.name || '', quote: layout.text.slice(start, end), ranges };
    }
  }
  return { problem: 'none' };
}

// ── Writing the mark ────────────────────────────────────────────────────────

// Put thread `id`'s mark on the words findQuote found.
export function markQuote(ranges, id) {
  const key = commentMarkKey(id);
  for (const r of ranges) r.ytext.format(r.index, r.length, { [key]: { id } });
}

// Every fragment a doc card's text is in: each page and its sheets.
function docFragments(cardYMap) {
  const scope = cardScope(cardYMap);
  return readPages(null, scope).flatMap((p) => pageFragments(scope, p.id));
}

// Take thread `id`'s mark off every word it is on. Returns how many runs
// carried it.
export function unmarkThread(cardYMap, id) {
  const found = [];
  const walk = (node) => {
    if (node instanceof Y.XmlText) {
      let index = 0;
      for (const op of node.toDelta()) {
        const length = typeof op.insert === 'string' ? op.insert.length : 1;
        for (const [k, v] of Object.entries(op.attributes || {})) {
          if (isCommentKey(k) && v?.id === id) found.push({ ytext: node, index, length, key: k });
        }
        index += length;
      }
      return;
    }
    if (node instanceof Y.XmlElement) for (const child of node.toArray()) walk(child);
  };
  for (const frag of docFragments(cardYMap)) for (const node of frag.toArray()) walk(node);
  // Formatting changes no lengths, so every place found still holds.
  for (const f of found) f.ytext.format(f.index, f.length, { [f.key]: null });
  return found.length;
}
