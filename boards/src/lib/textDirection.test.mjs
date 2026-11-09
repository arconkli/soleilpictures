// The rule for dir="auto" (lib/textDirection.js), on ProseMirror node names and
// on a small fake DOM: no jsdom here, so the tree is hand-built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wantsDirAuto, ownsDirection, markTextDirection, strongDirection, unsettleTextDirection } from './textDirection.js';

const el = (tag, children = [], attrs = {}) => {
  const node = {
    tagName: tag.toUpperCase(),
    children,
    attrs: { ...attrs },
    hasAttribute: (k) => k in node.attrs,
    setAttribute: (k, v) => { node.attrs[k] = v; },
  };
  return node;
};
const dirs = (n) => n.attrs.dir;

test('list items and quotes always take dir=auto', () => {
  for (const name of ['li', 'listItem', 'taskItem', 'noteChecklistItem', 'blockquote']) {
    assert.equal(wantsDirAuto(name, false), true, name);
    assert.equal(wantsDirAuto(name, true), true, `${name} nested`);
    assert.equal(ownsDirection(name), true, `${name} owns`);
  }
});

test('paragraphs and headings take it only outside a list item or quote', () => {
  for (const name of ['p', 'paragraph', 'heading', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    assert.equal(wantsDirAuto(name, false), true, name);
    assert.equal(wantsDirAuto(name, true), false, `${name} inside`);
    assert.equal(ownsDirection(name), false, `${name} owns`);
  }
});

test('lists, code and screenplay blocks never take it', () => {
  for (const name of ['ul', 'ol', 'bulletList', 'orderedList', 'taskList', 'noteChecklist',
    'codeBlock', 'pre', 'code', 'screenplayBlock', 'div', 'span', 'table', 'td', 'text', 'doc', '', undefined]) {
    assert.equal(wantsDirAuto(name, false), false, String(name));
    assert.equal(wantsDirAuto(name, true), false, `${name} inside`);
  }
});

test('markTextDirection marks the outermost text block and nothing under an item or quote', () => {
  const h = el('h2');
  const p = el('p');
  const liP = el('p');
  const li = el('li', [liP]);
  const ul = el('ul', [li, el('li', [el('p')])]);
  const ckP = el('p');
  const ck = el('li', [el('span'), el('div', [ckP])], { class: 'ck' });
  const checklist = el('ul', [ck]);
  const qP = el('p');
  const bq = el('blockquote', [qP]);
  const code = el('pre', [el('code')]);
  const cell = el('p');
  const table = el('table', [el('tbody', [el('tr', [el('td', [cell])])])]);
  const root = el('div', [h, p, ul, checklist, bq, code, table]);

  assert.equal(markTextDirection(root), root);

  assert.equal(dirs(h), 'auto');
  assert.equal(dirs(p), 'auto');
  assert.equal(dirs(ul), undefined);
  assert.equal(dirs(li), 'auto');
  assert.equal(dirs(liP), undefined);
  assert.equal(dirs(ul.children[1]), 'auto');
  assert.equal(dirs(checklist), undefined);
  assert.equal(dirs(ck), 'auto');
  assert.equal(dirs(ckP), undefined);
  assert.equal(dirs(bq), 'auto');
  assert.equal(dirs(qP), undefined);
  assert.equal(dirs(code), undefined);
  assert.equal(dirs(code.children[0]), undefined);
  assert.equal(dirs(cell), 'auto');
  assert.equal(dirs(root), undefined);
});

test('a nested quote in an item keeps its own dir; an existing dir is never overridden', () => {
  const inner = el('blockquote', [el('p')]);
  const li = el('li', [el('p'), inner]);
  const rtl = el('p', [], { dir: 'rtl' });
  markTextDirection(el('div', [li, rtl]));
  assert.equal(dirs(li), 'auto');
  assert.equal(dirs(inner), 'auto');
  assert.equal(dirs(inner.children[0]), undefined);
  assert.equal(dirs(rtl), 'rtl');
});

test('a name chip gets dir=auto (tagged) wherever it sits, unless it has a dir; code is skipped', () => {
  const chip = el('span', [], { 'data-entity-ref': '{}' });
  const inLi = el('span', [], { 'data-entity-ref': '{}' });
  const fixed = el('span', [], { 'data-entity-ref': '{}', dir: 'rtl' });
  const plain = el('span');
  const inCode = el('span', [], { 'data-entity-ref': '{}' });
  const root = el('div', [el('p', [chip, plain]), el('ul', [el('li', [el('p', [inLi])])]), el('p', [fixed]), el('pre', [inCode])]);
  markTextDirection(root);
  assert.equal(dirs(chip), 'auto');
  assert.equal(chip.attrs['data-dir-auto'], '');
  assert.equal(dirs(inLi), 'auto');
  assert.equal(dirs(fixed), 'rtl');
  assert.equal('data-dir-auto' in fixed.attrs, false);
  assert.equal(dirs(plain), undefined);
  assert.equal(dirs(inCode), undefined);
});

test('markTextDirection copes with null and with an empty tree', () => {
  assert.equal(markTextDirection(null), null);
  const empty = el('div');
  assert.equal(markTextDirection(empty), empty);
  assert.deepEqual(empty.attrs, {});
});

test('strongDirection reads the first letter, whatever script it is in', () => {
  assert.equal(strongDirection('hello'), 'ltr');
  assert.equal(strongDirection('مرحبا'), 'rtl');
  assert.equal(strongDirection('שלום'), 'rtl');
  assert.equal(strongDirection('ܫܠܡܐ'), 'rtl'); // Syriac
  assert.equal(strongDirection('ދިވެހި'), 'rtl'); // Thaana
  assert.equal(strongDirection('ߒߞߏ'), 'rtl'); // Nko
  assert.equal(strongDirection('𞤀𞤁'), 'rtl'); // Adlam
  assert.equal(strongDirection('12 - (مرحبا)'), 'rtl'); // digits and punctuation are not strong
  assert.equal(strongDirection('٣ hello'), 'ltr'); // an Arabic-Indic digit is not a letter
  assert.equal(strongDirection('日本語'), 'ltr');
  assert.equal(strongDirection('‏hello'), 'rtl'); // an invisible right-to-left mark is strong
  assert.equal(strongDirection('‎مرحبا'), 'ltr');
  assert.equal(strongDirection('123 ... '), null);
  assert.equal(strongDirection(''), null);
  assert.equal(strongDirection(undefined), null);
});

// A div, td or th that holds text straight in it, outside any item or quote.
const txt = (s) => ({ nodeType: 3, nodeValue: s });
const holder = (tag, kids = [], attrs = {}) => {
  const node = el(tag, kids.filter((k) => !k.nodeType), attrs);
  node.childNodes = kids;
  return node;
};

test('markTextDirection marks a div, td or th with direct text, not inside an owner', () => {
  const line = holder('div', [txt('مرحبا')]);
  const blank = holder('div', [txt('  \n '), el('br')]);
  const wrapper = holder('div', [el('p')]);
  const cell = holder('td', [txt('خلية')]);
  const head = holder('th', [txt('Head')]);
  const emptyCell = holder('td', []);
  const row = el('tr', [cell, head, emptyCell]);
  const liDiv = holder('div', [txt('inside an item')]);
  const li = el('li', [liDiv]);
  const qDiv = holder('div', [txt('inside a quote')]);
  const bq = el('blockquote', [qDiv]);
  const pre = el('pre', [holder('div', [txt('code')])]);
  const root = el('div', [line, blank, wrapper, el('table', [el('tbody', [row])]), el('ul', [li]), bq, pre]);
  markTextDirection(root);
  assert.equal(dirs(line), 'auto');
  assert.equal(dirs(blank), undefined);
  assert.equal(dirs(wrapper), undefined);
  assert.equal(dirs(wrapper.children[0]), 'rtl'); // an empty paragraph after the Arabic line follows it
  assert.equal(dirs(cell), 'auto');
  assert.equal(dirs(head), 'auto');
  assert.equal(dirs(emptyCell), undefined);
  assert.equal(dirs(liDiv), undefined);
  assert.equal(dirs(qDiv), undefined);
  assert.equal(dirs(pre.children[0]), undefined);
  assert.equal(dirs(root), undefined);
});

test('markTextDirection tags what it adds; htmlWithoutDirection takes back only that', async () => {
  const added = el('p');
  const stored = el('p', [], { dir: 'rtl' });
  markTextDirection(el('div', [added, stored]));
  assert.equal(added.attrs['data-dir-auto'], '');
  assert.equal('data-dir-auto' in stored.attrs, false);

  const { htmlWithoutDirection } = await import('./textDirection.js');
  const strip = (attrs) => {
    const node = { attrs: { ...attrs }, removeAttribute: (k) => { delete node.attrs[k]; } };
    return node;
  };
  const a = strip({ dir: 'auto', 'data-dir-auto': '' });
  const b = strip({ dir: 'rtl' });
  const root = {
    innerHTML: 'raw',
    querySelector: (sel) => (sel === '[data-dir-auto]' ? a : null),
    cloneNode: () => ({
      querySelectorAll: (sel) => (sel === '[data-dir-auto]' ? [a] : []),
      get innerHTML() { return `a=${JSON.stringify(a.attrs)} b=${JSON.stringify(b.attrs)}`; },
    }),
  };
  assert.equal(htmlWithoutDirection(root), 'a={} b={"dir":"rtl"}');
  assert.equal(htmlWithoutDirection({ innerHTML: 'x', querySelector: () => null }), 'x');
  assert.equal(htmlWithoutDirection(null), '');
});

test('the sanitizer never lets data-dir-auto through (data-* attributes are not allowed)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./sanitizeNoteHtml.js', import.meta.url), 'utf8');
  assert.match(src, /ALLOW_DATA_ATTR:\s*false/);
  assert.doesNotMatch(src, /'data-dir-auto'/);
});

