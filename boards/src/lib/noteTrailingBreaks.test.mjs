// padTrailingBreaks (lib/noteDocState.js): a paragraph or heading that ends in
// a hard break is saved with one more, so the html draws the line the editor
// shows. Pure tree work, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { padTrailingBreaks } from './noteDocState.js';

const text = (t) => ({ type: 'text', text: t });
const br = (extra = {}) => ({ type: 'hardBreak', ...extra });
const doc = (...content) => ({ type: 'doc', content });
const para = (...content) => ({ type: 'paragraph', content });

test('a paragraph ending in a hard break gets one more', () => {
  const out = padTrailingBreaks(doc(para(text('a'), br())));
  assert.deepEqual(out.content[0].content, [text('a'), br(), br()]);
});

test('a heading ending in a hard break is padded the same way', () => {
  const h = { type: 'heading', attrs: { level: 2 }, content: [text('T'), br()] };
  const out = padTrailingBreaks(doc(h));
  assert.deepEqual(out.content[0].content, [text('T'), br(), br()]);
  assert.deepEqual(out.content[0].attrs, { level: 2 });
});

test('a break in the middle of a paragraph is left alone', () => {
  const d = doc(para(text('a'), br(), text('b')));
  assert.deepEqual(padTrailingBreaks(d), d);
});

test('a paragraph holding only a hard break gets two', () => {
  const out = padTrailingBreaks(doc(para(br())));
  assert.deepEqual(out.content[0].content, [br(), br()]);
});

test('the added break carries no marks', () => {
  const out = padTrailingBreaks(doc(para(text('a'), br({ marks: [{ type: 'bold' }] }))));
  const c = out.content[0].content;
  assert.equal(c.length, 3);
  assert.deepEqual(c[1].marks, [{ type: 'bold' }]);
  assert.equal('marks' in c[2], false);
});

test('paragraphs inside lists and checklists are padded', () => {
  const inner = () => para(text('x'), br());
  const d = doc(
    { type: 'bulletList', content: [{ type: 'listItem', content: [inner()] }] },
    { type: 'noteChecklist', content: [{ type: 'noteChecklistItem', content: [inner()] }] },
  );
  const out = padTrailingBreaks(d);
  assert.deepEqual(out.content[0].content[0].content[0].content, [text('x'), br(), br()]);
  assert.deepEqual(out.content[1].content[0].content[0].content, [text('x'), br(), br()]);
});

test('the input is not changed', () => {
  const d = doc(para(text('a'), br()), { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('b'), br())] }] });
  const copy = structuredClone(d);
  padTrailingBreaks(d);
  assert.deepEqual(d, copy);
});

test('an empty paragraph is returned unchanged', () => {
  const p = { type: 'paragraph' };
  assert.deepEqual(padTrailingBreaks(p), { type: 'paragraph' });
  assert.equal(padTrailingBreaks(p), p);
});
