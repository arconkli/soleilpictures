// File versions (lib/cardVersions.js): the operations, and — the part that
// would lose files silently if it broke — that every version's file key can
// still be found by storage's liveness scan (_r2_keys_in_doc, migration
// 0127), run here for real over real Yjs bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import {
  versionsOf, liveVersions, currentOf, addVersionPatch, setCurrentPatch, deleteVersionPatch,
  restoreVersionPatch, labelVersionPatch, pruneDeletedPatch, separateCardFrom, normalizeVersionEntry,
  versionLabel, canVersion, VERSION_LIMIT, R2_FIELDS,
} from './cardVersions.js';

// ── storage's scan, as Postgres runs it ─────────────────────────────────────
const sql = readFileSync(new URL('../../../supabase/migrations/0127_image_refs_recompute_and_sweep_guard.sql', import.meta.url), 'utf8');
const pattern = /regexp_matches\(\s*encode\(decode\(p_doc, 'base64'\), 'escape'\),\s*'([^']+)'/.exec(sql)[1];
const SCAN = new RegExp(pattern, 'g');

// bytea → text with encode(…, 'escape'): zero bytes and bytes ≥ 0x80 become
// \ooo, a backslash doubles, everything else is the byte itself.
function pgEscape(u8) {
  let s = '';
  for (const b of u8) {
    if (b === 0 || b >= 0x80) s += '\\' + b.toString(8).padStart(3, '0');
    else if (b === 0x5c) s += '\\\\';
    else s += String.fromCharCode(b);
  }
  return s;
}
function scan(doc) {
  const text = pgEscape(Y.encodeStateAsUpdate(doc));
  return new Set([...text.matchAll(SCAN)].map((m) => m[1]));
}
function docWith(card) {
  const doc = new Y.Doc();
  const ym = new Y.Map();
  for (const [k, v] of Object.entries(card)) if (k !== 'id') ym.set(k, v);
  doc.getMap('cards').set(card.id, ym);
  return doc;
}
function apply(card, patch) {
  const next = { ...card };
  for (const [k, v] of Object.entries(patch)) next[k] = v;
  return next;
}
const k = (name) => `9b2f6a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b/1728690000000-${name}`;

test('the scan finds every version\'s file keys, for every kind and shape', () => {
  const kinds = {
    image: (i) => ({ src: `r2:${k(`img${i}.webp`)}`, fileName: `still-${i}.jpg`, sizeBytes: 1000 + i, mime: 'image/jpeg', media: { w: 4000, h: 3000 } }),
    video: (i) => ({ src: `r2:${k(`clip${i}.mp4`)}`, ...(i % 2 ? { poster: `r2:${k(`poster${i}.webp`)}` } : {}), fileName: `A00${i}.mov`, media: { fps: [24000, 1001], probed: 1 } }),
    audio: (i) => ({ src: `r2:${k(`take${i}.wav`)}`, cover: i === 2 ? `r2:${k('cover.webp')}` : undefined, fileName: `take${i}.wav`, duration: 3 + i }),
    pdf: (i) => ({ pdfSrc: `r2:${k(`script${i}.pdf`)}`, src: `r2:${k(`cover${i}.webp`)}`, name: `Script v${i}`, pageCount: 100 + i }),
    file: (i) => ({ fileSrc: `r2:${k(`proj${i}.prproj`)}`, fileName: `cut${i}.prproj`, ext: 'prproj' }),
  };
  for (const [kind, make] of Object.entries(kinds)) {
    let card = { id: `c-${kind}`, kind, x: 0, y: 0, w: 320, h: 180, createdAt: '2026-10-01T00:00:00Z', createdBy: 'u1', ...make(1) };
    for (let i = 2; i <= 5; i++) {
      const r = addVersionPatch(card, make(i), { by: 'u2', at: `2026-10-0${i}T00:00:00Z`, label: i === 3 ? 'Director’s cut' : null });
      assert.ok(r, `${kind} v${i}`);
      card = apply(card, r.patch);
    }
    // Delete one, switch to an older one, label another.
    card = apply(card, deleteVersionPatch(card, versionsOf(card)[1].id));
    card = apply(card, setCurrentPatch(card, versionsOf(card)[0].id));
    card = apply(card, labelVersionPatch(card, versionsOf(card)[3].id, 'Final'));
    const expected = new Set();
    for (const v of versionsOf(card)) for (const f of R2_FIELDS[kind]) if (v[f]) expected.add(v[f].slice(3));
    for (const f of R2_FIELDS[kind]) if (card[f]) expected.add(card[f].slice(3));
    const found = scan(docWith(card));
    assert.deepEqual([...found].sort(), [...expected].sort(), `${kind}: every key found, none mangled`);
  }
});

test('the hazard the entry shape avoids is real: the scan mangles a key that ends an object', () => {
  // If this ever stops failing the shape rule could be relaxed — until then it
  // proves the test above would catch a regression.
  const bad = [{ id: 'a', src: `r2:${k('one.webp')}` }, { id: 'b', src: `r2:${k('two.webp')}` }];
  const doc = docWith({ id: 'x', kind: 'image', versions: bad });
  const found = scan(doc);
  assert.ok(!found.has(k('one.webp')), 'a key followed by the next entry\'s type tag reads wrong');
  const bare = docWith({ id: 'y', kind: 'image', versions: [`r2:${k('one.webp')}`, `r2:${k('two.webp')}`] });
  assert.ok(!scan(bare).has(k('one.webp')));
});

