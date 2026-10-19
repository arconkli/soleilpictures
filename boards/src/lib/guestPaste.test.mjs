// lib/guestPaste.js: a guest's paste keeps its words and loses what the doc's
// room would refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema, Slice, Fragment } from '@tiptap/pm/model';
import { guestPasteSlice, GUEST_DROPPED_NODES } from './guestPaste.js';

// The doc's shape, as far as this cares: paragraphs of text and inline images,
// cluster embeds as blocks, link and bold marks.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    boardEmbed: { group: 'block', atom: true, attrs: { boardId: { default: null } } },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true, attrs: { src: { default: null } } },
  },
  marks: {
    link: { attrs: { href: { default: null } }, inclusive: false },
    bold: {},
  },
});
const p = (...c) => schema.node('paragraph', null, c);
const t = (s, marks = []) => schema.text(s, marks);
const link = (href) => schema.marks.link.create({ href });
const bold = schema.marks.bold.create();
const img = (src) => schema.node('image', { src });
const embed = schema.node('boardEmbed', { boardId: 'b1' });
const sliceOf = (...blocks) => new Slice(Fragment.fromArray(blocks), 1, 1);
const text = (slice) => {
  let out = '';
  slice.content.descendants((n) => { if (n.isText) out += n.text; else if (n.type.name !== 'paragraph') out += `[${n.type.name}]`; });
  return out;
};

test('a paste with nothing to refuse is the same slice', () => {
  const s = sliceOf(p(t('Hello '), t('world', [bold]), t(' see ', []), t('this', [link('https://example.com')])));
  assert.equal(guestPasteSlice(s), s);
  const mail = sliceOf(p(t('mail', [link('mailto:a@b.co')])));
  assert.equal(guestPasteSlice(mail), mail);
});

test('images and cluster embeds go; the words around them stay', () => {
  const s = sliceOf(p(t('Before '), img('r2:ws/a.png'), t(' after')), embed, p(t('Last')));
  const out = guestPasteSlice(s);
  assert.notEqual(out, s);
  assert.equal(text(out), 'Before  afterLast');
  let images = 0;
  out.content.descendants((n) => { if (GUEST_DROPPED_NODES.has(n.type.name)) images += 1; });
  assert.equal(images, 0);
});

test('a link the room would refuse loses its link, not its words or other marks', () => {
  const s = sliceOf(p(t('a doc link', [bold, link('soleil://board/b1')]), t(' and '), t('bad', [link('javascript:alert(1)')])));
  const out = guestPasteSlice(s);
  assert.equal(text(out), 'a doc link and bad');
  const marks = [];
  out.content.descendants((n) => { if (n.isText) marks.push(n.marks.map((m) => m.type.name).join('+')); });
  assert.deepEqual(marks, ['bold', '']);
  // Adjacent text with the same marks is joined back into one node.
  out.content.descendants((n) => { assert.notEqual(n.marks.some((m) => m.type.name === 'link'), true); });
});

test('a paste that was only an image is nothing', () => {
  const s = new Slice(Fragment.from(img('r2:ws/a.png')), 0, 0);
  assert.equal(guestPasteSlice(s), Slice.empty);
  assert.equal(guestPasteSlice(sliceOf(embed)), Slice.empty);
});

test('what is left still fits the doc', () => {
  const out = guestPasteSlice(sliceOf(p(t('x'), img('r2:ws/a.png')), p(t('y'))));
  const doc = schema.node('doc', null, [p(t('start'))]);
  // Inserting it where a paste lands checks it against the schema.
  assert.doesNotThrow(() => doc.replace(2, 2, out));
});
