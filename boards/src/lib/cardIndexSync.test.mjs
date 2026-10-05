// cardIndexSync — the card_index sync, run for real against an in-memory
// card_index that refuses writes the way the cap trigger does.
//
// The sync is where a cap refusal turns into "keep" or "take back", and every
// bug found in it so far was a sequence: a read that failed once, a heavy card
// ahead of light ones, a raise refused in the middle of a batch. Regexes over
// the source could not see any of them, so this runs the actual code.
//
// boardsApi.js imports the Supabase client, which needs the Vite env, so the
// sync's region of the file is lifted out between two markers and loaded with
// a mock in its place. If the markers move this fails loudly, not vacuously.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as Y from 'yjs';

const here = dirname(fileURLToPath(import.meta.url));

// ── An in-memory card_index with the cap trigger's rules (0346) ──────────────
//   INSERT refused when count + weight > cap (a zero-weight row never is);
//   UPDATE OF weight refused when count + max(new - old, 0) > cap;
//   a batch upsert is atomic.
function makeIndex({ cap = 50, elsewhere = 0 } = {}) {
  const rows = new Map();
  const failNext = [];                        // predicates (op) → error | null
  const count = () => elsewhere + [...rows.values()].reduce((n, r) => n + Number(r.weight ?? 1), 0);
  const refusal = { code: '42501', message: `Demo accounts are limited to ${cap} cards. Invite friends or upgrade to add more.` };
  const injected = (op) => {
    for (let i = 0; i < failNext.length; i++) {
      const err = failNext[i](op);
      if (err) { failNext.splice(i, 1); return err; }
    }
    return null;
  };
  function upsert(list) {
    const err = injected({ kind: 'upsert', rows: list });
    if (err) return { error: err };
    const staged = new Map(rows);
    let c = count();
    for (const r of list) {
      const old = staged.get(r.card_id);
      const w = Number(r.weight ?? 1);
      const delta = old ? Math.max(w - Number(old.weight ?? 1), 0) : Math.max(w, 0);
      if (delta > 0 && c + delta > cap) return { error: refusal };
      staged.set(r.card_id, { ...r });
      c += old ? w - Number(old.weight ?? 1) : w;
    }
    rows.clear();
    for (const [k, v] of staged) rows.set(k, v);
    return { error: null };
  }
  function from(table) {
    const st = { op: null, payload: null, ids: null };
    const run = () => {
      if (table === 'boards') return { data: { workspace_id: 'ws' }, error: null };
      if (table === 'images') return { data: [], error: null };
      if (st.op === 'select') {
        const err = injected({ kind: 'select' });
        if (err) return { data: null, error: err };
        return { data: [...rows.values()].map((r) => ({ card_id: r.card_id, weight: r.weight })), error: null };
      }
      if (st.op === 'delete') {
        const err = injected({ kind: 'delete' });
        if (err) return { error: err };
        for (const id of st.ids || []) rows.delete(id);
        return { error: null };
      }
      if (st.op === 'upsert') return upsert(st.payload);
      return { data: null, error: null };
    };
    const b = {
      select() { if (!st.op) st.op = 'select'; return b; },
      delete() { st.op = 'delete'; return b; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return b; },
      eq() { return b; },
      is() { return b; },
      in(_c, v) { st.ids = v; return b; },
      maybeSingle() { return Promise.resolve(run()); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  }
  const api = {
    from,
    rpc: async (name) => {
      if (name !== 'get_board_capacity') return { data: null, error: null };
      const err = injected({ kind: 'rpc' });
      if (err) return { data: null, error: err };
      return { data: [{ is_capped: true, cap, used: count() }], error: null };
    },
    auth: { onAuthStateChange() {} },
  };
  return { api, rows, count, failNext, refusal };
}

// ── The sync, lifted out of boardsApi.js ─────────────────────────────────────
const src = readFileSync(join(here, 'boardsApi.js'), 'utf8');
const startAt = src.indexOf('const SYNC_THROTTLE_MS');
const endAt = src.indexOf('// Per-kind preview data baked');
assert.ok(startAt > 0 && endAt > startAt, 'the sync region of boardsApi.js was not found — update the markers above');
const lib = (f) => pathToFileURL(join(here, f)).href;
const dir = mkdtempSync(join(tmpdir(), 'card-index-sync-'));
const modPath = join(dir, 'sync.mjs');
writeFileSync(modPath, `
import { buildCardIndexRow } from '${lib('cardIndexRow.js')}';
import { createPlacementLedger } from '${lib('capRefusal.js')}';
import { isAbandonedUpload } from '${lib('abandonedUploads.js')}';
import { fitByCost } from '${lib('demoCardCap.js')}';
const perf = { isEnabled: () => false, mark() {}, bump() {}, gauge() {} };
const supabase = globalThis.__cardIndexMock;
const _groupSyncState = new Map();
const _groupSigCache = new Map();
${src.slice(startAt, endAt)}
export { _doSyncCardIndex };
`);

const events = [];
globalThis.window = { dispatchEvent: (e) => { events.push({ type: e.type, detail: e.detail }); return true; } };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const quiet = console.warn;

let loads = 0;
async function setup(opts) {
  const index = makeIndex(opts);
  globalThis.__cardIndexMock = index.api;
  const sync = await import(`${pathToFileURL(modPath).href}?n=${loads++}`);
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  events.length = 0;
  console.warn = () => {};
  const run = async () => { await sync._doSyncCardIndex('A', doc); };
  return { index, sync, doc, cards, run };
}
function note(cards, id, extra = {}) {
  const ym = new Y.Map();
  cards.set(id, ym);
  for (const [k, v] of Object.entries({ id, kind: 'note', title: id, x: 0, y: 0, w: 100, h: 100, ...extra })) ym.set(k, v);
  return ym;
}
function grid(cards, id, cells) {
  const ym = note(cards, id, { kind: 'grid' });
  const cm = new Y.Map();
  ym.set('gridCells', cm);
  for (const [k, v] of Object.entries(cells)) cm.set(k, v);
  return ym;
}
const filled = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { type: 'image', src: `r2:x${i}` }]));
const indexed = (index) => [...index.rows.values()].map((r) => `${r.card_id}:${r.weight}`).sort();
const capped = () => events.filter((e) => e.type === 'soleil:card-index-capped').map((e) => e.detail);

