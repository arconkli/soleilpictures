// The mirror of the shared English: every bare shape and every section reads
// the same through gridLayoutWords as through gridLayout / gridLayoutLibrary.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from './gridLayout.js';
import { SOURCES, BUILT_IN_LAYOUTS, mergeSections, rowFromRecord } from './gridLayoutLibrary.js';
import { presetLabel, sectionTitle, localizeSections, localizeRow } from './gridLayoutWords.js';
import { setUiLocale } from './uiLocale.js';

afterEach(() => setUiLocale('en'));

test('every preset has the label the shared module has', () => {
  assert.ok(PRESETS.length >= 10);
  for (const p of PRESETS) assert.equal(presetLabel(p.id), p.label, p.id);
  assert.equal(presetLabel('no-such-shape'), null);
});

test('every section title equals mergeSections\' own', () => {
  const row = (source) => ({ key: `${source}:x`, id: 'x', name: 'x', tree: null, source });
  const merged = mergeSections({
    mine: [row(SOURCES.USER)], workspace: [row(SOURCES.WORKSPACE)], downloaded: [row(SOURCES.DOWNLOADED)],
    store: [row(SOURCES.STORE)], community: [row(SOURCES.COMMUNITY)],
  });
  assert.equal(merged.length, 6);
  for (const s of merged) assert.equal(sectionTitle(s.id), s.title, s.id);
  assert.equal(sectionTitle('nope'), null);
});

test('localizeSections keeps ids, order and rows; only titles and the shapes\' names are the words', () => {
  setUiLocale('es');   // catalogs are empty in node: the source English comes back
  const merged = mergeSections({ mine: [{ key: 'user:a', id: 'a', name: 'My grid', tree: null, source: SOURCES.USER }] });
  const out = localizeSections(merged);
  assert.deepEqual(out, merged);
  assert.equal(out.at(-1).rows.length, BUILT_IN_LAYOUTS.length);
  assert.equal(out[0].rows[0].name, 'My grid');   // a saved name is the person's own
});

test('a record with no name shows the stand-in through localizeRow; a named one is untouched', () => {
  const nameless = rowFromRecord({ id: 'x', body: { layout: PRESETS[0].tree } }, SOURCES.USER);
  assert.equal(nameless.name, 'Untitled');
  assert.equal(localizeRow(nameless).name, 'Untitled');   // English, and in a language with an empty catalog
  const named = rowFromRecord({ id: 'y', name: 'Mine', body: { layout: PRESETS[0].tree } }, SOURCES.USER);
  assert.equal(localizeRow(named), named);
  assert.equal(localizeRow(null), null);
});
