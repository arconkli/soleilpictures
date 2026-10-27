// docWrite — Markdown into a doc card's pages. What it writes has to be what
// the doc editor's binding would have written, or the binding deletes it the
// first time the page opens, so this holds it to the editor's REAL schema
// (baseDocExtensions, with lib/r2.js stubbed: its node view's import pulls in
// the Supabase client, and nothing here renders) and to y-prosemirror's own
// writer, then pins what a writer can rely on: links as the app makes them,
// pictures only from files already in the cluster, and a rewrite that keeps
// every block it didn't change, comments and all.
//
// Run: node --test src/lib/docWrite.test.mjs

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
  DOC_WRITE, NODE_ATTRS, MARK_ATTRS, MARK_RANK, markdownToDoc, bindLinks, linkAnchors, jsonToYNode,
  blockKey, planBlockEdit, preparePages, writePages, rewritePage, applyTextEdits, docProblem,
  placeableImages, currentPage, planPageEdit, pageMarkdown,
} = await import('./docWrite.js');
const { jsonToMarkdown, readDocPages } = await import('./docMarkdown.js');
const { cardScope, initCardDocStore, setDocMode, addPage, pageContentMap } = await import('./docState.js');
const { getLink } = await import('./links.js');

const schema = getSchema(baseDocExtensions);

const counter = () => { let i = 0; return () => `link-${++i}`; };
const r2 = (s) => s.startsWith('r2:');

// A fragment as data: element names, attributes and text deltas, in order,
// as they go over the wire (ProseMirror's attrs objects have no prototype,
// which Yjs encodes the same as any other object).
function dump(node) {
  const walk = (n) => {
    if (n instanceof Y.XmlText) return { delta: n.toDelta() };
    if (n instanceof Y.XmlElement) return { name: n.nodeName, attrs: n.getAttributes(), kids: n.toArray().map(walk) };
    return n.toArray().map(walk);
  };
  return JSON.parse(JSON.stringify(walk(node)));
}

function ours(blocks) {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('f');
  frag.insert(0, blocks.map(jsonToYNode));
  return frag;
}

function theirs(blocks) {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment('f');
  prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: blocks }, frag);
  return frag;
}

