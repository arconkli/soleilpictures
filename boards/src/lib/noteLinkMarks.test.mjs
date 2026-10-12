// The note schema's link mark ships in two phases (NOTE_LINK_MARKS in
// noteExtensions.js). y-prosemirror deletes, for every collaborator, the text
// of a paragraph holding a mark the local schema doesn't know, so the mark has
// to be in every open tab's schema before anything writes one. These pin the
// order; tests/note-links.spec.js drives the real editor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { noteExtensions, NOTE_LINK_MARKS } from '../components/noteExtensions/noteExtensions.js';

const schema = getSchema(noteExtensions);

test('the note schema knows the link mark (never remove it: later builds write it)', () => {
  assert.ok(schema.marks.link, 'link mark missing from the note schema');
});

test('nothing parses into a link mark until NOTE_LINK_MARKS is on', () => {
  const rules = schema.marks.link.spec.parseDOM || [];
  if (NOTE_LINK_MARKS) assert.ok(rules.length > 0);
  else assert.equal(rules.length, 0);
});
