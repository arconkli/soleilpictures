// docWrite — Markdown into a doc card's pages, for the API's doc writes
// (POST /boards/:id/docs and the …/doc/pages routes): the way in, where
// docMarkdown.js is the way out.
//
// Markdown is parsed by markdown-it into the editor's JSON, and the JSON is
// written as the very tree y-prosemirror's binding writes for it: one
// Y.XmlElement per node, named by its type, every attribute that isn't null
// set (defaults included), each run of text one Y.XmlText whose delta carries
// the marks. So the Worker carries no ProseMirror. docWrite.test.mjs holds the
// JSON to the editor's real schema and the tree to y-prosemirror's own writer,
// because a block the binding can't validate is DELETED the first time an
// editor shows it: a shape that wouldn't check is a failing test, never a doc.
//
// Changing a page keeps every block the new Markdown leaves as it was (the
// same Markdown before and after) exactly as it was: comments, colours,
// alignment, pictures and links included. Only what changed is rewritten
// (planBlockEdit).
//
// Nothing here talks to the network; the routes open the board, call these
// inside the write, and commit through the live room (lib/scoutBoard.js).

import * as Y from 'yjs';
import MarkdownIt from 'markdown-it';
import {
  addPage, cardScope, getDocMode, getPageSheetIds, initCardDocStore, pageContentMap,
  readPages, renamePage, blankFragment,
} from './docState.js';
import { addLink } from './links.js';
import { fragmentToJSON, jsonToMarkdown, resolveDocMarks, readDocPages } from './docMarkdown.js';
import { fragmentText } from './docText.js';

// One call's worth: the Markdown across every page it carries, how many pages
// it may add, how long a title may be, how many find-and-replace edits.
export const DOC_WRITE = { maxChars: 200_000, maxPages: 50, maxTitle: 200, maxEdits: 50 };

// A refusal the routes turn into a 4xx: `status` and `code` as the API's
// errors carry them.
export class DocWriteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const refuse = (message, status = 400, code = 'bad_request') => new DocWriteError(status, code, message);

// ── The schema's attributes, as y-prosemirror writes them ───────────────────
// y-prosemirror writes every attribute a node has, defaults included, except
// the null ones; and a mark's whole attrs object under the mark's name. These
// are the doc editor's (components/docExtensions/baseExtensions.js), and the
// test holds each table to the real schema.
export const NODE_ATTRS = Object.freeze({
  paragraph: { textAlign: null, spElement: null, spSceneNumber: null, spDual: null },
  heading: { textAlign: null, level: 1 },
  blockquote: {},
  bulletList: {},
  orderedList: { start: 1, type: null },
  listItem: {},
  taskList: {},
  taskItem: { checked: false },
  codeBlock: { language: null },
  horizontalRule: {},
  hardBreak: {},
  image: { src: null, alt: null, title: null, width: null, align: 'center' },
  table: {},
  tableRow: {},
  tableHeader: { colspan: 1, rowspan: 1, colwidth: null },
  tableCell: { colspan: 1, rowspan: 1, colwidth: null },
});
export const MARK_ATTRS = Object.freeze({
  bold: {}, italic: {}, strike: {}, code: {}, underline: {}, subscript: {}, superscript: {},
  highlight: { color: null },
  link: { linkId: null, href: null },
});
// The schema's mark order: ProseMirror keeps a text's marks sorted by it, and
// a node whose marks aren't is refused by check().
export const MARK_RANK = Object.freeze([
  'textStyle', 'bold', 'code', 'italic', 'strike', 'underline', 'subscript', 'superscript',
  'link', 'highlight', 'comment',
]);
const rankOf = (t) => {
  const i = MARK_RANK.indexOf(t);
  return i < 0 ? MARK_RANK.length : i;
};

// ── Markdown → tokens ───────────────────────────────────────────────────────
// CommonMark plus GitHub's tables and strikethrough, links found in bare
// http(s) addresses, and a single line break kept as one (what an assistant
// sees when it shows the same text). HTML is read only to find the few inline
// tags our own export writes (<u>, <sub>, <sup>) and their close kin; every
// other tag stays literal text, so nothing is ever rendered as markup.
let parser = null;
function markdownParser() {
  if (parser) return parser;
  const md = new MarkdownIt('default', { html: true, breaks: true, linkify: true, typographer: false });
  md.linkify.set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false });
  md.inline.ruler.after('strikethrough', 'highlight', highlightTokenize);
  md.inline.ruler2.after('strikethrough', 'highlight', highlightPostProcess);
  parser = md;
  return md;
}

