// The board persistence layer — yboard.js's handle, driven through the real
// useYBoard hook — against an in-memory "server" (board_state), IndexedDB
// cache, prefetch cache and realtime provider.
//
// yboard.js reads import.meta.env and pulls in the network, R2 and render
// modules, so it can't be imported under `node --test` as-is. A module hook
// (registered below, before the dynamic import) swaps every collaborator for
// a stub that calls into `globalThis.__yb`, swaps `react` for a tiny hook
// runtime, and rewrites the one import.meta.env read. Everything that decides
// WHAT gets persisted WHEN — yboard.js, useYBoard.js, yhelpers.js — is real.
//
// What it pins:
//   APP-CORE-01  a restore of an OPEN cluster sticks (it used to be undone by
//                the old doc's teardown + the remount re-applying its draft)
//   APP-CORE-13  a corruption heal right after a reset still remounts
//   APP-CORE-10  edits made on the instant cache paint survive leaving early
//   APP-CORE-09  the localStorage draft is debounced, local-only, and flushed
//                on pagehide
//   PERF-X1/02   applied (peer) updates upload nothing; the open backfill
//                asks can_write_board before rendering a thumbnail
//   review       an earlier session's draft is cleared by the first confirmed
//                save (any version shape), dropped when it can't be written,
//                and nothing writes board_state from a doc whose server
//                fetch failed — a re-fetch merges first
import test, { mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as Y from 'yjs';

// ── module hook ─────────────────────────────────────────────────────────────
const fn = (mod, name) => `export const ${name} = (...a) => globalThis.__yb.call(${JSON.stringify(mod)}, ${JSON.stringify(name)}, a);`;
const STUBS = {
  '/src/lib/boardsApi.js': ['loadBoardSnapshot', 'saveBoardSnapshot', 'saveBoardVersion', 'updateBoardThumb', 'getBoardBgColor', 'getChildBoardThumbs', 'isBoardThumbCustom'].map((n) => fn('boardsApi', n)).join('\n'),
  '/src/hooks/useBoardPreview.js': fn('useBoardPreview', 'invalidateBoardPreview'),
  '/src/lib/renderThumbnail.js': [fn('renderThumbnail', 'renderThumbnailBlob'), fn('renderThumbnail', 'quickVisualHash'), 'export const RENDER_VERSION = 1;'].join('\n'),
  '/src/lib/uploads.js': fn('uploads', 'uploadBoardThumbnail'),
  '/src/lib/prefetchKinds.js': [fn('prefetchKinds', 'peekBoardSnapshot'), fn('prefetchKinds', 'prefetchBoard')].join('\n'),
  '/src/lib/snapshotCache.js': ['getSnapshot', 'putSnapshot', 'deleteSnapshot'].map((n) => fn('snapshotCache', n)).join('\n'),
  '/src/lib/prefetch.js': fn('prefetch', 'invalidate'),
  '/src/lib/perf.js': 'export const isEnabled = () => false; export const bump = () => {}; export const mark = () => {}; export const gauge = () => {};',
  '/src/lib/errorReporting.js': 'export const logClientError = () => {};',
  '/src/lib/previewWorkerClient.js': 'export const serializeViaWorker = () => null;',
  '/src/lib/yPartyKit.js': fn('realtime', 'attachRealtime'),
  '/src/lib/ySupabase.js': fn('realtime', 'attachRealtime'),
  '/src/lib/supabase.js': 'export const supabase = { rpc: (...a) => globalThis.__yb.call("supabase", "rpc", a) };',
  '/src/lib/restoreSignal.js': fn('restoreSignal', 'watchBoardRestores'),
  '/src/lib/imageMeta.js': [fn('imageMeta', 'primeImageMeta'), fn('imageMeta', 'primeImageMetaForBoard')].join('\n'),
};
const REACT_STUB = ['useEffect', 'useRef', 'useState'].map((n) => `export const ${n} = (...a) => globalThis.__fakeReact.${n}(...a);`).join('\n');
const hooks = `
const STUBS = ${JSON.stringify(STUBS)};
export async function resolve(specifier, context, next) {
  if (specifier === 'react' && context.parentURL && context.parentURL.endsWith('/src/hooks/useYBoard.js')) {
    return { url: 'yb-stub:react', shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === 'yb-stub:react') return { format: 'module', shortCircuit: true, source: ${JSON.stringify(REACT_STUB)} };
  const path = url.split('?')[0];
  for (const suffix of Object.keys(STUBS)) {
    if (path.endsWith(suffix)) return { format: 'module', shortCircuit: true, source: STUBS[suffix] };
  }
  if (path.endsWith('/src/lib/yboard.js')) {
    const r = await next(url, context);
    const source = String(r.source).replace(/import\\.meta\\.env\\.VITE_USE_PARTYKIT/g, 'globalThis.__ybPartyKit');
    return { ...r, format: 'module', source };
  }
  return next(url, context);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks), import.meta.url);

// ── browser-ish globals ─────────────────────────────────────────────────────
const lsStore = new Map();
const lsWrites = [];   // keys, in write order
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => { lsWrites.push(k); lsStore.set(String(k), String(v)); },
  removeItem: (k) => { lsStore.delete(k); },
};
globalThis.window = new EventTarget();
globalThis.requestAnimationFrame = (f) => setTimeout(f, 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.__ybPartyKit = 'true';

// ── fake server + collaborators ─────────────────────────────────────────────
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const enc = (doc) => b64(Y.encodeStateAsUpdate(doc));
let env;
function resetEnv() {
  env = {
    server: new Map(),        // boardId -> board_state b64
    idb: new Map(),           // boardId -> b64
    prefetch: new Map(),      // boardId -> b64 (hover-warmed cache)
    saves: [],                // { boardId, stateWrite, wrote }
    renders: 0,
    rpc: [],
    canWrite: true,
    backstopDue: true,
    serverGate: null,         // a promise loadBoardSnapshot/prefetchBoard wait on
    serverDown: false,        // board_state reads throw (a network blip)
    rpcDown: false,           // can_write_board errors
    realtime: [],             // { boardId, destroyed }
    restoreWatchers: [],
  };
}
const impl = {
  boardsApi: {
    loadBoardSnapshot: async (id) => {
      if (env.serverGate) await env.serverGate;
      if (env.serverDown) throw new Error('network down');
      return env.server.get(id) ?? null;
    },
    saveBoardSnapshot: async (id, doc, { stateWrite = 'always' } = {}) => {
      const due = stateWrite === 'always' || env.backstopDue;
      const bytes = enc(doc);   // encoded synchronously, like the real one
      env.saves.push({ boardId: id, stateWrite, wrote: due });
      if (due) env.server.set(id, bytes);
      return due;
    },
    saveBoardVersion: async () => {},
    updateBoardThumb: async () => {},
    getBoardBgColor: async () => null,
    getChildBoardThumbs: async () => ({}),
    isBoardThumbCustom: async () => false,
  },
  useBoardPreview: { invalidateBoardPreview: () => {} },
  renderThumbnail: {
    renderThumbnailBlob: async () => { env.renders += 1; return {}; },
    quickVisualHash: (cards, strokes, arrows) => JSON.stringify([cards.length, strokes.length, arrows.length, Math.random()]),
  },
  uploads: { uploadBoardThumbnail: async () => ({ src: 'r2:thumb' }) },
  prefetchKinds: {
    peekBoardSnapshot: (id) => env.prefetch.get(id) ?? null,
    prefetchBoard: async (id) => {
      if (env.prefetch.has(id)) return env.prefetch.get(id);
      if (env.serverGate) await env.serverGate;
      if (env.serverDown) throw new Error('network down');
      const v = env.server.get(id) ?? null;
      if (v) env.prefetch.set(id, v);
      return v;
    },
  },
  snapshotCache: {
    getSnapshot: async (id) => (env.idb.has(id) ? { b64: env.idb.get(id) } : null),
    putSnapshot: async (id, _uid, v) => { env.idb.set(id, v); },
    deleteSnapshot: async (id) => { env.idb.delete(id); },
  },
  prefetch: { invalidate: (key) => { env.prefetch.delete(String(key).replace(/^board:/, '')); } },
  realtime: {
    attachRealtime: (_doc, boardId) => {
      const rec = { boardId, destroyed: false };
      env.realtime.push(rec);
      return { awareness: null, destroy() { rec.destroyed = true; }, whenSynced: async () => true };
    },
  },
  supabase: {
    rpc: async (name, args) => {
      env.rpc.push({ name, args });
      return env.rpcDown ? { data: null, error: { message: 'down' } } : { data: env.canWrite, error: null };
    },
  },
  restoreSignal: { watchBoardRestores: (boardId, cb) => { env.restoreWatchers.push({ boardId, cb }); return () => {}; } },
  imageMeta: { primeImageMeta: () => {}, primeImageMetaForBoard: () => {} },
};
globalThis.__yb = { call: (mod, name, args) => impl[mod][name](...args) };

// ── a minimal hook runtime (just enough for useYBoard) ──────────────────────
function createHookHost(hookFn) {
  const slots = [];
  let idx = 0;
  let queue = [];
  let dirty = false;
  let rendering = false;
  let scheduled = false;
  let out;
  globalThis.__fakeReact = {
    useRef(v) { const i = idx++; if (!slots[i]) slots[i] = { current: v }; return slots[i]; },
    useState(init) {
      const i = idx++;
      if (!slots[i]) slots[i] = { v: typeof init === 'function' ? init() : init };
      const s = slots[i];
      return [s.v, (nv) => {
        s.v = typeof nv === 'function' ? nv(s.v) : nv;
        dirty = true;
        // A state change outside render (a timer, a resolved load) re-renders
        // on the next microtask, like React's batched update would.
        if (!rendering && !scheduled) { scheduled = true; queueMicrotask(() => { scheduled = false; render(); }); }
      }];
    },
    useEffect(effect, deps) {
      const i = idx++;
      const prev = slots[i];
      const changed = !prev || !deps || deps.length !== prev.deps.length || deps.some((d, k) => !Object.is(d, prev.deps[k]));
      if (!prev) slots[i] = { deps, cleanup: null };
      if (changed) queue.push(() => {
        if (slots[i].cleanup) slots[i].cleanup();
        const c = effect();
        slots[i] = { deps, cleanup: typeof c === 'function' ? c : null };
      });
    },
  };
  let args = [];
  const render = (...a) => {
    if (a.length) args = a;
    rendering = true;
    try {
      for (let n = 0; n < 10; n++) {
        dirty = false;
        idx = 0;
        out = hookFn(...args);
        const q = queue; queue = [];
        q.forEach((f) => f());
        if (!dirty) break;
      }
    } finally { rendering = false; }
    return out;
  };
  const unmount = () => { for (const s of slots) if (s && s.cleanup) s.cleanup(); };
  return { render, unmount, get current() { return out; } };
}

// ── helpers ─────────────────────────────────────────────────────────────────
const settle = () => new Promise((r) => setImmediate(r));
async function advance(ms) {
  // Step through so async continuations (awaited saves) run between timers.
  const step = 50;
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(Math.min(step, ms - t));
    await settle();
  }
  await settle();
}
const cardsOf = (doc) => [...doc.getMap('cards').keys()].sort();
function addCard(doc, id, origin = 'local') {
  doc.transact(() => {
    const m = new Y.Map();
    m.set('id', id); m.set('kind', 'note'); m.set('x', 0); m.set('y', 0);
    doc.getMap('cards').set(id, m);
  }, origin);
}
const draftOf = (boardId) => {
  const raw = lsStore.get(`soleil.boards.ydoc.${boardId}`);
  if (!raw) return null;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Buffer.from(JSON.parse(raw).doc, 'base64'));
  return doc;
};
const serverDoc = (boardId) => {
  const doc = new Y.Doc();
  if (env.server.has(boardId)) Y.applyUpdate(doc, Buffer.from(env.server.get(boardId), 'base64'));
  return doc;
};
let seq = 0;
const newBoardId = () => `board-${++seq}`;

const { loadYBoard } = await import('./yboard.js');
const { useYBoard } = await import('../hooks/useYBoard.js');

beforeEach(() => {
  resetEnv();
  lsStore.clear();
  lsWrites.length = 0;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
});
afterEach(() => { mock.timers.reset(); });

// A board on the "server" with cards a,b; returns the version bytes at that
// point (what Version history would hold) plus a doc in the same lineage.
function seedServer(boardId, ids = ['a', 'b']) {
  const doc = new Y.Doc();
  for (const id of ids) addCard(doc, id);
  env.server.set(boardId, enc(doc));
  return doc;
}

// ── APP-CORE-01 ─────────────────────────────────────────────────────────────
test('APP-CORE-01: restoring an OPEN cluster sticks — server, draft and the remounted doc all hold the restored version', async () => {
  const boardId = newBoardId();
  const lineage = seedServer(boardId, ['a', 'b']);
  const version = enc(lineage);              // the version we will restore to
  const host = createHookHost((...a) => useYBoard(...a));
  host.render(boardId, 'u1', null, 'ws1', true);
  await advance(50);
  assert.deepEqual(host.current.cards.map((c) => c.id).sort(), ['a', 'b']);

  // Edit after the version was taken: add c, d (saved), then x (only drafted:
  // under PartyKit the backstop isn't due again inside the minute).
  addCard(host.current.ydoc, 'c');
  addCard(host.current.ydoc, 'd');
  await advance(3000);
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'b', 'c', 'd']);
  env.backstopDue = false;
  addCard(host.current.ydoc, 'x');
  await advance(3000);
  assert.ok(cardsOf(draftOf(boardId)).includes('x'), 'a pre-restore draft is sitting in localStorage');
  env.backstopDue = true;

  // bulletproofRestore: board_state := the version, room reset, reset signal.
  env.server.set(boardId, version);
  env.prefetch.set(boardId, enc(host.current.ydoc));   // a stale hover-warmed copy, worst case
  env.idb.set(boardId, enc(host.current.ydoc));        // and a stale instant-reopen cache
  const oldRealtime = env.realtime.at(-1);
  window.dispatchEvent(new CustomEvent('soleil-board-reset', { detail: { boardId } }));
  // The old doc leaves the room the moment the signal lands, before the jitter.
  assert.equal(oldRealtime.destroyed, true, 'provider detached immediately');
  assert.equal(draftOf(boardId), null, 'draft dropped immediately');
  // Edits on the discarded doc during the jitter go nowhere.
  addCard(host.current.ydoc, 'during-jitter');

  await advance(2000);        // jittered remount (≤1.5s) + fresh cold load
  await advance(3000);        // anything the old handle's teardown might still write

  assert.deepEqual(host.current.cards.map((c) => c.id).sort(), ['a', 'b'], 'remounted doc shows the restored version');
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'b'], 'board_state still holds the restored version');
  const d = draftOf(boardId);
  assert.ok(!d || cardsOf(d).join() === 'a,b', 'no pre-restore draft survives');
  const idbDoc = new Y.Doc();
  if (env.idb.has(boardId)) Y.applyUpdate(idbDoc, Buffer.from(env.idb.get(boardId), 'base64'));
  assert.equal(cardsOf(idbDoc).includes('c'), false, 'no pre-restore IndexedDB copy');
  assert.equal(env.realtime.filter((r) => !r.destroyed).length, 1, 'exactly one live provider: the new doc');

  // And the restored board keeps working: a new edit saves on top of it.
  addCard(host.current.ydoc, 'e');
  await advance(3000);
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'b', 'e']);
  host.unmount();
});

test('APP-CORE-01 control: without a discard the old teardown + draft undo the restore (the bug this guards)', async () => {
  const boardId = newBoardId();
  const lineage = seedServer(boardId, ['a', 'b']);
  const version = enc(lineage);
  const h1 = loadYBoard(boardId, { userId: 'u1' });
  await h1.ready;
  addCard(h1.ydoc, 'c');
  await advance(3000);
  env.server.set(boardId, version);
  h1.destroy();               // what the remount used to do — no discard
  await advance(100);
  const h2 = loadYBoard(boardId, { userId: 'u1' });
  await h2.ready;
  assert.deepEqual(cardsOf(h2.ydoc), ['a', 'b', 'c'], 'restore lost (documents the failure mode)');
  h2.destroy();
});

// ── APP-CORE-13 ─────────────────────────────────────────────────────────────
test('APP-CORE-13: a corruption heal <600ms after a reset still remounts the poisoned handle', async () => {
  const boardId = newBoardId();
  seedServer(boardId, ['a']);
  const host = createHookHost((...a) => useYBoard(...a));
  host.render(boardId, 'u1', null, 'ws1', true);
  await advance(50);
  const doc0 = host.current.ydoc;

  // Zero jitter, so the reset's remount lands at once and the corruption
  // below hits the FRESH handle — the case the old dedupe swallowed.
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    window.dispatchEvent(new CustomEvent('soleil-board-reset', { detail: { boardId } }));
    await advance(50);
    const doc1 = host.current.ydoc;
    assert.notEqual(doc1, doc0, 'reset remounted');
    // Corruption 50ms later — inside the 600ms dedupe window.
    window.dispatchEvent(new CustomEvent('soleil:yjs-corruption', { detail: { boardId } }));
    await advance(2000);
    assert.notEqual(host.current.ydoc, doc1, 'corruption heal remounted too');
  } finally { Math.random = realRandom; }
  const doc2 = host.current.ydoc;
  // The fresh handle persists: an edit reaches the server.
  addCard(doc2, 'z');
  await advance(3000);
  assert.ok(cardsOf(serverDoc(boardId)).includes('z'), 'post-heal edits persist');
  host.unmount();
});

// ── PERF-X1 / PERF-02 / APP-CORE-09 ─────────────────────────────────────────
test('PERF-X1: an applied (peer) update writes no draft, no board_state, no thumbnail', async () => {
  const boardId = newBoardId();
  const peer = seedServer(boardId, ['a']);
  const h = loadYBoard(boardId, { userId: 'viewer', workspaceId: 'ws1', hasThumb: true });
  await h.ready;
  await advance(50);
  env.saves.length = 0; lsWrites.length = 0;

  // The peer types: 30 updates arrive through the provider.
  peer.on('update', (u) => Y.applyUpdate(h.ydoc, u, { provider: true }));
  for (let i = 0; i < 30; i++) { addCard(peer, `p${i}`); await advance(20); }
  await advance(5000);

  assert.equal(h.ydoc.getMap('cards').size, 31, 'peer edits arrived');
  assert.equal(env.saves.length, 0, 'no board_state upload for peer edits');
  assert.equal(lsWrites.filter((k) => k.startsWith('soleil.boards.ydoc.')).length, 0, 'no draft writes for peer edits');
  assert.equal(env.renders, 0, 'no thumbnail render for peer edits');

  // Closing without having edited saves nothing either.
  h.destroy();
  await advance(100);
  assert.equal(env.saves.length, 0, 'viewer close uploads nothing');
});

test('APP-CORE-09: a local typing burst drafts a handful of times, not per update; pagehide flushes the latest', async () => {
  const boardId = newBoardId();
  seedServer(boardId, ['a']);
  env.backstopDue = false;    // PartyKit: the backstop isn't due inside the minute
  const h = loadYBoard(boardId, { userId: 'u1' });
  await h.ready;
  await advance(50);
  lsWrites.length = 0;

  for (let i = 0; i < 40; i++) { addCard(h.ydoc, `k${i}`); await advance(50); }   // 2s of continuous edits
  const draftWrites = lsWrites.filter((k) => k === `soleil.boards.ydoc.${boardId}`).length;
  assert.ok(draftWrites >= 1 && draftWrites <= 3, `max-wait keeps the draft fresh during a burst (got ${draftWrites})`);

  // The burst settles: the debounced save runs, but the backstop wasn't due
  // (nothing reached board_state), so the draft must NOT be cleared — it is
  // the only durable copy if the room never got these edits.
  await advance(3000);
  assert.ok(env.saves.length >= 1 && env.saves.every((s) => s.wrote === false));
  assert.ok(cardsOf(draftOf(boardId)).includes('k39'), 'draft kept, and current');

  addCard(h.ydoc, 'last');
  window.dispatchEvent(new Event('pagehide'));     // tab closing, before the debounce fires
  assert.ok(cardsOf(draftOf(boardId)).includes('last'), 'pagehide wrote the newest edit to the draft');
  h.destroy();
  await advance(100);
  assert.ok(cardsOf(serverDoc(boardId)).includes('last'), 'destroy saved it');
  assert.equal(draftOf(boardId), null, 'and then cleared the draft');
});

test('PERF-02: a local edit regenerates the thumbnail once; the open backfill asks can_write_board first', async () => {
  const boardId = newBoardId();
  seedServer(boardId, ['a']);
  env.canWrite = false;
  const viewer = loadYBoard(boardId, { userId: 'v', workspaceId: 'ws1', hasThumb: false });
  await viewer.ready;
  await advance(3000);
  assert.deepEqual(env.rpc.map((r) => r.name), ['can_write_board']);
  assert.equal(env.renders, 0, 'view-only member renders no backfill thumbnail');
  viewer.destroy();

  const boardId2 = newBoardId();
  seedServer(boardId2, ['a']);
  env.canWrite = true;
  const writer = loadYBoard(boardId2, { userId: 'w', workspaceId: 'ws1', hasThumb: true });
  await writer.ready;
  await advance(50);
  addCard(writer.ydoc, 'b');
  await advance(3000);
  assert.equal(env.renders, 1, 'own edit renders the thumbnail');
  writer.destroy();
});

// ── APP-CORE-10 ─────────────────────────────────────────────────────────────
test('APP-CORE-10: an edit on the instant cache paint survives leaving before the server snapshot lands', async () => {
  const boardId = newBoardId();
  const server = seedServer(boardId, ['a']);
  env.idb.set(boardId, enc(server));       // last session's cache
  addCard(server, 'fromPeer');             // the server moved on since
  env.server.set(boardId, enc(server));
  let open; env.serverGate = new Promise((r) => { open = r; });   // slow network

  let painted = false;
  const h = loadYBoard(boardId, { userId: 'u1', onEarlyContent: () => { painted = true; } });
  await advance(20);
  assert.equal(painted, true, 'cache painted');
  addCard(h.ydoc, 'early');                // user edits before the snapshot lands
  h.destroy();                             // ...and navigates away
  await advance(100);
  assert.equal(env.saves.length, 0, 'never overwrote board_state with an unmerged doc');
  assert.ok(cardsOf(draftOf(boardId)).includes('early'), 'the edit is in the draft');

  open(); env.serverGate = null;
  const h2 = loadYBoard(boardId, { userId: 'u1' });
  await h2.ready;
  assert.deepEqual(cardsOf(h2.ydoc), ['a', 'early', 'fromPeer'], 'next open merges the early edit with the server');
  await advance(3000);
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'early', 'fromPeer'], 'and saves it');
  assert.equal(draftOf(boardId), null, 'and the saved draft is gone');
  h2.destroy();
});

test('APP-CORE-10: an early edit is saved once the snapshot lands, if you stay', async () => {
  const boardId = newBoardId();
  const server = seedServer(boardId, ['a']);
  env.idb.set(boardId, enc(server));
  let open; env.serverGate = new Promise((r) => { open = r; });
  const h = loadYBoard(boardId, { userId: 'u1' });
  await advance(20);
  addCard(h.ydoc, 'early');
  open(); env.serverGate = null;
  await h.ready;
  await advance(3000);
  assert.ok(cardsOf(serverDoc(boardId)).includes('early'));
  h.destroy();
});

// ── a draft left by an earlier session ──────────────────────────────────────
// Store a draft the way an earlier session (or an older build) left it.
function plantDraft(boardId, doc, version) {
  const b = enc(doc);
  lsStore.set(`soleil.boards.ydoc.${boardId}`, version === 'raw' ? b : JSON.stringify({ doc: b, version }));
}

for (const version of [7, 'old-session:3', 'raw']) {
  test(`an earlier session's draft (version ${JSON.stringify(version)}) is saved and cleared on a view-only open; later opens save nothing`, async () => {
    const boardId = newBoardId();
    const lineage = seedServer(boardId, ['a']);
    const restorePoint = enc(lineage);
    const drafted = new Y.Doc();
    Y.applyUpdate(drafted, Buffer.from(restorePoint, 'base64'));
    addCard(drafted, 'unsaved');
    plantDraft(boardId, drafted, version);

    const h1 = loadYBoard(boardId, { userId: 'u1' });
    await h1.ready;
    await advance(3000);                      // no edits: just looking
    assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'unsaved'], 'the unsaved draft reached board_state');
    assert.equal(draftOf(boardId), null, 'and, confirmed, the draft is gone');
    h1.destroy();
    await advance(100);
    assert.equal(draftOf(boardId), null);

    // Version history restores [a] on another device. Reopening here must not
    // merge anything back over it, and a view-only reopen uploads nothing.
    env.server.set(boardId, restorePoint);
    env.idb.delete(boardId);
    env.saves.length = 0;
    const h2 = loadYBoard(boardId, { userId: 'u1' });
    await h2.ready;
    await advance(3000);
    h2.destroy();
    await advance(100);
    assert.equal(env.saves.length, 0, 'a view-only reopen makes zero saves');
    assert.deepEqual(cardsOf(serverDoc(boardId)), ['a'], 'the restore made elsewhere stands');
  });
}

