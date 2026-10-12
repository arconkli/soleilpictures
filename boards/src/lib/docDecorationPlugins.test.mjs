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
