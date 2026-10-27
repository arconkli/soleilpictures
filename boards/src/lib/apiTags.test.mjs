// apiTags — tags through the API: what a request to tag cards may say, how a
// name is read and matched as the workspace matches it (by slug, any case), a
// board's tags gathered from its links with what is still on it, and each
// thing a tag is on in the shape the API lists it.
//
// Run: node --test src/lib/apiTags.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TAGS, cleanTagName, tagSlug, readTagRequest, matchTags, isDeadTag, publicTag, boardTags, taggedItem,
} from './apiTags.js';
import { TOOLS } from './mcpTools.js';

const T1 = '0c9a1f3e-1111-4111-8111-111111111111';
const T2 = '0c9a1f3e-2222-4222-8222-222222222222';
const B1 = '11111111-1111-4111-8111-111111111111';
const problem = (b) => readTagRequest(b).problem;

test('a tag\'s name: spaces collapsed, a leading # dropped, nothing left is no name', () => {
  assert.equal(cleanTagName('  Night   exterior '), 'Night exterior');
  assert.equal(cleanTagName('#Diner'), 'Diner');
  assert.equal(cleanTagName('## Diner'), 'Diner');
  assert.equal(cleanTagName('#'), null);
  assert.equal(cleanTagName('   '), null);
  assert.equal(cleanTagName(42), null);
  assert.equal(tagSlug('Night Exterior'), 'night exterior');
});

test('readTagRequest: cards and tags, each tag a name or an id, the same one once', () => {
  const r = readTagRequest({ card_ids: ['c1', 'c2', 'c1'], add: ['Diner', 'diner', ` ${T1.toUpperCase()} `], remove: ['#Day'] });
  assert.equal(r.problem, undefined);
  assert.deepEqual(r.cardIds, ['c1', 'c2']);
  assert.deepEqual(r.add, [{ name: 'Diner', slug: 'diner' }, { name: T1.toUpperCase(), id: T1 }]);
  assert.deepEqual(r.remove, [{ name: 'Day', slug: 'day' }]);
  assert.deepEqual(readTagRequest({ card_ids: ['c1'], remove: ['Day'] }).add, []);
});

