// What the doc look's Comments panel reads: the pages in the page list's
// order and the text on each (docBlocks.js), the words each thread is on
// (docCommentAnchors.js), who resolved a thread and when (docState.js
// readComments), and the short times on its cards (relativeTime.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as ds from './docState.js';
import { docPageOrder, pageFragments, textblocksOf } from './docBlocks.js';
import { commentAnchors } from './docCommentAnchors.js';
import { relativeTimeCompact } from './relativeTime.js';

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

const cm = (id) => ({ comment: { id } });

test('the pages come in the page list\'s order, each with the names above it', () => {
  const { ydoc, ids } = docWith([
    { name: 'Treatment' }, { name: 'Locations' }, { name: 'Diner', parent: 'Locations' },
    { name: 'Motel', parent: 'Locations' }, { name: 'Shot list' },
  ]);
  // Moved: Shot list above Locations.
  ds.movePage(ydoc, ids['Shot list'], null, 1);
  assert.deepEqual(docPageOrder(ydoc).map((p) => [p.name, p.trail.join(' › ')]), [
    ['Treatment', ''], ['Shot list', ''], ['Locations', ''], ['Diner', 'Locations'], ['Motel', 'Locations'],
  ]);
});

test('a page\'s text is its own fragment, then its extra sheets, in order', () => {
  const { ydoc, scope, ids } = docWith([{ name: 'One', blocks: [block('first')] }]);
  const list = new Y.Array();
  scope.pageSheets.set(ids.One, list);
  for (const [sid, text] of [['s2', 'second'], ['s3', 'third']]) {
    list.push([{ id: sid }]);
    const f = new Y.XmlFragment();
    scope.sheetContent.set(sid, f);
    f.insert(0, [block(text)]);
  }
  const frags = pageFragments(ydoc, ids.One);
  assert.deepEqual(frags.map((f) => f.sheetId), [ids.One, 's2', 's3']);
  assert.deepEqual(frags.map((f) => textblocksOf(f.frag)[0].text), ['first', 'second', 'third']);
});

test('textblocks are read through lists and quotes, with anything inline that isn\'t text as one NUL', () => {
  const { ydoc, ids } = docWith([{ name: 'One', blocks: [
    block('Heading', 'heading'),
    (() => {
      const list = new Y.XmlElement('bulletList');
      const item = new Y.XmlElement('listItem');
      item.insert(0, [block('in a list')]);
      list.insert(0, [item]);
      return list;
    })(),
    block(['see ', { inline: 'mention' }, ' there']),
    block([[['bold', { bold: true }], [' plain']]]),
    new Y.XmlElement('paragraph'),
  ] }]);
  const blocks = textblocksOf(pageFragments(ydoc, ids.One)[0].frag);
  assert.deepEqual(blocks.map((b) => b.text), ['Heading', 'in a list', 'see \u0000 there', 'bold plain']);
  const runs = blocks[2].parts.map((p) => [p.start, p.len]);
  assert.deepEqual(runs, [[0, 4], [5, 6]]);
  assert.deepEqual(blocks[3].parts[0].ops.map((o) => [o.text, o.start, !!o.attributes?.bold]),
    [['bold', 0, true], [' plain', 4, false]]);
});

test('each thread is found where its words are, in the doc\'s order, whatever order they were written in', () => {
  const { ydoc } = docWith([
    { name: 'One', blocks: [block([[['A night drive '], ['across the desert', cm('t-late')], ['.']]])] },
    { name: 'Two', blocks: [block([[['the '], ['sodium-orange', cm('t-early')], [' sign']]])] },
  ]);
  const a = commentAnchors(ydoc);
  assert.deepEqual([...a.keys()], ['t-late', 't-early']);
  assert.equal(a.get('t-late').quote, 'across the desert');
  assert.equal(a.get('t-early').quote, 'sodium-orange');
  assert.ok(a.get('t-late').order < a.get('t-early').order);
  assert.equal(a.get('t-early').pageId, docPageOrder(ydoc)[1].id);
});

test('a thread\'s words read as one quote across a change of marks, and across blocks', () => {
  const { ydoc } = docWith([{ name: 'One', blocks: [
    block([[['rust, ', cm('t1')], ['bone', { ...cm('t1'), bold: true }], [', faded denim', cm('t1')]]]),
    block([[['end of one', cm('t2')]]]),
    block([[['start of two', cm('t2')], [' and the rest']]]),
  ] }]);
  const a = commentAnchors(ydoc);
  assert.equal(a.get('t1').quote, 'rust, bone, faded denim');
  assert.equal(a.get('t2').quote, 'end of one start of two');
});

test('two runs of a thread\'s words with words between show the gap', () => {
  const { ydoc } = docWith([{ name: 'One', blocks: [
    block([[['first', cm('t1')], [' not this '], ['second', cm('t1')]]]),
  ] }]);
  assert.equal(commentAnchors(ydoc).get('t1').quote, 'first … second');
});

test('comments on the same words are each found (an overlapping mark is filed under a hashed name)', () => {
  const { ydoc } = docWith([{ name: 'One', blocks: [
    block([[['pushed two stops', { 'comment--AbC+/=12': { id: 'ta' }, 'comment--ZyX98765': { id: 'tb' } }]]]),
  ] }]);
  const a = commentAnchors(ydoc);
  assert.equal(a.get('ta').quote, 'pushed two stops');
  assert.equal(a.get('tb').quote, 'pushed two stops');
});

