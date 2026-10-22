// The doc editor's decoration plugins must not re-walk the whole document on a
// transaction that changes nothing but the selection (DOCS-11): a caret move or
// a held arrow key used to re-run the entity trie over every text node and
// JSON.stringify every match, and rebuild every link badge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import { makeAutoDetectPlugin, AUTO_DETECT_KEY } from '../components/docExtensions/AutoDetectPlugin.js';
import { makeCandidateNamePlugin, CANDIDATE_NAME_KEY } from '../components/docExtensions/CandidateNamePlugin.js';
import { createNameIndex } from './entityNameTrie.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
  },
  marks: { link: { attrs: { linkId: { default: null } } }, code: {} },
});

// A stand-in for the entity trie that counts how often it is consulted.
function countingIndex(name) {
  const index = {
    calls: 0,
    *findMatches(text) {
      index.calls++;
      let i = text.indexOf(name);
      while (i !== -1) {
        yield { start: i, end: i + name.length, records: [{ id: 'e1', name }] };
        i = text.indexOf(name, i + name.length);
      }
    },
  };
  return index;
}

function makeState(index) {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('Ada met Bob.')]),
    schema.node('paragraph', null, [schema.text('Later, Ada left.')]),
  ]);
  const plugin = makeAutoDetectPlugin({ getIndex: () => index });
  return { state: EditorState.create({ schema, doc, plugins: [plugin] }), plugin };
}

test('auto-detect decorates matches on init', () => {
  const index = countingIndex('Ada');
  const { state } = makeState(index);
  const decos = AUTO_DETECT_KEY.getState(state).set.find();
  assert.equal(decos.length, 2);
});

test('a selection-only transaction does not re-walk the doc', () => {
  const index = countingIndex('Ada');
  const { state } = makeState(index);
  const before = index.calls;
  const moved = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)));
  assert.equal(index.calls, before, 'caret move re-ran the trie');
  assert.equal(AUTO_DETECT_KEY.getState(moved), AUTO_DETECT_KEY.getState(state), 'decorations kept as-is');
});

test('a doc change, or the refresh meta, recomputes', () => {
  const index = countingIndex('Ada');
  const { state } = makeState(index);
  let calls = index.calls;
  const typed = state.apply(state.tr.insertText('Ada ', 1));
  assert.ok(index.calls > calls, 'doc change did not recompute');
  assert.equal(AUTO_DETECT_KEY.getState(typed).set.find().length, 3);
  calls = index.calls;
  state.apply(state.tr.setMeta(AUTO_DETECT_KEY, true));
  assert.ok(index.calls > calls, 'refresh meta did not recompute');
});

// The applied-tag-range boxes move with the text, and the owner used to refresh
// them only after the plugin's apply — so a doc change was suppressed against
// boxes one edit old. The plugin must ask for the ranges of the doc it builds.
test('auto-detect suppresses under applied ranges of the NEW doc', () => {
  const index = countingIndex('Ada');
  // A box over the second paragraph's "Ada", computed from whichever doc is
  // passed in (as DocPageEditor's refreshAppliedRangeBoxes now does).
  const boxesFor = (doc) => {
    let box = null;
    doc.forEach((node, offset, i) => {
      if (i !== 1) return;
      const at = node.textContent.indexOf('Ada');
      box = { from: offset + 1 + at, to: offset + 1 + at + 3 };
    });
    return box ? [box] : [];
  };
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('Ada met Bob.')]),
    schema.node('paragraph', null, [schema.text('Later, Ada left.')]),
  ]);
  const plugin = makeAutoDetectPlugin({ getIndex: () => index, getAppliedRangeSet: boxesFor });
  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  assert.equal(AUTO_DETECT_KEY.getState(state).set.find().length, 1, 'covered match suppressed');
  // A paste above shifts the covered "Ada"; suppression must follow it.
  const pasted = state.apply(state.tr.insertText('A long pasted line. ', 1));
  const decos = AUTO_DETECT_KEY.getState(pasted).set.find();
  assert.equal(decos.length, 1, 'still exactly one hairline (the uncovered first "Ada")');
  assert.equal(pasted.doc.textBetween(decos[0].from, decos[0].to), 'Ada');
  assert.ok(decos[0].from < pasted.doc.child(0).nodeSize, 'the hairline is in the first paragraph');
});

// ── A key re-reads the paragraph it typed into, not the document ───────────
// Both underline plugins used to re-run the trie over every text node of the
// doc on every keystroke (a few ms each in a 40-page doc, per key). Now they
// move what an edit didn't touch and decorate afresh only the textblocks it
// did — found by comparing the two docs, so a collaborator's change, which
// y-prosemirror applies as a replace of the whole document, costs the same.

