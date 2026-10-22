// What the doc look's side panel searches with (docFind.js): the words as
// typed, every case or this one (Aa), whole words or not, on every page or
// this one; each hit with the words around it; and Replace all on the pages
// that aren't open, in place in the doc, as one step. The editor's own
// search (matchesInPM) finds the same hits in the same order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { Schema } from '@tiptap/pm/model';
import * as ds from './docState.js';
import { pageFragments, textblocksOf } from './docBlocks.js';
import { matchesIn, pageHits, docHits, replaceInPages, matchesInPM, snippetOf } from './docFind.js';

const words = (text, q, o) => matchesIn(text, q, o).map(([a, b]) => text.slice(a, b));

test('a search finds the words in any case, and only as typed with Aa', () => {
  assert.deepEqual(words('Night drive, a night, NIGHT.', 'night'), ['Night', 'night', 'NIGHT']);
  assert.deepEqual(words('Night drive, a night, NIGHT.', 'night', { matchCase: true }), ['night']);
});

test('Whole word leaves out the words inside longer ones, in any alphabet', () => {
  assert.deepEqual(words('night nightly overnight night-time night_shift', 'night', { wholeWord: true }), ['night', 'night']);
  assert.deepEqual(words('café cafés', 'café', { wholeWord: true }), ['café']);
  assert.deepEqual(words('밤 밤에 한밤', '밤', { wholeWord: true }), ['밤']);
});

test('Korean is found inside a longer word, as any words are without Whole word', () => {
  assert.deepEqual(words('밤 밤에 한밤중', '밤'), ['밤', '밤', '밤']);
});

test('hits never overlap, and an empty search finds nothing', () => {
  assert.deepEqual(matchesIn('aaaa', 'aa'), [[0, 2], [2, 4]]);
  assert.deepEqual(matchesIn('anything', ''), []);
});

test('a hit never runs across something inline that isn\'t text', () => {
  assert.deepEqual(matchesIn('see\u0000there', 'seethere'), []);
  assert.deepEqual(words('see\u0000there', 'there'), ['there']);
});

test('what a pattern would read as special is searched as itself', () => {
  assert.deepEqual(words('Is it (a) $5.00? [yes]', '(a) $5.00?'), ['(a) $5.00?']);
  assert.deepEqual(words('a.b axb', 'a.b'), ['a.b']);
});

test('a hit\'s snippet is the words around it, cut at a word', () => {
  assert.deepEqual(snippetOf('one two three four five six seven', 14, 18, { before: 8, after: 6 }),
    { before: '…three ', match: 'four', after: ' five…' });
  assert.deepEqual(snippetOf('a night drive', 2, 7), { before: 'a ', match: 'night', after: ' drive' });
  assert.deepEqual(snippetOf('see\u0000the night', 8, 13), { before: 'see the ', match: 'night', after: '' });
});

// A block the way y-prosemirror files one: an element holding runs of text,
// each run's marks as attributes.
function block(runs, tag = 'paragraph') {
  const el = new Y.XmlElement(tag);
  const kids = [];
  for (const r of (Array.isArray(runs) ? runs : [runs])) {
    if (r && r.inline) { kids.push(new Y.XmlElement(r.inline)); continue; }
    const t = new Y.XmlText();
    const list = typeof r === 'string' ? [[r]] : r;
    let at = 0;
    for (const [s, attrs] of list) { t.insert(at, s, attrs || {}); at += s.length; }
    kids.push(t);
  }
  el.insert(0, kids);
  return el;
}

function docWith(pages) {
  const ydoc = new Y.Doc();
  const scope = ds.rootScope(ydoc);
  const ids = {};
  for (const p of pages) {
    const id = ds.addPage(ydoc, { name: p.name, parent_id: p.parent ? ids[p.parent] : null });
    ids[p.name] = id;
    scope.content.get(id).insert(0, p.blocks || []);
  }
  return { ydoc, scope, ids };
}
const textOf = (ydoc, pageId) => textblocksOf(pageFragments(ydoc, pageId)[0].frag).map((b) => b.text);

test('every page is searched in the page list\'s order, each page\'s hits in order', () => {
  const { ydoc } = docWith([
    { name: 'Treatment', blocks: [block('A night drive.'), block('The night is long; night falls.')] },
    { name: 'Locations' },
    { name: 'Diner', parent: 'Locations', blocks: [block('Open all night.')] },
  ]);
  const groups = docHits(ydoc, undefined, 'night');
  assert.deepEqual(groups.map((g) => [g.name, g.trail.join(' › '), g.hits.length]), [
    ['Treatment', '', 3], ['Diner', 'Locations', 1],
  ]);
  assert.deepEqual(groups[0].hits.map((h) => h.k), [0, 1, 2]);
  assert.deepEqual(groups[0].hits[1].snippet, { before: 'The ', match: 'night', after: ' is long; night falls.' });
});