const CORPUS = {
  prose: 'A diner at night.\n\nRain on the glass, **neon** in the *puddles*, a ~~dead~~ phone.',
  headings: '# One\n\n## Two\n\n###### Six\n\nText under.',
  breaks: 'INT. DINER – NIGHT\nThe neon hums.\nA cup sits cold.',
  marks: 'Some ==highlight== and <u>underline</u>, H<sub>2</sub>O, E = mc<sup>2</sup>, `code`, ***both***.',
  nestedMarks: '==**bold inside highlight**== and **==highlight inside bold==** and <u>*under italic*</u>.',
  lists: '- one\n- two\n  - two a\n  - two b\n- three\n\n3. third\n4. fourth',
  tasks: '- [ ] scout the alley\n- [x] cast the singer\n  - [ ] call her agent',
  mixedTasks: '- [ ] a task\n- not a task',
  quote: '> A line.\n>\n> > Nested.\n\n> - in a list',
  code: '```fountain\nINT. DINER\n```\n\n    indented code\n\n```\n```',
  table: '| Shot | Lens | Note |\n|:-----|:----:|-----:|\n| Wide | 24mm | **neon** |\n| Close | 85mm | |',
  rule: 'Above\n\n---\n\nBelow',
  links: 'See [the ref](https://example.com/a), [**bold link**](https://example.com/b) and https://example.org/c and <mailto:a@b.co>.',
  unsafe: '[click](javascript:alert(1)) and [file](file:///etc/passwd) and <script>alert(1)</script>',
  html: '<div>\n<b>raw</b>\n</div>\n\nText <span>kept</span> <br> after.',
  pictures: '![ours](r2:images/abc.jpg)\n\nText ![ours](r2:images/abc.jpg) more\n\n![theirs](https://example.com/x.jpg)\n\n# Head ![ours](r2:images/abc.jpg)',
  listPicture: '- ![ours](r2:images/abc.jpg)\n- text',
  oddItems: '- # heading item\n- ```\n  code first\n  ```\n-\n- plain',
  escapes: 'Not \\*italic\\*, a \\# and 2 \\< 3 & 4 > 1, a_b_c, *real*.',
  emptyQuote: '>\n\nafter',
  long: Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with **some** text.`).join('\n\n'),
};

test('the attribute tables are the doc editor\'s, defaults and order included', () => {
  for (const [name, attrs] of Object.entries(NODE_ATTRS)) {
    const spec = schema.nodes[name]?.spec?.attrs || {};
    assert.ok(schema.nodes[name], `${name} is a node in the doc schema`);
    assert.deepEqual(Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v.default])), attrs, name);
  }
  for (const [name, attrs] of Object.entries(MARK_ATTRS)) {
    const spec = schema.marks[name]?.spec?.attrs || {};
    assert.ok(schema.marks[name], `${name} is a mark in the doc schema`);
    assert.deepEqual(Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v.default])), attrs, name);
    assert.equal(schema.marks[name].excludes(schema.marks[name]), true, `${name} is not an overlapping mark (those are written under hashed names)`);
  }
  assert.deepEqual(Object.keys(schema.marks), [...MARK_RANK]);
});

for (const [name, md] of Object.entries(CORPUS)) {
  test(`${name}: valid in the editor's schema, and written as y-prosemirror writes it`, () => {
    const { blocks } = bindLinks(markdownToDoc(md, { imageAllowed: r2 }).content, counter());
    const json = { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] };
    const node = schema.nodeFromJSON(json);
    node.check();
    assert.deepEqual(dump(ours(blocks)), dump(theirs(blocks)));
    // …and the binding reads it back as the very same document.
    const back = yXmlFragmentToProseMirrorRootNode(ours(json.content), schema);
    back.check();
    assert.deepEqual(back.toJSON(), node.toJSON());
  });

  test(`${name}: reading it back and writing that again changes nothing`, () => {
    const once = jsonToMarkdown(markdownToDoc(md, { imageAllowed: r2 }));
    const twice = jsonToMarkdown(markdownToDoc(once, { imageAllowed: r2 }));
    assert.equal(twice, once);
  });
}

test('what the Markdown says lands as the nodes and marks the editor uses', () => {
  const types = (md) => markdownToDoc(md, { imageAllowed: r2 }).content.map((b) => b.type);
  assert.deepEqual(types(CORPUS.tasks), ['taskList']);
  assert.deepEqual(types(CORPUS.mixedTasks), ['bulletList'], 'a list that is not all tasks stays a list, its brackets kept as text');
  assert.deepEqual(types(CORPUS.pictures), ['image', 'paragraph', 'image', 'paragraph', 'paragraph', 'heading']);
  const [first] = markdownToDoc(CORPUS.breaks).content;
  assert.equal(first.content.filter((n) => n.type === 'hardBreak').length, 2, 'a single line break is kept as one');
  const marks = markdownToDoc(CORPUS.marks).content[0].content.flatMap((n) => (n.marks || []).map((m) => m.type));
  for (const m of ['highlight', 'underline', 'subscript', 'superscript', 'code', 'bold', 'italic']) assert.ok(marks.includes(m), m);
  const table = markdownToDoc(CORPUS.table).content[0];
  assert.deepEqual(table.content[0].content.map((c) => c.content[0].attrs?.textAlign ?? null), ['left', 'center', 'right']);
  const unsafe = JSON.stringify(markdownToDoc(CORPUS.unsafe));
  assert.doesNotMatch(unsafe, /"type":"link"/, 'only http(s) and mailto links are made');
  assert.match(unsafe, /<script>alert\(1\)<\/script>/, 'markup stays literal text');
  const odd = markdownToDoc(CORPUS.oddItems).content[0].content;
  assert.ok(odd.every((li) => li.content[0].type === 'paragraph'), 'every list item starts with a paragraph');
});