test('a view-only member with a leftover draft drops it instead of POSTing it into a refusal on every open', async () => {
  const boardId = newBoardId();
  const peer = seedServer(boardId, ['a']);
  addCard(peer, 'p');                        // an older build drafted this peer edit
  plantDraft(boardId, peer, 4);
  env.canWrite = false;

  const h1 = loadYBoard(boardId, { userId: 'viewer' });
  await h1.ready;
  await advance(3000);
  h1.destroy();
  await advance(100);
  assert.equal(env.saves.length, 0, 'no upload');
  assert.equal(draftOf(boardId), null, 'the unsaveable draft is dropped');
  assert.ok(env.rpc.some((r) => r.name === 'can_write_board'), 'decided by can_write_board');

  const h2 = loadYBoard(boardId, { userId: 'viewer' });
  await h2.ready;
  await advance(3000);
  h2.destroy();
  await advance(100);
  assert.equal(env.saves.length, 0, 'and the next open uploads nothing either');
});

test('a draft is kept, not dropped, when can_write_board cannot be asked', async () => {
  const boardId = newBoardId();
  const doc = seedServer(boardId, ['a']);
  addCard(doc, 'unsaved');
  plantDraft(boardId, doc, 2);
  env.rpcDown = true;
  const h = loadYBoard(boardId, { userId: 'u1' });
  await h.ready;
  await advance(3000);
  h.destroy();
  await advance(100);
  assert.equal(env.saves.length, 0);
  assert.ok(cardsOf(draftOf(boardId)).includes('unsaved'), 'the draft waits for the next open');
});

