// docText.test.mjs — a doc's words, off real Y types, with block boundaries
// as word boundaries and every sheet included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { fragmentText, docPagesText, docSignature, snippetAround } from './docText.js';

function para(text, tag = 'paragraph') {
  const el = new Y.XmlElement(tag);
  el.insert(0, [new Y.XmlText(text)]);
  return el;
}

// A doc card the way docState.initCardDocStore lays one out.
function docCard(doc, pages) {
  const card = new Y.Map();
  doc.getMap('cards').set('doc-1', card);
  const arr = new Y.Array();
  const content = new Y.Map();
  const sheets = new Y.Map();
  const sheetContent = new Y.Map();
  card.set('kind', 'doc');
  card.set('docPages', arr);
  card.set('docPageContent', content);
  card.set('docPageSheets', sheets);
  card.set('docSheetContent', sheetContent);
  for (const p of pages) {
    arr.push([{ id: p.id, name: p.name }]);
    const frag = new Y.XmlFragment();
    content.set(p.id, frag);
    frag.insert(0, p.blocks.map((b) => para(b)));
    if (p.sheets) {
      const list = new Y.Array();
      sheets.set(p.id, list);
      for (const [sid, text] of p.sheets) {
        list.push([{ id: sid }]);
        const sf = new Y.XmlFragment();
        sheetContent.set(sid, sf);
        sf.insert(0, [para(text)]);
      }
    }
  }
  return card;
}

test('blocks are separate words, not glued together', () => {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment('f');
  frag.insert(0, [para('Exterior.'), para('Night.', 'heading')]);
  assert.equal(fragmentText(frag), 'Exterior. Night.');
  assert.equal(fragmentText(null), '');
});

test('every page of a doc card, with its extra sheets, in order', () => {
  const doc = new Y.Doc();
  const card = docCard(doc, [
    { id: 'p1', name: 'Scene 1', blocks: ['INT. DINER — NIGHT', 'Rain on the glass.'] },
    { id: 'p2', name: 'Scene 2', blocks: ['EXT. LOT'], sheets: [['p2', 'ignored primary'], ['s9', 'Second sheet line.']] },
  ]);
  const pages = docPagesText(card);
  assert.deepEqual(pages.map((p) => p.id), ['p1', 'p2']);
  assert.equal(pages[0].text, 'INT. DINER — NIGHT Rain on the glass.');
  assert.equal(pages[1].text, 'EXT. LOT Second sheet line.', 'extra sheets count; the primary is not read twice');
  assert.equal(pages[1].name, 'Scene 2');
  assert.deepEqual(docPagesText(new Y.Map()), [], 'a card with no doc store has no pages');
});

test('the signature moves with the words and only with them', () => {
  const a = [{ id: 'p1', name: 'One', text: 'diner at night' }];
  const b = [{ id: 'p1', name: 'One', text: 'diner at dawn' }];
  assert.equal(docSignature(a), docSignature([{ ...a[0] }]));
  assert.notEqual(docSignature(a), docSignature(b));
  assert.notEqual(docSignature(a), docSignature([{ ...a[0], name: 'Two' }]));
});

test('a snippet shows the words around the match', () => {
  const text = 'The rain has not stopped for three days and the diner is the only light on the whole street tonight.';
  const s = snippetAround(text, 'diner', 20);
  assert.ok(s.includes('diner'));
  assert.ok(s.startsWith('…') && s.endsWith('…'));
  const inner = s.replace(/^…/, '').replace(/…$/, '');
  const at = text.indexOf(inner);
  assert.ok(at > 0 && text[at - 1] === ' ', 'the cut lands at the start of a word');
  assert.ok(text[at + inner.length] === ' ', 'and ends at the end of one');
  assert.equal(snippetAround('short', 'x'), 'short');
});
