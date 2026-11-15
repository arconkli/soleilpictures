// isDefaultName: the names the app writes into people's data ("Untitled doc"),
// compared in every language. The table comes from the catalogs' "default name"
// entries (scripts/i18nDefaultNames.mjs); this tests the compare, the generator
// on a temporary copy of the catalogs, and the compares that use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDefaultName } from './defaultNames.js';
import DEFAULT_NAMES from './defaultNames.data.js';
import { collect, render, check, union, readExisting, LEGACY } from '../../scripts/i18nDefaultNames.mjs';
import { suggestClusterName } from './clusterFromSelection.js';

const WRITTEN = ['Untitled', 'Untitled doc', 'Untitled cluster', 'Untitled script', 'Group'];

test('every name the app writes is a default in English', () => {
  for (const name of WRITTEN) assert.equal(isDefaultName(name, name), true, name);
  for (const name of WRITTEN) assert.ok(name in DEFAULT_NAMES, `${name} is in the generated table`);
});

test('"Untitled list" stays a default as the older English name of a cluster', () => {
  assert.deepEqual(LEGACY, ['Untitled list']);
  assert.equal(isDefaultName('Untitled list', 'Untitled list'), true);
  assert.equal(isDefaultName(['Untitled cluster', 'Untitled list'], 'untitled list'), true);
});

test('case and spacing do not matter', () => {
  assert.equal(isDefaultName('Untitled doc', 'untitled doc'), true);
  assert.equal(isDefaultName('Untitled doc', 'UNTITLED DOC'), true);
  assert.equal(isDefaultName('Untitled doc', '  Untitled doc \n'), true);
  assert.equal(isDefaultName('Untitled doc', 'Untitled  doc'), false, 'inner spacing is part of the name');
});

test('names that are not defaults', () => {
  assert.equal(isDefaultName('Untitled doc', 'Treatment v4'), false);
  assert.equal(isDefaultName('Untitled doc', 'Untitled doc 2'), false);
  assert.equal(isDefaultName('Untitled doc', 'My Untitled doc'), false);
  assert.equal(isDefaultName('Untitled doc', ''), false);
  assert.equal(isDefaultName('Untitled doc', '   '), false);
  assert.equal(isDefaultName('Untitled doc', null), false);
  assert.equal(isDefaultName('Untitled doc', undefined), false);
  // One default is not another: a page's name is not a doc's.
  assert.equal(isDefaultName('Untitled doc', 'Untitled cluster'), false);
  assert.equal(isDefaultName('Untitled cluster', 'Untitled doc'), false);
});

test('a list of defaults matches any of them', () => {
  const tracking = ['Untitled', 'Untitled doc'];
  assert.equal(isDefaultName(tracking, 'Untitled'), true);
  assert.equal(isDefaultName(tracking, 'untitled doc'), true);
  assert.equal(isDefaultName(tracking, 'Untitled script'), false);
});

test('a name nobody generated still matches its own English', () => {
  assert.equal(isDefaultName('Untitled group', 'Untitled group', {}), true);
  assert.equal(isDefaultName('Untitled group', 'Grupo sin título', {}), false);
});

test('a translation counts, from an injected table', () => {
  const table = { 'Untitled doc': ['Documento sin título', 'Untitled doc'], 'Untitled': ['Sin título'] };
  assert.equal(isDefaultName('Untitled doc', 'documento SIN título', table), true);
  assert.equal(isDefaultName('Untitled doc', 'Untitled doc', table), true);
  assert.equal(isDefaultName('Untitled doc', 'Sin título', table), false, 'a page default is not a doc default');
  assert.equal(isDefaultName(['Untitled', 'Untitled doc'], 'Sin título', table), true);
  assert.equal(isDefaultName('Untitled doc', 'Otro nombre', table), false);
});