// ── the editor plugin: the set is rebuilt from the doc, cache or no cache ─────
const { Schema, Slice, Fragment, Node: PMNode } = await import('@tiptap/pm/model');
const { EditorState, TextSelection } = await import('@tiptap/pm/state');
const { Step, liftTarget, findWrapping, canSplit } = await import('@tiptap/pm/transform');
const { sinkListItem, liftListItem, splitListItem } = await import('@tiptap/pm/schema-list');
const { joinBackward } = await import('@tiptap/pm/commands');
const { DecorationSet } = await import('@tiptap/pm/view');
const { directionDecorations, TextDirection } = await import('./textDirectionExtension.js');

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: { group: 'block', content: 'inline*' },
    codeBlock: { group: 'block', content: 'text*' },
    blockquote: { group: 'block', content: 'block+' },
    listItem: { content: 'paragraph block*' },
    bulletList: { group: 'block', content: 'listItem+' },
    taskItem: { content: 'paragraph block*' },
    taskList: { group: 'block', content: 'taskItem+' },
    text: { group: 'inline' },
    // A note mention chip: an inline atom whose label is its visible text.
    mention: { group: 'inline', inline: true, atom: true, attrs: { label: { default: '' } } },
    // A board embed: a block atom whose node view draws interface words and sets its own dir.
    embed: { group: 'block', atom: true },
  },
});
const N = schema.nodes;
const p = (t) => N.paragraph.create(null, t ? schema.text(t) : null);
const li = (...c) => N.listItem.create(null, c);
const ul = (...c) => N.bulletList.create(null, c);
const bq = (...c) => N.blockquote.create(null, c);
const mkdoc = (...c) => N.doc.create(null, c);

