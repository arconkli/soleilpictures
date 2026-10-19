import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SHELVES, SHELF_IDS, SHELF_OF_KIND, SHELF_BUCKETS, FILTER_CHIPS, shelfOf, shelfById,
} from './sidebarShelves.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '../../../supabase/migrations');

// The migration that defines sidebar_shelf_of last is the one in force (0419
// made it, 0428 moved docs onto the files shelf).
function newestDefinition() {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8');
    if (sql.includes('function public.sidebar_shelf_of')) found = { file: f, sql };
  }
  return found;
}

// Pull sidebar_shelf_of's CASE out of that migration: every `when p_kind = 'x'`
// and `when p_kind in ('a', 'b')` arm, plus the else.
function sqlShelfMap() {
  const { sql } = newestDefinition();
  const body = sql.slice(sql.indexOf('function public.sidebar_shelf_of'));
  const fn = body.slice(0, body.indexOf('$$;'));
  const map = {};
  const arm = /when p_kind (?:= '([a-z]+)'|in \(([^)]*)\)) then (null|'([a-z]+)')/g;
  for (const m of fn.matchAll(arm)) {
    const kinds = m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim().replace(/'/g, ''));
    for (const k of kinds) map[k] = m[3] === 'null' ? null : m[4];
  }
  const other = fn.match(/else '([a-z]+)'/);
  return { map, other: other && other[1] };
}

test('the SQL twin puts every kind on the same shelf as the client', () => {
  const { map, other } = sqlShelfMap();
  assert.ok(Object.keys(map).length >= 8, `parsed the CASE arms out of ${newestDefinition().file}`);
  assert.ok(newestDefinition().file >= '0428', 'the newest definition is the one that moved docs');
  assert.deepEqual(map, { ...SHELF_OF_KIND });
  assert.equal(other, 'more');
  assert.equal(shelfOf('grid'), other);
});

test('shelves come in the order people look for them', () => {
  assert.deepEqual(SHELF_IDS, ['photos', 'video', 'audio', 'files', 'writing', 'links', 'more']);
  assert.equal(shelfById('photos').layout, 'rows', 'photos list like everything else: no mosaic');
  for (const id of ['photos', 'video', 'audio', 'files']) assert.equal(shelfById(id).layout, 'rows', `${id} are files: listed`);
  for (const id of ['writing', 'links', 'more']) assert.equal(shelfById(id).layout, 'fold', `${id} is summed up`);
  assert.deepEqual(['writing', 'links', 'more'].map((id) => shelfById(id).label), ['Notes', 'Links', 'Other']);
  assert.equal(shelfById('nope'), null);
});

test('clusters are never contents, unknown kinds are never lost', () => {
  assert.equal(shelfOf('board'), null);
  assert.equal(shelfOf('boardlink'), null);
  for (const k of ['grid', 'schedule', 'palette', 'shape', 'art', 'vote', 'something-new']) {
    assert.equal(shelfOf(k), 'more', k);
  }
  assert.equal(shelfOf(undefined), 'writing', 'a card without a kind is a note');
  assert.equal(shelfOf('doc'), 'files', 'a doc is a file people write');
  assert.equal(shelfOf('toString'), 'more', 'prototype keys are not kinds');
});

test('every shelf can open in the full-page Files view', () => {
  for (const id of SHELF_IDS) assert.ok(SHELF_BUCKETS[id]?.length, id);
  assert.deepEqual(SHELF_BUCKETS.files, ['pdf', 'file', 'doc']);
  assert.deepEqual(SHELF_BUCKETS.writing, ['note']);
});

test('the chips are All, the shelves people filter by, and Not on board', () => {
  assert.equal(FILTER_CHIPS[0].id, 'all');
  assert.equal(FILTER_CHIPS.at(-1).id, 'unplaced');
  assert.equal(FILTER_CHIPS.at(-1).label, 'Not on board');
  for (const c of FILTER_CHIPS.slice(1, -1)) assert.ok(SHELVES.some((s) => s.id === c.id), c.id);
});
