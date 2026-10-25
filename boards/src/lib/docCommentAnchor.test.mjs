// docCommentAnchor — a comment put on words inside a doc, as the editor puts
// one. The pages are written by y-prosemirror's own writer against the doc
// editor's REAL schema (lib/r2.js stubbed, as in docWrite.test.mjs), and what
// the API writes is read back by y-prosemirror into a ProseMirror doc that
// must check: the mark the editor would make, on exactly the words quoted,
// and gone again with its thread.
//
// Run: node --test src/lib/docCommentAnchor.test.mjs

import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

registerHooks({
  resolve(specifier, context, next) {
    if (/\/lib\/r2\.js$/.test(specifier)) {
      return { url: 'data:text/javascript,export const resolveSrc=(s)=>s;export const getSignedUrl=async()=>null;', shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { getSchema } = await import('@tiptap/core');
const { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } = await import('y-prosemirror');
const { baseDocExtensions } = await import('../components/docExtensions/baseExtensions.js');
const {
  commentMarkKey, fragmentLayout, foldText, markdownWords, findQuote, markQuote, unmarkThread, COMMENT_BARRED,
} = await import('./docCommentAnchor.js');
const { collectQuotes } = await import('./apiComments.js');
const { cardScope, initCardDocStore, addPage, pageContentMap, addPageSheet, getOrCreateSheetContent } = await import('./docState.js');
const { cardToYMap } = await import('./yhelpers.js');

const schema = getSchema(baseDocExtensions);
const text = (t, marks = []) => ({ type: 'text', text: t, ...(marks.length ? { marks } : {}) });
const para = (...content) => ({ type: 'paragraph', content });

// A doc card with two pages: Opening (a heading, a paragraph with bold and a
// link, a paragraph with a line break) and Close (repeating a phrase).
function docCard() {
  const ydoc = new Y.Doc();
  const cards = ydoc.getMap('cards');
  ydoc.transact(() => cards.set('d1', cardToYMap({ id: 'd1', kind: 'doc', title: 'Treatment', x: 0, y: 0, w: 320, h: 240 })));
  const card = cards.get('d1');
  initCardDocStore(ydoc, card);
  const scope = cardScope(card);
  const p1 = addPage(ydoc, { name: 'Opening', scope });
  const p2 = addPage(ydoc, { name: 'Close', scope });
  prosemirrorJSONToYXmlFragment(schema, {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [text('Tokyo, 1974')] },
      para(text('A diner at '), text('night', [{ type: 'bold' }]), text(', rain on the glass. '),
        text('A neon sign', [{ type: 'link', attrs: { href: 'https://x.test', linkId: null } }]), text(' hums.')),
      para(text('EXT. ALLEY'), { type: 'hardBreak' }, text('She waits.')),
    ],
  }, pageContentMap(ydoc, scope).get(p1));
  prosemirrorJSONToYXmlFragment(schema, {
    type: 'doc',
    content: [para(text('She waits. The sign goes dark.'))],
  }, pageContentMap(ydoc, scope).get(p2));
  return { ydoc, card, scope, p1, p2 };
}

// What y-prosemirror reads back from a fragment: a ProseMirror doc, checked
// against the schema as an editor would hold it.
const readBack = (frag) => {
  const node = yXmlFragmentToProseMirrorRootNode(frag, schema);
  node.check();
  return node;
};
// The words carrying thread `id`'s mark, block by block.
const marked = (node, id) => {
  const out = [];
  node.descendants((n) => {
    if (n.isTextblock) out.push('');
    if (n.isText && n.marks.some((m) => m.type.name === 'comment' && m.attrs.id === id)) out[out.length - 1] += n.text;
  });
  return out.filter(Boolean);
};

test('the mark is keyed as y-prosemirror keys it', () => {
  for (const id of ['cm_k2x9q1ab0z3', 'cm_a', 'cm_0000000000000000', 'x-y_z']) {
    const frag = new Y.Doc().getXmlFragment('f');
    prosemirrorJSONToYXmlFragment(schema, {
      type: 'doc', content: [para(text('quoted', [{ type: 'comment', attrs: { id } }]))],
    }, frag);
    const [run] = frag.get(0).toArray();
    assert.deepEqual(Object.keys(run.toDelta()[0].attributes), [commentMarkKey(id)], id);
    assert.deepEqual({ ...run.toDelta()[0].attributes[commentMarkKey(id)] }, { id });
  }
});

test('a thread on quoted words: the editor\'s own mark, on exactly those words, around other marks', () => {
  const { ydoc, card, scope, p1 } = docCard();
  const found = findQuote(card, 'at night, rain');
  assert.equal(found.pageId, p1);
  assert.equal(found.pageName, 'Opening');
  assert.equal(found.quote, 'at night, rain');
  ydoc.transact(() => markQuote(found.ranges, 'cm_one'));

  const frag = pageContentMap(ydoc, scope).get(p1);
  const node = readBack(frag);
  assert.deepEqual(marked(node, 'cm_one'), ['at night, rain']);
  let bold = '';
  node.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'bold')) bold += n.text; });
  assert.equal(bold, 'night', 'the bold stays where it was');
  assert.equal(collectQuotes(frag).get('cm_one'), 'at night, rain', 'and the API reads the quote back');

  // Across blocks and a line break, the mark goes on each run.
  const wide = findQuote(card, 'glass. A neon sign hums. EXT. ALLEY She waits.');
  assert.equal(wide.ranges.length, 3, 'a paragraph\'s text is one run, whatever its marks; a line break parts two');
  ydoc.transact(() => markQuote(wide.ranges, 'cm_two'));
  const after = readBack(frag);
  assert.deepEqual(marked(after, 'cm_two'), ['glass. A neon sign hums.', 'EXT. ALLEYShe waits.']);
  assert.deepEqual(marked(after, 'cm_one'), ['at night, rain'], 'an overlapping thread keeps its own');
});