// What is drawn where, as sorted "from-to:dir" strings.
const snap = (set, doc) => set.find(0, doc.content.size)
  .map((d) => `${d.from}-${d.to}:${d.type.attrs.dir}`).sort();
// The dir drawn on each owner, in document order.
const dirOf = (doc) => directionDecorations(doc).find(0, doc.content.size)
  .sort((a, b) => a.from - b.from).map((x) => x.type.attrs.dir);
const AR = 'مرحبا';

// The real plugin (state.init and state.apply), without a view.
const makePlugin = () => TextDirection.config.addProseMirrorPlugins.call({ name: 'textDirection' })[0];

// ── the browser-rule oracle ──────────────────────────────────────────────────
// From the decorations alone, each owner's direction the way a browser resolves it:
// an explicit dir wins; dir=auto takes the first strong letter of the element's text,
// skipping descendants that carry a dir (none found: ltr); no dir takes the parent
// element's direction; the editor root is ltr. A chip's dir comes from its decoration
// (a chip left without one is read by its label, so a missing decoration shows up);
// a block embed's from its node view (always dir=ltr), so both are skipped.
function browserDirs(doc, set) {
  const at = new Map();
  for (const d of set.find(0, doc.content.size)) at.set(d.from, d.type.attrs.dir);
  const firstStrong = (node, pos) => {
    if (node.isText) return strongDirection(node.text);
    if (node.type.name === 'mention') return strongDirection(node.attrs.label); // the chip's visible text
    let p = pos + 1;
    for (let i = 0; i < node.childCount; i += 1) {
      const c = node.child(i);
      if (c.type.name === 'embed') { p += c.nodeSize; continue; }
      if (c.isText || !at.has(p)) { const d = firstStrong(c, p); if (d) return d; }
      p += c.nodeSize;
    }
    return null;
  };
  const out = [];
  const walk = (node, pos, parentDir, inside) => {
    let dir = parentDir;
    if (pos >= 0) {
      const a = at.get(pos);
      if (a === 'rtl' || a === 'ltr') dir = a;
      else if (a === 'auto') dir = firstStrong(node, pos) || 'ltr';
      if (wantsDirAuto(node.type.name, inside)) out.push({ pos, dir });
    }
    if (node.isTextblock || node.isLeaf) return;
    const inner = inside || (pos >= 0 && ownsDirection(node.type.name));
    let p = pos < 0 ? 0 : pos + 1;
    for (let i = 0; i < node.childCount; i += 1) {
      walk(node.child(i), p, dir, inner);
      p += node.child(i).nodeSize;
    }
  };
  walk(doc, -1, 'ltr', false);
  return out;
}

// What each owner should read as, worked out straight from the document.
function desiredDirs(doc) {
  const owners = [];
  const ownStrong = (node) => {
    if (node.isText) return strongDirection(node.text);
    // A chip never decides its line's direction (it carries a dir of its own).
    for (let i = 0; i < node.childCount; i += 1) {
      const c = node.child(i);
      if (!c.isText && ownsDirection(c.type.name)) continue;
      const d = ownStrong(c);
      if (d) return d;
    }
    return null;
  };
  const walk = (node, pos, inside, parent) => {
    let here = parent;
    if (pos >= 0 && wantsDirAuto(node.type.name, inside)) {
      here = owners.length;
      owners.push({ pos, end: pos + node.nodeSize, strong: ownStrong(node), parent });
    }
    if (node.isTextblock || node.isLeaf) return;
    const inner = inside || (pos >= 0 && ownsDirection(node.type.name));
    let p = pos < 0 ? 0 : pos + 1;
    for (let i = 0; i < node.childCount; i += 1) { walk(node.child(i), p, inner, here); p += node.child(i).nodeSize; }
  };
  walk(doc, -1, false, -1);
  return owners.map((o, i) => {
    if (o.strong) return { pos: o.pos, dir: o.strong };
    const below = owners.slice(i + 1).find((x) => x.pos < o.end && x.strong);
    if (below) return { pos: o.pos, dir: below.strong };
    const before = owners.slice(0, i).reverse().find((x) => x.strong);
    return { pos: o.pos, dir: before ? before.strong : 'ltr' };
  });
}

function assertBrowserRule(doc, set, label = '') {
  assert.deepEqual(browserDirs(doc, set), desiredDirs(doc), `browser rule ${label}`);
}
const decorated = (doc) => directionDecorations(doc).find(0, doc.content.size).length;

