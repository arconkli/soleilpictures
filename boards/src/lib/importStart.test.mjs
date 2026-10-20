// importStart.test.mjs — one bulk import from the drop to the end, against a
// fake App: what the tray is told, when the question is asked, the hold that
// keeps a checkout in another tab, the watch for room, the queue, Remove.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startBulkImport, pokeImport, offerStopped } from './importStart.js';
import { matchStopped } from './importResume.js';
import { storedZip } from './zipFixture.mjs';

const jpg = (name, size = 10) => ({ name, size, lastModified: 1, type: 'image/jpeg' });
// A walked folder as folderWalk returns it: Night (a, b) / Stills (c, d), plus a loose file.
const walked = (top = 'Night') => ({
  root: { name: null, files: [jpg('loose.jpg')], dirs: [
    { name: top, files: [jpg('a.jpg'), jpg('b.jpg')], dirs: [{ name: 'Stills', files: [jpg('c.jpg'), jpg('d.jpg')], dirs: [] }] },
  ] },
  files: 5, clusters: 2, truncated: false, flattened: false, skipped: {}, origins: new Map(),
});

const flush = () => new Promise((r) => setTimeout(r, 0));
async function until(pred, n = 200) { for (let i = 0; i < n && !pred(); i++) await flush(); assert.ok(pred(), 'condition never held'); }

function fakeServer({ cardsLeft = Infinity } = {}) {
  const s = { cardsLeft, created: 0, appended: 0, jobs: 0 };
  const deps = {
    createJob: async () => { s.jobs++; return `job-${s.jobs}`; },
    budgets: async () => ({ cardsLeft: s.cardsLeft, bytesLeft: Infinity, bytesUsed: 0, quota: 100 }),
    createClusters: async (job, rows) => { s.created += rows.length; },
    appendCards: async (boardId, cards) => {
      if (cards.length > s.cardsLeft) throw Object.assign(new Error('cap'), { status: 402, code: 'limit_reached' });
      s.cardsLeft -= cards.length; s.appended += cards.length;
    },
    upload: async (item, f, { cardId }) => ({ src: `r2:${cardId}`, key: cardId, width: 10, height: 10 }),
    patchCards: async () => {}, removeCards: async () => {}, putItems: async () => {}, setJob: async () => {},
    newId: (() => { let n = 0; return () => `b${++n}`; })(),
    cardId: (item) => `c-${item.file.relPath}`, encodeDoc: () => 'AAA=', now: () => 0, sleep: async () => {},
  };
  return { s, deps };
}

function fakeEnv({ server = fakeServer(), answer = 'fit', who = {}, zipAnswer = 'unpack' } = {}) {
  const store = new Map();
  const seen = { puts: [], asks: [], zipAsks: [], deps: null, holds: [], unholds: [], upgrades: [], removed: [], logs: [], toasts: [], wakes: new Set(), polls: new Set() };
  let k = 0;
  const env = {
    newKey: () => `k${++k}`,
    put: (key, fields) => { store.set(key, { ...(store.get(key) || {}), ...fields }); seen.puts.push([key, fields.phase || fields.snap?.status || Object.keys(fields)[0]]); },
    drop: (key) => store.delete(key),
    walk: async (entries, { onProgress }) => { onProgress?.({ files: 5, clusters: 2 }); return entries[0].walked; },
    walkPicked: async () => walked(),
    who: async () => ({ own: true, plan: 'free', trialOffer: true, addon: false, targetName: 'Studio', ...who }),
    makeDeps: (a) => { seen.deps = a; return server.deps; },
    ask: async (model) => { seen.asks.push(model); return typeof answer === 'function' ? answer(model) : answer; },
    askZip: async (model) => { seen.zipAsks.push(model); return zipAnswer; },
    upgrade: (offer, o) => seen.upgrades.push([offer, o?.stoppedBy, seen.holds.length]),
    hold: (h) => { seen.holds.push(h); return `held-${seen.holds.length}`; },
    unhold: (id) => seen.unholds.push(id),
    openBoard: () => {},
    removeImport: async (r) => { seen.removed.push(r); },
    wake: (fn) => { seen.wakes.add(fn); return () => seen.wakes.delete(fn); },
    every: (ms, fn) => { seen.polls.add(fn); return () => seen.polls.delete(fn); },
    log: (name, props) => seen.logs.push([name, props.phase || props.action || '']),
    toast: (t) => seen.toasts.push(t),
    now: () => 0,
    clusterCost: 0,
  };
  return { env, store, seen, server };
}

