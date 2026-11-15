// listItemWords is the app's mirror of listItem.js's LIST_WORDS: every item
// toListItem builds reads the same with either, in English.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { toListItem, LIST_WORDS, TYPE_LABELS } from './listItem.js';
import { listItemWords } from './listItemWords.js';
import { setUiLocale } from './uiLocale.js';

afterEach(() => setUiLocale('en'));

const KINDS = ['image', 'pdf', 'video', 'audio', 'file', 'note', 'link', 'doc', 'palette', 'schedule', 'shape', 'grid', 'board', 'boardlink', 'shortcut', 'mystery', undefined];
const FAMILIES = ['markdown', 'text', 'code', 'table', 'subtitles', 'font', 'mail', 'design', 'zip', 'listed', 'none', undefined];

test('same words as LIST_WORDS, one by one', () => {
  assert.deepEqual(Object.keys(listItemWords).sort(), Object.keys(LIST_WORDS).sort());
  for (const k of KINDS) {
    assert.equal(listItemWords.typeLabel(k), LIST_WORDS.typeLabel(k), `typeLabel ${k}`);
    assert.equal(listItemWords.fallbackName(k), LIST_WORDS.fallbackName(k), `fallbackName ${k}`);
  }
  for (const f of FAMILIES) assert.equal(listItemWords.familyLabel(f), LIST_WORDS.familyLabel(f), `familyLabel ${f}`);
  assert.equal(listItemWords.itemName(), LIST_WORDS.itemName());
  assert.equal(listItemWords.shapeName('star'), LIST_WORDS.shapeName('star'));
  for (const n of [0, 1, 2, 5, 30, 999]) {
    for (const k of ['pages', 'lines', 'colors', 'scheduleItems', 'scheduleRows']) {
      assert.equal(listItemWords[k](n), LIST_WORDS[k](n), `${k}(${n})`);
    }
  }
  for (const iso of ['2026-06-15', 'bad', undefined]) assert.equal(listItemWords.monthTitle(iso), LIST_WORDS.monthTitle(iso));
});

test('every kind in TYPE_LABELS is covered by the mirror', () => {
  for (const [kind, label] of Object.entries(TYPE_LABELS)) assert.equal(listItemWords.typeLabel(kind), label, kind);
});

test('toListItem builds the same item with either set of words', () => {
  const cards = [
    { id: 'a', kind: 'image', src: 'r2:k' },
    { id: 'b', kind: 'pdf', pageCount: 1, src: 'r2:p' },
    { id: 'b2', kind: 'pdf', pageCount: 12 },
    { id: 'c', kind: 'video' }, { id: 'd', kind: 'audio' }, { id: 'e', kind: 'file' },
    { id: 'f', kind: 'file', fileName: 'notes.md', ext: 'md', fileSrc: 'r2:k/notes.md' },
    { id: 'f2', kind: 'file', fileName: 'x.zip', ext: 'zip', fileSrc: 'r2:k/x.zip' },
    { id: 'g', kind: 'note', html: '' }, { id: 'h', kind: 'link' },
    { id: 'i', kind: 'doc', lines: [{ t: 'a' }] }, { id: 'j', kind: 'palette', swatches: [{ hex: '#fff' }] },
    { id: 'k', kind: 'schedule', rows: [{ day: 'Mon' }] },
    { id: 'k2', kind: 'schedule', schedView: true, anchor: '2026-06-15', cells: {} },
    { id: 'k3', kind: 'schedule', schedView: true, cells: {} },
    { id: 'l', kind: 'shape' }, { id: 'l2', kind: 'shape', shape: 'star' },
    { id: 'm', kind: 'grid' }, { id: 'n', kind: 'board' }, { id: 'o', kind: 'boardlink' },
    { id: 'p', kind: 'mystery' }, { id: 'q' },
  ];
  for (const card of cards) {
    const plain = toListItem(card, {});
    const viaApp = toListItem(card, { words: listItemWords });
    assert.deepEqual(viaApp, plain, card.id);
  }
});