test('a thread whose words are gone isn\'t placed, and a long quote is cut at a word', () => {
  const long = 'word '.repeat(100).trim();
  const { ydoc } = docWith([{ name: 'One', blocks: [block([[[long, cm('t-long')]]])] }]);
  const a = commentAnchors(ydoc, undefined, { max: 40 });
  assert.equal(a.has('t-gone'), false);
  const q = a.get('t-long').quote;
  assert.ok(q.length <= 41, q);
  assert.match(q, /^word( word)*…$/);
});

test('a resolved thread says who resolved it and when; an open one, nobody', () => {
  const ydoc = new Y.Doc();
  const id = ds.addCommentThread(ydoc, { pageId: 'p', body: 'Name the gas station?', author: 'Maya' });
  assert.deepEqual(pick(ds.readThread(ydoc, id)), { resolved: false, resolvedBy: null, resolvedByName: null, resolvedAt: null });
  const before = Date.now();
  ds.resolveComment(ydoc, id, true, undefined, { by: 'u-jon', byName: 'Jon Park' });
  const t = ds.readThread(ydoc, id);
  assert.equal(t.resolved, true);
  assert.equal(t.resolvedBy, 'u-jon');
  assert.equal(t.resolvedByName, 'Jon Park');
  assert.ok(t.resolvedAt >= before);
  ds.resolveComment(ydoc, id, false, undefined, { by: 'u-maya', byName: 'Maya' });
  assert.deepEqual(pick(ds.readThread(ydoc, id)), { resolved: false, resolvedBy: null, resolvedByName: null, resolvedAt: null });
});

test('a name is filed with the resolve only when there is one, and never a long one', () => {
  const ydoc = new Y.Doc();
  const id = ds.addCommentThread(ydoc, { pageId: 'p', body: 'b' });
  ds.resolveComment(ydoc, id, true, undefined, { by: 'u1' });
  assert.equal('byName' in ydoc.getMap('docComments').get(`${id}~s`), false);
  assert.equal(ds.readThread(ydoc, id).resolvedByName, null);
  ds.resolveComment(ydoc, id, true, undefined, { by: 'u1', byName: 'x'.repeat(200) });
  assert.equal(ds.readThread(ydoc, id).resolvedByName.length, 80);
});

test('a thread resolved the old way (in the thread itself) is resolved by nobody we know', () => {
  const ydoc = new Y.Doc();
  const id = ds.addCommentThread(ydoc, { pageId: 'p', body: 'b' });
  ds.resolveComment(ydoc, id, true, undefined, { by: 'u1', log: false });
  assert.deepEqual(pick(ds.readThread(ydoc, id)), { resolved: true, resolvedBy: null, resolvedByName: null, resolvedAt: null });
});

function pick(t) {
  return { resolved: t.resolved, resolvedBy: t.resolvedBy, resolvedByName: t.resolvedByName, resolvedAt: t.resolvedAt };
}

test('a card\'s time is short: minutes, hours today, Yesterday, a weekday, then a date', () => {
  const now = new Date(2026, 9, 22, 15, 30).getTime();
  const at = (...a) => new Date(...a).getTime();
  assert.equal(relativeTimeCompact(now - 20_000, now), 'Just now');
  assert.equal(relativeTimeCompact(now + 60_000, now), 'Just now');
  assert.equal(relativeTimeCompact(now - 40 * 60_000, now), '40m');
  assert.equal(relativeTimeCompact(at(2026, 9, 22, 13, 10), now), '2h');
  assert.equal(relativeTimeCompact(at(2026, 9, 22, 0, 5), now), '15h');
  assert.equal(relativeTimeCompact(at(2026, 9, 21, 23, 50), now), 'Yesterday');
  assert.equal(relativeTimeCompact(at(2026, 9, 19, 9, 0), now),
    new Date(2026, 9, 19).toLocaleDateString(undefined, { weekday: 'short' }));
  assert.equal(relativeTimeCompact(at(2026, 8, 30, 9, 0), now),
    new Date(2026, 8, 30).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  assert.equal(relativeTimeCompact(at(2025, 11, 30, 9, 0), now),
    new Date(2025, 11, 30).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
  assert.equal(relativeTimeCompact(null, now), '');
});

test('just past midnight, a comment from a couple of hours ago is hours ago, not Yesterday', () => {
  const now = new Date(2026, 9, 22, 0, 48).getTime();
  assert.equal(relativeTimeCompact(now - 2 * 3600e3, now), '2h');
  assert.equal(relativeTimeCompact(now - (5 * 60 + 59) * 60e3, now), '5h');
  assert.equal(relativeTimeCompact(now - 7 * 3600e3, now), 'Yesterday');
});

test('a reply\'s @-mention: the word being typed after @, and only the people still named when it\'s sent', async () => {
  const { detectMentionToken, matchMentions } = await import('./commentMentionText.js');
  assert.deepEqual(detectMentionToken('Ask @jo', 7), { tokenStart: 4, query: 'jo' });
  assert.deepEqual(detectMentionToken('@', 1), { tokenStart: 0, query: '' });
  assert.equal(detectMentionToken('Ask jo', 6), null);
  assert.equal(detectMentionToken('mail me@x then ', 15), null);
  const picked = [{ id: 'u1', name: 'Jon Park' }, { id: 'u2', name: 'Maya' }, { id: 'u1', name: 'Jon Park' }];
  assert.deepEqual(matchMentions('@Jon Park can you shoot it?', picked), ['u1']);
  assert.deepEqual(matchMentions('nobody now', picked), []);
});