test('readTagRequest: says what to fix', () => {
  for (const [b, re] of [
    [null, /send \{"card_ids"/],
    [[], /send \{"card_ids"/],
    [{ card_ids: ['c1'], add: ['x'], tags: ['y'] }, /tags isn't a field here/],
    [{ add: ['x'] }, /card_ids must list the cards/],
    [{ card_ids: [], add: ['x'] }, /card_ids must list the cards/],
    [{ card_ids: ['c1', 7], add: ['x'] }, /ids of cards/],
    [{ card_ids: ['x'.repeat(201)], add: ['x'] }, /ids of cards/],
    [{ card_ids: Array.from({ length: TAGS.maxCards + 1 }, (_, i) => `c${i}`), add: ['x'] }, new RegExp(`at most ${TAGS.maxCards}`)],
    [{ card_ids: ['c1'] }, /name the tags to add, or to remove/],
    [{ card_ids: ['c1'], add: [], remove: [] }, /name the tags/],
    [{ card_ids: ['c1'], add: 'Diner' }, /add must be a list/],
    [{ card_ids: ['c1'], add: ['  '] }, /isn't one/],
    [{ card_ids: ['c1'], add: ['a\u0007b'] }, /isn't one/],
    [{ card_ids: ['c1'], remove: [null] }, /remove must list tag names/],
    [{ card_ids: ['c1'], add: Array.from({ length: TAGS.maxNames + 1 }, (_, i) => `t${i}`) }, new RegExp(`at most ${TAGS.maxNames}`)],
    [{ card_ids: ['c1'], add: ['x'.repeat(TAGS.maxName + 1)] }, new RegExp(`at most ${TAGS.maxName} characters`)],
    [{ card_ids: ['c1'], add: ['Diner'], remove: ['#diner'] }, /Diner is both added and removed/],
    [{ card_ids: ['c1'], add: [T1], remove: [T1.toUpperCase()] }, /both added and removed/],
  ]) assert.match(problem(b) || '', re, JSON.stringify(b)?.slice(0, 80));
  // A long name is fine for a tag the workspace already has: only a new one is held to the limit.
  assert.equal(problem({ card_ids: ['c1'], remove: ['x'.repeat(TAGS.maxName + 1)] }), undefined);
});

test('matchTags: by id, or by name in any case, deleted tags included', () => {
  const rows = [
    { id: T1, name: 'Diner', slug: 'diner', status: 'active', deleted_at: null },
    { id: T2, name: 'Day', status: 'deleted', deleted_at: '2026-10-20T00:00:00Z' },
  ];
  const [a, b, c, d] = matchTags([{ name: 'DINER', slug: 'diner' }, { name: 'day', slug: 'day' },
    { name: T1, id: T1 }, { name: 'Dusk', slug: 'dusk' }], rows);
  assert.equal(a.row.id, T1);
  assert.equal(b.row.id, T2, 'a row read without its slug is matched by its name');
  assert.equal(c.row.id, T1);
  assert.equal(d.row, null);
  assert.equal(isDeadTag(rows[0]), false);
  assert.equal(isDeadTag(rows[1]), true);
  assert.equal(isDeadTag({ status: 'hidden', deleted_at: null }), false, 'the app lists and applies every status but deleted');
  assert.equal(isDeadTag({ status: 'active', deleted_at: '2026-10-20T00:00:00Z' }), true);
});

test('publicTag: the fields a tag is shown with, items only when counted', () => {
  const row = { id: T1, name: 'Diner', slug: 'diner', status: 'active', kind: 'user', workspace_id: 'w', created_at: 'then' };
  assert.deepEqual(publicTag(row), {
    id: T1, name: 'Diner', color: null, entity_type: null, description: null, created_at: 'then',
  });
  assert.equal(publicTag(row, 3).items, 3);
  assert.equal(publicTag(row, null).items, null);
});

test('boardTags: each tag with what carries it on the board, once, by name; the gone left out', () => {
  const tags = [
    { id: T1, name: 'diner' },
    { id: T2, name: 'Characters' },
    { id: 'idle', name: 'Idle' },
  ];
  const links = [
    { source_kind: 'card', source_id: 'c1', target_id: T1 },
    { source_kind: 'card', source_id: 'c1', target_id: T1 },
    { source_kind: 'card', source_id: 'gone', target_id: T1 },
    { source_kind: 'group', source_id: 'g1', target_id: T1 },
    { source_kind: 'doc', source_id: 'd1', source_page_id: 'p1', target_id: T1 },
    { source_kind: 'doc', source_id: 'd1', source_page_id: null, target_id: T1 },
    { source_kind: 'board', source_id: B1, target_id: T2 },
    { source_kind: 'board', source_id: 'another', target_id: 'idle' },
    { source_kind: 'card', source_id: 'c2', target_id: 'not-readable' },
  ];
  const live = { cards: new Set(['c1', 'd1']), groups: new Set(['g1']) };
  const out = boardTags(links, tags, B1, live);
  assert.deepEqual(out.map((t) => t.name), ['Characters', 'diner'], 'by name, and a tag carrying nothing here is not listed');
  assert.deepEqual([out[0].on_board, out[0].cards], [true, []]);
  assert.deepEqual([out[1].on_board, out[1].cards, out[1].groups, out[1].pages],
    [false, ['c1'], ['g1'], [{ card_id: 'd1', page_id: 'p1' }]]);
  // Without knowing what is on the board, every link counts.
  assert.deepEqual(boardTags(links, tags, B1).find((t) => t.id === T1).cards, ['c1', 'gone']);
});

test('taggedItem: a card, a group, a board, a doc page, each with where it is and a link', () => {
  const o = 'https://clusters.test';
  const card = taggedItem({
    applied_at: 't', applied_source: 'user', id: `${B1}:c1`, kind: 'image', title: 'Booth', body: '',
    card_body: 'A booth by the window, at night', board_id: B1, card_id: 'c1', board_name: 'Locations',
  }, o);
  assert.deepEqual(card, {
    kind: 'card', card_kind: 'image', board_id: B1, auto: false, tagged_at: 't', board_name: 'Locations',
    card_id: 'c1', title: 'Booth', excerpt: 'A booth by the window, at night', url: `${o}/?to=c:${B1}:c1`,
  });
  const group = taggedItem({ applied_source: 'auto', kind: 'group', title: 'Stills', board_id: B1, group_id: 'g1', member_count: 4 }, o);
  assert.deepEqual([group.kind, group.auto, group.group_id, group.cards, group.url], ['group', true, 'g1', 4, `${o}/?to=b:${B1}`]);
  const board = taggedItem({ applied_source: 'auto-backfill', kind: 'board', id: B1, board_id: B1, title: 'Diner' }, o);
  assert.deepEqual([board.kind, board.auto, board.board_id, board.title, board.url], ['board', true, B1, 'Diner', `${o}/?to=b:${B1}`]);
  const page = taggedItem({
    applied_source: 'ai', kind: 'doc', title: 'Opening', body: `INT. DINER ${'x'.repeat(300)}`, board_id: B1, card_id: 'd1', page_id: 'p1',
  }, o);
  assert.deepEqual([page.kind, page.auto, page.card_id, page.page_id, page.url], ['doc_page', true, 'd1', 'p1', `${o}/?to=c:${B1}:d1`]);
  assert.equal(page.excerpt.length, 200);
});

test('the MCP tools\' limits are the API\'s', () => {
  const tool = (n) => TOOLS.find((t) => t.name === n).inputSchema.properties;
  assert.equal(tool('tag_cards').card_ids.maxItems, TAGS.maxCards);
  assert.equal(tool('tag_cards').add.maxItems, TAGS.maxNames);
  assert.equal(tool('tag_cards').remove.maxItems, TAGS.maxNames);
  assert.equal(tool('list_tags').limit.maximum, TAGS.maxItems);
});