// ==highlight==, which docMarkdown.js writes for a highlighted run: markdown-it's
// own ~~strikethrough~~ rule with `=` for `~`.
function highlightTokenize(state, silent) {
  const start = state.pos;
  const marker = state.src.charCodeAt(start);
  if (silent || marker !== 0x3D /* = */) return false;
  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;
  let token;
  if (len % 2) {
    token = state.push('text', '', 0);
    token.content = '=';
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    token = state.push('text', '', 0);
    token.content = '==';
    state.delimiters.push({
      marker, length: 0, token: state.tokens.length - 1, end: -1,
      open: scanned.can_open, close: scanned.can_close,
    });
  }
  state.pos += scanned.length;
  return true;
}

function highlightPairs(state, delimiters) {
  const lone = [];
  for (const startDelim of delimiters) {
    if (startDelim.marker !== 0x3D || startDelim.end === -1) continue;
    const endDelim = delimiters[startDelim.end];
    Object.assign(state.tokens[startDelim.token], { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' });
    Object.assign(state.tokens[endDelim.token], { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' });
    const before = state.tokens[endDelim.token - 1];
    if (before.type === 'text' && before.content === '=') lone.push(endDelim.token - 1);
  }
  while (lone.length) {
    const i = lone.pop();
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++;
    j--;
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
  }
}

function highlightPostProcess(state) {
  highlightPairs(state, state.delimiters);
  for (const meta of state.tokens_meta) if (meta?.delimiters) highlightPairs(state, meta.delimiters);
}

// Markdown → markdown-it's tokens. What a block becomes can depend on the board
// (which pictures may be placed, see tokensToDoc), so a write parses before it
// opens the board and builds the blocks once it has.
export function parseMarkdown(markdown) {
  return markdownParser().parse(String(markdown ?? '').replace(/\r\n?/g, '\n'), {});
}

// ── tokens → the editor's JSON ──────────────────────────────────────────────

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
// A picture may be placed only from a file already in the cluster (`r2:` and
// its storage key, as the board's image cards and the doc's own pictures hold
// it); any other source becomes a link to it, or just its text.
const INLINE_HTML = {
  u: 'underline', ins: 'underline', sub: 'subscript', sup: 'superscript', mark: 'highlight',
  s: 'strike', del: 'strike', strike: 'strike', b: 'bold', strong: 'bold', i: 'italic', em: 'italic',
};
const HTML_TAG = /^<\s*(\/?)\s*([a-z]+)\b[^>]*?(\/?)\s*>$/i;

function textNode(text, marks) {
  if (!text) return null;
  const seen = new Map();
  for (const m of marks) if (m.type !== 'nolink') seen.set(m.type, m);   // the innermost of a type wins
  let list = [...seen.values()];
  // `code` excludes every other mark in this schema.
  if (seen.has('code')) list = [{ type: 'code' }];
  list.sort((a, b) => rankOf(a.type) - rankOf(b.type));
  const node = { type: 'text', text };
  if (list.length) node.marks = list.map((m) => (m.type === 'link' ? { type: 'link', attrs: { href: m.href }, ref: m.ref } : { type: m.type }));
  return node;
}

// Inline tokens → inline nodes (pictures still among them; a paragraph lifts
// those out when it closes).
function inlineNodes(children, ctx) {
  const out = [];
  const marks = [];
  const drop = (type) => {
    for (let i = marks.length - 1; i >= 0; i--) if (marks[i].type === type) { marks.splice(i, 1); return; }
  };
  const push = (n) => { if (n) out.push(n); };
  for (const t of children) {
    switch (t.type) {
      case 'text': case 'text_special': push(textNode(t.content, marks)); break;
      case 'softbreak': case 'hardbreak': out.push({ type: 'hardBreak' }); break;
      case 'code_inline': push(textNode(t.content, [...marks, { type: 'code' }])); break;
      case 'strong_open': marks.push({ type: 'bold' }); break;
      case 'strong_close': drop('bold'); break;
      case 'em_open': marks.push({ type: 'italic' }); break;
      case 'em_close': drop('italic'); break;
      case 's_open': marks.push({ type: 'strike' }); break;
      case 's_close': drop('strike'); break;
      case 'mark_open': marks.push({ type: 'highlight' }); break;
      case 'mark_close': drop('highlight'); break;
      case 'link_open': {
        const href = String(t.attrGet('href') || '');
        marks.push(SAFE_HREF.test(href) ? { type: 'link', href, ref: ++ctx.refs } : { type: 'nolink' });
        break;
      }
      case 'link_close': {
        const i = marks.findLastIndex((m) => m.type === 'link' || m.type === 'nolink');
        if (i >= 0) marks.splice(i, 1);
        break;
      }
      case 'image': {
        const src = String(t.attrGet('src') || '');
        const alt = t.content || '';
        // imageAllowed answers true, or the src to place instead (a bare key
        // spelled as the board holds it).
        const placed = !ctx.inHeading && ctx.imageAllowed(src);
        if (placed) {
          const attrs = { src: typeof placed === 'string' ? placed : src };
          if (alt) attrs.alt = alt;
          const title = t.attrGet('title');
          if (title) attrs.title = String(title);
          out.push({ type: 'image', attrs });
        } else if (SAFE_HREF.test(src)) {
          push(textNode(alt || src, [...marks.filter((m) => m.type !== 'link' && m.type !== 'nolink'),
            { type: 'link', href: src, ref: ++ctx.refs }]));
        } else {
          push(textNode(alt, marks));
        }
        break;
      }
      case 'html_inline': {
        const m = HTML_TAG.exec(t.content || '');
        const tag = m?.[2]?.toLowerCase();
        if (tag === 'br') out.push({ type: 'hardBreak' });
        else if (tag && INLINE_HTML[tag] && !m[3]) {
          if (m[1]) drop(INLINE_HTML[tag]);
          else marks.push({ type: INLINE_HTML[tag] });
        } else push(textNode(t.content, marks));
        break;
      }
      default:
        if (t.content) push(textNode(t.content, marks));
    }
  }
  return mergeText(out);
}

// Adjacent text with the same marks is one text node, as ProseMirror keeps it,
// and spaces either side of a line break go, as Markdown drops them around
// its own.
function mergeText(nodes) {
  const out = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text' && sameMarks(last.marks, n.marks)) {
      out[out.length - 1] = { ...last, text: last.text + n.text };
    } else out.push(n);
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i].type !== 'hardBreak') continue;
    if (out[i - 1]?.type === 'text') out[i - 1] = { ...out[i - 1], text: out[i - 1].text.replace(/[ \t]+$/, '') };
    if (out[i + 1]?.type === 'text') out[i + 1] = { ...out[i + 1], text: out[i + 1].text.replace(/^[ \t]+/, '') };
  }
  return out.filter((n) => n.type !== 'text' || n.text);
}
const markKey = (m) => `${m.type}:${m.ref ?? ''}:${m.attrs?.href ?? ''}`;
const sameMarks = (a = [], b = []) => a.length === b.length && a.every((m, i) => markKey(m) === markKey(b[i]));