// ── the cold-load fetch fails ───────────────────────────────────────────────
test('a failed snapshot fetch never overwrites board_state with the draft / cache paint; a re-fetch merges and saves', async () => {
  const boardId = newBoardId();
  const server = seedServer(boardId, ['a']);
  const drafted = new Y.Doc();
  Y.applyUpdate(drafted, Y.encodeStateAsUpdate(server));
  addCard(drafted, 'unsaved');
  plantDraft(boardId, drafted, 'old:3');
  addCard(server, 'newerOnServer');          // the server moved on since
  env.server.set(boardId, enc(server));
  env.serverDown = true;                      // the open hits a network blip

  const h = loadYBoard(boardId, { userId: 'u1' });
  await h.ready;
  addCard(h.ydoc, 'typedMeanwhile');          // an edit while the server copy is missing
  await advance(2000);
  window.dispatchEvent(new Event('pagehide'));
  h.flushNow();
  await advance(100);
  assert.equal(env.saves.length, 0, 'nothing written from a doc that has not merged the server');
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'newerOnServer']);
  assert.ok(cardsOf(draftOf(boardId)).includes('typedMeanwhile'), 'the edit is safe in the draft');

  env.serverDown = false;                     // the network comes back
  await advance(10000);
  assert.deepEqual(cardsOf(h.ydoc), ['a', 'newerOnServer', 'typedMeanwhile', 'unsaved'], 're-fetch merged the server copy');
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'newerOnServer', 'typedMeanwhile', 'unsaved'], 'and the save is whole');
  h.destroy();
  await advance(100);
  assert.equal(draftOf(boardId), null);
});