const rich = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    blockquote: { group: 'block', content: 'block+' },
    codeBlock: { group: 'block', content: 'text*', code: true, marks: '' },
    text: { group: 'inline' },
    hardBreak: { group: 'inline', inline: true },
  },
  marks: { link: { attrs: { linkId: { default: null } } }, code: {}, bold: {} },
});

function names(...list) {
  const index = createNameIndex();
  list.forEach((name, i) => index.add({ kind: 'card', id: `e${i}`, name }));
  return index;
}
// The real trie, counting the text nodes it is asked to read.
function counted(index) {
  const c = { reads: 0, findMatches(text) { c.reads++; return index.findMatches(text); },
    longestMatchAt: (text, at) => index.longestMatchAt(text, at) };
  return c;
}
const para = (text) => rich.node('paragraph', null, text ? [rich.text(text)] : []);
const threeParas = () => rich.node('doc', null, [
  para('Ada met Bob at noon.'), para('Bob wrote to Ada.'), para('Later, Ada Lovelace left.'),
]);
// Where the second paragraph's text starts.
const secondStart = (doc) => doc.child(0).nodeSize + 1;

const PLUGINS = [
  ['auto-detect', AUTO_DETECT_KEY, (index, extra = {}) => makeAutoDetectPlugin({ getIndex: () => index, ...extra })],
  ['candidate names', CANDIDATE_NAME_KEY, (index, extra = {}) => makeCandidateNamePlugin({ getIndex: () => index, ...extra })],
];
const setOf = (key, state) => {
  const s = key.getState(state);
  return s.set || s;
};

for (const [label, key, make] of PLUGINS) {
  test(`${label}: typing into one paragraph re-reads only that paragraph`, () => {
    const index = counted(names('Ada', 'Bob'));
    let state = EditorState.create({ schema: rich, doc: threeParas(), plugins: [make(index)] });
    state = state.apply(state.tr.insertText('Ada ', 1)); // the first build, if the plugin waits for one
    const before = index.reads;
    state = state.apply(state.tr.insertText('Ada ', secondStart(state.doc)));
    assert.equal(index.reads - before, 1, 'one text node read');
    const texts = setOf(key, state).find().map((d) => state.doc.textBetween(d.from, d.to));
    assert.equal(texts.filter((t) => t === 'Ada').length, 5);
  });

  test(`${label}: a collaborator's edit, applied as a whole-document replace, re-reads only what changed`, () => {
    const index = counted(names('Ada', 'Bob'));
    let state = EditorState.create({ schema: rich, doc: threeParas(), plugins: [make(index)] });
    state = state.apply(state.tr.insertText('Ada ', 1));
    // Their doc: ours with one word typed into the second paragraph. Every
    // other paragraph is the same node object, as y-prosemirror keeps them.
    const theirs = state.apply(state.tr.insertText('Bob ', secondStart(state.doc))).doc;
    const before = index.reads;
    state = state.apply(state.tr.replaceWith(0, state.doc.content.size, theirs.content));
    assert.equal(index.reads - before, 1, 'one text node read');
    const fresh = EditorState.create({ schema: rich, doc: state.doc, plugins: [make(names('Ada', 'Bob'))] });
    assert.deepEqual(shape(setOf(key, state)), shape(setOf(key, fresh.apply(fresh.tr.setMeta(key, true)))));
  });

  test(`${label}: a new index is read over the whole document at the next edit`, () => {
    let index = counted(names('Ada'));
    const plugin = make(null, { getIndex: () => index });
    let state = EditorState.create({ schema: rich, doc: threeParas(), plugins: [plugin] });
    state = state.apply(state.tr.insertText('x', 1));
    index = counted(names('Ada', 'Bob'));
    state = state.apply(state.tr.insertText('y', 1));
    assert.equal(index.reads, 3, 'every text node read with the new index');
    const texts = setOf(key, state).find().map((d) => state.doc.textBetween(d.from, d.to));
    assert.ok(texts.includes('Bob'), 'the new name is underlined in a paragraph the edit never touched');
  });
}

// Decorations as comparable data: where, and what they say.
const shape = (set) => set.find()
  .map((d) => `${d.from}-${d.to} ${JSON.stringify(d.type.attrs)}`)
  .sort();

// A seeded generator, so a failure is a sequence that can be replayed.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Every text position (inside a textblock) of a doc.
function textPositions(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (let i = 0; i <= node.content.size; i++) out.push(pos + 1 + i);
    return false;
  });
  return out;
}
function textblocks(doc) {
  const out = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) { out.push({ node, pos }); return false; }
    return true;
  });
  return out;
}

