// docMarkdown — a doc card's pages as Markdown, straight from its fragments.
// The parity test holds the hand-rolled fragment walk to y-prosemirror's, the
// rest pins what a reader gets: page order, links, screenplay lines, the
// character budget, and that reading writes nothing.
//
// Run: node --test src/lib/docMarkdown.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { yXmlFragmentToProsemirrorJSON } from 'y-prosemirror';

import { fragmentToJSON, jsonToMarkdown, readDocPages, flattenPages, DOC_READ } from './docMarkdown.js';
import { addLink } from './links.js';

// A doc card as the app stores it: a Y.Map on the board's cards map holding the
// page list and one fragment per page.
function docCard(ydoc, id, pages) {
  const card = new Y.Map();
  ydoc.getMap('cards').set(id, card);
  card.set('id', id);
  card.set('kind', 'doc');
  card.set('title', 'Treatment');
  const list = new Y.Array();
  const content = new Y.Map();
  card.set('docPages', list);
  card.set('docPageContent', content);
  card.set('docPageSheets', new Y.Map());
  card.set('docSheetContent', new Y.Map());
  pages.forEach((p, i) => {
    list.push([{ id: p.id, name: p.name, parent_id: p.parent_id ?? null, order: p.order ?? i }]);
    const frag = new Y.XmlFragment();
    content.set(p.id, frag);
    p.fill?.(frag);
  });
  return {
    card,
    scope: {
      pages: list, content, pageSheets: card.get('docPageSheets'), sheetContent: card.get('docSheetContent'),
    },
  };
}

// Blocks into a fragment: [type, attrs, [[text, marks], …] | children].
function fill(frag, blocks) {
  const build = ([type, attrs, inner]) => {
    const el = new Y.XmlElement(type);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return { el, inner };
  };
  const place = (parent, blocksHere) => {
    blocksHere.forEach((b, i) => {
      const { el, inner } = build(b);
      parent.insert(i, [el]);
      if (Array.isArray(inner) && inner.length && typeof inner[0][0] === 'string') {
        const t = new Y.XmlText();
        el.insert(0, [t]);
        let at = 0;
        for (const [text, marks] of inner) { t.insert(at, text, marks || {}); at += text.length; }
      } else if (Array.isArray(inner)) {
        place(el, inner);
      }
    });
  };
  place(frag, blocks);
}

test('the fragment walk matches y-prosemirror, hashed mark names included', () => {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('f');
  fill(frag, [
    ['heading', { level: 2 }, [['Night exteriors', {}]]],
    ['paragraph', {}, [['Neon on ', {}], ['wet', { bold: {} }], [' asphalt', { 'comment--abcd1234': { id: 't1' } }]]],
    ['bulletList', {}, [['listItem', {}, [['paragraph', {}, [['one', { italic: {} }]]]]]]],
  ]);
  assert.deepEqual(fragmentToJSON(frag), yXmlFragmentToProsemirrorJSON(frag));
  assert.deepEqual(fragmentToJSON(null), { type: 'doc', content: [] });
});

test('a screenplay keeps its words, scene headings in bold', () => {
  const md = jsonToMarkdown({ type: 'doc', content: [
    { type: 'screenplayBlock', attrs: { element: 'scene' }, content: [{ type: 'text', text: 'INT. DINER - NIGHT' }] },
    { type: 'screenplayBlock', attrs: { element: 'character' }, content: [{ type: 'text', text: 'MAE' }] },
    { type: 'screenplayBlock', attrs: { element: 'dialogue' }, content: [{ type: 'text', text: 'Coffee. Black.' }] },
    { type: 'screenplayBlock', attrs: { element: 'scene' } },
  ] });
  assert.equal(md, '**INT. DINER - NIGHT**\n\nMAE\n\nCoffee. Black.\n');
});

