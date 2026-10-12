// The doc editor's decoration plugins must not re-walk the whole document on a
// transaction that changes nothing but the selection (DOCS-11): a caret move or
// a held arrow key used to re-run the entity trie over every text node and
// JSON.stringify every match, and rebuild every link badge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { makeAutoDetectPlugin, AUTO_DETECT_KEY } from '../components/docExtensions/AutoDetectPlugin.js';

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
  const decos = AUTO_DETECT_KEY.getState(state).find();
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
  assert.equal(AUTO_DETECT_KEY.getState(typed).find().length, 3);
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
  assert.equal(AUTO_DETECT_KEY.getState(state).find().length, 1, 'covered match suppressed');
  // A paste above shifts the covered "Ada"; suppression must follow it.
  const pasted = state.apply(state.tr.insertText('A long pasted line. ', 1));
  const decos = AUTO_DETECT_KEY.getState(pasted).find();
  assert.equal(decos.length, 1, 'still exactly one hairline (the uncovered first "Ada")');
  assert.equal(pasted.doc.textBetween(decos[0].from, decos[0].to), 'Ada');
  assert.ok(decos[0].from < pasted.doc.child(0).nodeSize, 'the hairline is in the first paragraph');
});