const SNIPPETS = ['Ada', ' Ada ', 'Bob', ' bob.', 'Ada Lovelace', 'Lovelace ', 'x', ' ', 'tagged ', 'Ad', 'a'];

// One random edit to `state`, as a transaction (null when it can't apply).
function randomEdit(state, rand) {
  const { doc, tr } = state;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const positions = textPositions(doc);
  const blocks = textblocks(doc);
  const kind = Math.floor(rand() * 11);
  try {
    if (kind <= 2) return tr.insertText(pick(SNIPPETS), pick(positions));
    if (kind === 3) {
      const a = pick(positions), b = pick(positions);
      return a === b ? null : tr.delete(Math.min(a, b), Math.max(a, b));
    }
    if (kind === 4) return tr.split(pick(positions));
    if (kind === 5 || kind === 6) {
      const { node, pos } = pick(blocks);
      if (node.type.name === 'codeBlock' || node.content.size < 2) return null;
      const a = pos + 1 + Math.floor(rand() * node.content.size);
      const b = pos + 1 + Math.floor(rand() * node.content.size);
      if (a === b) return null;
      const mark = pick([rich.marks.link.create(), rich.marks.code.create(), rich.marks.bold.create()]);
      const [from, to] = [Math.min(a, b), Math.max(a, b)];
      return kind === 5 ? tr.addMark(from, to, mark) : tr.removeMark(from, to, mark.type);
    }
    if (kind === 7) {
      const { node, pos } = pick(blocks);
      const to = node.type.name === 'codeBlock' ? rich.nodes.paragraph : rich.nodes.codeBlock;
      return tr.setBlockType(pos + 1, pos + 1, to);
    }
    if (kind === 8) {
      const { pos } = pick(blocks);
      const range = doc.resolve(pos + 1).blockRange();
      const wrapping = range && findWrapping(range, rich.nodes.blockquote);
      return wrapping ? tr.wrap(range, wrapping) : null;
    }
    if (kind === 9) {
      const { node, pos } = pick(blocks);
      if (node.type.name === 'codeBlock') return null;
      return tr.insert(pos + 1 + Math.floor(rand() * (node.content.size + 1)), rich.nodes.hardBreak.create());
    }
    // Two edits far apart in one transaction (a find-and-replace, a paste).
    tr.insertText(pick(SNIPPETS), positions[0]);
    return tr.insertText(pick(SNIPPETS), textPositions(tr.doc).at(-1));
  } catch (_) {
    return null;
  }
}

// A box over the first "Ada" of every textblock that says "tagged" — like the
// applied tag ranges, worked out from whichever doc is being decorated.
function taggedBoxes(doc) {
  const boxes = [];
  for (const { node, pos } of textblocks(doc)) {
    const text = node.textContent;
    if (!text.includes('tagged')) continue;
    const at = text.indexOf('Ada');
    if (at >= 0) boxes.push({ from: pos + 1 + at, to: pos + 1 + at + 3 });
  }
  return boxes;
}

for (const [label, key, make] of PLUGINS) {
  test(`${label}: after any run of edits, the underlines are what a fresh read would draw`, () => {
    const ignored = new Set(['bob']);
    const extra = label === 'auto-detect'
      ? { getIgnored: () => ignored, getAppliedRangeSet: (doc) => taggedBoxes(doc) }
      : { getAppliedRangeSet: (doc) => taggedBoxes(doc), getMentionIndex: () => names('Lovelace') };
    const index = names('Ada', 'Ada Lovelace', 'Bob', 'Lovelace');
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed);
      let state = EditorState.create({
        schema: rich,
        doc: rich.node('doc', null, [para('Ada met Bob.'), para('tagged: Ada and Ada Lovelace.'), para('Later, Lovelace left.')]),
        plugins: [make(index, extra)],
      });
      // Drawn once to begin with, as the editor asks when the index lands (the
      // candidate plugin draws nothing before that).
      state = state.apply(state.tr.setMeta(key, true));
      const steps = [];
      for (let i = 0; i < 25; i++) {
        let tr = randomEdit(state, rand);
        if (!tr) continue;
        // Now and then it arrives the way a collaborator's edit does.
        if (rand() < 0.25) {
          const theirs = state.apply(tr).doc;
          tr = state.tr.replaceWith(0, state.doc.content.size, theirs.content);
          steps.push('remote');
        } else steps.push('local');
        state = state.apply(tr);
        const fresh = EditorState.create({ schema: rich, doc: state.doc, plugins: [make(index, extra)] });
        const expected = setOf(key, fresh.apply(fresh.tr.setMeta(key, true)));
        assert.deepEqual(shape(setOf(key, state)), shape(expected),
          `seed ${seed}, edit ${i + 1} (${steps.join(', ')})`);
      }
    }
  });
}