const drop = (env, over = {}) => startBulkImport({ entries: [{ name: 'Night', walked: walked(over.top) }], boardId: 'target', canAttemptFiles: true, source: 'drop', ...over }, env);

test('everything fits: no question, the tray goes reading → queued → job, loose files go back to the board', async () => {
  const { env, store, seen, server } = fakeEnv();
  const out = await drop(env);
  assert.deepEqual(out.loose.map((f) => f.name), ['loose.jpg']);
  assert.equal(seen.asks.length, 0);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  const phases = seen.puts.filter(([, p]) => ['reading', 'queued', 'job'].includes(p)).map(([, p]) => p);
  assert.deepEqual([...new Set(phases)], ['reading', 'queued', 'job']);
  assert.equal(server.s.appended, 4);
  assert.equal(store.get(out.key).title, 'Night');
  assert.equal(store.get(out.key).targetName, 'Studio', 'the tray knows where it went');
  assert.equal(seen.holds.length, 0, 'nothing waited, nothing held');
  assert.deepEqual(seen.logs.filter(([n]) => n === 'folder_import').length, 1);
});

test('the question: Cancel leaves nothing behind — no job row, no clusters, no entry', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const { env, store, seen } = fakeEnv({ server, answer: 'cancel' });
  const out = await drop(env);
  assert.equal(seen.asks.length, 1);
  assert.equal(seen.asks[0].fit.n, '2');
  assert.equal(seen.asks[0].wait.n, '2');
  assert.equal(out.key, null);
  assert.equal(store.size, 0);
  assert.equal(server.s.jobs + server.s.created, 0);
  assert.deepEqual(seen.logs.filter(([n]) => n === 'import_preflight').map(([, a]) => a), ['view', 'cancel']);
});

test('bring what fits: the rest waits, held for a checkout, and comes in by itself when room appears', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const { env, store, seen } = fakeEnv({ server, answer: 'fit' });
  const out = await drop(env);
  await until(() => store.get(out.key)?.snap?.status === 'waiting');
  await until(() => seen.holds.length === 1);
  assert.deepEqual([seen.holds[0].limit, seen.holds[0].count, seen.holds[0].boardId], ['cards', 2, 'target']);
  assert.equal(seen.wakes.size, 1, 'watching for room');
  assert.equal(store.get(out.key).plan, 'free');

  for (const fn of seen.polls) fn();   // a poll with no room yet changes nothing
  await flush();
  assert.equal(store.get(out.key).snap.status, 'waiting');

  server.s.cardsLeft = 10;            // they made room
  pokeImport(out.key);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  assert.equal(server.s.appended, 4);
  assert.deepEqual(seen.unholds, ['held-1'], 'the hold goes once it is not waiting');
  assert.equal(seen.wakes.size + seen.polls.size, 0, 'and the watch stops');
});

test('buying from the question: held FIRST (so checkout opens in a new tab), then the offer; what fits comes in meanwhile', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const { env, store, seen } = fakeEnv({ server, answer: 'all' });
  const out = await drop(env);
  assert.equal(seen.upgrades.length, 1);
  const [offer, stoppedBy, holdsBefore] = seen.upgrades[0];
  assert.deepEqual([offer, stoppedBy], ['trial', 'cards']);
  assert.equal(holdsBefore, 1, 'the hold existed before the offer opened');
  await until(() => store.get(out.key)?.snap?.status === 'waiting');
  assert.equal(seen.holds.length, 1, 'one hold, not one per wait');
  assert.deepEqual(seen.logs.filter(([n]) => n === 'import_preflight').map(([, a]) => a), ['view', 'upgrade']);
});

test('someone else\'s workspace: never held (nothing they buy makes room there)', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const { env, store, seen } = fakeEnv({ server, answer: 'fit', who: { own: false, plan: 'free', trialOffer: false } });
  const out = await drop(env);
  await until(() => store.get(out.key)?.snap?.status === 'waiting');
  await flush(); await flush();
  assert.equal(seen.holds.length, 0);
  assert.equal(seen.asks[0].offerKind, null);
});