test('only the pages asked for are searched', () => {
  const { ydoc, ids } = docWith([
    { name: 'One', blocks: [block('night')] }, { name: 'Two', blocks: [block('night')] },
  ]);
  assert.deepEqual(docHits(ydoc, undefined, 'night', {}, { pageIds: [ids.Two] }).map((g) => g.id), [ids.Two]);
});

test('a hit is found across a change of marks, through a list, and across two pieces of text', () => {
  const { ydoc, ids } = docWith([{ name: 'One', blocks: [
    block([[['nig', { bold: {} }], ['ht drive']]]),
    (() => {
      const list = new Y.XmlElement('bulletList');
      const item = new Y.XmlElement('listItem');
      item.insert(0, [block('night in a list')]);
      list.insert(0, [item]);
      return list;
    })(),
    block(['the ni', 'ght after']),
  ] }]);
  const hits = pageHits(ydoc, undefined, ids.One, 'night');
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((h) => h.segs.length), [1, 1, 2]);
});

test('Replace all changes each hit in place and keeps its marks, comments too', () => {
  const comment = { 'comment--AbCd1234': { id: 'c1' } };
  const { ydoc, ids } = docWith([
    { name: 'One', blocks: [block([[['A '], ['night', { bold: {} }], [' drive at night']]])] },
    { name: 'Two', blocks: [block([[['Night', comment], [' falls']]])] },
  ]);
  assert.deepEqual(replaceInPages(ydoc, undefined, [ids.One, ids.Two], 'night', {}, 'evening', 'find'), { n: 3, pages: 2 });
  const [one] = textblocksOf(pageFragments(ydoc, ids.One)[0].frag);
  assert.equal(one.text, 'A evening drive at evening');
  assert.deepEqual(one.parts[0].ops.map((o) => [o.text, !!o.attributes?.bold]),
    [['A ', false], ['evening', true], [' drive at evening', false]]);
  const [two] = textblocksOf(pageFragments(ydoc, ids.Two)[0].frag);
  assert.equal(two.text, 'evening falls');
  assert.deepEqual(two.parts[0].ops[0].attributes, comment);
});

test('a hit across two pieces of text is replaced whole', () => {
  const { ydoc, ids } = docWith([{ name: 'One', blocks: [block(['the ni', 'ght after'])] }]);
  replaceInPages(ydoc, undefined, [ids.One], 'night', {}, 'day', 'find');
  assert.deepEqual(textOf(ydoc, ids.One), ['the day after']);
});

test('replacing with nothing deletes; a replacement holding the words isn\'t replaced again', () => {
  const { ydoc, ids } = docWith([{ name: 'One', blocks: [block('cat and cat')] }, { name: 'Two', blocks: [block('a cat')] }]);
  assert.deepEqual(replaceInPages(ydoc, undefined, [ids.One], 'cat', {}, 'cats', 'find'), { n: 2, pages: 1 });
  assert.deepEqual(textOf(ydoc, ids.One), ['cats and cats']);
  replaceInPages(ydoc, undefined, [ids.Two], ' cat', {}, '', 'find');
  assert.deepEqual(textOf(ydoc, ids.Two), ['a']);
});

test('Replace all keeps to its options: Aa and Whole word', () => {
  const { ydoc, ids } = docWith([{ name: 'One', blocks: [block('Night nightly night')] }]);
  assert.deepEqual(replaceInPages(ydoc, undefined, [ids.One], 'night', { matchCase: true, wholeWord: true }, 'day', 'find'), { n: 1, pages: 1 });
  assert.deepEqual(textOf(ydoc, ids.One), ['Night nightly day']);
});

test('Replace all across pages is one step back', () => {
  const { ydoc, scope, ids } = docWith([
    { name: 'One', blocks: [block('night one')] }, { name: 'Two', blocks: [block('night two')] },
  ]);
  const um = new Y.UndoManager([scope.content], { trackedOrigins: new Set(['find']) });
  replaceInPages(ydoc, undefined, [ids.One, ids.Two], 'night', {}, 'day', 'find');
  assert.deepEqual([...textOf(ydoc, ids.One), ...textOf(ydoc, ids.Two)], ['day one', 'day two']);
  um.undo();
  assert.deepEqual([...textOf(ydoc, ids.One), ...textOf(ydoc, ids.Two)], ['night one', 'night two']);
});

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph+' },
    mention: { group: 'inline', inline: true, atom: true },
    text: { group: 'inline' },
  },
  marks: { bold: {} },
});

test('the editor finds the same hits, at its own places', () => {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('A night '), schema.node('mention'), schema.text(' night')]),
    schema.node('bulletList', null, [schema.node('listItem', null, [
      schema.node('paragraph', null, [schema.text('Night', [schema.mark('bold')]), schema.text('fall')]),
    ])]),
    schema.node('paragraph'),
  ]);
  assert.deepEqual(matchesInPM(doc, 'night').map(([a, b]) => doc.textBetween(a, b)), ['night', 'night', 'Night']);
  assert.equal(matchesInPM(doc, 'night', { wholeWord: true }).length, 2);
  assert.equal(matchesInPM(doc, 'night', { matchCase: true }).length, 2);
});
