// docSummaryEmpty.test.mjs — the closed doc card says "Empty" and offers
// Start writing (the doc look's S-card, owner's pick 2026-10-21) only for a
// doc with nothing in it: no page, or one page holding no text and nothing
// else (no picture, table or rule). An empty paragraph or two is still empty.
//
//   node --test src/lib/docSummaryEmpty.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  initCardDocStore, cardScope, readDocSummary, addPage, getOrCreatePageContent, addPageSheet, getOrCreateSheetContent,
} from './docState.js';

function card() {
  const ydoc = new Y.Doc();
  const ym = new Y.Map();
  ydoc.getMap('cards').set('doc-1', ym);
  ym.set('kind', 'doc');
  initCardDocStore(ydoc, ym);
  return { ydoc, scope: cardScope(ym) };
}
const para = (frag, text = '') => {
  const p = new Y.XmlElement('paragraph');
  frag.push([p]);
  if (text) { const t = new Y.XmlText(); p.push([t]); t.insert(0, text); }
  return p;
};

test('a doc with no page is empty', () => {
  const { ydoc, scope } = card();
  assert.equal(readDocSummary(ydoc, 600, scope).empty, true);
});

test('one page of empty paragraphs is empty; a word makes it not', () => {
  const { ydoc, scope } = card();
  const id = addPage(ydoc, { name: 'Untitled doc', scope });
  const frag = getOrCreatePageContent(ydoc, id, scope);
  para(frag); para(frag);
  assert.equal(readDocSummary(ydoc, 600, scope).empty, true);
  para(frag, 'Night');
  assert.equal(readDocSummary(ydoc, 600, scope).empty, false);
});

test('a picture, a table or a rule with no text is not empty', () => {
  for (const name of ['image', 'table', 'horizontalRule', 'boardEmbed']) {
    const { ydoc, scope } = card();
    const id = addPage(ydoc, { name: 'Untitled doc', scope });
    const frag = getOrCreatePageContent(ydoc, id, scope);
    para(frag);
    frag.push([new Y.XmlElement(name)]);
    assert.equal(readDocSummary(ydoc, 600, scope).empty, false, name);
  }
});

test('text on a later sheet of the one page, or a second page, is not empty', () => {
  {
    const { ydoc, scope } = card();
    const id = addPage(ydoc, { name: 'Untitled doc', scope });
    para(getOrCreatePageContent(ydoc, id, scope));
    const sheet = addPageSheet(ydoc, id, scope);
    para(getOrCreateSheetContent(ydoc, id, sheet, scope), 'Later');
    assert.equal(readDocSummary(ydoc, 600, scope).empty, false);
  }
  {
    const { ydoc, scope } = card();
    addPage(ydoc, { name: 'One', scope });
    addPage(ydoc, { name: 'Two', scope });
    assert.equal(readDocSummary(ydoc, 600, scope).empty, false);
  }
});