test('leaving while the snapshot fetch is still failing keeps everything in the draft and writes nothing', async () => {
  const boardId = newBoardId();
  const server = seedServer(boardId, ['a']);
  env.idb.set(boardId, enc(server));         // cache paint
  addCard(server, 'newerOnServer');
  env.server.set(boardId, enc(server));
  env.serverDown = true;

  const h = loadYBoard(boardId, { userId: 'u1', workspaceId: 'ws1' });
  await h.ready;
  addCard(h.ydoc, 'mine');
  await advance(500);
  h.destroy();
  await advance(5000);
  assert.equal(env.saves.length, 0);
  assert.equal(env.renders, 0);
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'newerOnServer'], 'board_state untouched');
  assert.ok(cardsOf(draftOf(boardId)).includes('mine'));

  env.serverDown = false;
  const h2 = loadYBoard(boardId, { userId: 'u1' });
  await h2.ready;
  await advance(3000);
  assert.deepEqual(cardsOf(serverDoc(boardId)), ['a', 'mine', 'newerOnServer'], 'the next open merges and saves');
  assert.equal(draftOf(boardId), null);
  h2.destroy();
});

// ── the instant paint, through the hook ─────────────────────────────────────
// useYBoard wires its early-paint handler only after loadYBoard() has returned,
// and a draft is applied before loadYBoard's first await. The draft's paint was
// handed to the handler that wasn't wired yet, so a board with unsaved edits
// waited for the server like a cold open. Boot timing reads paintSource.
const PLANT = {
  draft: (boardId, server) => {
    const d = new Y.Doc();
    Y.applyUpdate(d, Buffer.from(enc(server), 'base64'));
    addCard(d, 'unsaved');
    plantDraft(boardId, d, 7);
  },
  cache: (boardId, server) => { env.idb.set(boardId, enc(server)); },
};
for (const source of Object.keys(PLANT)) {
  test(`a ${source} paints the board before the server answers, and says it did`, async () => {
    const boardId = newBoardId();
    const server = seedServer(boardId, ['a']);
    PLANT[source](boardId, server);
    let open; env.serverGate = new Promise((r) => { open = r; });   // slow network
    const host = createHookHost((...a) => useYBoard(...a));
    host.render(boardId, 'u1', null, 'ws1', true);
    await advance(100);   // the local read resolves, then the paint's frame
    assert.equal(host.current.ready, true, 'painted while board_state is still on its way');
    assert.equal(host.current.synced, false);
    assert.equal(host.current.paintSource, source);
    open(); env.serverGate = null;
    await advance(50);
    assert.equal(host.current.synced, true);
    assert.equal(host.current.paintSource, source, 'the first paint keeps its source');
    host.unmount();
  });
}

test('with nothing on this device, the first paint is the server snapshot', async () => {
  const boardId = newBoardId();
  seedServer(boardId, ['a']);
  let open; env.serverGate = new Promise((r) => { open = r; });
  const host = createHookHost((...a) => useYBoard(...a));
  host.render(boardId, 'u1', null, 'ws1', true);
  await advance(100);
  assert.equal(host.current.ready, false, 'nothing to paint until the server answers');
  open(); env.serverGate = null;
  await advance(50);
  assert.equal(host.current.ready, true);
  assert.equal(host.current.paintSource, 'server');
  host.unmount();
});
