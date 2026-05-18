// op_classifier.test.mjs
//
// Smoke test for op_classifier.js. Run with:
//   cd boards && node src/lib/op_classifier.test.mjs
//
// This file uses Node ESM and the actual yjs from node_modules. No test
// framework — exit code 0 on pass, non-zero on failure. Until the vitest
// setup lands in Phase 5, this is the regression check.

import * as Y from 'yjs';
import { classifyUpdate, classifyStandalone, hashUpdateBytes } from './op_classifier.js';

let failed = 0;
let passed = 0;
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`);
    failed++;
  } else {
    console.log(`pass: ${msg}`);
    passed++;
  }
}
function assertContains(arr, item, msg) {
  if (!arr.includes(item)) {
    console.error(`FAIL: ${msg}\n  expected array to contain: ${item}\n  actual: ${JSON.stringify(arr)}`);
    failed++;
  } else {
    console.log(`pass: ${msg}`);
    passed++;
  }
}

// Helper: capture the update produced by mutating doc, given doc's prior state.
// Accumulates all emitted updates and merges them so multi-mutation flows
// (not wrapped in transact) still produce a single update for classification.
function captureUpdate(beforeDoc, mutate) {
  const before = Y.encodeStateAsUpdate(beforeDoc);
  const tmp = new Y.Doc();
  Y.applyUpdate(tmp, before);
  const updates = [];
  const onUpdate = (update) => { updates.push(update); };
  tmp.on('update', onUpdate);
  mutate(tmp);
  tmp.off('update', onUpdate);
  tmp.destroy();
  const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
  return { beforeState: before, updateBytes: merged };
}

// ─── Test 1: adding a card ────────────────────────────────────────────────
{
  const doc = new Y.Doc();
  const { beforeState, updateBytes } = captureUpdate(doc, (d) => {
    const cards = d.getMap('cards');
    const card = new Y.Map();
    card.set('kind', 'note');
    card.set('x', 100);
    card.set('y', 200);
    card.set('body', 'hello');
    cards.set('card-1', card);
  });
  const r = classifyUpdate(beforeState, updateBytes);
  assertEq(r.op_kind, 'card.add', 'add card → op_kind=card.add');
  assertEq(r.card_ids, ['card-1'], 'add card → card_ids=[card-1]');
  assertEq(r.r2_keys, [], 'add card → no r2 keys (note card)');
}

// ─── Test 2: deleting a card ──────────────────────────────────────────────
{
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  const c = new Y.Map(); c.set('kind', 'note'); cards.set('card-a', c);
  const { beforeState, updateBytes } = captureUpdate(doc, (d) => {
    d.getMap('cards').delete('card-a');
  });
  const r = classifyUpdate(beforeState, updateBytes);
  assertEq(r.op_kind, 'card.delete', 'delete card → op_kind=card.delete');
  assertEq(r.card_ids, ['card-a'], 'delete card → card_ids=[card-a]');
}

// ─── Test 3: moving a card (position only) ────────────────────────────────
{
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  const c = new Y.Map();
  c.set('kind', 'note'); c.set('x', 10); c.set('y', 20);
  cards.set('card-m', c);
  const { beforeState, updateBytes } = captureUpdate(doc, (d) => {
    const cm = d.getMap('cards').get('card-m');
    cm.set('x', 500);
    cm.set('y', 600);
  });
  const r = classifyUpdate(beforeState, updateBytes);
  assertEq(r.op_kind, 'card.move', 'move card x/y → op_kind=card.move');
  assertEq(r.card_ids, ['card-m'], 'move card → card_ids=[card-m]');
}

// ─── Test 4: image card → r2 key detected ─────────────────────────────────
{
  const doc = new Y.Doc();
  const { beforeState, updateBytes } = captureUpdate(doc, (d) => {
    const cards = d.getMap('cards');
    const card = new Y.Map();
    card.set('kind', 'image');
    card.set('url', 'r2:abc-123-xyz');
    cards.set('img-1', card);
  });
  const r = classifyUpdate(beforeState, updateBytes);
  assertEq(r.op_kind, 'media.attach', 'add image card → op_kind=media.attach');
  assertContains(r.r2_keys, 'abc-123-xyz', 'image card → r2_keys contains key');
  assertEq(r.card_ids, ['img-1'], 'image card → card_ids=[img-1]');
}

// ─── Test 5: bulk add (multiple cards) ────────────────────────────────────
{
  const doc = new Y.Doc();
  const { beforeState, updateBytes } = captureUpdate(doc, (d) => {
    const cards = d.getMap('cards');
    for (let i = 0; i < 5; i++) {
      const c = new Y.Map(); c.set('kind', 'note'); cards.set(`bulk-${i}`, c);
    }
  });
  const r = classifyUpdate(beforeState, updateBytes);
  // 5 adds dominate, single signal → card.add
  assertEq(r.op_kind, 'card.add', 'bulk 5 adds same kind → op_kind=card.add');
  assertEq(r.card_ids.length, 5, 'bulk → 5 card_ids');
}

// ─── Test 6: mixed bulk (add + delete) → op.bulk ──────────────────────────
{
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  // Seed 3 existing
  for (let i = 0; i < 3; i++) {
    const c = new Y.Map(); c.set('kind', 'note'); cards.set(`old-${i}`, c);
  }
  const { beforeState, updateBytes } = captureUpdate(doc, (d) => {
    const cm = d.getMap('cards');
    // Delete 2 existing, add 2 new
    cm.delete('old-0');
    cm.delete('old-1');
    const a = new Y.Map(); a.set('kind', 'note'); cm.set('new-a', a);
    const b = new Y.Map(); b.set('kind', 'note'); cm.set('new-b', b);
  });
  const r = classifyUpdate(beforeState, updateBytes);
  assertEq(r.op_kind, 'op.bulk', 'add + delete in one update → op_kind=op.bulk');
  assertEq(r.card_ids.length, 4, 'mixed → 4 card_ids');
}

// ─── Test 7: text insert/delete inside a doc page ─────────────────────────
{
  const doc = new Y.Doc();
  const docPageContent = doc.getMap('docPageContent');
  const xml = new Y.XmlFragment();
  docPageContent.set('page-1', xml);
  const { beforeState, updateBytes } = captureUpdate(doc, (d) => {
    const dp = d.getMap('docPageContent').get('page-1');
    const para = new Y.XmlElement('paragraph');
    const txt = new Y.XmlText();
    txt.insert(0, 'hello world');
    para.insert(0, [txt]);
    dp.insert(0, [para]);
  });
  const r = classifyUpdate(beforeState, updateBytes);
  // We expect doc.edit or text.insert as the kind
  console.log(`  (doc page edit op_kind = ${r.op_kind}, affected_types = ${JSON.stringify(r.affected_types)})`);
  if (r.op_kind !== 'op.other' && r.op_kind !== 'op.error') {
    passed++;
    console.log('pass: doc page edit classified');
  } else {
    failed++;
    console.error('FAIL: doc page edit returned op.other / op.error');
  }
}

// ─── Test 8: hash determinism ─────────────────────────────────────────────
{
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const h1 = await hashUpdateBytes(bytes);
  const h2 = await hashUpdateBytes(bytes);
  assertEq(h1, h2, 'hash deterministic');
  if (h1.startsWith('sha256:') || h1.startsWith('fnv:')) {
    passed++;
    console.log(`pass: hash prefix valid (${h1.slice(0, 10)}...)`);
  } else {
    failed++;
    console.error(`FAIL: hash has unknown prefix: ${h1.slice(0, 10)}`);
  }
}

// ─── Test 9: standalone classify (no prior state) ─────────────────────────
{
  const doc = new Y.Doc();
  const { updateBytes } = captureUpdate(doc, (d) => {
    const c = new Y.Map(); c.set('kind', 'note'); d.getMap('cards').set('sa-1', c);
  });
  const r = classifyStandalone(updateBytes);
  assertEq(r.op_kind, 'card.add', 'standalone classify → card.add');
  assertEq(r.card_ids, ['sa-1'], 'standalone classify → card_ids');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