test('a block this does not know still reads as a paragraph', () => {
  const md = jsonToMarkdown({ type: 'doc', content: [
    { type: 'calloutBox', content: [{ type: 'text', text: 'Keep the grain.' }] },
    { type: 'wrapper', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Deep' }] }] },
  ] });
  assert.equal(md, 'Keep the grain.\n\n# Deep\n');
});

test('pages read in page-list order, nested pages after their parent, links resolved, comments gone', () => {
  const ydoc = new Y.Doc();
  addLink(ydoc, { id: 'L1', pageId: 'p1', anchor: { from: 1, to: 2 }, targets: [{ href: 'https://example.com/ref' }] });
  const { scope } = docCard(ydoc, 'd1', [
    { id: 'p2', name: 'Two', order: 1, fill: (f) => fill(f, [['paragraph', {}, [['second', {}]]]]) },
    { id: 'p1', name: 'One', order: 0, fill: (f) => fill(f, [['paragraph', {}, [
      ['See ', {}], ['the ref', { link: { linkId: 'L1' } }], [' and ', {}], ['a dead link', { link: { linkId: 'nope' } }],
      [' noted', { comment: { id: 'c1' } }],
    ]]]) },
    { id: 'p1a', name: 'One, inside', parent_id: 'p1', order: 0, fill: (f) => fill(f, [['paragraph', {}, [['nested', {}]]]]) },
  ]);
  const { total, pages } = readDocPages(ydoc, scope);
  assert.equal(total, 3);
  assert.deepEqual(pages.map((p) => [p.id, p.title, p.depth, p.parent_id]),
    [['p1', 'One', 0, null], ['p1a', 'One, inside', 1, 'p1'], ['p2', 'Two', 0, null]]);
  assert.equal(pages[0].markdown, 'See [the ref](https://example.com/ref) and a dead link noted\n');
  assert.ok(pages.every((p) => p.truncated === false && /^[0-9a-f]{8}$/.test(p.hash)));
  assert.equal(flattenPages([{ id: 'a', order: 0 }]).length, 1);
});

test('the character budget fills pages in order, cuts one, and lists the rest without text', () => {
  const ydoc = new Y.Doc();
  const long = 'x'.repeat(50);
  const { scope } = docCard(ydoc, 'd1', ['a', 'b', 'c'].map((id) => ({
    id, name: id.toUpperCase(), fill: (f) => fill(f, [['paragraph', {}, [[long, {}]]]]),
  })));
  const { pages } = readDocPages(ydoc, scope, { maxChars: 70 });
  assert.deepEqual(pages.map((p) => [p.id, p.markdown?.length ?? null, p.truncated, p.chars]),
    [['a', 51, false, 51], ['b', 19, true, 51], ['c', null, false, 51]]);
  assert.equal(pages[1].hash, pages[0].hash, 'the hash is of the whole page, not the part shown');

  const one = readDocPages(ydoc, scope, { pageId: 'c' });
  assert.equal(one.total, 3);
  assert.deepEqual(one.pages.map((p) => p.id), ['c']);
  assert.equal(readDocPages(ydoc, scope, { pageId: 'zz' }), null);
  assert.ok(DOC_READ.defaultChars <= DOC_READ.maxChars);
});

test('reading a doc writes nothing to it', () => {
  const ydoc = new Y.Doc();
  const { scope, card } = docCard(ydoc, 'd1', [
    { id: 'p1', name: 'One', fill: (f) => fill(f, [['paragraph', {}, [['hello', {}]]]]) },
  ]);
  // A page whose fragment is missing, and a sheet listed without content: the
  // editor's getOrCreate* helpers would make both. A reader must not.
  card.get('docPages').push([{ id: 'p2', name: 'Two', parent_id: null, order: 1 }]);
  const sheets = new Y.Array();
  card.get('docPageSheets').set('p1', sheets);
  sheets.push([{ id: 's2' }]);
  let updates = 0;
  ydoc.on('update', () => { updates += 1; });
  const before = Y.encodeStateVector(ydoc);
  const { pages } = readDocPages(ydoc, scope);
  assert.deepEqual(pages.map((p) => [p.id, p.markdown]), [['p1', 'hello\n'], ['p2', '']]);
  assert.equal(updates, 0);
  assert.deepEqual(Y.encodeStateVector(ydoc), before);
});