test('pictures: placed only from files already in the cluster, otherwise a link or their words', () => {
  const doc = markdownToDoc(CORPUS.pictures, { imageAllowed: (s) => s === 'r2:images/abc.jpg' });
  const images = doc.content.filter((b) => b.type === 'image');
  assert.equal(images.length, 2);
  assert.deepEqual(images[0].attrs, { src: 'r2:images/abc.jpg', alt: 'ours' });
  const theirs = doc.content[4].content[0];
  assert.equal(theirs.text, 'theirs');
  assert.deepEqual(theirs.marks.map((m) => [m.type, m.attrs?.href]), [['link', 'https://example.com/x.jpg']]);
  const heading = doc.content[5];
  assert.equal(heading.content.map((n) => n.text).join(''), 'Head ours', 'a heading holds no picture, so it keeps the words');
  const none = markdownToDoc('![ours](r2:images/abc.jpg)', { imageAllowed: () => false });
  assert.equal(none.content[0].content[0].text, 'ours');
  // A bare key is placed as the board spells it, when imageAllowed says how.
  const bare = markdownToDoc('![ours](images/abc.jpg)', {
    imageAllowed: (s) => (s === 'images/abc.jpg' ? 'r2:images/abc.jpg' : false),
  });
  assert.deepEqual(bare.content[0].attrs, { src: 'r2:images/abc.jpg', alt: 'ours' });
});

test('links: one record per link written, the mark naming it, the anchor where its text is', () => {
  const { blocks, links } = bindLinks(markdownToDoc(CORPUS.links).content, counter());
  assert.deepEqual(links.map((l) => l.href), ['https://example.com/a', 'https://example.com/b', 'https://example.org/c', 'mailto:a@b.co']);
  const marks = blocks[0].content.flatMap((n) => n.marks || []).filter((m) => m.type === 'link');
  for (const m of marks) assert.deepEqual(Object.keys(m.attrs).sort(), ['href', 'linkId']);
  assert.ok(marks.every((m) => m.attrs.href === null), 'the target lives in the record, as the app keeps it');
  const anchors = linkAnchors(blocks, new Set(links.map((l) => l.id)));
  const node = schema.nodeFromJSON({ type: 'doc', content: blocks });
  for (const l of links) {
    const { from, to } = anchors.get(l.id);
    let text = '';
    node.nodesBetween(from, to, (n, pos) => {
      if (n.isText) text += n.text.slice(Math.max(0, from - pos), to - pos);
    });
    assert.ok(text.length > 0);
    node.nodesBetween(from, to, (n) => {
      if (n.isText) assert.ok(n.marks.some((m) => m.attrs.linkId === l.id), `${l.id} covers ${JSON.stringify(text)}`);
    });
  }
});

test('planBlockEdit keeps what matches, in order, and the empty blocks of an unchanged stretch', () => {
  const plan = (o, n) => {
    const p = planBlockEdit(o, n);
    return { keep: [...p.keep].sort((a, b) => a - b), seq: p.seq.map((e) => (e.old !== undefined ? `o${e.old}` : `n${e.new}`)).join(' ') };
  };
  assert.deepEqual(plan(['a', 'b', 'c'], ['a', 'B', 'c']), { keep: [0, 2], seq: 'o0 n1 o2' });
  assert.deepEqual(plan(['a', null, 'b'], ['a', 'b']), { keep: [0, 1, 2], seq: 'o0 o1 o2' });
  assert.deepEqual(plan(['a', null, 'b'], ['a', 'x', 'b']), { keep: [0, 2], seq: 'o0 n1 o2' });
  assert.deepEqual(plan(['a', 'b'], []), { keep: [], seq: '' });
  assert.deepEqual(plan([], ['a', 'b']), { keep: [], seq: 'n0 n1' });
  assert.deepEqual(plan(['x', 'a', 'y', 'a'], ['a', 'a']), { keep: [1, 3], seq: 'o1 o3' });
  assert.deepEqual(plan(['a', 'b', 'c', 'd'], ['d', 'a', 'b']), { keep: [0, 1], seq: 'n0 o0 o1' });
  assert.deepEqual(plan([null, 'a'], ['a', 'z']), { keep: [0, 1], seq: 'o0 o1 n1' });
});

