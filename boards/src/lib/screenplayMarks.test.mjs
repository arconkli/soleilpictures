// A screenplay's scene numbers and auto (CONT'D)s are drawn on every edit
// (ScreenplayPagination's marks), and drawing them anew for a 120-page script
// took several milliseconds a key. A key typed inside one block that leaves
// every number and CONT'D as it was now keeps the drawn marks and moves them;
// anything else draws them afresh. Either way they must be what a fresh draw
// of the new doc would give.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { ScreenplayPagination } from '../components/docExtensions/screenplay/ScreenplayPagination.js';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    screenplayBlock: {
      group: 'block',
      content: 'inline*',
      attrs: { element: { default: 'action' }, sceneNumber: { default: null }, dual: { default: null } },
    },
    horizontalRule: { group: 'block' },
    text: { group: 'inline' },
  },
});
const B = (element, text, attrs = {}) => schema.node('screenplayBlock', { element, ...attrs }, text ? [schema.text(text)] : []);

// The marks plugin alone: the page-break plugin beside it waits for a pause.
const marksPlugin = () => ScreenplayPagination.config.addProseMirrorPlugins.call({ options: {} })[0];
const marksOf = (state) => state.plugins[0].getState(state).set;
const shape = (set) => set.find()
  .map((d) => `${d.from}-${d.to} ${JSON.stringify(d.type.attrs || {})} ${d.spec?.key || ''}`)
  .sort();
const fresh = (doc) => marksOf(EditorState.create({ schema, doc, plugins: [marksPlugin()] }));

const scene = () => [
  B('scene', 'INT. CAFE - NIGHT'),
  B('action', 'Rain on the glass.'),
  B('character', 'MINSU'),
  B('dialogue', 'Two coffees.'),
  B('action', 'She looks away.'),
  B('character', 'MINSU'),
  B('dialogue', 'Please.'),
];
const script = () => schema.node('doc', null, [...scene(), ...scene(), B('scene', 'EXT. STREET - DAY')]);

// Where the text of the n-th block (0-based) starts.
const blockStart = (doc, n) => {
  let at = null;
  doc.forEach((node, offset, i) => { if (i === n) at = offset + 1; });
  return at;
};

test('a key inside a speech keeps the drawn numbers and CONT\'Ds, moved', () => {
  let state = EditorState.create({ schema, doc: script(), plugins: [marksPlugin()] });
  const before = marksOf(state).find();
  assert.equal(before.filter((d) => d.type.attrs?.['data-scene-number']).length, 3, 'three numbered scenes');
  assert.equal(before.filter((d) => d.spec?.key?.startsWith('sp-contd')).length, 2, 'two CONT\'Ds');
  state = state.apply(state.tr.insertText(' Now.', blockStart(state.doc, 3) + 12));
  const after = marksOf(state).find();
  assert.deepEqual(shape(marksOf(state)), shape(fresh(state.doc)));
  // The same decorations, not a new set drawn like them.
  assert.ok(after.every((d, i) => d.type === before[i].type), 'every mark is the one drawn before');
});

test('a key that changes a cue redraws the CONT\'Ds', () => {
  let state = EditorState.create({ schema, doc: script(), plugins: [marksPlugin()] });
  // The second MINSU of the first scene becomes JIHYE: no CONT'D there now.
  const at = blockStart(state.doc, 5);
  state = state.apply(state.tr.insertText('JIHYE', at, at + 5));
  assert.deepEqual(shape(marksOf(state)), shape(fresh(state.doc)));
  assert.equal(marksOf(state).find().filter((d) => d.spec?.key?.startsWith('sp-contd')).length, 1);
});

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
const ELEMENTS = ['scene', 'action', 'character', 'dialogue', 'parenthetical', 'transition'];
const SNIPPETS = ['MINSU', 'JIHYE', ' ', 'x', 'INT. ', "(CONT'D)", 'Rain.'];

function randomEdit(state, rand) {
  const { doc, tr } = state;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const blocks = [];
  doc.forEach((node, offset) => blocks.push({ node, pos: offset }));
  const { node, pos } = pick(blocks);
  const inside = () => pos + 1 + Math.floor(rand() * (node.content.size + 1));
  const kind = Math.floor(rand() * 9);
  try {
    if (node.type.name !== 'screenplayBlock') return kind < 4 ? tr.delete(pos, pos + node.nodeSize) : null;
    if (kind <= 2) return tr.insertText(pick(SNIPPETS), inside());
    if (kind === 3) {
      const a = inside(), b = inside();
      return a === b ? null : tr.delete(Math.min(a, b), Math.max(a, b));
    }
    if (kind === 4) return tr.split(inside(), 1, [{ type: schema.nodes.screenplayBlock, attrs: { element: pick(ELEMENTS) } }]);
    if (kind === 5) return tr.setNodeMarkup(pos, undefined, { ...node.attrs, element: pick(ELEMENTS) });
    if (kind === 6) return tr.setNodeMarkup(pos, undefined, { ...node.attrs, sceneNumber: rand() < 0.5 ? null : String(1 + Math.floor(rand() * 9)) });
    if (kind === 7) return tr.insert(pos, schema.nodes.horizontalRule.create());
    // Two speeches far apart in one transaction.
    tr.insertText(pick(SNIPPETS), 1);
    return tr.insertText(pick(SNIPPETS), tr.doc.content.size - 1);
  } catch (_) {
    return null;
  }
}

test('after any run of edits, the marks are what a fresh draw would give', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = rng(seed);
    let state = EditorState.create({ schema, doc: script(), plugins: [marksPlugin()] });
    const steps = [];
    for (let i = 0; i < 30; i++) {
      let tr = randomEdit(state, rand);
      if (!tr || !tr.docChanged) continue;
      // Now and then it arrives as y-prosemirror applies a collaborator's edit.
      if (rand() < 0.25) {
        const theirs = state.apply(tr).doc;
        tr = state.tr.replaceWith(0, state.doc.content.size, theirs.content);
        steps.push('remote');
      } else steps.push('local');
      state = state.apply(tr);
      assert.deepEqual(shape(marksOf(state)), shape(fresh(state.doc)), `seed ${seed}, edit ${i + 1} (${steps.join(', ')})`);
    }
  }
});