test.after(() => { console.warn = quiet; });

test('it indexes the board and releases the row of a card that is deleted', async () => {
  const { index, cards, run } = await setup();
  note(cards, 'a'); note(cards, 'b'); note(cards, 'c');
  await run();
  assert.deepEqual(indexed(index), ['a:1', 'b:1', 'c:1']);
  cards.delete('c');
  await run();
  assert.deepEqual(indexed(index), ['a:1', 'b:1']);
});

test('a cleanup read that fails once is retried by the next sync, not forgotten', async () => {
  const { index, cards, run } = await setup({ elsewhere: 47 });
  note(cards, 'a'); note(cards, 'b'); note(cards, 'c');
  await run();
  cards.delete('c');
  index.failNext.push((op) => (op.kind === 'select' ? { code: '', message: 'Failed to fetch' } : null));
  await run();
  assert.deepEqual(indexed(index), ['a:1', 'b:1', 'c:1'], 'the failed round leaves the row');
  cards.get('a').set('title', 'renamed');           // an ordinary edit — no card added or removed
  await run();
  assert.deepEqual(indexed(index), ['a:1', 'b:1'], 'the next sync still releases it');
  assert.equal(index.count(), 49);
});

test('at the limit, a raised weight is held and every other change still lands', async () => {
  const { index, cards, run } = await setup({ elsewhere: 48 });
  note(cards, 'a');
  grid(cards, 'g', { c1: { type: 'text', html: '' } });   // empty: weighs 0
  note(cards, 'b');
  await run();
  assert.equal(index.count(), 50);
  cards.get('g').get('gridCells').set('c1', { type: 'text', html: '<p>words</p>' });   // 0 → 1, refused
  cards.get('a').set('title', 'a renamed');
  await run();
  assert.equal(index.rows.get('a').title, 'a renamed', 'the rename is not frozen out by the raise');
  assert.equal(index.rows.get('g').weight, 0, 'the raise waits for room');
  assert.deepEqual(capped(), [], 'an edit is never withdrawn and opens no wall');
  index.rows.delete('b');                               // room appears elsewhere
  await run();
  assert.equal(index.rows.get('g').weight, 1, 'the held raise lands once there is room');
});

test('a card that weighs nothing lands at zero room, and a failed write of it is never a refusal', async () => {
  const { index, sync, cards, run } = await setup({ elsewhere: 50 });
  await run();
  grid(cards, 'g1', {});
  note(cards, 'n1');
  sync.notePlacedThroughCap(['g1', 'n1']);
  await run();
  assert.deepEqual(indexed(index), ['g1:0']);
  assert.deepEqual(capped().map((d) => d.cardIds), [['n1']], 'only the card that costs room is refused');

  const again = await setup({ elsewhere: 50 });
  await again.run();
  grid(again.cards, 'g1', {});
  note(again.cards, 'n1');
  again.sync.notePlacedThroughCap(['g1', 'n1']);
  again.index.failNext.push((op) => (op.kind === 'upsert' && op.rows.every((r) => Number(r.weight) === 0) ? { code: '', message: 'Failed to fetch' } : null));
  await again.run();
  assert.deepEqual(capped().map((d) => d.cardIds), [['n1']], 'the free grid is not taken back after a dropped connection');
  await again.run();
  assert.deepEqual(indexed(again.index), ['g1:0'], 'and lands on the next sync');
});