const LANG = /^[\w+#.-]{1,40}$/;
function codeBlock(t) {
  const lang = t.type === 'fence' ? String(t.info || '').trim().split(/\s+/)[0] : '';
  const text = String(t.content || '').replace(/\n$/, '');
  const node = { type: 'codeBlock' };
  if (lang && LANG.test(lang)) node.attrs = { language: lang };
  if (text) node.content = [{ type: 'text', text }];
  return node;
}

// Text kept as it was written, a line to a line: a block of HTML. (Markdown
// reads such a block raw, so the backslash docMarkdown.js ends each of its
// lines with comes back as text, and goes.)
function literalParagraph(text) {
  const content = [];
  String(text || '').replace(/\n+$/, '').split('\n').forEach((line, i) => {
    if (i) content.push({ type: 'hardBreak' });
    const words = line.replace(/\\?[ \t]*$/, '');
    if (words) content.push({ type: 'text', text: words });
  });
  return { type: 'paragraph', content };
}

const TASK = /^\[([ xX])\](?:[ \t]+|$)/;

// A node as the schema wants it, once its content is in; returns what takes
// its place (a paragraph holding a picture becomes three blocks).
function finish(node) {
  switch (node.type) {
    case 'paragraph': {
      if (!node.content.some((c) => c.type === 'image')) return [node];
      const out = [];
      let run = [];
      const flush = () => {
        const content = trimEdges(run);
        if (content.length) out.push({ ...node, content });
        run = [];
      };
      for (const c of node.content) {
        if (c.type === 'image') { flush(); out.push(c); } else run.push(c);
      }
      flush();
      return out;
    }
    case 'listItem':
    case 'taskItem': {
      const [first] = node.content;
      if (!first) node.content = [{ type: 'paragraph', content: [] }];
      else if (first.type === 'heading') node.content[0] = { type: 'paragraph', content: first.content };
      else if (first.type !== 'paragraph') node.content.unshift({ type: 'paragraph', content: [] });
      return [node];
    }
    case 'bulletList': {
      const tasks = node.content.map((li) => {
        const t = li.content[0]?.content?.[0];
        return t?.type === 'text' && !t.marks ? TASK.exec(t.text) : null;
      });
      if (!tasks.length || !tasks.every(Boolean)) return [node];
      return [{
        type: 'taskList',
        content: node.content.map((li, i) => {
          const para = li.content[0];
          const rest = para.content[0].text.slice(tasks[i][0].length);
          const content = rest ? [{ ...para.content[0], text: rest }, ...para.content.slice(1)] : para.content.slice(1);
          return { type: 'taskItem', attrs: { checked: tasks[i][1] !== ' ' }, content: [{ ...para, content }, ...li.content.slice(1)] };
        }),
      }];
    }
    case 'blockquote':
    case 'tableHeader':
    case 'tableCell':
      if (!node.content.length) node.content = [{ type: 'paragraph', content: [] }];
      return [node];
    default:
      return [node];
  }
}

// Spaces left at the edges of text a picture was lifted out of.
function trimEdges(nodes) {
  const out = nodes.slice();
  while (out[0]?.type === 'hardBreak') out.shift();
  while (out[out.length - 1]?.type === 'hardBreak') out.pop();
  if (out[0]?.type === 'text') out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') };
  const last = out.length - 1;
  if (out[last]?.type === 'text') out[last] = { ...out[last], text: out[last].text.replace(/\s+$/, '') };
  return out.filter((n) => n.type !== 'text' || n.text);
}

const ALIGN = /text-align:\s*(left|center|right)/i;

// markdown-it's tokens → { type: 'doc', content: [blocks] }. `imageAllowed(src)`
// says whether a picture may be placed from that source. Link marks come out
// as { type: 'link', attrs: { href }, ref } — one `ref` per link written, which
// bindLinks turns into the app's link records.
export function tokensToDoc(tokens, { imageAllowed = () => false } = {}) {
  const root = { type: 'doc', content: [] };
  const stack = [root];
  const ctx = { refs: 0, imageAllowed, inHeading: false };
  const top = () => stack[stack.length - 1];
  const open = (node) => { node.content = []; top().content.push(node); stack.push(node); };
  const close = () => {
    if (stack.length < 2) return;
    const node = stack.pop();
    const siblings = top().content;
    siblings.splice(siblings.lastIndexOf(node), 1, ...finish(node));
  };
  for (const t of tokens) {
    switch (t.type) {
      case 'paragraph_open': open({ type: 'paragraph' }); break;
      case 'heading_open': open({ type: 'heading', attrs: { level: Math.min(6, Math.max(1, Number(t.tag.slice(1)) || 1)) } }); break;
      case 'blockquote_open': open({ type: 'blockquote' }); break;
      case 'bullet_list_open': open({ type: 'bulletList' }); break;
      case 'ordered_list_open': {
        const start = Number(t.attrGet('start'));
        open({ type: 'orderedList', ...(Number.isInteger(start) && start >= 0 && start !== 1 ? { attrs: { start } } : {}) });
        break;
      }
      case 'list_item_open': open({ type: 'listItem' }); break;
      case 'table_open': open({ type: 'table' }); break;
      case 'tr_open': open({ type: 'tableRow' }); break;
      case 'th_open':
      case 'td_open': {
        const cell = { type: t.type === 'th_open' ? 'tableHeader' : 'tableCell' };
        open(cell);
        const align = ALIGN.exec(String(t.attrGet('style') || ''))?.[1]?.toLowerCase();
        if (align) Object.defineProperty(cell, 'align', { value: align, enumerable: false });
        break;
      }
      case 'paragraph_close': case 'heading_close': case 'blockquote_close':
      case 'bullet_list_close': case 'ordered_list_close': case 'list_item_close':
      case 'table_close': case 'tr_close': case 'th_close': case 'td_close':
        close();
        break;
      case 'fence': case 'code_block': top().content.push(codeBlock(t)); break;
      case 'hr': top().content.push({ type: 'horizontalRule' }); break;
      case 'html_block': top().content.push(literalParagraph(t.content)); break;
      case 'inline': {
        const host = top();
        ctx.inHeading = host.type === 'heading';
        const nodes = inlineNodes(t.children || [], ctx);
        ctx.inHeading = false;
        if (host.type === 'tableHeader' || host.type === 'tableCell') {
          // A cell's text arrives bare; the schema wants it in a paragraph.
          open(host.align ? { type: 'paragraph', attrs: { textAlign: host.align } } : { type: 'paragraph' });
          top().content.push(...nodes);
          close();
        } else host.content.push(...nodes);
        break;
      }
      default: break;
    }
  }
  while (stack.length > 1) close();
  return root;
}

export function markdownToDoc(markdown, opts) {
  return tokensToDoc(parseMarkdown(markdown), opts);
}

// ── Links ───────────────────────────────────────────────────────────────────
// A link in the app is a record in the board's links map (lib/links.js) and a
// mark naming it: { linkId }. Each link written gets its own record, as the
// editor makes one per link. Returns the blocks with their marks bound, and
// the records still to be added, by id.
export function bindLinks(blocks, newId = () => crypto.randomUUID()) {
  const ids = new Map();
  const links = [];
  const walk = (n) => {
    if (n.type === 'text' && n.marks) {
      return {
        ...n,
        marks: n.marks.map((m) => {
          if (m.type !== 'link') return m;
          let id = ids.get(m.ref);
          if (!id) {
            id = newId();
            ids.set(m.ref, id);
            links.push({ id, href: m.attrs.href });
          }
          return { type: 'link', attrs: { linkId: id, href: null } };
        }),
      };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return { blocks: blocks.map(walk), links };
}

// Where each of `ids`' text sits in a page made of `blocks`, in ProseMirror
// positions, for the link record's anchor (which the app reads, and never
// moves after).
export function linkAnchors(blocks, ids) {
  const at = new Map();
  let pos = 0;
  const LEAF = new Set(['hardBreak', 'horizontalRule', 'image', 'boardEmbed']);
  const walk = (n) => {
    if (n.type === 'text') {
      const link = n.marks?.find((m) => m.type === 'link' && ids.has(m.attrs?.linkId));
      if (link) {
        const id = link.attrs.linkId;
        const cur = at.get(id);
        at.set(id, { from: cur ? cur.from : pos, to: pos + n.text.length });
      }
      pos += n.text.length;
      return;
    }
    if (LEAF.has(n.type)) { pos += 1; return; }
    pos += 1;
    for (const c of n.content || []) walk(c);
    pos += 1;
  };
  for (const b of blocks) walk(b);
  return at;
}

// ── JSON → Yjs, as y-prosemirror writes it ──────────────────────────────────

function markAttributes(marks = []) {
  const out = {};
  for (const m of marks) out[m.type] = { ...(MARK_ATTRS[m.type] || {}), ...(m.attrs || {}) };
  return out;
}

export function jsonToYNode(node) {
  const el = new Y.XmlElement(node.type);
  const attrs = { ...(NODE_ATTRS[node.type] || {}), ...(node.attrs || {}) };
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  const kids = [];
  const content = node.content || [];
  for (let i = 0; i < content.length; i++) {
    if (content[i].type !== 'text') { kids.push(jsonToYNode(content[i])); continue; }
    const run = [];
    while (i < content.length && content[i].type === 'text') run.push(content[i++]);
    i--;
    const text = new Y.XmlText();
    text.applyDelta(run.map((n) => ({ insert: n.text, attributes: markAttributes(n.marks) })));
    kids.push(text);
  }
  if (kids.length) el.insert(0, kids);
  return el;
}

// ── Keeping what didn't change ──────────────────────────────────────────────

// A block's Markdown on its own: what a page's blocks are matched by.
export function blockKey(block) {
  return jsonToMarkdown({ type: 'doc', content: [block] }).trim();
}

// Each block a page holds now, as JSON and keyed by its Markdown as a reader
// gets it (links resolved, comments left out); the key of a block with no
// Markdown (an empty one, or one Markdown has no words for) is null, which
// nothing matches.
export function pageBlocks(ydoc, frag) {
  return (frag?.toArray() || []).map((child) => {
    const one = { toArray: () => [child] };
    const json = fragmentToJSON(one).content;
    return {
      json,
      key: blankFragment(one) ? null : jsonToMarkdown(resolveDocMarks({ type: 'doc', content: json }, ydoc)).trim() || null,
    };
  });
}

// Past this many pairs to compare, the changed middle of a page is rewritten
// whole rather than matched block by block.
const LCS_MAX = 1_000_000;

// How to turn blocks keyed `oldKeys` into blocks keyed `newKeys`, keeping
// every old block that a new one matches, in order (a longest common
// subsequence). Between two kept blocks, a stretch the new Markdown leaves
// unchanged holds only empty blocks, which Markdown can't write, so those stay
// too. Returns `keep` (old indices) and `seq`, the page as it will be, each
// entry { old: i } or { new: j }.
export function planBlockEdit(oldKeys, newKeys) {
  const n = oldKeys.length;
  const m = newKeys.length;
  const same = (i, j) => oldKeys[i] !== null && oldKeys[i] === newKeys[j];
  const pairs = [];
  let lo = 0;
  while (lo < n && lo < m && same(lo, lo)) { pairs.push([lo, lo]); lo++; }
  let hiO = n;
  let hiN = m;
  const tail = [];
  while (hiO > lo && hiN > lo && same(hiO - 1, hiN - 1)) { hiO--; hiN--; tail.unshift([hiO, hiN]); }
  const a = hiO - lo;
  const b = hiN - lo;
  if (a && b && a * b <= LCS_MAX) {
    const w = b + 1;
    const len = new Uint32Array((a + 1) * w);
    for (let i = a - 1; i >= 0; i--) {
      for (let j = b - 1; j >= 0; j--) {
        len[i * w + j] = same(lo + i, lo + j)
          ? len[(i + 1) * w + j + 1] + 1
          : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a && j < b) {
      if (same(lo + i, lo + j)) { pairs.push([lo + i, lo + j]); i++; j++; } else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++; else j++;
    }
  }
  pairs.push(...tail);

  const keep = new Set();
  const seq = [];
  let po = 0;
  let pn = 0;
  const region = (endO, endN) => {
    const olds = [];
    for (let i = po; i < endO; i++) olds.push(i);
    if (endN === pn && olds.every((i) => oldKeys[i] === null)) {
      for (const i of olds) { keep.add(i); seq.push({ old: i }); }
    } else {
      for (let j = pn; j < endN; j++) seq.push({ new: j });
    }
  };
  for (const [i, j] of pairs) {
    region(i, j);
    keep.add(i);
    seq.push({ old: i });
    po = i + 1;
    pn = j + 1;
  }
  region(n, m);
  return { keep, seq };
}

// ── Doc cards ───────────────────────────────────────────────────────────────

// Whether a card's doc can be written here, or why not.
export function docProblem(ydoc, cardYMap) {
  if (!cardYMap || typeof cardYMap.get !== 'function') return null;
  if ((cardYMap.get('kind') || 'note') !== 'doc') return `a ${cardYMap.get('kind') || 'note'}, not a doc`;
  if (!cardYMap.get('docPages')) return null;   // no store yet: one is made on the write
  if (getDocMode(ydoc, cardScope(cardYMap)) === 'screenplay') {
    return 'a screenplay; the API writes prose docs, so a screenplay is edited in the app';
  }
  return null;
}

// The pictures a doc on this board may place: every file the board's image
// cards show, and every picture already in this doc.
export function placeableImages(cards, cardYMap) {
  const srcs = new Set();
  for (const c of cards || []) {
    if ((c.kind === 'image') && typeof c.src === 'string' && c.src.startsWith('r2:')) srcs.add(c.src);
  }
  const content = cardYMap?.get?.('docPageContent');
  const walk = (n) => {
    if (n instanceof Y.XmlElement) {
      if (n.nodeName === 'image') {
        const src = n.getAttribute('src');
        if (typeof src === 'string' && src.startsWith('r2:')) srcs.add(src);
      }
      for (const c of n.toArray()) walk(c);
    }
  };
  if (content && typeof content.forEach === 'function') content.forEach((frag) => { for (const c of frag?.toArray?.() || []) walk(c); });
  return srcs;
}

const clipTitle = (s) => String(s ?? '').trim().slice(0, DOC_WRITE.maxTitle);

// The pages a write carries, checked before anything is opened: an array of
// { title, markdown }, within DOC_WRITE. Returns them with their tokens.
export function preparePages(pages) {
  if (!Array.isArray(pages) || !pages.length) throw refuse('pages is required: [{ title, markdown }]');
  if (pages.length > DOC_WRITE.maxPages) throw refuse(`at most ${DOC_WRITE.maxPages} pages per call`);
  let chars = 0;
  return pages.map((p, i) => {
    if (!p || typeof p !== 'object') throw refuse(`pages[${i}] must be an object: { title, markdown }`);
    if (p.markdown != null && typeof p.markdown !== 'string') throw refuse(`pages[${i}].markdown must be a string`);
    const markdown = p.markdown || '';
    chars += markdown.length;
    if (chars > DOC_WRITE.maxChars) throw refuse(`at most ${DOC_WRITE.maxChars} characters of Markdown per call; send the rest in another`, 413, 'payload_too_large');
    const tokens = parseMarkdown(markdown);
    // A page with no title takes its first heading's words, as a reader would.
    const heading = tokens.findIndex((t) => t.type === 'heading_open');
    const fallback = heading >= 0 ? tokens[heading + 1]?.children?.map((c) => c.content || '').join('') : '';
    return { title: clipTitle(p.title) || clipTitle(fallback) || 'Untitled', tokens };
  });
}

// Write `pages` (from preparePages) into a doc card as new pages, after any it
// has, or under `parentId`. Makes the card's store first if it has none.
// Returns each new page as a reader sees it now: { id, title, parent_id,
// depth, chars, hash }, and the text the page index wants.
export function writePages(ydoc, cardYMap, pages, { parentId = null, userId = null, imageAllowed, newId } = {}) {
  initCardDocStore(ydoc, cardYMap);
  const scope = cardScope(cardYMap);
  if (parentId && !readPages(ydoc, scope).some((p) => p.id === parentId)) {
    throw refuse(`this doc has no page ${parentId}`, 404, 'not_found');
  }
  const made = [];
  for (const p of pages) {
    const doc = tokensToDoc(p.tokens, { imageAllowed });
    const { blocks, links } = bindLinks(doc.content, newId);
    const pageId = addPage(ydoc, { name: p.title, parent_id: parentId, scope });
    const frag = pageContentMap(ydoc, scope).get(pageId);
    if (blocks.length) frag.insert(0, blocks.map(jsonToYNode));
    addLinks(ydoc, links, { pageId, blocks, userId });
    made.push(pageId);
  }
  return made.map((id) => pageSummary(ydoc, scope, id));
}

function addLinks(ydoc, links, { pageId, blocks, userId }) {
  if (!links.length) return;
  const anchors = linkAnchors(blocks, new Set(links.map((l) => l.id)));
  for (const l of links) {
    addLink(ydoc, {
      id: l.id, pageId, anchor: anchors.get(l.id) || { from: 0, to: 0 },
      targets: [{ kind: 'url', href: l.href }], createdBy: userId || null,
    });
  }
}

function pageSummary(ydoc, scope, pageId) {
  const read = readDocPages(ydoc, scope, { pageId });
  const { markdown: _m, truncated: _t, ...page } = read.pages[0];
  const frag = pageContentMap(ydoc, scope).get(pageId);
  return { ...page, text: fragmentText(frag) };
}

// One page's Markdown and hash as a reader gets them now, or null.
export function currentPage(ydoc, cardYMap, pageId) {
  const scope = cardScope(cardYMap);
  const read = scope.pages ? readDocPages(ydoc, scope, { pageId }) : null;
  return read?.pages?.[0] || null;
}

// Apply find-and-replace `edits` ([{ old_text, new_text }]) to a page's
// Markdown, each old_text found exactly once, in order.
export function applyTextEdits(markdown, edits) {
  if (!Array.isArray(edits) || !edits.length) throw refuse('edits must be a non-empty array of { old_text, new_text }');
  if (edits.length > DOC_WRITE.maxEdits) throw refuse(`at most ${DOC_WRITE.maxEdits} edits per call`);
  let out = markdown;
  edits.forEach((e, i) => {
    const from = e?.old_text;
    const to = e?.new_text ?? '';
    if (typeof from !== 'string' || !from) throw refuse(`edits[${i}].old_text must be non-empty text from the page`);
    if (typeof to !== 'string') throw refuse(`edits[${i}].new_text must be a string`);
    const at = out.indexOf(from);
    if (at < 0) throw refuse(`edits[${i}].old_text is not on the page as it is now; read the page again and copy the text exactly`);
    if (out.indexOf(from, at + 1) >= 0) throw refuse(`edits[${i}].old_text appears more than once; include more of the text around it`);
    out = out.slice(0, at) + to + out.slice(at + from.length);
  });
  if (out.length > DOC_WRITE.maxChars) throw refuse(`a page holds at most ${DOC_WRITE.maxChars} characters of Markdown through the API`, 413, 'payload_too_large');
  return out;
}

// One page's Markdown, checked and parsed.
export function pageMarkdown(markdown) {
  if (typeof markdown !== 'string') throw refuse('markdown must be a string');
  if (markdown.length > DOC_WRITE.maxChars) {
    throw refuse(`a page holds at most ${DOC_WRITE.maxChars} characters of Markdown through the API`, 413, 'payload_too_large');
  }
  return parseMarkdown(markdown);
}

// What rewriting page `pageId` would do, without doing it: the blocks it holds
// now, what `tokens` parse to, the plan between them, a new name when `title`
// differs from the page's, and whether anything would change at all. `tokens`
// null leaves the content as it is (a rename). Refuses a page that still holds
// a legacy second sheet (opening the doc in the app joins them).
export function planPageEdit(ydoc, cardYMap, pageId, tokens, { title = null, imageAllowed } = {}) {
  const scope = cardScope(cardYMap);
  const page = readPages(ydoc, scope).find((p) => p.id === pageId);
  if (!page) throw refuse('this doc has no such page', 404, 'not_found');
  if (getPageSheetIds(ydoc, pageId, scope).length > 1) {
    throw refuse('this page is from an older layout; open the doc in the app once, then try again', 409, 'conflict');
  }
  const old = pageBlocks(ydoc, pageContentMap(ydoc, scope).get(pageId));
  const doc = tokens ? tokensToDoc(tokens, { imageAllowed }) : null;
  const plan = doc ? planBlockEdit(old.map((b) => b.key), doc.content.map(blockKey)) : null;
  const name = clipTitle(title);
  const rename = name && name !== (page.name || '') ? name : null;
  const same = !plan || (plan.keep.size === old.length && plan.seq.length === old.length);
  return { scope, old, doc, plan, rename, unchanged: same && !rename };
}

// Rewrite a page's content as `tokens` say it should now read, keeping every
// block whose Markdown didn't change, and rename it when `title` is given.
// Returns the page as a reader sees it now and what happened to its blocks.
export function rewritePage(ydoc, cardYMap, pageId, tokens, { title = null, userId = null, imageAllowed, newId } = {}) {
  const { scope, old, doc, plan, rename } = planPageEdit(ydoc, cardYMap, pageId, tokens, { title, imageAllowed });
  let blocks = { kept: old.length, removed: 0, added: 0 };
  if (plan) {
    const content = pageContentMap(ydoc, scope);
    let frag = content.get(pageId);
    if (!frag) {
      frag = new Y.XmlFragment();
      content.set(pageId, frag);
    }
    const fresh = plan.seq.filter((e) => e.new !== undefined).map((e) => doc.content[e.new]);
    const { blocks: bound, links } = bindLinks(fresh, newId);
    const boundAt = new Map(plan.seq.filter((e) => e.new !== undefined).map((e, k) => [e.new, bound[k]]));

    for (let i = old.length - 1; i >= 0; i--) if (!plan.keep.has(i)) frag.delete(i, 1);
    let at = 0;
    for (const e of plan.seq) {
      if (e.new !== undefined) frag.insert(at, [jsonToYNode(boundAt.get(e.new))]);
      at++;
    }
    const finalBlocks = plan.seq.map((e) => (e.old !== undefined ? old[e.old].json[0] : boundAt.get(e.new))).filter(Boolean);
    addLinks(ydoc, links, { pageId, blocks: finalBlocks, userId });
    blocks = { kept: plan.keep.size, removed: old.length - plan.keep.size, added: fresh.length };
  }
  if (rename) renamePage(ydoc, pageId, rename, scope);
  return { page: pageSummary(ydoc, scope, pageId), blocks };
}