test('Cancel while reading: nothing is planned or made', async () => {
  const { env, store, server } = fakeEnv();
  let release;
  env.walk = (entries, { signal }) => new Promise((resolve) => { release = () => resolve(walked()); signal.addEventListener('abort', () => resolve(walked())); });
  const p = drop(env);
  await flush();
  const key = [...store.keys()][0];
  store.get(key).act('cancel');
  const out = await p;
  assert.deepEqual(out, { loose: [], key: null });
  assert.equal(store.size, 0);
  assert.equal(server.s.jobs, 0);
  void release;
});

test('two drops take turns: the second is asked only once the first has stopped running', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const order = [];
  const { env, store } = fakeEnv({ server, answer: (m) => { order.push(m.title); return 'fit'; } });
  let gate;
  const slow = new Promise((r) => { gate = r; });
  const upload = server.deps.upload;
  server.deps.upload = async (...a) => { await slow; return upload(...a); };
  const first = drop(env, { top: 'Night' });
  const second = drop(env, { top: 'Day' });
  await first;
  await flush();
  assert.deepEqual(order, ['Night'], 'Day waits its turn while Night runs');
  const dayKey = [...store.entries()].find(([, e]) => e.title === 'Day')?.[0];
  assert.equal(store.get(dayKey).phase, 'queued');
  gate();
  await second;
  assert.deepEqual(order, ['Night', 'Day']);
});

test('Cancel on a queued import leaves the tray at once and never asks', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const order = [];
  const { env, store } = fakeEnv({ server, answer: (m) => { order.push(m.title); return 'fit'; } });
  let gate;
  const slow = new Promise((r) => { gate = r; });
  const upload = server.deps.upload;
  server.deps.upload = async (...a) => { await slow; return upload(...a); };
  await drop(env, { top: 'Night' });
  const second = drop(env, { top: 'Day' });
  await flush(); await flush();
  const dayKey = [...store.entries()].find(([, e]) => e.title === 'Day')?.[0];
  store.get(dayKey).act('cancel');
  assert.equal(store.has(dayKey), false, 'gone from the tray before the import ahead finishes');
  gate();
  const out = await second;
  assert.equal(out.key, null);
  assert.deepEqual(order, ['Night'], 'Day was never asked about');
});

test('Cancel while the room is being read: the entry stays gone and nothing runs', async () => {
  const { env, store, seen, server } = fakeEnv();
  let gate;
  const slow = new Promise((r) => { gate = r; });
  const budgets = server.deps.budgets;
  server.deps.budgets = async () => { await slow; return budgets(); };
  const p = drop(env);
  await until(() => store.get([...store.keys()][0])?.phase === 'queued');
  await flush(); await flush();
  const key = [...store.keys()][0];
  store.get(key).act('cancel');
  gate();
  const out = await p;
  assert.equal(out.key, null);
  assert.equal(store.size, 0, 'not put back');
  assert.equal(seen.asks.length + server.s.jobs, 0, 'never asked, never made');
});

test('a wait that found room before the plan was re-read is not held', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const { env, store, seen } = fakeEnv({ server, answer: 'fit' });
  let gate;
  const slow = new Promise((r) => { gate = r; });
  let calls = 0;
  const who = env.who;
  env.who = async (...a) => { if (++calls > 1) await slow; return who(...a); };
  const out = await drop(env);
  await until(() => store.get(out.key)?.snap?.status === 'waiting');
  server.s.cardsLeft = 10;
  pokeImport(out.key);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  gate();
  await flush(); await flush();
  assert.equal(seen.holds.length, 0, 'done before the hold would have gone in');
});

test('Close on a finished import lets the job go: a late poke finds nothing', async () => {
  const { env, store } = fakeEnv();
  const out = await drop(env);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  store.get(out.key).act('close');
  assert.equal(store.has(out.key), false);
  pokeImport(out.key);   // the controller is gone: nothing throws, nothing comes back
  await flush();
  assert.equal(store.has(out.key), false);
});

test('Remove: the job stops, its clusters go to the trash (App\'s undo), and the entry stays gone', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const { env, store, seen } = fakeEnv({ server, answer: 'fit' });
  const out = await drop(env);
  await until(() => store.get(out.key)?.snap?.status === 'waiting');
  await store.get(out.key).act('remove');
  await flush();
  assert.equal(store.has(out.key), false);
  assert.equal(seen.removed.length, 1);
  assert.equal(seen.removed[0].title, 'Night');
  assert.equal(seen.removed[0].topIds.length, 1, 'the top cluster; its subfolders go with it');
  await flush(); await flush();
  assert.equal(store.has(out.key), false, 'a late snapshot does not bring it back');
});