test('room is counted in weight: a heavy card that does not fit never takes light ones with it', async () => {
  const { index, sync, cards, run } = await setup({ elsewhere: 48 });
  await run();
  grid(cards, 'g5', filled(5));
  note(cards, 'n1'); note(cards, 'n2');
  sync.notePlacedThroughCap(['g5', 'n1', 'n2']);
  await run();
  assert.deepEqual(indexed(index), ['n1:1', 'n2:1']);
  assert.deepEqual(capped().map((d) => d.cardIds), [['g5']]);
});

test('without the capacity read, the probe still tries lighter cards after a heavy one is refused', async () => {
  const { index, sync, cards, run } = await setup({ elsewhere: 48 });
  await run();
  grid(cards, 'g5', filled(5));
  note(cards, 'n1'); note(cards, 'n2'); note(cards, 'n3');
  sync.notePlacedThroughCap(['g5', 'n1', 'n2', 'n3']);
  index.failNext.push((op) => (op.kind === 'rpc' ? { code: 'PGRST', message: 'unavailable' } : null));
  await run();
  assert.deepEqual(indexed(index), ['n1:1', 'n2:1']);
  assert.deepEqual(capped().map((d) => d.cardIds.sort()), [['g5', 'n3']]);
});

test('a write that fails for any other reason refuses nothing and takes nothing back', async () => {
  const { index, sync, cards, run } = await setup({ elsewhere: 49 });
  await run();
  note(cards, 'n1'); note(cards, 'n2');
  sync.notePlacedThroughCap(['n1', 'n2']);
  index.failNext.push((op) => (op.kind === 'upsert' ? index.refusal : null));            // the batch is refused …
  index.failNext.push((op) => (op.kind === 'upsert' ? { code: '', message: 'Failed to fetch' } : null));   // … then the landing write drops
  await run();
  assert.deepEqual(capped(), [], 'a dropped connection is not a cap refusal');
  await run();
  assert.deepEqual(indexed(index), ['n1:1']);
  assert.deepEqual(capped().map((d) => d.cardIds), [['n2']], 'the real overflow, on the retry');
});

test('only a card this tab placed through the gate is taken back; existing work is kept', async () => {
  const { sync, cards, run } = await setup({ elsewhere: 50 });
  await run();
  note(cards, 'mine'); note(cards, 'restored');
  sync.notePlacedThroughCap(['mine']);
  await run();
  const [d] = capped();
  assert.deepEqual(d.cardIds, ['mine']);
  assert.equal(d.rejected, 1);
  assert.equal(d.kept, 1);
});

test('room that frees goes to the card just placed, not to one kept from before', async () => {
  const { index, sync, cards, run } = await setup({ elsewhere: 48 });
  note(cards, 'x1'); note(cards, 'x2');
  await run();
  assert.equal(index.count(), 50);
  note(cards, 'kept');                     // e.g. a cluster's card put back: not this tab's to take back
  await run();
  assert.deepEqual(capped().map((d) => d.kept), [1], 'kept, uncounted');
  cards.delete('x1');                      // the person makes room …
  note(cards, 'fresh');                    // … and uses it
  sync.notePlacedThroughCap(['fresh']);
  events.length = 0;
  await run();
  assert.ok(index.rows.has('fresh'), 'the card the person just placed takes the room');
  assert.ok(!index.rows.has('kept'), 'the kept card waits, still on the board');
  assert.deepEqual(capped().flatMap((d) => d.cardIds), [], 'nothing is taken back');
});

test('while a deletion\'s row is still on the meter, nothing is refused against it', async () => {
  const { index, sync, cards, run } = await setup({ elsewhere: 48 });
  note(cards, 'x1'); note(cards, 'x2');
  await run();
  cards.delete('x1');
  note(cards, 'fresh');
  sync.notePlacedThroughCap(['fresh']);
  index.failNext.push((op) => (op.kind === 'delete' ? { code: '', message: 'Failed to fetch' } : null));
  events.length = 0;
  await run();
  assert.deepEqual(capped(), [], 'the failed cleanup round refuses nothing');
  await run();
  assert.deepEqual(indexed(index), ['fresh:1', 'x2:1'], 'the retry releases the row and the card lands');
});
