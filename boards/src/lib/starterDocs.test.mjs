// starterDocs.test.mjs — the treatment a page promises: the same sections as
// the page, written the way the editor would write them, whole on every device.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import {
  TREATMENT_SECTIONS, TREATMENT_EXPORT_STEP, STARTER_DOCS, treatmentPageSteps, starterDocPages, starterDocSpot, isStarterKind,
  writeStarterDoc, isPristineStarter, starterDocsTouched, docFingerprint,
} from './starterDocs.js';
import { openDocWhenMounted } from './openDocCard.js';
import { stashStarterIntent, readStarterIntent, clearStarterIntent, STARTER_INTENT_KEY, STARTER_INTENT_MAX_AGE_MS } from './starterIntent.js';
import { initCardDocStore, cardScope, writeScriptBody, readPages, pageContentMap } from './docState.js';
import { docPagesText } from './docText.js';
import { buildCardIndexRow } from './cardIndexRow.js';
import { getLandingSpec } from './seoLanding.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

// The schema the doc editor binds with (baseExtensions: StarterKit, headings 1–6).
const schema = getSchema([StarterKit.configure({ history: false, heading: { levels: [1, 2, 3, 4, 5, 6] } })]);

// A board holding the starter doc, made the way App's addStarterDoc makes it:
// card, doc store and every page in ONE 'local' transaction.
function boardWithStarter(kind = 'treatment') {
  const ydoc = new Y.Doc();
  const cards = ydoc.getMap('cards');
  const undo = new Y.UndoManager(cards, { trackedOrigins: new Set(['local']) });
  ydoc.transact(() => {
    const ym = new Y.Map();
    cards.set('doc-1', ym);
    ym.set('kind', 'doc');
    ym.set('title', STARTER_DOCS[kind].title);
    ym.set('seed', true);
    ym.set('starter', kind);
    writeStarterDoc(ydoc, ym, kind);   // App's own write
  }, 'local');
  return { ydoc, undo, cards };
}

test('the page prints the same sections the document is written from, then how to send it', () => {
  const spec = getLandingSpec('/tools/directors-treatment');
  assert.deepEqual(spec.steps, treatmentPageSteps());
  assert.deepEqual(spec.steps.map((s) => s.t), [...TREATMENT_SECTIONS.map((s) => s.t), TREATMENT_EXPORT_STEP.t]);
  assert.equal(spec.starter, 'treatment', 'its buttons ask for the document');
  assert.ok(isStarterKind(spec.starter));
});

test('the document: a cover, then a page per section, headed with the page\'s own words', () => {
  const pages = starterDocPages('treatment');
  assert.equal(pages.length, 1 + TREATMENT_SECTIONS.length);
  assert.deepEqual(pages.map((p) => p.name), ['Cover', ...TREATMENT_SECTIONS.map((s) => s.t)]);
  for (const [i, s] of TREATMENT_SECTIONS.entries()) {
    const [h, para] = pages[i + 1].docJSON.content;
    assert.equal(h.type, 'heading');
    assert.equal(h.content[0].text, s.t);
    assert.equal(para.content[0].text, s.prompt);
  }
  assert.deepEqual(starterDocPages('nope'), []);
});

test('written whole in the card\'s creation, readable by every device, and exactly what the editor writes', () => {
  const { ydoc } = boardWithStarter();
  const again = new Y.Doc();
  Y.applyUpdate(again, Y.encodeStateAsUpdate(ydoc));
  const card = again.getMap('cards').get('doc-1');
  const scope = cardScope(card);
  const pages = readPages(again, scope).sort((a, b) => a.order - b.order);
  assert.deepEqual(pages.map((p) => p.name), starterDocPages('treatment').map((p) => p.name));
  const byName = new Map(starterDocPages('treatment').map((p) => [p.name, p.docJSON]));
  for (const p of pages) {
    // The editor's binding DELETES an element that fails the schema on first
    // render — this is the difference between a treatment and blank pages.
    const root = yXmlFragmentToProseMirrorRootNode(pageContentMap(again, scope).get(p.id), schema);
    root.check();
    assert.deepEqual(root.toJSON(), schema.nodeFromJSON(byName.get(p.name)).toJSON(), p.name);
  }
  // Searchable: the words reach the doc page index like any typed doc's.
  const text = docPagesText(card).map((p) => p.text).join(' ');
  assert.match(text, /Palette, lensing, light and texture\./);
});