// ── Zips ────────────────────────────────────────────────────────────────────
const nightZip = () => storedZip([{ path: 'Night/a.jpg', bytes: 'a' }, { path: 'Night/Stills/c.jpg', bytes: 'c' }], 'Night.zip');
const photo = () => new File(['p'], 'p.jpg', { type: 'image/jpeg' });
const dropFiles = (env, files, over = {}) => startBulkImport({ files, boardId: 'target', canAttemptFiles: true, source: 'drop', ...over }, env);

test('a dropped zip is asked about; Unpack makes its folders the tree and the photo beside it goes the ordinary way', async () => {
  const { env, store, seen, server } = fakeEnv({ zipAnswer: 'unpack' });
  const out = await dropFiles(env, [photo(), nightZip()]);
  assert.equal(seen.zipAsks.length, 1);
  assert.equal(seen.zipAsks[0].title, 'Unpack this into clusters?');
  assert.deepEqual(out.loose.map((f) => f.name), ['p.jpg']);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  assert.equal(server.s.appended, 2, 'a.jpg and Stills/c.jpg, read out of the zip');
  assert.deepEqual([store.get(out.key).title, store.get(out.key).source, store.get(out.key).zips], ['Night', 'zip', 1]);
  assert.equal(seen.deps.kind, 'zip');
  assert.deepEqual(seen.deps.sourceRef.zips, ['Night.zip']);
  assert.deepEqual(seen.logs.filter(([n]) => n === 'import_job').map(([, p]) => p).slice(0, 1), ['zip_question']);
});

test('Add as zip files: nothing is read and no tray appears; the zips come back to be added as they are', async () => {
  const { env, store, seen } = fakeEnv({ zipAnswer: 'keep' });
  const out = await dropFiles(env, [nightZip(), photo()]);
  assert.equal(out.key, null);
  assert.deepEqual(out.loose.map((f) => f.name).sort(), ['Night.zip', 'p.jpg']);
  assert.equal(store.size + seen.puts.length, 0);
});

test('Escape on the zip question lets go of the whole drop', async () => {
  const { env, store } = fakeEnv({ zipAnswer: 'cancel' });
  const out = await dropFiles(env, [nightZip(), photo()]);
  assert.deepEqual(out, { loose: [], key: null });
  assert.equal(store.size, 0);
});

test('picked as a zip to unpack: no question', async () => {
  const { env, store, seen, server } = fakeEnv();
  const out = await startBulkImport({ zips: [nightZip()], askZips: false, boardId: 'target', canAttemptFiles: true, source: 'zip' }, env);
  assert.equal(seen.zipAsks.length, 0);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  assert.equal(server.s.appended, 2);
});

test('a ".zip" that isn\'t one is added as a file, and the real one still comes in', async () => {
  const { env, store, server } = fakeEnv();
  const fake = new File(['only words'], 'Notes.zip', { type: 'application/zip' });
  const out = await dropFiles(env, [fake, nightZip()]);
  assert.deepEqual(out.loose.map((f) => f.name), ['Notes.zip']);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  assert.equal(server.s.appended, 2);
});

test('a folder and a zip in one drop: one import, side by side', async () => {
  const { env, store, server } = fakeEnv();
  const out = await startBulkImport({ entries: [{ name: 'Day', walked: walked('Day') }], files: [nightZip()], boardId: 'target', canAttemptFiles: true, source: 'drop' }, env);
  assert.deepEqual(out.loose.map((f) => f.name), ['loose.jpg']);
  await until(() => store.get(out.key)?.snap?.status === 'done');
  assert.equal(store.get(out.key).title, '2 folders');
  assert.equal(store.get(out.key).source, 'folder');
  assert.equal(server.s.appended, 6, 'four from the folder, two from the zip');
});

