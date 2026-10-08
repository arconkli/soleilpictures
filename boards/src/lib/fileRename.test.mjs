// fileRename.test.mjs — renaming a file in Files.
//
//   node --test src/lib/fileRename.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRename, cleanName, renamePatch, NAME_MAX } from './fileRename.js';
import { assetFilename } from './cardAssetName.js';
import { toListItem } from './listItem.js';

test('each kind renames the field its name is shown from', () => {
  assert.deepEqual(renamePatch({ kind: 'image', title: 'a' }, 'Hero'), { title: 'Hero' });
  assert.deepEqual(renamePatch({ kind: 'shape', label: 'x' }, 'Box'), { label: 'Box' });
  assert.deepEqual(renamePatch({ kind: 'file', fileName: 'brief.docx' }, 'Brief'), { title: 'Brief' });
  assert.equal(canRename({ kind: 'note' }), false);
  assert.equal(renamePatch({ kind: 'note', body: 'x' }, 'y'), null);
  assert.equal(canRename({ kind: 'board' }), false);
});

test('empty or unchanged is no rename', () => {
  assert.equal(renamePatch({ kind: 'image' }, '   '), null);
  assert.equal(renamePatch({ kind: 'image', title: 'Hero' }, ' Hero ', 'Hero'), null);
});

test('names are one clean line, capped', () => {
  assert.equal(cleanName('  a\n\tb  c '), 'a b c');
  assert.equal(cleanName('x'.repeat(500)).length, NAME_MAX);
});

test('a renamed file still downloads under its original name', () => {
  const audio = { kind: 'audio', src: 'r2:k/loop.wav', fileName: 'Loop 120bpm.wav' };
  const renamed = { ...audio, ...renamePatch(audio, 'Kick') };
  assert.equal(assetFilename(renamed, 'audio'), 'Loop 120bpm.wav');
  // A PDF's name is its original filename: the first rename keeps it.
  const pdf = { kind: 'pdf', pdfSrc: 'r2:k/deck.pdf', name: 'Deck v3.pdf' };
  const p = renamePatch(pdf, 'Pitch deck');
  assert.deepEqual(p, { name: 'Pitch deck', fileName: 'Deck v3.pdf' });
  assert.equal(assetFilename({ ...pdf, ...p }, 'pdf'), 'Deck v3.pdf');
  // …and only the first.
  assert.deepEqual(renamePatch({ ...pdf, ...p }, 'Final deck'), { name: 'Final deck' });
});

test('the new name is what Files shows', () => {
  const file = { id: 'f', kind: 'file', fileName: 'brief.docx', fileSrc: 'r2:k/brief.docx' };
  assert.equal(toListItem({ ...file, ...renamePatch(file, 'Client brief') }, {}).name, 'Client brief');
  assert.equal(toListItem(file, {}).name, 'brief.docx');
});

test('a card link opens its board with the card selected, dropping the rest of the URL', async () => {
  const { cardLinkUrl } = await import('./cardLink.js');
  assert.equal(
    cardLinkUrl('https://clusters.example/app?board=old&x=1#frag', 'B1', 'C9'),
    'https://clusters.example/app?board=B1&card=C9',
  );
});