test('a card without versions has one, v1, from itself', () => {
  const card = { id: 'c', kind: 'video', src: 'r2:K1', poster: 'r2:P1', fileName: 'a.mov', createdAt: 'T0', createdBy: 'u1' };
  const list = versionsOf(card);
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).slice(0, 3), ['src', 'poster', 'id']);
  assert.equal(list[0].id, 'v1');
  assert.equal(list[0].by, 'u1');
  assert.equal(currentOf(card).id, 'v1');
  assert.equal(versionLabel(currentOf(card)), 'v1');
  assert.deepEqual(versionsOf({ id: 'n', kind: 'note' }), []);
  assert.equal(canVersion({ kind: 'image', src: 'r2:x' }), true);
  assert.equal(canVersion({ kind: 'image', src: 'r2:x', pending: true }), false);
  assert.equal(canVersion({ kind: 'note' }), false);
});

test('adding a version shows it, keeps the old, and clears what the old one had', () => {
  let card = { id: 'c', kind: 'video', src: 'r2:K1', poster: 'r2:P1', fileName: 'v1.mov', w: 320, h: 180 };
  const r = addVersionPatch(card, { src: 'r2:K2', fileName: 'v2.mov', media: { w: 1080, h: 1920 } }, { by: 'u2', at: 'T2' });
  card = apply(card, r.patch);
  assert.equal(card.src, 'r2:K2');
  assert.equal(card.poster, null);              // v1's poster doesn't linger on v2
  assert.equal(card.fileName, 'v2.mov');
  assert.equal(card.verId, r.entry.id);
  assert.equal(card.h, 569);                    // portrait: refit to the width
  assert.equal(liveVersions(card).length, 2);
  assert.equal(currentOf(card).n, 2);
  // Back to v1.
  card = apply(card, setCurrentPatch(card, 'v1'));
  assert.equal(card.src, 'r2:K1');
  assert.equal(card.poster, 'r2:P1');
  assert.equal(card.verId, 'v1');
  // An audio switch drops the old waveform so it's recomputed.
  const a = apply({ id: 'a', kind: 'audio', src: 'r2:A1', peaks: 'xyz', analyzed: 1 }, addVersionPatch({ id: 'a', kind: 'audio', src: 'r2:A1', peaks: 'xyz', analyzed: 1 }, { src: 'r2:A2' }).patch);
  assert.equal(a.peaks, null);
  assert.equal(a.analyzed, null);
});

test('delete keeps the version for a while; the last one can\'t go; restore and prune', () => {
  let card = { id: 'c', kind: 'image', src: 'r2:I1' };
  card = apply(card, addVersionPatch(card, { src: 'r2:I2' }).patch);
  const v2 = currentOf(card).id;
  // Deleting the one on show falls back to the newest left.
  card = apply(card, deleteVersionPatch(card, v2, '2026-10-01T00:00:00Z'));
  assert.equal(card.src, 'r2:I1');
  assert.equal(liveVersions(card).length, 1);
  assert.equal(versionsOf(card).length, 2);     // still there, marked
  assert.equal(deleteVersionPatch(card, 'v1'), null);
  card = apply(card, restoreVersionPatch(card, v2));
  assert.equal(liveVersions(card).length, 2);
  card = apply(card, deleteVersionPatch(card, v2, '2026-10-01T00:00:00Z'));
  assert.equal(pruneDeletedPatch(card, Date.parse('2026-10-20T00:00:00Z')), null);   // within 30 days
  card = apply(card, pruneDeletedPatch(card, Date.parse('2026-11-05T00:00:00Z')));
  assert.equal(versionsOf(card).length, 1);
});

test('an unknown top-level file (an older app replaced it) shows as the newest version', () => {
  let card = { id: 'c', kind: 'image', src: 'r2:I1' };
  card = apply(card, addVersionPatch(card, { src: 'r2:I2' }).patch);
  card = { ...card, src: 'r2:I9' };            // written without touching versions
  const list = versionsOf(card);
  assert.equal(list.length, 3);
  assert.equal(list[2].untracked, true);
  assert.equal(currentOf(card).src, 'r2:I9');
  // The next version operation persists it as a real one.
  card = apply(card, addVersionPatch(card, { src: 'r2:I10' }).patch);
  assert.equal(versionsOf(card).length, 4);
  assert.ok(versionsOf(card).every((v) => !v.untracked));
  assert.deepEqual(versionsOf(card).map((v) => v.n), [1, 2, 3, 4]);
});

test('limits, labels, and keeping a dropped file as its own card', () => {
  let card = { id: 'c', kind: 'file', fileSrc: 'r2:F0' };
  for (let i = 1; i < VERSION_LIMIT; i++) card = apply(card, addVersionPatch(card, { fileSrc: `r2:F${i}` }).patch);
  assert.equal(liveVersions(card).length, VERSION_LIMIT);
  assert.equal(addVersionPatch(card, { fileSrc: 'r2:Fx' }), null);
  assert.equal(addVersionPatch(card, { fileName: 'no file' }), null);
  card = apply(card, labelVersionPatch(card, 'v1', '  Picture lock  '));
  assert.equal(versionsOf(card)[0].label, 'Picture lock');
  const e = normalizeVersionEntry('video', { src: 'r2:S', fileName: 'n.mov', id: 'vz', n: 3 });
  const sep = separateCardFrom({ id: 'c', kind: 'video', x: 10, y: 20, w: 300, h: 200 }, e, 'new');
  assert.deepEqual(sep, { id: 'new', kind: 'video', src: 'r2:S', fileName: 'n.mov', x: 334, y: 20, w: 300, h: 200 });
});