// A board holding one doc card, made as the app makes one.
function board() {
  const ydoc = new Y.Doc();
  const card = new Y.Map();
  ydoc.transact(() => {
    ydoc.getMap('cards').set('doc-1', card);
    card.set('id', 'doc-1');
    card.set('kind', 'doc');
    card.set('title', 'Treatment');
    initCardDocStore(ydoc, card);
  });
  return { ydoc, card };
}

test('writePages: pages in order, each reading back as written, links live, hashes a reader will see', () => {
  const { ydoc, card } = board();
  const pages = preparePages([
    { title: 'Look', markdown: CORPUS.prose },
    { markdown: '# Places\n\nShinjuku, [Golden Gai](https://example.com/gg).' },
    { title: 'Empty', markdown: '' },
  ]);
  const made = writePages(ydoc, card, pages, { userId: 'u1', imageAllowed: r2, newId: counter() });
  assert.deepEqual(made.map((p) => p.title), ['Look', 'Places', 'Empty'], 'a page with no title takes its first heading\'s words');
  const read = readDocPages(ydoc, cardScope(card));
  assert.deepEqual(read.pages.map((p) => p.id), made.map((p) => p.id));
  assert.deepEqual(read.pages.map((p) => p.hash), made.map((p) => p.hash));
  assert.equal(read.pages[0].markdown, jsonToMarkdown(markdownToDoc(CORPUS.prose)));
  assert.match(read.pages[1].markdown, /\[Golden Gai\]\(https:\/\/example\.com\/gg\)/);
  const link = getLink(ydoc, 'link-1');
  assert.equal(link.pageId, made[1].id);
  assert.equal(link.createdBy, 'u1');
  assert.deepEqual(link.targets, [{ kind: 'url', href: 'https://example.com/gg' }]);
  assert.equal(made[2].chars, 0);
  assert.equal(made[0].text, 'A diner at night. Rain on the glass, neon in the puddles, a dead phone.');
  // …and under a page, as its sub-pages.
  const sub = writePages(ydoc, card, preparePages([{ title: 'Sub', markdown: 'x' }]), { parentId: made[0].id, imageAllowed: r2 });
  assert.equal(sub[0].parent_id, made[0].id);
  assert.equal(sub[0].depth, 1);
  assert.throws(() => writePages(ydoc, card, pages, { parentId: 'p_nope' }), /no page p_nope/);
});

test('writePages makes the store on a doc card that never had one (a doc made by POST /cards)', () => {
  const ydoc = new Y.Doc();
  const card = new Y.Map();
  ydoc.transact(() => {
    ydoc.getMap('cards').set('api-1', card);
    card.set('kind', 'doc');
    card.set('title', 'From the API');
  });
  const made = writePages(ydoc, card, preparePages([{ title: 'One', markdown: 'Hello' }]), {});
  assert.equal(readDocPages(ydoc, cardScope(card)).pages[0].id, made[0].id);
  assert.equal(cardScope(card).meta.get('contentModel'), 'flow');
});

// A page with what Markdown can't carry: a comment on its first paragraph, a
// colour on its second, an embedded card, an empty spacer paragraph.
function richPage() {
  const { ydoc, card } = board();
  const scope = cardScope(card);
  const pageId = addPage(ydoc, { name: 'Look', scope });
  const json = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Commented line.', marks: [{ type: 'comment', attrs: { id: 'c1' } }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Coloured line.', marks: [{ type: 'textStyle', attrs: { color: '#E0782F' } }] }] },
    { type: 'paragraph' },
    { type: 'boardEmbed', attrs: { boardId: 'b1', cardId: null, label: 'Mood' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Old ending.' }] },
  ] };
  prosemirrorJSONToYXmlFragment(schema, json, pageContentMap(ydoc, scope).get(pageId));
  return { ydoc, card, scope, pageId };
}

