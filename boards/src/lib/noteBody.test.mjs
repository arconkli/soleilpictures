// A note's text lives in `html` or, for a text drop / an API note, in plain
// `body`. Opening a body-only note used to seed the editor from html alone and
// save the empty result over the body (NOTES-01); ticking a checklist box used
// to save the rendered DOM over the note (NOTES-02). The DOM-free halves of
// both fixes are pinned here; tests/note-body-seed.spec.js drives the editor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';
import { htmlHasText, bodyHasText, noteBodyToHtml, noteSourceHtml } from './noteBody.js';
import {
  NOTE_SEEDED_KEY, ensureNoteFragment, getNoteFragment,
  noteFragmentIsBlank, toggleNoteChecklistItem, seedNoteFragmentFromHtml,
} from './noteDocState.js';
import { noteExtensions } from '../components/noteExtensions/noteExtensions.js';

test('htmlHasText ignores tags and non-breaking spaces', () => {
  assert.equal(htmlHasText(''), false);
  assert.equal(htmlHasText(null), false);
  assert.equal(htmlHasText('<p></p>'), false);
  assert.equal(htmlHasText('<p>&nbsp;</p>'), false);
  assert.equal(htmlHasText('<p> x </p>'), true);
});

test('bodyHasText', () => {
  assert.equal(bodyHasText(null), false);
  assert.equal(bodyHasText('  \n '), false);
  assert.equal(bodyHasText('a'), true);
});

test('noteBodyToHtml: one escaped paragraph per line, blank lines kept', () => {
  assert.equal(noteBodyToHtml('a < b & c\n\nnext'), '<p>a &lt; b &amp; c</p><p></p><p>next</p>');
  assert.equal(noteBodyToHtml('one\r\ntwo'), '<p>one</p><p>two</p>');
  assert.equal(noteBodyToHtml('<b>not markup</b>'), '<p>&lt;b&gt;not markup&lt;/b&gt;</p>');
  assert.equal(noteBodyToHtml('   '), '');
  assert.equal(noteBodyToHtml(null), '');
});

test('noteSourceHtml: html with text wins; body fills a textless html', () => {
  assert.equal(noteSourceHtml('<p>rich</p>', 'plain'), '<p>rich</p>');
  assert.equal(noteSourceHtml(undefined, 'plain'), '<p>plain</p>');
  assert.equal(noteSourceHtml('<p></p>', 'plain'), '<p>plain</p>');
  // No body to prefer: a textless html (a lone image) is still the note.
  assert.equal(noteSourceHtml('<img src="x">', null), '<img src="x">');
  assert.equal(noteSourceHtml(undefined, null), '');
});

const schema = getSchema(noteExtensions);

function seededCard(json) {
  const ydoc = new Y.Doc();
  const card = new Y.Map();
  ydoc.getMap('cards').set('c', card);
  const frag = ensureNoteFragment(ydoc, card);
  if (json) prosemirrorJSONToYXmlFragment(schema, json, frag);
  card.set(NOTE_SEEDED_KEY, true);
  return { ydoc, card, frag };
}

const p = (text, marks) => ({ type: 'paragraph', content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [] });
const item = (text, checked = false) => ({ type: 'noteChecklistItem', attrs: { checked }, content: [p(text)] });

test('noteFragmentIsBlank: empty and empty-paragraph fragments are blank; text and mentions are not', () => {
  assert.equal(noteFragmentIsBlank(null), true);
  assert.equal(noteFragmentIsBlank(seededCard().frag), true);
  assert.equal(noteFragmentIsBlank(seededCard({ type: 'doc', content: [p('')] }).frag), true);
  assert.equal(noteFragmentIsBlank(seededCard({ type: 'doc', content: [p('hi')] }).frag), false);
  const mention = { type: 'paragraph', content: [{ type: 'noteMention', attrs: { entityRef: { kind: 'tag', id: 't1' }, label: 'Ana' } }] };
  assert.equal(noteFragmentIsBlank(seededCard({ type: 'doc', content: [mention] }).frag), false);
  assert.equal(noteFragmentIsBlank(seededCard({ type: 'doc', content: [{ type: 'noteChecklist', content: [item('')] }] }).frag), false);
});

test('a seeded note with real content is never re-seeded from a body', () => {
  const { ydoc, card, frag } = seededCard({ type: 'doc', content: [p('kept')] });
  seedNoteFragmentFromHtml(ydoc, card, '', 'stale body');
  assert.deepEqual(yXmlFragmentToProsemirrorJSON(frag).content.map((n) => n.content?.[0]?.text), ['kept']);
});

test('a blank seeded note with no body stays blank (deliberately emptied)', () => {
  const { ydoc, card, frag } = seededCard({ type: 'doc', content: [p('')] });
  seedNoteFragmentFromHtml(ydoc, card, '<p></p>', null);
  assert.equal(noteFragmentIsBlank(frag), true);
});

test('toggleNoteChecklistItem flips the Nth item and nothing else', () => {
  const comment = [{ type: 'comment', attrs: { id: 'th1' } }];
  const { ydoc, card, frag } = seededCard({
    type: 'doc',
    content: [
      p('see this', comment),
      { type: 'noteChecklist', content: [item('one'), item('two', true)] },
      p('between'),
      { type: 'noteChecklist', content: [item('three')] },
    ],
  });
  const before = yXmlFragmentToProsemirrorJSON(frag);

  assert.equal(toggleNoteChecklistItem(ydoc, card, 2, '', null), true);
  assert.equal(toggleNoteChecklistItem(ydoc, card, 1, '', null), false);
  assert.equal(toggleNoteChecklistItem(ydoc, card, 7, '', null), null);

  const after = yXmlFragmentToProsemirrorJSON(getNoteFragment(card));
  const checks = after.content
    .filter((n) => n.type === 'noteChecklist')
    .flatMap((l) => l.content.map((i) => i.attrs.checked));
  assert.deepEqual(checks, [false, false, true]);
  // The comment anchor rides along untouched.
  assert.deepEqual(after.content[0], before.content[0]);
});