test('quotes match as people copy them: spacing, curly quotes, and the Markdown a doc reads as', () => {
  const { card, p1 } = docCard();
  assert.equal(findQuote(card, 'A   diner\nat').quote, 'A diner at');
  assert.equal(findQuote(card, 'A diner at **night**, rain').quote, 'A diner at night, rain');
  assert.equal(findQuote(card, '[A neon sign](https://x.test) hums').quote, 'A neon sign hums');
  assert.equal(findQuote(card, '# Tokyo, 1974').quote, 'Tokyo, 1974');
  assert.equal(findQuote(card, 'EXT. ALLEY\\\nShe').quote, 'EXT. ALLEY\nShe');
  assert.equal(findQuote(card, 'EXT. ALLEY\\\nShe').pageId, p1);

  const curly = docCard();
  prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: [para(text('It’s “noir”, really'))] },
    pageContentMap(curly.ydoc, curly.scope).get(curly.p2));
  assert.equal(findQuote(curly.card, 'It\'s "noir", really').quote, 'It’s “noir”, really');

  assert.deepEqual(foldText(' a \n\n b '), { text: 'a b', at: [1, 2, 6] });
  assert.equal(markdownWords('- [ ] **Shot** list\n> 1. `ECU` ==eyes==\\\nnext'), 'Shot list\nECU eyes\nnext');
});

test('words in more than one place, on no page, or not there at all', () => {
  const { card, p1, p2 } = docCard();
  assert.deepEqual(findQuote(card, 'She waits.'), { problem: 'many', count: 2, pages: ['Opening', 'Close'] });
  assert.equal(findQuote(card, 'She waits.', { pageId: p2 }).pageId, p2);
  assert.equal(findQuote(card, 'She waits.', { pageId: p1 }).pageId, p1);
  assert.deepEqual(findQuote(card, 'She waits.', { pageId: 'nope' }), { problem: 'page' });
  assert.deepEqual(findQuote(card, 'a diner'), { problem: 'none' }, 'case counts');
  assert.deepEqual(findQuote(card, 'The sign goes dark. Tokyo'), { problem: 'none' }, 'never across pages');
});