test('rewritePage keeps every block left as it was, comments, colours and embeds included', () => {
  const { ydoc, card, pageId } = richPage();
  const frag = pageContentMap(ydoc, cardScope(card)).get(pageId);
  const before = frag.toArray();
  const page = currentPage(ydoc, card, pageId);
  const next = page.markdown.replace('Old ending.', 'A new ending, with [a link](https://example.com/end).');
  let out;
  ydoc.transact(() => {
    out = rewritePage(ydoc, card, pageId, preparePages([{ markdown: next }])[0].tokens, { imageAllowed: r2, newId: counter() });
  });
  assert.deepEqual(out.blocks, { kept: 4, removed: 1, added: 1 });
  const after = frag.toArray();
  for (let i = 0; i < 4; i++) assert.equal(after[i], before[i], `block ${i} is the same block, not a copy`);
  assert.notEqual(after[4], before[4]);
  const doc = yXmlFragmentToProseMirrorRootNode(frag, schema);
  doc.check();
  assert.equal(doc.child(0).firstChild.marks[0].type.name, 'comment', 'the comment still has its anchor');
  assert.equal(doc.child(1).firstChild.marks[0].attrs.color, '#E0782F');
  assert.equal(doc.child(3).type.name, 'boardEmbed');
  assert.equal(out.page.hash, currentPage(ydoc, card, pageId).hash);
  assert.match(currentPage(ydoc, card, pageId).markdown, /\[a link\]\(https:\/\/example\.com\/end\)/);
});

test('rewritePage: a whole new page replaces everything, spacers too; a rename rides along', () => {
  const { ydoc, card, pageId } = richPage();
  let out;
  ydoc.transact(() => {
    out = rewritePage(ydoc, card, pageId, preparePages([{ markdown: '# Fresh\n\nAll new.' }])[0].tokens, { title: 'Renamed' });
  });
  assert.deepEqual(out.blocks, { kept: 0, removed: 5, added: 2 });
  assert.equal(out.page.title, 'Renamed');
  assert.equal(currentPage(ydoc, card, pageId).markdown, '# Fresh\n\nAll new.\n');
  ydoc.transact(() => {
    out = rewritePage(ydoc, card, pageId, preparePages([{ markdown: '' }])[0].tokens, {});
  });
  assert.equal(currentPage(ydoc, card, pageId).chars, 0);
  assert.throws(() => rewritePage(ydoc, card, 'p_nope', [], {}), /no such page/);
});

test('applyTextEdits: each old_text exactly once, in order', () => {
  assert.equal(applyTextEdits('a b c', [{ old_text: 'b', new_text: 'B' }, { old_text: 'c', new_text: '' }]), 'a B ');
  assert.throws(() => applyTextEdits('a b', [{ old_text: 'z', new_text: 'y' }]), /not on the page/);
  assert.throws(() => applyTextEdits('a a', [{ old_text: 'a', new_text: 'y' }]), /more than once/);
  assert.throws(() => applyTextEdits('a', []), /non-empty array/);
  assert.throws(() => applyTextEdits('a', [{ old_text: '', new_text: 'y' }]), /non-empty text/);
});

test('preparePages holds a call to its limits', () => {
  assert.throws(() => preparePages([]), /pages is required/);
  assert.throws(() => preparePages(Array.from({ length: DOC_WRITE.maxPages + 1 }, () => ({ markdown: 'x' }))), /at most/);
  const big = 'x'.repeat(DOC_WRITE.maxChars / 2 + 1);
  assert.throws(() => preparePages([{ markdown: big }, { markdown: big }]), (e) => e.status === 413);
  assert.equal(preparePages([{ title: 't'.repeat(500), markdown: '' }])[0].title.length, DOC_WRITE.maxTitle);
  assert.equal(preparePages([{ markdown: 'no heading' }])[0].title, 'Untitled');
});