// A temporary copy of the catalogs, with a translation written into it.
function withCatalogs(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'default-names-'));
  try {
    for (const [locale, body] of Object.entries(files)) {
      mkdirSync(join(dir, locale));
      writeFileSync(join(dir, locale, 'messages.po'), `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\n${body}`);
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const entry = (id, str, ctx = 'default name') => `msgctxt "${ctx}"\nmsgid "${id}"\nmsgstr "${str}"\n\n`;

test('the generator collects English and every non-empty translation, sorted', () => {
  withCatalogs({
    en: entry('Untitled doc', '') + entry('Untitled', ''),
    es: entry('Untitled doc', 'Documento sin título') + entry('Untitled', 'Sin título'),
    fr: entry('Untitled doc', 'Document sans titre') + entry('Untitled', ''),
    ja: entry('Untitled doc', '無題のドキュメント'),
    // Another context is not a default name, nor is a message with none.
    ru: entry('Untitled doc', 'Не то', 'keyboard key') + 'msgid "Untitled doc"\nmsgstr "Тоже не то"\n\n',
  }, (dir) => {
    const table = collect(dir);
    assert.deepEqual(table['Untitled doc'], ['Documento sin título', 'Document sans titre', 'Untitled doc', '無題のドキュメント'].sort());
    assert.deepEqual(table.Untitled, ['Sin título', 'Untitled']);
    assert.deepEqual(table['Untitled list'], ['Untitled list']);
    assert.deepEqual(Object.keys(table), [...Object.keys(table)].sort());
    assert.equal(table['Untitled doc'].includes('Не то'), false);
    assert.equal(table['Untitled doc'].includes('Тоже не то'), false);
    // And the compare answers from it.
    assert.equal(isDefaultName('Untitled doc', 'document SANS titre', table), true);
    assert.equal(isDefaultName('Untitled doc', '無題のドキュメント', table), true);
    assert.equal(isDefaultName('Untitled', 'Document sans titre', table), false);
  });
});

test('the generator is stable and the staleness check sees a changed catalog', () => {
  withCatalogs({ en: entry('Untitled doc', ''), es: entry('Untitled doc', 'Documento sin título') }, (dir) => {
    const out = join(dir, 'defaultNames.data.js');
    assert.equal(check({ localesDir: dir, out }), false, 'no data file yet: stale');
    writeFileSync(out, render(collect(dir)));
    assert.equal(check({ localesDir: dir, out }), true);
    assert.equal(render(collect(dir)), readFileSync(out, 'utf8'), 'same input, same file');
    writeFileSync(join(dir, 'es', 'messages.po'), `msgid ""\nmsgstr ""\n\n${entry('Untitled doc', 'Documento nuevo')}`);
    assert.equal(check({ localesDir: dir, out }), false, 'a translation changed: stale');
  });
});

test('the data file is append-only: a name the catalogs no longer hold is kept', () => {
  withCatalogs({ en: entry('Untitled doc', ''), es: entry('Untitled doc', 'Documento nuevo') }, (dir) => {
    const out = join(dir, 'defaultNames.data.js');
    writeFileSync(out, render({ 'Untitled doc': ['Documento sin título', 'Untitled doc'], 'Old name': ['Old name'] }));
    const merged = union(collect(dir), readExisting(out));
    assert.deepEqual(merged['Untitled doc'], ['Documento nuevo', 'Documento sin título', 'Untitled doc']);
    assert.deepEqual(merged['Old name'], ['Old name']);
    assert.equal(check({ localesDir: dir, out }), false, 'the file lacks the new name: stale');
    writeFileSync(out, render(merged));
    assert.equal(check({ localesDir: dir, out }), true, 'kept names do not make it stale');
  });
});

test('the data file is plain data: no imports, no macros', () => {
  const source = readFileSync(new URL('./defaultNames.data.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  const logic = readFileSync(new URL('./defaultNames.js', import.meta.url), 'utf8');
  assert.doesNotMatch(logic, /@lingui/);
  assert.deepEqual([...logic.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['./defaultNames.data.js']);
});

test('clusterFromSelection: a group nobody named is not a name, in English as before', () => {
  const cards = [{ kind: 'note', text: 'Alpha beta gamma' }];
  for (const g of ['Group', 'group', 'Untitled group', 'untitled', 'New group', '  GROUP ']) {
    assert.equal(suggestClusterName({ groupName: g, cards: [] }), suggestClusterName({ groupName: null, cards: [] }), g);
  }
  assert.equal(suggestClusterName({ groupName: 'Locations', cards }), 'Locations');
});

test('a new swatch\'s default name is not a custom name, in any language', async () => {
  const { hasCustomName } = await import('./paletteLayout.js');
  const table = { Color: ['Color', 'Couleur'] };
  assert.equal(hasCustomName('Color'), false);
  assert.equal(hasCustomName('  color '), false);
  assert.equal(hasCustomName('Couleur', table), false);
  assert.equal(hasCustomName('couleur', table), false);
  assert.equal(hasCustomName('Couleur', { Color: ['Color'] }), true, 'not a default when the table lacks it');
  assert.equal(hasCustomName('Couleur'), false, 'the shipped table knows every language');
  assert.equal(hasCustomName('Sky', table), true);
  assert.equal(hasCustomName(''), false);
  assert.equal(hasCustomName(null), false);
});