// ── An import a reload stopped (lib/importResume.js) ───────────────────────
// The resume side of App's env, over the same store.
function withResume({ env, store, seen }, { seed = null, jobs = [], live = () => true, handles = {} } = {}) {
  Object.assign(seen, { seeds: [], locks: [], unlocks: [], saved: new Map(), savedLog: [], dropped: [], statuses: [], pruned: null });
  Object.assign(env, {
    stoppedFor: ({ boardId, tops }) => {
      const e = matchStopped([...store.entries()].map(([key, v]) => ({ key, ...v })), { boardId, tops });
      return e ? { jobId: e.stopped.jobId, key: e.key } : null;
    },
    loadSeed: async (jobId) => { seen.seeds.push(jobId); return { jobId, created: [], landed: [], cardIds: [], ...seed }; },
    lock: (jobId) => { seen.locks.push(jobId); return () => seen.unlocks.push(jobId); },
    saveHandles: async (jobId, record) => { seen.saved.set(jobId, record); seen.savedLog.push([jobId, record]); return true; },
    loadHandles: async (jobId) => handles[jobId] || null,
    dropHandles: (jobId) => { seen.dropped.push(jobId); seen.saved.delete(jobId); },
    pruneHandles: (ids) => { seen.pruned = ids; },
    findStopped: async () => jobs,
    isLive: live,
    has: (key) => store.has(key),
    setJobStatus: async (jobId, status) => { seen.statuses.push([jobId, status]); },
  });
  return env;
}
// What the ledger of a stopped Night import says: both clusters made, a in, b started.
const SEED = { created: [['Night', 'bN'], ['Night/Stills', 'bS']], landed: ['Night/a.jpg'], cardIds: [['Night/b.jpg', 'c-old']] };
const STOPPED_JOB = {
  id: 'job-9', target_board_id: 'target', source: 'folder', source_ref: { tops: ['Night'] }, status: 'running',
  totals: { files: 4 }, done: { files: 1 }, root_board_ids: ['bN'],
};
const recordUploads = (server) => {
  const ids = [];
  const upload = server.deps.upload;
  server.deps.upload = async (item, f, o) => { ids.push([item.file.relPath, o.cardId]); return upload(item, f, o); };
  return ids;
};

test('the same folders dropped again on the same cluster go on with the stopped import: no question, what landed skipped', async () => {
  const server = fakeServer({ cardsLeft: 2 });
  const ctx = fakeEnv({ server, answer: 'fit' });
  const { env, store, seen } = withResume(ctx, { seed: SEED }) && ctx;
  const ids = recordUploads(server);
  store.set('stopped-job-9', { phase: 'stopped', stopped: { jobId: 'job-9', targetBoardId: 'target', tops: ['Night'] } });
  const out = await drop(env);
  await until(() => store.get(out.key)?.snap?.status === 'waiting');
  assert.equal(seen.asks.length, 0, 'asked when it began, not again');
  assert.deepEqual(seen.seeds, ['job-9']);
  assert.equal(store.has('stopped-job-9'), false, 'its stopped entry made way');
  assert.equal(store.get(out.key).snap.id, 'job-9');
  assert.equal(server.s.jobs, 0, 'no second job');
  assert.equal(server.s.created, 0, 'no second set of clusters');
  assert.deepEqual(ids, [['Night/b.jpg', 'c-old'], ['Night/Stills/c.jpg', 'c-Night/Stills/c.jpg']], 'a skipped; b under the card it already has');
  assert.ok(seen.logs.some(([n, p]) => n === 'import_job' && p === 'restart'));

  const other = fakeEnv();
  withResume(other, { seed: SEED });
  other.store.set('stopped-job-9', { phase: 'stopped', stopped: { jobId: 'job-9', targetBoardId: 'target', tops: ['Night'] } });
  await drop(other.env, { boardId: 'elsewhere' });
  assert.deepEqual(other.seen.seeds, [], 'on another cluster it is a new import');
  assert.equal(other.store.has('stopped-job-9'), true);
});

const dirHandle = (name, answer = 'granted') => ({
  kind: 'directory', name, asked: 0,
  queryPermission: async () => 'prompt',
  async requestPermission() { this.asked++; return answer; },
  values() { return { next: async () => ({ done: true }) }; },
});

