// The note schema's link mark shipped in two phases (NOTE_LINK_MARKS in
// noteExtensions.js). y-prosemirror deletes, for every collaborator, the text
// of a paragraph holding a mark the local schema doesn't know, so the mark was
// in every open tab's schema (phase 1, 2026-10-12) before anything wrote one
// (phase 2: the flag on). These pin that state; tests/note-links.spec.js
// drives the real editor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { noteExtensions, NOTE_LINK_MARKS } from '../components/noteExtensions/noteExtensions.js';

const schema = getSchema(noteExtensions);

test('the note schema knows the link mark (never remove it: notes hold it)', () => {
  assert.ok(schema.marks.link, 'link mark missing from the note schema');
});

test('phase 2: anchors parse into a link mark', () => {
  assert.equal(NOTE_LINK_MARKS, true);
  assert.ok((schema.marks.link.spec.parseDOM || []).length > 0);
});

// What the parse rule sees: an <a> with only an href.
const anchor = (href) => ({ getAttribute: (n) => (n === 'href' ? href : null), hasAttribute: () => false });
const linkRule = () => schema.marks.link.spec.parseDOM[0];

test('http, https and mailto addresses become a link', () => {
  for (const href of ['https://example.com/brief', 'http://example.com', 'mailto:sam@example.com', 'HTTPS://EXAMPLE.COM']) {
    assert.notEqual(linkRule().getAttrs(anchor(href)), false, href);
  }
});

test('any other address keeps its words and no link', () => {
  for (const href of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>x</b>']) {
    assert.equal(linkRule().getAttrs(anchor(href)), false, JSON.stringify(href));
  }
});

test('tel, ftp and relative addresses stay links (Link\'s default rule)', () => {
  for (const href of ['tel:123', 'ftp://example.com', '/b/123']) {
    assert.notEqual(linkRule().getAttrs(anchor(href)), false, JSON.stringify(href));
  }
});

test('quotes and inline code stay in the schema (only their typing triggers went)', () => {
  assert.ok(schema.nodes.blockquote);
  assert.ok(schema.marks.code);
});