test('a page\'s extra sheets are read too', () => {
  const { ydoc, card, scope, p2 } = docCard();
  const sheet = addPageSheet(ydoc, p2, scope);
  prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: [para(text('Fade out on the rooftops.'))] },
    getOrCreateSheetContent(ydoc, p2, sheet, scope));
  const found = findQuote(card, 'the rooftops');
  assert.equal(found.pageId, p2);
  ydoc.transact(() => markQuote(found.ranges, 'cm_sheet'));
  assert.deepEqual(marked(readBack(scope.sheetContent.get(sheet)), 'cm_sheet'), ['the rooftops']);
});

test('taking a thread away takes its mark off, and leaves every other', () => {
  const { ydoc, card, scope, p1 } = docCard();
  ydoc.transact(() => {
    markQuote(findQuote(card, 'rain on the glass').ranges, 'cm_a');
    markQuote(findQuote(card, 'the glass. A neon').ranges, 'cm_b');
  });
  let n = 0;
  ydoc.transact(() => { n = unmarkThread(card, 'cm_a'); });
  assert.ok(n >= 1);
  const node = readBack(pageContentMap(ydoc, scope).get(p1));
  assert.deepEqual(marked(node, 'cm_a'), []);
  assert.deepEqual(marked(node, 'cm_b'), ['the glass. A neon']);
  assert.equal(unmarkThread(card, 'cm_missing'), 0);
});

test('a fragment\'s layout: a break between blocks and in place of a line break', () => {
  const { scope, p1 } = docCard();
  const { text: t, runs } = fragmentLayout(scope.content.get(p1));
  assert.equal(t, 'Tokyo, 1974\nA diner at night, rain on the glass. A neon sign hums.\nEXT. ALLEY\nShe waits.\n');
  assert.ok(runs.every((r) => t.slice(r.start, r.end) && !t.slice(r.start, r.end).includes('\n')));
});

test('what can\'t carry a comment is the schema\'s: code blocks, and text marked as code', () => {
  const comment = schema.marks.comment;
  assert.deepEqual([...COMMENT_BARRED.blocks],
    Object.values(schema.nodes).filter((t) => t.isTextblock && !t.allowsMarkType(comment)).map((t) => t.name));
  assert.deepEqual([...COMMENT_BARRED.marks],
    Object.values(schema.marks).filter((m) => m !== comment && m.excludes(comment)).map((m) => m.name));
});

test('a quote over code: the comment covers the rest, as the editor\'s does; all code is refused', () => {
  const { ydoc, card, scope, p2 } = docCard();
  prosemirrorJSONToYXmlFragment(schema, {
    type: 'doc',
    content: [
      para(text('Run '), text('npm test', [{ type: 'code' }]), text(' before the cut.')),
      { type: 'codeBlock', attrs: { language: null }, content: [text('const take = 3;')] },
    ],
  }, pageContentMap(ydoc, scope).get(p2));

  const mixed = findQuote(card, 'Run `npm test` before the cut.');
  assert.equal(mixed.quote, 'Run npm test before the cut.');
  ydoc.transact(() => markQuote(mixed.ranges, 'cm_code'));
  const across = findQuote(card, 'the cut. const take');
  ydoc.transact(() => markQuote(across.ranges, 'cm_across'));
  const node = readBack(pageContentMap(ydoc, scope).get(p2));
  assert.deepEqual(marked(node, 'cm_code'), ['Run  before the cut.']);
  assert.deepEqual(marked(node, 'cm_across'), ['the cut.'], 'nothing in the code block');

  assert.deepEqual(findQuote(card, 'const take = 3;'), { problem: 'code' });
  assert.deepEqual(findQuote(card, 'npm test'), { problem: 'code' });
});