test('a stopped import is offered once; Resume asks to read its folder inside the click, then goes on from its ledger', async () => {
  const server = fakeServer();
  const ctx = fakeEnv({ server });
  const night = dirHandle('Night');
  withResume(ctx, { seed: SEED, jobs: [STOPPED_JOB], handles: { 'job-9': { kind: 'folder', handles: [night] } } });
  const { env, store, seen } = ctx;
  let walkedFrom = null;
  env.walk = async (entries, { onProgress }) => { walkedFrom = entries; onProgress?.({ files: 5, clusters: 2 }); return walked(); };
  await offerStopped(env);
  await offerStopped(env);
  const offered = [...store.entries()].filter(([, e]) => e.phase === 'stopped');
  assert.equal(offered.length, 1, 'one entry a job');
  const [key, entry] = offered[0];
  assert.deepEqual([entry.title, entry.canResume, entry.landed, entry.total, entry.targetName], ['Night', true, 1, 4, 'Studio']);

  await entry.act('resume');
  assert.equal(night.asked, 1, 'the browser was asked, once');
  assert.deepEqual([walkedFrom[0].name, walkedFrom[0].isDirectory], ['Night', true], 'the kept handle walks like a drop');
  assert.equal(store.has(key), false);
  await until(() => [...store.values()].some((e) => e.snap?.id === 'job-9' && e.snap.status === 'done'));
  assert.equal(seen.asks.length, 0);
  assert.equal(server.s.jobs, 0);
  assert.ok(seen.logs.some(([n, p]) => n === 'import_job' && p === 'restart'));
  assert.deepEqual(seen.unlocks, ['job-9'], 'held while it ran, let go when done');
  assert.ok(seen.dropped.includes('job-9'), 'finished: nothing kept to go on with');

  const refused = fakeEnv();
  withResume(refused, { jobs: [STOPPED_JOB], handles: { 'job-9': { kind: 'folder', handles: [dirHandle('Night', 'denied')] } } });
  await offerStopped(refused.env);
  await refused.store.get('stopped-job-9').act('resume');
  assert.deepEqual(refused.seen.seeds, []);
  assert.equal(refused.store.has('stopped-job-9'), true, 'still offered: it can be dropped again');
  assert.match(refused.seen.toasts[0].message, /Drop it on Studio again/);
});

test('offerStopped: none for a job whose clusters are gone; Remove ends the job and takes what came in to the trash', async () => {
  const ctx = fakeEnv();
  withResume(ctx, { jobs: [STOPPED_JOB, { ...STOPPED_JOB, id: 'job-gone', root_board_ids: ['trashed'] }], live: (id) => id !== 'trashed' });
  const { env, store, seen } = ctx;
  assert.deepEqual(await offerStopped(env), ['stopped-job-9'], 'what it put up, for the workspace to take back');
  assert.deepEqual([...store.keys()], ['stopped-job-9']);
  assert.deepEqual(seen.pruned, ['job-9'], 'what other jobs kept in this browser is let go');
  const entry = store.get('stopped-job-9');
  assert.equal(entry.canResume, false, 'nothing kept here: drop it again');
  await entry.act('remove');
  assert.equal(store.has('stopped-job-9'), false);
  assert.deepEqual(seen.statuses, [['job-9', 'cancelled']]);
  assert.deepEqual(seen.dropped, ['job-9']);
  assert.deepEqual(seen.removed, [{ topIds: ['bN'], title: 'Night' }]);

  const left = fakeEnv();
  withResume(left, { jobs: [STOPPED_JOB] });
  const ctl = new AbortController();
  ctl.abort();
  assert.deepEqual(await offerStopped(left.env, { signal: ctl.signal }), [], 'a workspace already gone puts nothing up');
  assert.equal(left.store.size, 0);
});

test('a new import keeps the folder it was dropped from once it has an id, holds its lock while it runs, and lets both go when done', async () => {
  const server = fakeServer();
  const ctx = fakeEnv({ server });
  withResume(ctx);
  const { env, store, seen } = ctx;
  const upload = server.deps.upload;
  // Nothing uploads until it is kept: kept while it runs, not after.
  server.deps.upload = async (...a) => { await until(() => seen.savedLog.length > 0); return upload(...a); };
  const out = await drop(env, { handles: [Promise.resolve({ kind: 'directory', name: 'Night' }), Promise.resolve({ kind: 'file', name: 'loose.jpg' }), Promise.resolve(null)] });
  await until(() => store.get(out.key)?.snap?.status === 'done');
  assert.deepEqual(seen.savedLog, [['job-1', { kind: 'folder', handles: [{ kind: 'directory', name: 'Night' }] }]], 'its folder, not the photo beside it');
  assert.deepEqual(seen.locks, ['job-1']);
  assert.deepEqual(seen.unlocks, ['job-1']);
  assert.equal(seen.saved.has('job-1'), false, 'finished: nothing kept to go on with');
});