test('an English-only document carries nothing', () => {
  const doc = mkdoc(p('hello'), ul(li(p('a'), ul(li(p('')))), li(p('123'))), bq(p('quote')));
  assert.equal(decorated(doc), 0);
  assert.equal(directionDecorations(doc), DecorationSet.empty);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('an English item nested in an Arabic item has a dir of its own', () => {
  const doc = mkdoc(ul(li(p(AR), ul(li(p('English sub-point'))))));
  assert.deepEqual(dirOf(doc), ['auto', 'auto']);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('an Arabic item nested in an English item is decorated; its English parent is not', () => {
  const doc = mkdoc(ul(li(p('English'), ul(li(p(AR))))));
  assert.deepEqual(dirOf(doc), ['auto']);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('an English list item inside an Arabic blockquote has a dir of its own', () => {
  const doc = mkdoc(bq(p(AR), ul(li(p('English item')))));
  assert.deepEqual(dirOf(doc), ['auto', 'auto']);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('a quote holding only an Arabic list after an English paragraph: the quote is rtl, its item nothing', () => {
  const doc = mkdoc(p('English'), bq(ul(li(p(AR)))));
  const set = directionDecorations(doc);
  const found = set.find(0, doc.content.size);
  assert.equal(found.length, 1);
  assert.equal(found[0].from, doc.child(0).nodeSize); // the quote
  assert.equal(found[0].type.attrs.dir, 'rtl');
  assertBrowserRule(doc, set);
});

test('an item is judged by its own text, then by the first item below it', () => {
  const a = mkdoc(ul(li(p(''), ul(li(p(AR))))));
  assert.deepEqual(dirOf(a), ['rtl']);
  assertBrowserRule(a, directionDecorations(a));
  const b = mkdoc(ul(li(p('English'), ul(li(p(AR))))));
  assert.deepEqual(dirOf(b), ['auto']);
  assertBrowserRule(b, directionDecorations(b));
});

test('an empty item after an Arabic paragraph is right to left, across parents', () => {
  const doc = mkdoc(p(AR), ul(li(p(''))));
  assert.deepEqual(dirOf(doc), ['auto', 'rtl']);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('a nested empty item after its Arabic parent inherits; nothing is drawn on it', () => {
  const doc = mkdoc(ul(li(p(AR), ul(li(p(''))))));
  assert.deepEqual(dirOf(doc), ['auto']);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('an empty item after English, inside an Arabic item, is explicitly ltr', () => {
  const doc = mkdoc(ul(li(p(AR), ul(li(p('English')), li(p(''))))));
  assert.deepEqual(dirOf(doc), ['auto', 'auto', 'ltr']);
  assertBrowserRule(doc, directionDecorations(doc));
});

const mention = (label) => N.mention.create({ label });
const para = (...c) => N.paragraph.create(null, c);
const embed = () => N.embed.create();

test('a chip never decides its line: an Arabic sentence led by a Latin name reads rtl', () => {
  const doc = mkdoc(para(mention('Marcus'), schema.text(` ${AR}`)));
  const set = directionDecorations(doc);
  assert.deepEqual(browserDirs(doc, set).map((o) => o.dir), ['rtl']);
  assertBrowserRule(doc, set);
  // the paragraph and the chip each carry dir=auto
  assert.deepEqual(dirOf(doc), ['auto', 'auto']);
  // inside an item, an Arabic sub-item agrees with its parent: nothing extra on it
  const nested = mkdoc(ul(li(para(mention('Marcus Webb'), schema.text(` ${AR}`)), ul(li(p(AR))))));
  assertBrowserRule(nested, directionDecorations(nested));
  assert.equal(decorated(nested), 2); // the item and its chip; the Arabic sub-item agrees with its parent
});

test('a Hebrew-named chip leading an English line in an English document carries nothing', () => {
  const doc = mkdoc(p('English'), para(mention('דני'), schema.text(' hello there')));
  assert.equal(directionDecorations(doc), DecorationSet.empty);
  assert.deepEqual(browserDirs(doc, directionDecorations(doc)).map((o) => o.dir), ['ltr', 'ltr']);
});

test('the same English line inside an Arabic document stays ltr', () => {
  const doc = mkdoc(p(AR), para(mention('דני'), schema.text(' hello there')));
  const set = directionDecorations(doc);
  assert.deepEqual(browserDirs(doc, set).map((o) => o.dir), ['rtl', 'ltr']);
  assertBrowserRule(doc, set);
  // the Arabic paragraph, and the chip (the English paragraph reads ltr like its parent: nothing)
  assert.deepEqual(dirOf(doc), ['auto', 'auto']);
});

test('a line holding only a chip after Arabic inherits rtl', () => {
  const doc = mkdoc(p(AR), para(mention('Marcus')));
  const set = directionDecorations(doc);
  assert.deepEqual(browserDirs(doc, set).map((o) => o.dir), ['rtl', 'rtl']);
  assertBrowserRule(doc, set);
});

test('a chip with an empty label is not decorated', () => {
  const doc = mkdoc(p(AR), para(mention('')));
  assert.deepEqual(dirOf(doc), ['auto', 'rtl']);
});

test('a block embed leading a quote does not decide it: an Arabic quote stays rtl', () => {
  const doc = mkdoc(bq(embed(), p(AR)));
  const set = directionDecorations(doc);
  assert.deepEqual(browserDirs(doc, set).map((o) => o.dir), ['rtl']);
  assertBrowserRule(doc, set);
  // and in an English document it carries nothing
  const en = mkdoc(bq(embed(), p('English')), ul(li(p('item'), embed())));
  assert.equal(directionDecorations(en), DecorationSet.empty);
});

test('a digits-only paragraph after an Arabic one is right to left', () => {
  const doc = mkdoc(p(AR), p('123'));
  assert.deepEqual(dirOf(doc), ['auto', 'rtl']);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('after English text, an empty owner reads left to right and is not decorated', () => {
  const doc = mkdoc(p(AR), p('hello'), p(''));
  assert.deepEqual(dirOf(doc), ['auto']);
  assertBrowserRule(doc, directionDecorations(doc));
});

test('an all-Arabic document decorates every top-level owner and nothing nested that agrees', () => {
  const doc = mkdoc(p(AR), ul(li(p(AR), ul(li(p(AR)), li(p(''))))), bq(p(AR), ul(li(p(AR)))), p(AR));
  const set = directionDecorations(doc);
  const found = set.find(0, doc.content.size);
  // the paragraph, the list's first item, the quote and the last paragraph; no nested item
  assert.equal(found.length, 4);
  let pos = 0;
  const tops = [];
  for (let i = 0; i < doc.childCount; i += 1) { tops.push(pos); pos += doc.child(i).nodeSize; }
  const from = found.map((d) => d.from).sort((x, y) => x - y);
  assert.deepEqual(from, [tops[0], tops[1] + 1, tops[2], tops[3]]);
  assertBrowserRule(doc, set);
});

test('Shift-Tab on an Arabic item holding two paragraphs matches a full rebuild', () => {
  const doc = mkdoc(p('مقدمة'), ul(li(p('واحد')), li(p('اثنان'), p('سطر ثان')), li(p('ثلاثة'))), p('خاتمة'));
  const start = doc.child(0).nodeSize + 1 + doc.child(1).child(0).nodeSize + 3;
  const plugin = makePlugin();
  let state = EditorState.create({ schema, doc, plugins: [plugin] });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start)));
  let tr = null;
  liftListItem(N.listItem)(state, (t) => { tr = t; });
  assert.ok(tr, 'the lift ran');
  state = state.apply(tr);
  assert.deepEqual(snap(plugin.getState(state), state.doc), snap(directionDecorations(state.doc, { cache: false }), state.doc));
  // the lifted paragraph is now a top-level owner, and the old item is gone: 4 owners, all auto
  assert.ok(snap(plugin.getState(state), state.doc).length >= 3);
});

test('the two-step transaction that threw in DecorationSet.map does not throw', () => {
  const doc = PMNode.fromJSON(schema, {"type":"doc","content":[{"type":"blockquote","content":[{"type":"blockquote","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph"},{"type":"blockquote","content":[{"type":"blockquote","content":[{"type":"blockquote","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"ي"}]},{"type":"paragraph","content":[{"type":"text","text":"عر"}]},{"type":"paragraph","content":[{"type":"text","text":"بي"}]}]}]}]}]}]}]}]}]},{"type":"paragraph","content":[{"type":"text","text":"مرحبا"}]}]});
  const steps = [{"stepType":"replace","from":17,"to":17,"slice":{"content":[{"type":"paragraph","content":[{"type":"text","text":"مرحبا"}]}]}},{"stepType":"replaceAround","from":8,"to":30,"gapFrom":9,"gapTo":29,"insert":0,"structure":true}];
  const plugin = makePlugin();
  const state = EditorState.create({ schema, doc, plugins: [plugin] });
  const tr = state.tr;
  for (const s of steps) tr.step(Step.fromJSON(schema, s));
  let next;
  assert.doesNotThrow(() => { next = state.apply(tr); });
  assert.deepEqual(snap(plugin.getState(next), next.doc), snap(directionDecorations(next.doc, { cache: false }), next.doc));
});

// ── fuzz: the plugin's state equals an uncached full rebuild, after every transaction
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
const WORDS = ['hello', 'مرحبا', 'שלום', '123', '', ' ', 'abc', 'عربي', '‏', 'x', '٣', '😀'];

function randomBlock(r, depth = 0) {
  const w = () => WORDS[Math.floor(r() * WORDS.length)];
  const para = () => {
    const t = w();
    const text = t ? [schema.text(t)] : [];
    if (r() < 0.15) text.unshift(N.mention.create({ label: w() }));
    return N.paragraph.create(null, text);
  };
  const kind = r();
  if (depth < 3 && kind < 0.2) return bq(para(), ...(r() < 0.5 ? [randomBlock(r, depth + 1)] : []));
  if (depth < 3 && kind < 0.4) {
    const item = () => li(para(), ...(r() < 0.4 ? [randomBlock(r, depth + 1)] : []));
    return ul(...[item(), item(), item()].slice(0, 1 + Math.floor(r() * 3)));
  }
  if (depth < 3 && kind < 0.5) return N.taskList.create(null, [N.taskItem.create(null, [para()])]);
  if (kind < 0.6) { const t = w(); return N.heading.create(null, t ? schema.text(t) : null); }
  if (kind < 0.65) return N.codeBlock.create(null, schema.text('code'));
  if (kind < 0.68) return bq(embed(), para());
  return para();
}

// One edit, added to `tr` (so one transaction can hold several). Real commands run on
// a throwaway state over tr.doc and their steps are copied in.
function addEdit(tr, r) {
  const doc = tr.doc;
  const size = doc.content.size;
  const pos = () => Math.min(size, 1 + Math.floor(r() * Math.max(1, size - 1)));
  const viaCommand = (cmd) => {
    let st = EditorState.create({ schema, doc });
    try { st = st.apply(st.tr.setSelection(TextSelection.near(doc.resolve(pos())))); } catch { return; }
    cmd(st, (t) => { for (const s of t.steps) tr.step(s); });
  };
  try {
    switch (Math.floor(r() * 12)) {
      case 0: tr.insertText(WORDS[Math.floor(r() * WORDS.length)] || 'x', pos()); break;
      case 1: viaCommand(sinkListItem(N.listItem)); break;
      case 2: viaCommand(liftListItem(N.listItem)); break;
      case 3: viaCommand(splitListItem(N.listItem)); break;
      case 4: viaCommand(joinBackward); break;
      case 5: { // setNodeMarkup
        const $p = doc.resolve(pos());
        if ($p.parent.isTextblock && $p.parent.type.name !== 'codeBlock' && $p.depth > 0) tr.setNodeMarkup($p.before(), [N.paragraph, N.heading][Math.floor(r() * 2)]);
        break;
      }
      case 6: { // wrap
        const a = pos();
        const range = doc.resolve(a).blockRange(doc.resolve(Math.min(size, a + Math.floor(r() * 12))));
        const type = [N.bulletList, N.blockquote, N.taskList][Math.floor(r() * 3)];
        const wrapping = range && findWrapping(range, type);
        if (wrapping) tr.wrap(range, wrapping);
        break;
      }
      case 7: { // Enter at a block boundary
        const $p = doc.resolve(pos());
        for (const depth of [1, 2, 3]) if ($p.depth >= depth && canSplit(doc, $p.pos, depth)) { tr.split($p.pos, depth); break; }
        break;
      }
      case 8: { // lift a range
        const range = doc.resolve(pos()).blockRange();
        const target = range && liftTarget(range);
        if (target != null) tr.lift(range, target);
        break;
      }
      case 9: { const a = pos(); tr.delete(a, Math.min(size, a + 1 + Math.floor(r() * 30))); break; }
      case 10: { // paste a slice
        const a = pos();
        const blocks = [randomBlock(r), randomBlock(r)].slice(0, 1 + Math.floor(r() * 2));
        tr.replaceRange(a, Math.min(size, a + Math.floor(r() * 6)), new Slice(Fragment.from(blocks), 0, 0));
        break;
      }
      default: if (r() < 0.25) tr.replaceWith(0, size, [randomBlock(r), randomBlock(r)]); // whole-doc replace
    }
  } catch { /* an edit the schema refuses is simply skipped */ }
}

function runFuzz(reference) {
  let applied = 0;
  for (const seed of [1, 7, 42, 99, 2026, 31337]) {
    const r = rng(seed);
    const fresh = () => mkdoc(...Array.from({ length: 8 }, () => randomBlock(r)));
    const plugin = makePlugin();
    let state = EditorState.create({ schema, doc: fresh(), plugins: [plugin] });
    for (let i = 0; i < 300; i += 1) {
      const tr = state.tr;
      const steps = 1 + Math.floor(r() * 4);
      for (let s = 0; s < steps; s += 1) addEdit(tr, r);
      if (!tr.docChanged) continue;
      applied += 1;
      state = state.apply(tr); // must not throw
      assert.deepEqual(snap(plugin.getState(state), state.doc), snap(reference(state.doc), state.doc), `seed ${seed} tr ${i}`);
      assertBrowserRule(state.doc, plugin.getState(state), `seed ${seed} tr ${i}`);
      assertStaticMatchesEditor(state.doc, `seed ${seed} tr ${i}`);
      if (state.doc.content.size < 8 || state.doc.content.size > 700) {
        state = state.apply(state.tr.replaceWith(0, state.doc.content.size, fresh().content));
      }
    }
  }
  return applied;
}

test('the plugin state equals an uncached full rebuild after every transaction (6 seeds x 300)', () => {
  const applied = runFuzz((doc) => directionDecorations(doc, { cache: false }));
  assert.ok(applied > 1000, `only ${applied} transactions applied`);
});

// ── the static pass agrees with the editor ───────────────────────────────────
// A small DOM that can be built, marked, serialized and cloned: enough for
// markTextDirection, directedHtml and htmlWithoutDirection.
const { markTextDirection: mark, htmlWithoutDirection: withoutDir, directedHtml: directed } = await import('./textDirection.js');

function ser(n) {
  if (n.nodeType === 3) return n.nodeValue;
  const tag = n.tagName.toLowerCase();
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  return `<${tag}${attrs}>${n.childNodes.map(ser).join('')}</${tag}>`;
}

function dn(tag, kids = [], attrs = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    childNodes: [],
    children: [],
    hasAttribute: (k) => k in node.attrs,
    getAttribute: (k) => (k in node.attrs ? node.attrs[k] : null),
    setAttribute: (k, v) => { node.attrs[k] = v; },
    removeAttribute: (k) => { delete node.attrs[k]; },
    append: (c) => { node.childNodes.push(c); if (c.nodeType === 1) node.children.push(c); },
    cloneNode: () => {
      const copy = dn(tag, [], node.attrs);
      for (const c of node.childNodes) copy.append(c.nodeType === 3 ? c : c.cloneNode(true));
      return copy;
    },
    querySelector: (sel) => node.querySelectorAll(sel)[0] || null,
    querySelectorAll: (sel) => {
      assert.ok(sel === '[data-dir-auto]' || sel === '[data-dir-auto][dir="rtl"]', sel);
      const want = sel === '[data-dir-auto]' ? () => true : (c) => c.attrs.dir === 'rtl';
      const out = [];
      const visit = (n) => { for (const c of n.children) { if ('data-dir-auto' in c.attrs && want(c)) out.push(c); visit(c); } };
      visit(node);
      return out;
    },
    get innerHTML() { return node.childNodes.map(ser).join(''); },
  };
  for (const k of kids) node.append(k);
  return node;
}
const tx = (s) => ({ nodeType: 3, nodeValue: s });

const DOM_TAGS = { paragraph: 'p', heading: 'h2', blockquote: 'blockquote', bulletList: 'ul', taskList: 'ul', listItem: 'li', taskItem: 'li', codeBlock: 'pre' };

// The editor's document as static, sanitized html, with the elements that are
// owners listed in document order (the order desiredDirs uses).
function toDom(doc) {
  const owners = [];
  const conv = (node, inside) => {
    if (node.isText) return tx(node.text);
    const name = node.type.name;
    if (name === 'mention') return dn('span', node.attrs.label ? [tx(node.attrs.label)] : [], { 'data-entity-ref': '{}' });
    if (name === 'embed') return dn('div', [], { dir: 'ltr' }); // its node view sets a dir of its own
    const el = dn(DOM_TAGS[name]);
    if (wantsDirAuto(name, inside)) owners.push(el);
    const inner = inside || ownsDirection(name);
    node.forEach((c) => el.append(conv(c, inner)));
    return el;
  };
  const root = dn('div');
  doc.forEach((c) => root.append(conv(c, false)));
  return { root, owners };
}

// How a browser resolves each element: an explicit dir wins; dir=auto reads the
// first strong letter of its text, skipping descendants that carry a dir (none:
// ltr); no dir takes the parent's. Returns the direction of each owner.
function resolveDom(root, owners) {
  const firstStrong = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) {
        const d = strongDirection(c.nodeValue);
        if (d) return d;
      } else if (!('dir' in c.attrs)) {
        const d = firstStrong(c);
        if (d) return d;
      }
    }
    return null;
  };
  const resolved = new Map();
  const walk = (el, parentDir) => {
    let dir = parentDir;
    const a = el.attrs.dir;
    if (a === 'rtl' || a === 'ltr') dir = a;
    else if (a === 'auto') dir = firstStrong(el) || 'ltr';
    resolved.set(el, dir);
    for (const c of el.children) walk(c, dir);
  };
  walk(root, 'ltr');
  return owners.map((o) => resolved.get(o));
}

// Names the document and the owner when the static pass and the editor disagree.
function assertStaticMatchesEditor(doc, label = '') {
  const { root, owners } = toDom(doc);
  const before = root.innerHTML;
  mark(root);
  const got = resolveDom(root, owners);
  const want = desiredDirs(doc).map((d) => d.dir);
  got.forEach((dir, i) => {
    assert.equal(dir, want[i], `static pass vs editor ${label}: owner #${i} (<${owners[i].tagName.toLowerCase()}>) in ${JSON.stringify(doc.toJSON())}`);
  });
  assert.equal(withoutDir(root), before, `htmlWithoutDirection(markTextDirection(x)) !== x ${label}: ${JSON.stringify(doc.toJSON())}`);
}

test('the static pass agrees with the editor on a chip-only line, digits and punctuation after Arabic', () => {
  for (const doc of [
    mkdoc(p(AR), para(mention('Marcus'))),
    mkdoc(p(AR), p('123')),
    mkdoc(p(AR), p('...')),
    mkdoc(p(AR), ul(li(para(mention('Marcus'))), li(p('42')))),
    mkdoc(p(AR), bq(para(mention('Marcus')))),
    mkdoc(bq(p(''), ul(li(p(AR))))),
    mkdoc(p(AR), p('hello'), p('123')),
  ]) assertStaticMatchesEditor(doc, 'named case');
  const { root, owners } = toDom(mkdoc(p(AR), para(mention('Marcus')), p('123')));
  mark(root);
  assert.deepEqual(resolveDom(root, owners), ['rtl', 'rtl', 'rtl']);
  assert.equal(owners[1].attrs.dir, 'rtl');
  assert.equal(owners[1].attrs['data-dir-auto'], '');
});

test('an English-only document is unchanged by the static pass: every owner keeps dir=auto', () => {
  const { root, owners } = toDom(mkdoc(p('hello'), ul(li(p('123')), li(p(''))), bq(para(mention('Marcus'))), p('...')));
  mark(root);
  assert.equal(owners.length, 5);
  for (const o of owners) assert.equal(o.attrs.dir, 'auto');
  assert.doesNotMatch(root.innerHTML, /dir="(rtl|ltr)"/);
});

test('the static pass leaves an author-stored dir alone', () => {
  const stored = dn('p', [], { dir: 'ltr' });
  const root = dn('div', [dn('p', [tx(AR)]), stored]);
  mark(root);
  assert.equal(stored.attrs.dir, 'ltr');
  assert.equal('data-dir-auto' in stored.attrs, false);
});

test('the static pass agrees with the editor over the fuzz corpus (documents)', () => {
  let n = 0;
  for (const seed of [1, 7, 42, 99, 2026, 31337, 5, 11]) {
    const r = rng(seed);
    for (let i = 0; i < 150; i += 1) {
      assertStaticMatchesEditor(mkdoc(...Array.from({ length: 8 }, () => randomBlock(r))), `seed ${seed} doc ${i}`);
      n += 1;
    }
  }
  assert.equal(n, 1200);
});

// ── export: dir stays, the internal markers go ───────────────────────────────
test('directedHtml with markers:false keeps every dir and drops data-dir-auto', () => {
  const build = () => dn('div', [
    dn('p', [tx('hello')]),
    dn('p', [tx(AR)]),
    dn('p', [dn('span', [tx('Marcus')], { 'data-entity-ref': '{}' })]),
    dn('p', [tx('x')], { dir: 'rtl' }),
  ]);
  const real = globalThis.document;
  let current = null;
  globalThis.document = {
    createElement: () => ({
      set innerHTML(_) { current = build(); },
      get innerHTML() { return current.innerHTML; },
      get content() { return current; },
    }),
  };
  try {
    const kept = directed('<mixed>');
    const bare = directed('<mixed>', { markers: false });
    assert.match(kept, /data-dir-auto/);
    assert.doesNotMatch(bare, /data-dir-auto/);
    assert.equal(bare, kept.replaceAll(' data-dir-auto=""', ''));
    assert.match(bare, /<p dir="auto">hello<\/p>/);
    assert.match(bare, /<p dir="auto">مرحبا<\/p>/);
    assert.match(bare, /<p dir="rtl">x<\/p>/);
    assert.match(bare, /<span data-entity-ref="\{\}" dir="auto">Marcus<\/span>/);
  } finally {
    globalThis.document = real;
  }
});

test('an English document exports the html directedHtml gave before, minus the markers', () => {
  const build = () => dn('div', [dn('p', [tx('hello')]), dn('ul', [dn('li', [dn('p', [tx('item')])])])]);
  const real = globalThis.document;
  let current = null;
  globalThis.document = {
    createElement: () => ({
      set innerHTML(_) { current = build(); },
      get innerHTML() { return current.innerHTML; },
      get content() { return current; },
    }),
  };
  try {
    const expected = '<p dir="auto" data-dir-auto="">hello</p><ul><li dir="auto" data-dir-auto=""><p>item</p></li></ul>';
    assert.equal(directed('x'), expected);
    assert.equal(directed('x', { markers: false }), expected.replaceAll(' data-dir-auto=""', ''));
  } finally {
    globalThis.document = real;
  }
});

// ── settle:false: the editable DOM (RichNoteEditor) keeps only phase 1 ───────
test('settle:false leaves every owner dir=auto with its marker; the default settles; htmlWithoutDirection round-trips', () => {
  const build = () => dn('div', [
    dn('p', [tx(AR)]),
    dn('p', [tx('2024')]),
    dn('p', [tx('hello')]),
  ]);
  const real = globalThis.document;
  let current = null;
  globalThis.document = {
    createElement: () => ({
      set innerHTML(_) { current = build(); },
      get innerHTML() { return current.innerHTML; },
      get content() { return current; },
    }),
  };
  try {
    const settled = directed('x');
    assert.equal(settled, `<p dir="auto" data-dir-auto="">${AR}</p><p dir="rtl" data-dir-auto="">2024</p><p dir="auto" data-dir-auto="">hello</p>`);
    assert.equal(directed('x', { settle: true }), settled);
    const plain = directed('x', { settle: false });
    assert.equal(plain, `<p dir="auto" data-dir-auto="">${AR}</p><p dir="auto" data-dir-auto="">2024</p><p dir="auto" data-dir-auto="">hello</p>`);
    assert.doesNotMatch(plain, /dir="rtl"|dir="ltr"/);
    // markTextDirection takes the same option, and the markers still come back off.
    const root = build();
    mark(root, { settle: false });
    assert.equal(root.innerHTML, plain);
    assert.equal(withoutDir(root), `<p>${AR}</p><p>2024</p><p>hello</p>`);
  } finally {
    globalThis.document = real;
  }
});

test('unsettleTextDirection puts a settled dir=rtl back to auto and leaves an authored one', () => {
  const root = dn('div', [dn('p', [tx(AR)]), dn('p', [tx('2024')]), dn('p', [tx('x')], { dir: 'rtl' })]);
  mark(root);
  assert.equal(root.children[1].attrs.dir, 'rtl'); // settled after the Arabic line
  assert.equal(unsettleTextDirection(root), root);
  assert.deepEqual(root.children.map((c) => c.attrs.dir), ['auto', 'auto', 'rtl']);
  assert.equal(unsettleTextDirection(null), null);
});

import { scriptClass } from './textDirection.js';

test('scriptClass: an engine that lacks one script name still gets the rest', () => {
  const make = (src) => {
    if (src.includes('Yezidi')) throw new SyntaxError('Invalid property name');
    return new RegExp(src, 'u');
  };
  const re = scriptClass(['Arabic', 'Hebrew', 'Yezidi'], make);
  assert.ok(re.test('\u0628'));
  assert.ok(re.test('\u05D0'));
  assert.ok(!re.test('a'));
  assert.ok(scriptClass(['Arabic', 'Yezidi']).test('\u{10E80}'));
});
