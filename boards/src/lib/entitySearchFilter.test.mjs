import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entitySearchFilter, entitySearchRank } from './entitySearchFilter.js';

test('search looks at the title, the text and an uploaded file\'s own name', () => {
  assert.equal(entitySearchFilter('diner'),
    'title.ilike.%diner%,body.ilike.%diner%,meta->>fileName.ilike.%diner%,seen.ilike.%diner%,fold.ilike.%diner%');
  assert.equal(entitySearchFilter('diner', { fold: false }),
    'title.ilike.%diner%,body.ilike.%diner%,meta->>fileName.ilike.%diner%,seen.ilike.%diner%');
});

test('PostgREST syntax in a query is searched for, never parsed', () => {
  assert.equal(entitySearchFilter('Act II (rev), "final" 100%'),
    'title.ilike.%Act II rev final 100%,body.ilike.%Act II rev final 100%,meta->>fileName.ilike.%Act II rev final 100%,seen.ilike.%Act II rev final 100%,fold.ilike.%Act II rev final 100%');
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

test('the words inside documents are searched by page text and page title', async () => {
  const { docPageSearchFilter } = await import('./entitySearchFilter.js');
  assert.equal(docPageSearchFilter('rain on the glass'),
    'page_text.ilike.%rain on the glass%,page_title.ilike.%rain on the glass%,fold.ilike.%rain on the glass%');
  assert.equal(docPageSearchFilter('rain', { fold: false }), 'page_text.ilike.%rain%,page_title.ilike.%rain%');
  assert.equal(docPageSearchFilter('(,)'), null);
});

test('a picture found only by what is in it says so; one found by its own words does not', async () => {
  const { foundOnlyInPicture } = await import('./entitySearchFilter.js');
  const photo = { kind: 'image', title: '', body: '', meta: { fileName: 'DSC_0412.jpg', src: 'r2:w/x.jpg' } };
  assert.equal(foundOnlyInPicture(photo, 'neon'), true);
  assert.equal(foundOnlyInPicture(photo, 'dsc_0412'), false, 'its file name holds the word');
  assert.equal(foundOnlyInPicture({ ...photo, title: 'Neon signs' }, 'neon'), false, 'its caption holds it');
  assert.equal(foundOnlyInPicture({ kind: 'note', title: '', body: '' }, 'neon'), false, 'only pictures are described');
  assert.equal(foundOnlyInPicture(photo, '  '), false);
});

test('the folded query is ORed in beside the raw words, so accents never decide a match', async () => {
  const { isMissingColumn } = await import('./entitySearchFilter.js');
  assert.equal(entitySearchFilter('Caf\u00e9'),
    'title.ilike.%Caf\u00e9%,body.ilike.%Caf\u00e9%,meta->>fileName.ilike.%Caf\u00e9%,seen.ilike.%Caf\u00e9%,title.ilike.%Cafe%,body.ilike.%Cafe%,meta->>fileName.ilike.%Cafe%,seen.ilike.%Cafe%,fold.ilike.%Cafe%');
  assert.match(entitySearchFilter('Cafe\u0301'), /^title\.ilike\.%Caf\u00e9%.*fold\.ilike\.%Cafe%$/, 'typed decomposed, searched composed');
  assert.ok(isMissingColumn({ code: '42703' }));
  assert.ok(isMissingColumn({ detail: 'select card_index 400: {"code":"42703","message":"column card_index.fold does not exist"}' }));
  assert.ok(!isMissingColumn({ code: '42501' }));
  assert.ok(!isMissingColumn(null));
});

test('full-width punctuation that NFKD turns into filter syntax is cleaned after the fold', async () => {
  const { docPageSearchFilter } = await import('./entitySearchFilter.js');
  for (const q of ['东京，大阪', '（仮）', '５０％']) {
    for (const f of [entitySearchFilter(q), docPageSearchFilter(q)]) {
      // every term is `col.ilike.%value%`; the only commas are the separators
      for (const term of f.split(',')) {
        assert.match(term, /^[\w>-]+\.ilike\.%[^,()"%]*%$/, `${q}: ${term}`);
      }
    }
  }
});

test('a fold that leaves nothing adds no empty fold term', async () => {
  const { docPageSearchFilter } = await import('./entitySearchFilter.js');
  assert.ok(!docPageSearchFilter('́x́').includes('fold.ilike.%%'));
  assert.ok(!entitySearchFilter('ًً').includes('fold.ilike.%%'));
});

test('folding works both ways: an accented query reaches rows stored plain', async () => {
  const { docPageSearchFilter } = await import('./entitySearchFilter.js');
  const f = entitySearchFilter('café');
  for (const col of ['title', 'body', 'meta->>fileName', 'seen']) {
    assert.ok(f.includes(`${col}.ilike.%cafe%`), col);
  }
  assert.ok(f.includes('fold.ilike.%cafe%'));
  const d = docPageSearchFilter('café');
  assert.ok(d.includes('page_text.ilike.%cafe%') && d.includes('page_title.ilike.%cafe%'));
  // a plain query adds no duplicate raw terms; it still reaches "Café" through fold
  assert.equal(entitySearchFilter('cafe').split(',').length, 5);
  assert.ok(entitySearchFilter('café', { fold: false }).includes('title.ilike.%cafe%'));
});
