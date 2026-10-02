import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitySearchFilter, entitySearchRank } from './entitySearchFilter.js';

test('search looks at the title, the text and an uploaded file\'s own name', () => {
  assert.equal(entitySearchFilter('diner'),
    'title.ilike.%diner%,body.ilike.%diner%,meta->>fileName.ilike.%diner%');
});

test('PostgREST syntax in a query is searched for, never parsed', () => {
  assert.equal(entitySearchFilter('Act II (rev), "final" 100%'),
    'title.ilike.%Act II rev final 100%,body.ilike.%Act II rev final 100%,meta->>fileName.ilike.%Act II rev final 100%');
  assert.equal(entitySearchFilter(' ( ) , % '), null, 'nothing left to search for');
  assert.equal(entitySearchFilter(''), null);
});

test('a photo with no title ranks by its file name', () => {
  const lq = 'diner_ext_dusk_04.jpg';
  const photo = { title: '', meta: { fileName: 'diner_ext_dusk_04.jpg' } };
  const note = { title: 'notes about diner_ext_dusk_04.jpg' };
  assert.equal(entitySearchRank(photo, lq), 0, 'an exact file name is an exact match');
  assert.ok(entitySearchRank(photo, lq) < entitySearchRank(note, lq));
  assert.equal(entitySearchRank({ title: 'Diner, dusk', meta: { fileName: 'x.jpg' } }, 'diner'), 1,
    'a typed title still decides when there is one');
});
