import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTO_RANGE_SOURCES, findWordAnchor, planRangeReconcile } from './docRangeReconcile.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

const P1 = { pHash: 'h1', text: 'Astrid walks into the diner and orders coffee.' };
const P2 = { pHash: 'h2', text: 'Later, astrid meets Moe outside the Astridville sign.' };
const row = (over) => ({ id: 'r', source: 'user', target_id: 'tag-astrid', source_anchor: { pHash: 'gone', startOffset: 0, length: 6 }, ...over });

test('the cascade\'s own orphans are dropped, a person\'s are never dropped', () => {
  const plan = planRangeReconcile([
    row({ id: 'auto', source: 'auto-word' }),
    row({ id: 'mine', source: 'user', source_anchor: { pHash: 'gone', startOffset: 0, length: 6, text: 'Astrid' } }),
  ], [P1], () => 'Astrid');
  assert.deepEqual(plan.drop, ['auto']);
  assert.deepEqual(plan.toPage, []);
  assert.equal(plan.move.length, 1);
  assert.equal(plan.move[0].id, 'mine');
  assert.deepEqual(plan.move[0].anchor, { pHash: 'h1', startOffset: 0, length: 6, text: 'Astrid' });
});

test('every automatic source counts as the cascade\'s', () => {
  for (const source of AUTO_RANGE_SOURCES) {
    assert.deepEqual(planRangeReconcile([row({ id: source, source })], [P1]).drop, [source]);
  }
});

test('a range on a live paragraph is left alone', () => {
  const plan = planRangeReconcile([row({ source_anchor: { pHash: 'h1', startOffset: 0, length: 6 } })], [P1]);
  assert.deepEqual(plan, { drop: [], move: [], toPage: [] });
});

test('with no anchor text the tag\'s name finds the word; gone, it becomes a page tag', () => {
  const moved = planRangeReconcile([row({ id: 'a' })], [P1], () => 'Astrid');
  assert.equal(moved.move[0].anchor.pHash, 'h1');
  const paged = planRangeReconcile([row({ id: 'b' })], [{ pHash: 'h3', text: 'Nobody by that name is here at all.' }], () => 'Astrid');
  assert.deepEqual(paged.toPage, ['b']);
});

test('whole words only, any case, and never onto a word the tag already holds', () => {
  const taken = new Set(['tag-astrid|h2|7|6']);
  // "Astridville" is not "Astrid"; "astrid" at 7 is taken; nothing else in P2.
  assert.equal(findWordAnchor([P2], 'Astrid', 'tag-astrid', taken), null);
  assert.deepEqual(findWordAnchor([P2], 'Astrid', 'tag-astrid', new Set()),
    { pHash: 'h2', startOffset: 7, length: 6, text: 'astrid' });
  // Two orphans of one tag land on two different words.
  const plan = planRangeReconcile([row({ id: 'x' }), row({ id: 'y' })], [P1, P2], () => 'Astrid');
  assert.deepEqual(plan.move.map((m) => [m.id, m.anchor.pHash, m.anchor.startOffset]), [['x', 'h1', 0], ['y', 'h2', 7]]);
});

test('a word with regex characters is matched literally', () => {
  const p = { pHash: 'h', text: 'Meet Dr. (Who) at the T.A.R.D.I.S tonight please.' };
  assert.equal(findWordAnchor([p], '(Who)', 't', new Set())?.startOffset, 9);
  assert.equal(findWordAnchor([p], 'T.A.R.D.I.S', 't', new Set())?.startOffset, 22);
});

test('the doc paths only ever garbage-collect automatic rows', () => {
  const src = read('aiParagraphCascade.js');
  assert.match(src, /\.not\('source_anchor', 'is', null\)\s*\.in\('source', AUTO_RANGE_SOURCES\)/,
    'wipePageRangeRows must leave a person\'s ranges');
  assert.match(src, /\.eq\('source_anchor->>length', lengthStr\)\s*\.in\('source', AUTO_RANGE_SOURCES\)/,
    'the diff delete must leave a person\'s ranges');
  assert.doesNotMatch(src, /Stale GC/, 'the old delete-every-orphan GC is back');
});

test('saving a doc\'s links deletes only the link rows it writes', () => {
  const src = read('boardsApi.js');
  const fn = src.slice(src.indexOf('export async function updateBacklinks'));
  const del = fn.slice(fn.indexOf(".from('entity_links').delete()"), fn.indexOf('if (delNew.error)'));
  assert.match(del, /\.eq\('link_kind', 'mention'\)/);
  assert.match(del, /\.not\('source_link_id', 'is', null\)/);
  assert.doesNotMatch(del, /\.eq\('source', 'user'\)/, 'source=user alone also matched the page\'s tags');
});

test('a doc removal keeps the tag off the page, and undo restores the exact rows', () => {
  const src = read('tagsApi.js');
  for (const fn of ['untagDocRange', 'untagDocPage']) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const end = body.indexOf('\nexport ', 10);
    const own = body.slice(0, end > 0 ? end : undefined);
    assert.match(own, /\.select\(\)/, `${fn} must return the removed rows`);
    assert.match(own, /suppressDocPageTag\(/, `${fn} must write the doc_page suppression`);
  }
  assert.match(src, /targetKind: DOC_PAGE_IGNORE_KIND/);
  assert.match(src, /export const DOC_PAGE_IGNORE_KIND = 'doc_page'/,
    'the kind must match 0590\'s guard');
});

test('0590 guards every automatic tag insert and proves its grants', () => {
  const sql = readFileSync(join(here, '../../../supabase/migrations/0590_tag_autoapply_guard.sql'), 'utf8');
  assert.match(sql, /create trigger a_tag_autoapply_guard\s+before insert on public\.entity_links/);
  assert.match(sql, /coalesce\(new\.source, 'user'\) <> 'user'/);
  assert.match(sql, /i\.target_kind\s*=\s*'doc_page'/);
  assert.match(sql, /revoke execute on function public\._tg_entity_links_tag_autoapply_guard\(\) from public, anon, authenticated/);
  assert.match(sql, /has_function_privilege\('authenticated', 'public\._tg_entity_links_tag_autoapply_guard\(\)'/);
  assert.match(sql, /a\.source_page_id/, 'get_things_tagged must return page_id for doc rows');
});
