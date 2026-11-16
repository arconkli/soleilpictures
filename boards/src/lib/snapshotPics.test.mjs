// A board's picture info rides in its IndexedDB snapshot record, so a repeat
// open seeds imageMeta before the cached snapshot paints (yboard.js) instead of
// waiting for the network prime — cards would otherwise pick the multi-MB
// original. This pins the pure pieces: the record merge (snapshotCache.js) and
// export / seed / row-merge (imageMeta.js). IndexedDB itself isn't exercised.
//
// imageMeta.js imports the Supabase client and perf (both need the browser's
// import.meta.env), so a module hook swaps them for stubs before it loads, the
// way yboard.test.mjs does for its collaborators.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mergeSnapshotRecord } from './snapshotCache.js';
import { variantsSettled } from './imageVariantPick.js';

const hooks = `
const STUBS = {
  '/src/lib/supabase.js': 'export const supabase = { from: (t) => globalThis.__sb.from(t) };',
  '/src/lib/perf.js': 'export const isEnabled = () => false; export const mark = () => {}; export const gauge = () => {};',
};
export async function load(url, context, next) {
  const path = url.split('?')[0];
  for (const suffix of Object.keys(STUBS)) {
    if (path.endsWith(suffix)) return { format: 'module', shortCircuit: true, source: STUBS[suffix] };
  }
  return next(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks), import.meta.url);

// A chainable stand-in for supabase.from('images'): eq() marks the board-id half,
// contains() the referenced-onto half, and awaiting it answers from `fake`.
const fake = { filters: [], rows: { own: [], ref: [] }, error: { own: null, ref: null } };
globalThis.__sb = {
  from: () => {
    let half = null;
    const q = {
      select: () => q,
      eq: () => { half = 'own'; return q; },
      contains: () => { half = 'ref'; return q; },
      or: (f) => { fake.filters.push(f); return q; },
      then: (ok, bad) => Promise.resolve({ data: fake.error[half] ? null : fake.rows[half], error: fake.error[half] }).then(ok, bad),
    };
    return q;
  },
};

const im = await import('./imageMeta.js');
const { PIC_FIELDS, exportImageMeta, seedImageMeta, mergeMetaRow, picFieldsDiffer, setMetaLocal, getMeta, subscribeMeta, primeImageMetaForBoard, whenBoardMetaPrimed } = im;

// ── mergeSnapshotRecord ─────────────────────────────────────────────────────
const PICS = { 'ws/a.jpg': { blur: 'x', previewKey: 'ws/previews/a.webp', w: 4000, h: 3000 } };

test('a snapshot write keeps the picture info already on the record for the same user', () => {
  const prev = { boardId: 'b', uid: 'u1', b64: 'old', cachedAt: 1, pics: PICS, picsAt: 5 };
  const next = { boardId: 'b', uid: 'u1', b64: 'new', updatedAt: null, cachedAt: 2 };
  assert.deepEqual(mergeSnapshotRecord(prev, next), { ...next, pics: PICS, picsAt: 5 });
});

test('null user matches null user, and the picture info is kept', () => {
  const prev = { boardId: 'b', uid: null, b64: null, pics: PICS, picsAt: 5 };
  const next = { boardId: 'b', uid: null, b64: 'new', cachedAt: 2 };
  assert.equal(mergeSnapshotRecord(prev, next).pics, PICS);
});

test('another user never inherits the picture info', () => {
  const next = { boardId: 'b', uid: 'u2', b64: 'new', cachedAt: 2 };
  assert.equal(mergeSnapshotRecord({ boardId: 'b', uid: 'u1', pics: PICS, picsAt: 5 }, next), next);
  assert.equal(mergeSnapshotRecord({ boardId: 'b', uid: null, pics: PICS, picsAt: 5 }, next), next);
  assert.equal(mergeSnapshotRecord({ boardId: 'b', uid: 'u1', pics: PICS, picsAt: 5 }, { ...next, uid: null }).pics, undefined);
});

test('a write with its own pictures, or no record before it, is written as is', () => {
  const own = { boardId: 'b', uid: 'u1', b64: 'new', pics: { 'k': {} }, picsAt: 9 };
  assert.equal(mergeSnapshotRecord({ boardId: 'b', uid: 'u1', pics: PICS, picsAt: 5 }, own), own);
  const next = { boardId: 'b', uid: 'u1', b64: 'new' };
  assert.equal(mergeSnapshotRecord(undefined, next), next);
  assert.equal(mergeSnapshotRecord({ boardId: 'b', uid: 'u1', b64: 'old' }, next), next);
});

// ── exportImageMeta ─────────────────────────────────────────────────────────
// The cache is module state with no reset, so every test uses its own keys.
const ROW = (over = {}) => ({
  blur: 'blurhash', previewKey: 'ws/previews/p.webp', previewW: 1280, previewH: 853,
  previewSmKey: null, previewSmW: null, previewSmH: null, previewXsKey: null, previewXsW: null, previewXsH: null,
  w: 4032, h: 2688, sizeBytes: 9_000_000, checked: true, ...over,
});

test('export keeps only the picture fields, leaves nulls out, and skips what is not worth storing', () => {
  setMetaLocal('exp/full.jpg', ROW());
  setMetaLocal('exp/xs-only.jpg', ROW({ blur: null, previewKey: null, previewW: null, previewH: null, previewXsKey: 'ws/previews/x.webp', previewXsW: 256, previewXsH: 171, checked: false }));
  setMetaLocal('exp/blur-only.jpg', ROW({ previewKey: null, previewW: null, previewH: null }));
  // the placeholder primeImageMeta writes for a key with no row
  setMetaLocal('exp/placeholder.jpg', { ...Object.fromEntries(PIC_FIELDS.map((f) => [f, null])), checked: false });
  // a row with sizes but nothing to draw from
  setMetaLocal('exp/no-preview.jpg', ROW({ blur: null, previewKey: null, previewW: null, previewH: null }));
  seedImageMeta({ 'exp/seeded.jpg': { blur: 'b', previewKey: 'ws/previews/s.webp' } });

  const out = exportImageMeta(['exp/full.jpg', 'exp/xs-only.jpg', 'exp/blur-only.jpg', 'exp/placeholder.jpg', 'exp/no-preview.jpg', 'exp/seeded.jpg', 'exp/unknown.jpg', '', null, 7]);
  assert.deepEqual(Object.keys(out).sort(), ['exp/blur-only.jpg', 'exp/full.jpg', 'exp/xs-only.jpg']);
  assert.deepEqual(out['exp/full.jpg'], { blur: 'blurhash', previewKey: 'ws/previews/p.webp', previewW: 1280, previewH: 853, w: 4032, h: 2688, checked: true });
  // not confirmed by the server: no `checked` at all
  assert.deepEqual(out['exp/xs-only.jpg'], { previewXsKey: 'ws/previews/x.webp', previewXsW: 256, previewXsH: 171, w: 4032, h: 2688 });
  for (const e of Object.values(out)) {
    for (const k of Object.keys(e)) assert.ok(k === 'checked' || PIC_FIELDS.includes(k), `${k} is a picture field`);
    assert.ok(!Object.values(e).some((v) => v == null));
  }
});

test('export carries checked only as boolean true, so a blur-only GIF stays settled on a repeat open', () => {
  setMetaLocal('chk/gif.gif', ROW({ previewKey: null, previewW: null, previewH: null, w: 480, h: 270, checked: true }));
  setMetaLocal('chk/unchecked.jpg', ROW({ checked: false }));
  setMetaLocal('chk/truthy.jpg', ROW({ checked: 1 }));
  const out = exportImageMeta(['chk/gif.gif', 'chk/unchecked.jpg', 'chk/truthy.jpg']);
  assert.equal(out['chk/gif.gif'].checked, true);
  assert.equal('checked' in out['chk/unchecked.jpg'], false);
  assert.equal('checked' in out['chk/truthy.jpg'], false);
});

test('export stops at max entries and tolerates a bad key list', () => {
  const keys = [];
  for (let i = 0; i < 5; i++) { keys.push(`cap/${i}.jpg`); setMetaLocal(`cap/${i}.jpg`, ROW()); }
  assert.equal(Object.keys(exportImageMeta(keys, 3)).length, 3);
  assert.deepEqual(Object.keys(exportImageMeta(keys, 3)), keys.slice(0, 3));
  assert.equal(Object.keys(exportImageMeta(keys)).length, 5);
  assert.deepEqual(exportImageMeta(null), {});
  assert.deepEqual(exportImageMeta('cap/0.jpg'), {});
});

// ── seedImageMeta ───────────────────────────────────────────────────────────
test('seeding fills an empty slot, marks it seeded, and tells the card', () => {
  let woke = 0;
  const off = subscribeMeta('seed/a.jpg', () => { woke += 1; });
  seedImageMeta({ 'seed/a.jpg': { blur: 'bh', previewKey: 'ws/previews/a.webp', previewW: 1280, previewH: 720, w: 3000, h: 1688, junk: 'x' } });
  off();
  const m = getMeta('seed/a.jpg');
  assert.equal(m.seeded, true);
  assert.equal(m.blur, 'bh');
  assert.equal(m.previewKey, 'ws/previews/a.webp');
  assert.equal(m.previewW, 1280);
  assert.equal(m.previewSmKey, null);
  assert.equal(m.previewXsW, null);
  assert.equal('junk' in m, false);
  // nothing claims the server confirmed it: no `checked` at all
  assert.equal('checked' in m, false);
  assert.equal(woke, 1);
});

test('seeding keeps checked only when the record says boolean true', () => {
  seedImageMeta({
    'seed/chk-true.gif': { blur: 'bh', w: 480, h: 270, checked: true },
    'seed/chk-false.gif': { blur: 'bh', checked: false },
    'seed/chk-string.gif': { blur: 'bh', checked: 'true' },
    'seed/chk-one.gif': { blur: 'bh', checked: 1 },
  });
  assert.equal(getMeta('seed/chk-true.gif').checked, true);
  assert.equal(getMeta('seed/chk-true.gif').seeded, true);
  for (const k of ['false', 'string', 'one']) assert.equal('checked' in getMeta(`seed/chk-${k}.gif`), false, k);
  // a record with `checked` alone has nothing to draw from and seeds nothing
  seedImageMeta({ 'seed/chk-only.gif': { checked: true } });
  assert.equal(getMeta('seed/chk-only.gif'), null);
});

test('a seeded blur-only GIF reads settled once its record says checked, so no backfill runs', () => {
  seedImageMeta({ 'seed/settle-checked.gif': { blur: 'bh', checked: true }, 'seed/settle-open.gif': { blur: 'bh' } });
  assert.equal(variantsSettled(getMeta('seed/settle-checked.gif')), true);
  assert.equal(variantsSettled(getMeta('seed/settle-open.gif')), false);
});

test('seeding never overwrites an entry that is already cached', () => {
  setMetaLocal('seed/keep.jpg', ROW({ previewKey: 'ws/previews/fresh.webp' }));
  seedImageMeta({ 'seed/keep.jpg': { blur: 'old', previewKey: 'ws/previews/stale.webp' } });
  assert.equal(getMeta('seed/keep.jpg').previewKey, 'ws/previews/fresh.webp');
  assert.equal(getMeta('seed/keep.jpg').seeded, undefined);
  seedImageMeta({ 'seed/twice.jpg': { blur: 'one' } });
  seedImageMeta({ 'seed/twice.jpg': { blur: 'two' } });
  assert.equal(getMeta('seed/twice.jpg').blur, 'one');
});

test('seeding drops what is not the right type and ignores malformed input', () => {
  seedImageMeta({ 'seed/types.jpg': { blur: 'ok', previewKey: 42, previewW: '1280', previewH: NaN, w: Infinity, h: 600, previewSmKey: '' } });
  const m = getMeta('seed/types.jpg');
  assert.equal(m.blur, 'ok');
  assert.equal(m.previewKey, null);
  assert.equal(m.previewW, null);
  assert.equal(m.previewH, null);
  assert.equal(m.w, null);
  assert.equal(m.h, 600);
  assert.equal(m.previewSmKey, null);

  for (const bad of [null, undefined, 'str', 7, [], [{ blur: 'x' }], { '': { blur: 'x' } }, { 'seed/bad1.jpg': null }, { 'seed/bad2.jpg': 'x' }, { 'seed/bad3.jpg': {} }]) {
    assert.doesNotThrow(() => seedImageMeta(bad));
  }
  assert.equal(getMeta('seed/bad1.jpg'), null);
  assert.equal(getMeta('seed/bad2.jpg'), null);
  assert.equal(getMeta('seed/bad3.jpg'), null);
  assert.equal(getMeta('0'), null);
});

// ── mergeMetaRow ────────────────────────────────────────────────────────────
test('a row replaces a seeded entry outright, dropping seeded', () => {
  const seeded = { ...Object.fromEntries(PIC_FIELDS.map((f) => [f, null])), blur: 'old', previewKey: 'ws/previews/old.webp', seeded: true };
  const row = ROW({ blur: 'new', previewKey: 'ws/previews/new.webp' });
  const out = mergeMetaRow(seeded, row);
  assert.deepEqual(out, row);
  assert.equal(out.seeded, undefined);
});

test('a row only fills what a normal entry lacks, and with no entry it is the row', () => {
  const prev = ROW({ previewKey: 'ws/previews/local.webp', sizeBytes: null, previewSmKey: null });
  const row = ROW({ previewKey: 'ws/previews/server.webp', sizeBytes: 123, previewSmKey: 'ws/previews/sm.webp', previewSmW: 640, previewSmH: 427 });
  const out = mergeMetaRow(prev, row);
  assert.equal(out.previewKey, 'ws/previews/local.webp');
  assert.equal(out.sizeBytes, 123);
  assert.equal(out.previewSmKey, 'ws/previews/sm.webp');
  assert.equal(mergeMetaRow(undefined, row), row);
});

test('only a changed picture field counts as news when a seeded entry is replaced', () => {
  const seeded = { ...Object.fromEntries(PIC_FIELDS.map((f) => [f, null])), blur: 'b', previewKey: 'k', w: 10, h: 20, seeded: true };
  const same = mergeMetaRow(seeded, { ...seeded, seeded: undefined, sizeBytes: 5, checked: true });
  assert.equal(picFieldsDiffer(seeded, same), false);
  assert.equal(picFieldsDiffer(seeded, mergeMetaRow(seeded, { ...seeded, previewXsKey: 'xs' })), true);
});

// ── the board prime hands back what it received ─────────────────────────────
test('the board prime resolves [] and keeps no promise for a bad id', async () => {
  assert.deepEqual(await primeImageMetaForBoard('not-a-board-id'), []);
  assert.deepEqual(await primeImageMetaForBoard(null), []);
  assert.equal(whenBoardMetaPrimed('not-a-board-id'), null);
  assert.equal(whenBoardMetaPrimed('00000000-0000-0000-0000-000000000000'), null);
});

const row = (path, over = {}) => ({
  storage_path: path, blur_hash: 'bh', preview_path: 'ws/previews/a.webp', preview_w: 1280, preview_h: 720,
  preview_sm_path: null, preview_sm_w: null, preview_sm_h: null, preview_xs_path: null, preview_xs_w: null, preview_xs_h: null,
  width: 3000, height: 1688, size_bytes: 5, variants_checked_at: '2026-11-01', ...over,
});

test('the board prime skips derived preview rows, replaces seeded entries, and answers with the keys it got', async () => {
  const BOARD = '11111111-1111-1111-1111-111111111111';
  fake.filters = [];
  fake.error = { own: null, ref: null };
  fake.rows = {
    own: [row('prime/a.jpg'), row('prime/c.jpg', { blur_hash: 'cc' })],
    ref: [row('prime/c.jpg', { blur_hash: 'cc' }), row('prime/b.jpg', { preview_path: 'ws/previews/b-new.webp' })],
  };
  // last visit's copies: a is unchanged on the server, b's preview moved
  seedImageMeta({
    'prime/a.jpg': { blur: 'bh', previewKey: 'ws/previews/a.webp', previewW: 1280, previewH: 720, w: 3000, h: 1688 },
    'prime/b.jpg': { blur: 'bh', previewKey: 'ws/previews/b-old.webp' },
  });
  const woke = { a: 0, b: 0, c: 0 };
  const offs = ['a', 'b', 'c'].map((k) => subscribeMeta(`prime/${k}.jpg`, () => { woke[k] += 1; }));
  const wokeAtStart = { ...woke };   // (seeding already woke a and b)

  const p = primeImageMetaForBoard(BOARD);
  assert.equal(whenBoardMetaPrimed(BOARD), p);
  assert.equal(primeImageMetaForBoard(BOARD), p, 'once per board per session: the same promise');
  assert.deepEqual((await p).sort(), ['prime/a.jpg', 'prime/b.jpg', 'prime/c.jpg']);
  offs.forEach((off) => off());

  assert.equal(fake.filters.length, 2, 'both queries carry the filter');
  for (const f of fake.filters) assert.equal(f, 'storage_path.not.like.*/previews/*,storage_path.like.*/previews/link/*');

  assert.equal(getMeta('prime/a.jpg').seeded, undefined);
  assert.equal(getMeta('prime/a.jpg').sizeBytes, 5);
  assert.equal(getMeta('prime/a.jpg').checked, true);
  assert.equal(getMeta('prime/b.jpg').previewKey, 'ws/previews/b-new.webp');
  assert.equal(woke.a - wokeAtStart.a, 0, 'an unchanged picture is not news');
  assert.equal(woke.b - wokeAtStart.b, 1, 'a moved preview is');
  assert.equal(woke.c, 1, 'a new entry is, once, though both halves returned it');
  // what the snapshot record would now store
  assert.deepEqual(Object.keys(exportImageMeta(await p)).sort(), ['prime/a.jpg', 'prime/b.jpg', 'prime/c.jpg']);
});

test('a failed board prime resolves [], keeps no promise, and can be tried again', async () => {
  const BOARD = '22222222-2222-2222-2222-222222222222';
  fake.error = { own: { code: 'x', message: 'down' }, ref: { code: 'x', message: 'down' } };
  assert.deepEqual(await primeImageMetaForBoard(BOARD), []);
  assert.equal(whenBoardMetaPrimed(BOARD), null);
  fake.error = { own: null, ref: null };
  fake.rows = { own: [row('retry/a.jpg')], ref: [] };
  assert.deepEqual(await primeImageMetaForBoard(BOARD), ['retry/a.jpg']);
  assert.ok(whenBoardMetaPrimed(BOARD));
});

test('one half failing still fills the cache but answers [], so a partial set is never stored', async () => {
  const BOARD = '33333333-3333-3333-3333-333333333333';
  fake.error = { own: null, ref: { code: 'x', message: 'down' } };
  fake.rows = { own: [row('half/a.jpg')], ref: [] };
  assert.deepEqual(await primeImageMetaForBoard(BOARD), []);
  assert.equal(getMeta('half/a.jpg').previewKey, 'ws/previews/a.webp');
});