test('one undo takes the whole document back', () => {
  const { ydoc, undo, cards } = boardWithStarter();
  assert.ok(cards.get('doc-1'));
  undo.undo();
  assert.equal(cards.get('doc-1'), undefined);
  assert.equal(ydoc.getMap('cards').size, 0);
});

test('a seed: never in card_index, so it neither counts nor stamps activation', () => {
  const { cards } = boardWithStarter();
  const ym = cards.get('doc-1');
  assert.equal(buildCardIndexRow({ workspaceId: 'ws', boardId: 'b', cardId: 'doc-1', get: (k) => ym.get(k) }), null);
});

test('it lands beside what is already on the board, not on top of it', () => {
  assert.equal(starterDocSpot([]), null);
  const spot = starterDocSpot([{ x: 100, y: 300, w: 200, h: 100 }, { x: 500, y: 120, w: 300, h: 200 }]);
  assert.equal(spot.x - 320 / 2, 500 + 300 + 80, 'its left edge clears the rightmost card');
  assert.equal(spot.y - 240 / 2, 120, 'top-aligned with the highest');
});

test('the request survives sign-in for a day, and only for a document that exists', () => {
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  assert.equal(stashStarterIntent({ kind: 'treatment', from: '/tools/directors-treatment', now: 1000 }, storage), true);
  assert.deepEqual(readStarterIntent({ now: 61_000 }, storage), { kind: 'treatment', from: '/tools/directors-treatment', ageMs: 60_000 });
  assert.equal(readStarterIntent({ now: 1000 + STARTER_INTENT_MAX_AGE_MS + 1 }, storage), null);
  assert.equal(m.has(STARTER_INTENT_KEY), false, 'an expired request is removed on read');
  assert.equal(stashStarterIntent({ kind: 'nope' }, storage), false);
  m.set(STARTER_INTENT_KEY, JSON.stringify({ kind: 'treatment', at: null }));
  assert.equal(readStarterIntent({}, storage), null, 'no timestamp is not "stamped at the epoch"');
  m.set(STARTER_INTENT_KEY, '{garbled');
  assert.equal(readStarterIntent({}, storage), null);
  stashStarterIntent({ kind: 'treatment' }, storage);
  clearStarterIntent(storage);
  assert.equal(readStarterIntent({}, storage), null);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('App writes it as a seed, in one transaction, free at the cap, and spends the request first', () => {
  const app = read('App.jsx');
  const fn = app.slice(app.indexOf('const addStarterDoc = (kind, clickPos = null) => {'), app.indexOf('const setBoardBgColor = async'));
  assert.match(fn, /kind: 'doc', title: STARTER_DOCS\[kind\]\.title, seed: true, starter: kind,/);
  assert.match(fn, /afterInsert: \(cardYM\) => \{ if \(cardYM\) writeStarterDoc\(ydoc, cardYM, kind\); \},/);
  assert.doesNotMatch(fn.replace(/^\s*\/\/.*$/gm, ''), /setAutoFocusId/,
    'autofocus selects a doc\'s TITLE text — the next keystroke would rename the treatment');
  assert.match(app, /const cost = isSeedCard\(card\) \? 0 : placementCost\(card\);/,
    'a seed is never indexed, so the gate must not charge it either');
  assert.match(app, /useStarterIntentResume\(\{\s*ready: !myTier\.loading && yb\.ready && yb\.synced && yb\.boardId === currentBoard\?\.id\s*&& firstRunSettled && !!currentBoard\?\.id && canEditCurrent && onOwnBoard,/,
    'placed against the server\'s board, not the cache paint — and only on the person\'s own');
  assert.match(app, /const onOwnBoard = !!currentBoard\?\.id && currentBoard\.workspace_id === workspace\?\.id\s*&& !!user\?\.id && workspace\?\.created_by === user\.id;/);
  assert.match(app, /if \(id\) openDocWhenMounted\(\{ boardId: currentBoard\.id, cardId: id \}\);/);
  const hook = read('hooks/useStarterIntentResume.js');
  const claim = hook.indexOf('claimStarterIntent().then(');
  assert.ok(claim > 0 && claim < hook.indexOf('resumeRef.current(intent);'),
    'spent (claimed) before the write — a refusal or a crash never writes it twice');
});

test('a free start on the treatment page asks for it; one anywhere else drops an old request', () => {
  const hook = read('hooks/useLandingEngagement.js');
  assert.match(hook, /if \(starter\) stashStarterIntent\(\{ kind: starter, from: page \}\);\s*else clearStarterIntent\(\);/);
  assert.match(read('pages/SeoLandingPage.jsx'), /starter: spec\?\.starter \|\| null,/);
});

test('two tabs signing in together claim the request once between them', async () => {
  const { claimStarterIntent } = await import('../hooks/useStarterIntentResume.js');
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  try {
    // A Web Lock that really serialises: each holder runs to completion before
    // the next starts, the way navigator.locks does across tabs.
    let chain = Promise.resolve();
    const asked = [];
    const locks = { request: (name, fn) => { asked.push(name); const run = chain.then(() => fn()); chain = run.catch(() => {}); return run; } };
    stashStarterIntent({ kind: 'treatment' });
    const [a, b] = await Promise.all([claimStarterIntent({ locks }), claimStarterIntent({ locks })]);
    assert.equal([a, b].filter(Boolean).length, 1, 'exactly one tab gets it');
    // In one process the two never truly race, so what this pins is that the
    // read-and-clear runs INSIDE the shared lock, which is what holds across tabs.
    assert.deepEqual(asked, ['soleil.starter-intent', 'soleil.starter-intent']);
    assert.equal(readStarterIntent(), null);
    // No lock API at all still claims, once.
    stashStarterIntent({ kind: 'treatment' });
    assert.equal((await claimStarterIntent({ locks: null }))?.kind, 'treatment');
    assert.equal(await claimStarterIntent({ locks: null }), null);
  } finally {
    delete globalThis.localStorage;
  }
});

// ── Template until touched ──────────────────────────────────────────────────

const firstPage = (card) => {
  const scope = cardScope(card);
  const pages = scope.pages.toArray();
  return { scope, id: pages[1].id };   // "Concept"
};

test('an untouched starter is pristine; any real change makes it the person\'s', () => {
  const fresh = () => boardWithStarter().cards.get('doc-1');
  assert.equal(isPristineStarter(fresh()), true);

  const typed = fresh();
  const { scope, id } = firstPage(typed);
  scope.content.get(id).get(1).get(0).insert(0, 'A diner at night. ');
  assert.equal(isPristineStarter(typed), false, 'a word typed');

  const renamed = fresh();
  const r = firstPage(renamed);
  const pages = r.scope.pages;
  const entry = pages.get(1);
  renamed.doc.transact(() => { pages.delete(1, 1); pages.insert(1, [{ ...entry, name: 'Idea' }]); });
  assert.equal(isPristineStarter(renamed), false, 'a page renamed');

  const imaged = fresh();
  const im = firstPage(imaged);
  im.scope.content.get(im.id).insert(2, [new Y.XmlElement('image')]);
  assert.equal(isPristineStarter(imaged), false, 'an image dropped in, no words changed');

  const settings = fresh();
  cardScope(settings).meta.set('zoom', 1.25);
  assert.equal(isPristineStarter(settings), true, 'a setting is not authorship');
  assert.equal(isPristineStarter(new Y.Map()), false, 'a card that is not a starter is never "pristine"');
});

test('only content changes to a STARTER that is still a seed are picked up', () => {
  const { ydoc, cards } = boardWithStarter();
  const plain = new Y.Map();
  ydoc.transact(() => { cards.set('doc-2', plain); plain.set('kind', 'doc'); writeStarterDoc(ydoc, plain, 'treatment'); });
  const seen = [];
  cards.observeDeep((events) => seen.push(...starterDocsTouched(events, cards)));
  const { scope, id } = firstPage(cards.get('doc-1'));
  scope.content.get(id).get(1).get(0).insert(0, 'x');
  cardScope(cards.get('doc-1')).meta.set('zoom', 2);                       // settings: ignored
  const p2 = firstPage(plain);
  p2.scope.content.get(p2.id).get(1).get(0).insert(0, 'y');                 // not a starter: ignored
  assert.deepEqual(seen, ['doc-1']);
  cards.get('doc-1').delete('seed');
  scope.content.get(id).get(1).get(0).insert(0, 'z');                      // promoted already: ignored
  assert.deepEqual(seen, ['doc-1']);
});

test('the fingerprint ignores ids, so every untouched treatment matches every other', () => {
  const a = boardWithStarter().cards.get('doc-1');
  const b = boardWithStarter().cards.get('doc-1');
  assert.notEqual(cardScope(a).pages.get(0).id, cardScope(b).pages.get(0).id);
  assert.equal(docFingerprint(a), docFingerprint(b));
});

test('App drops the seed on the first real change, on both panes, outside the person\'s undo', () => {
  const app = read('App.jsx');
  const fx = app.slice(app.indexOf('// A starter document stops being our template'));
  const body = fx.slice(0, fx.indexOf('}, [yb.ydoc, yb.boardId, splitYb.ydoc, splitYb.boardId]);'));
  assert.match(body, /\{ ydoc: yb\.ydoc, boardId: yb\.boardId \},\s*\{ ydoc: splitYb\.ydoc, boardId: splitYb\.boardId \},/);
  assert.match(body, /for \(const id of starterDocsTouched\(events, cards\)\)/);
  assert.match(body, /if \(!ym \|\| ym\.get\('seed'\) !== true \|\| !ym\.get\('starter'\) \|\| isPristineStarter\(ym\)\) return;/);
  assert.match(body, /ydoc\.transact\(\(\) => \{ ym\.delete\('seed'\); \}, 'upload'\);/);
  assert.match(body, /cards\.unobserveDeep\(onDeep\);/);
});

// ── Opening it ──────────────────────────────────────────────────────────────

test('it is centred first, and opened only once its card is in the page', () => {
  const events = [];
  let mounted = false;
  const queue = [];
  const doc = {
    dispatchEvent: (e) => events.push([e.type, e.detail]),
    querySelector: (sel) => (mounted && sel === '[data-card-id="doc-9"]' ? {} : null),
  };
  const schedule = (fn) => queue.push(fn);
  const run = () => { const fn = queue.shift(); fn && fn(); };
  assert.equal(openDocWhenMounted({ boardId: 'b1', cardId: 'doc-9', doc, schedule }), true);
  assert.deepEqual(events, [['soleil-flash-card', { boardId: 'b1', cardId: 'doc-9' }]]);
  run(); run();                                      // not mounted yet: keeps looking
  assert.equal(events.length, 1);
  mounted = true;
  run();                                             // found — one beat for its listener
  assert.equal(events.length, 1);
  run();
  assert.deepEqual(events[1], ['soleil-open-doc-card', { cardId: 'doc-9', pageId: null, scrollTop: 0 }]);
  assert.equal(openDocWhenMounted({ boardId: null, cardId: 'x', doc, schedule }), false);
});