test('docProblem: prose docs only', () => {
  const { ydoc, card } = board();
  assert.equal(docProblem(ydoc, card), null);
  setDocMode(ydoc, cardScope(card), 'screenplay');
  assert.match(docProblem(ydoc, card), /screenplay/);
  const note = new Y.Map();
  ydoc.getMap('cards').set('n', note);
  note.set('kind', 'note');
  assert.match(docProblem(ydoc, note), /a note, not a doc/);
});

test('placeableImages: the board\'s image files and the doc\'s own pictures', () => {
  const { ydoc, card, scope, pageId } = richPage();
  prosemirrorJSONToYXmlFragment(schema, { type: 'doc', content: [{ type: 'image', attrs: { src: 'r2:doc/pic.png' } }] },
    pageContentMap(ydoc, scope).get(pageId));
  const srcs = placeableImages([
    { kind: 'image', src: 'r2:images/a.jpg' }, { kind: 'video', src: 'r2:v.mp4' }, { kind: 'image', src: 'https://x/y.jpg' },
  ], card);
  assert.deepEqual([...srcs].sort(), ['r2:doc/pic.png', 'r2:images/a.jpg']);
});

test('blockKey is the block\'s Markdown on its own', () => {
  const [h] = markdownToDoc('## Two').content;
  assert.equal(blockKey(h), '## Two');
});

test('planPageEdit: what a rewrite would do, and nothing when the page comes back as it was', () => {
  const { ydoc, card, pageId } = richPage();
  const md = currentPage(ydoc, card, pageId).markdown;
  assert.equal(planPageEdit(ydoc, card, pageId, pageMarkdown(md), {}).unchanged, true,
    'read and sent back, spacer and comment included, it changes nothing');
  assert.equal(planPageEdit(ydoc, card, pageId, null, { title: 'Look' }).unchanged, true, 'its own name is no rename');
  const renamed = planPageEdit(ydoc, card, pageId, null, { title: 'Looks' });
  assert.equal(renamed.unchanged, false);
  assert.equal(renamed.rename, 'Looks');
  assert.equal(planPageEdit(ydoc, card, pageId, pageMarkdown(`${md}\nMore.`), {}).unchanged, false);
  assert.throws(() => planPageEdit(ydoc, card, 'p_nope', null, {}), (e) => e.status === 404);
});

test('rewritePage with no Markdown renames and touches nothing else', () => {
  const { ydoc, card, pageId } = richPage();
  const frag = pageContentMap(ydoc, cardScope(card)).get(pageId);
  const before = frag.toArray();
  const out = rewritePage(ydoc, card, pageId, null, { title: 'Moodboard notes' });
  assert.deepEqual(out.blocks, { kept: 5, removed: 0, added: 0 });
  assert.equal(out.page.title, 'Moodboard notes');
  assert.deepEqual(frag.toArray(), before);
});

test('pageMarkdown: one page, a string, within the limit', () => {
  assert.throws(() => pageMarkdown(42), /must be a string/);
  assert.throws(() => pageMarkdown('x'.repeat(DOC_WRITE.maxChars + 1)),
    (e) => e.status === 413 && e.code === 'payload_too_large');
  assert.ok(pageMarkdown('# Hi').some((t) => t.type === 'heading_open'));
});

test('the MCP tools hold the API\'s limits', async () => {
  const { TOOLS } = await import('./mcpTools.js');
  const props = (n) => TOOLS.find((t) => t.name === n).inputSchema.properties;
  assert.equal(props('write_doc').pages.maxItems, DOC_WRITE.maxPages);
  assert.equal(props('write_doc').pages.items.properties.title.maxLength, DOC_WRITE.maxTitle);
  assert.equal(props('edit_doc_page').edits.maxItems, DOC_WRITE.maxEdits);
  assert.equal(props('edit_doc_page').title.maxLength, DOC_WRITE.maxTitle);
});
