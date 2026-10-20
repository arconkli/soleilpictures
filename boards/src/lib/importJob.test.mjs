// importJob.test.mjs — the bulk import runner against a fake server: a card
// cap that refuses whole batches, a drive that fills, files that fail, a room
// that blinks, a reload, and a cancel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImportJob, pendingCard, finishFields, spotFor } from './importJob.js';
import { planBulk } from './importPlan.js';

const file = (relPath, size = 10) => ({
  name: relPath.split('/').pop(), relPath, size, lastModified: 7, type: 'image/jpeg',
  open: async () => ({ name: relPath.split('/').pop() }),
});
const dir = (relPath, files = [], dirs = []) => ({ name: relPath.split('/').pop(), relPath, files, dirs });
// Reading order: Night/a, Night/b, Night/Stills/c, d, e, Wardrobe/f.
const ROOT = { name: null, relPath: '', files: [], dirs: [
  dir('Night', [file('Night/a.jpg'), file('Night/b.jpg')],
    [dir('Night/Stills', [file('Night/Stills/c.jpg'), file('Night/Stills/d.jpg'), file('Night/Stills/e.jpg')])]),
  dir('Wardrobe', [file('Wardrobe/f.jpg')]),
] };
const classify = () => ({ route: 'image', kind: 'image', w: 240, h: 180 });
const planFor = (clusterCost = 0) => planBulk(ROOT, { clusterCost, classify });

function harness({ cap = Infinity, drive = Infinity, failOn = [], flaky = 0, budgets = null, uploadGate = null } = {}) {
  const log = [];
  const boards = new Map();
  const s = { cap, drive, capUsed: 0, driveUsed: 0, flaky, clock: 0, ids: 0 };
  const fails = new Set(failOn);
  const err = (message, extra) => Object.assign(new Error(message), extra);
  const deps = {
    createJob: async () => { log.push(['createJob']); return 'job-1'; },
    budgets: async () => (budgets ? budgets() : { cardsLeft: Infinity, bytesLeft: Infinity }),
    createClusters: async (job, rows) => {
      log.push(['clusters', rows.map((r) => r.key)]);
      for (const r of rows) boards.set(r.id, { key: r.key, parent: r.parent_key, doc: JSON.parse(r.doc), cards: new Map() });
    },
    appendCards: async (boardId, cards) => {
      if (s.flaky > 0) { s.flaky--; throw err('room', { status: 503, code: 'room_unavailable', retry: true }); }
      const b = boards.get(boardId);
      const fresh = cards.filter((c) => !b.cards.has(c.id));
      if (s.capUsed + fresh.length > s.cap) throw err('cap', { status: 402, code: 'limit_reached' });
      s.capUsed += fresh.length;
      for (const c of fresh) b.cards.set(c.id, { ...c });
      log.push(['append', b.key, cards.map((c) => c.id)]);
    },
    upload: async (item, f, { cardId, signal }) => {
      if (uploadGate) await uploadGate(item, signal);
      if (fails.has(item.file.relPath)) throw new Error('could not read the file');
      if (s.driveUsed + item.bytes > s.drive) throw err('over quota', { code: 402 });
      s.driveUsed += item.bytes;
      log.push(['upload', item.file.relPath, cardId]);
      return { src: `r2:${cardId}`, key: cardId, width: 100, height: 50 };
    },
    patchCards: async (boardId, patches) => {
      log.push(['patch', patches.map((p) => p.id)]);
      for (const p of patches) Object.assign(boards.get(boardId).cards.get(p.id), p.fields);
    },
    removeCards: async (boardId, ids) => {
      log.push(['remove', ids]);
      for (const id of ids) { if (boards.get(boardId).cards.delete(id)) s.capUsed--; }
    },
    putItems: async (job, rows) => { log.push(['items', rows.map((r) => `${r.rel_path}:${r.status}`)]); },
    setJob: async (job, fields) => { log.push(['job', fields]); },
    newId: () => `b${++s.ids}`,
    cardId: (item) => `c-${item.file.relPath}`,
    encodeDoc: (cards) => JSON.stringify(cards.map((c) => c.id)),
    now: () => s.clock,
    sleep: async (ms) => { s.clock += ms; },
  };
  const boardByKey = (key) => [...boards.values()].find((b) => b.key === key);
  return { deps, log, boards, s, boardByKey };
}

const at = (log, pred) => log.findIndex(pred);
const uploads = (log) => log.filter((e) => e[0] === 'upload');

test('everything fits: clusters parents first with their subfolder cards; ledger before cards, landed before patch', async () => {
  const h = harness();
  const job = createImportJob({ plan: planFor(0), deps: h.deps, clusterCost: 0, limits: { uploads: 2 } });
  const end = await job.start();
  assert.equal(end.status, 'done');
  assert.deepEqual(end.landed, { files: 6, bytes: 60 });
  assert.deepEqual(h.log.filter((e) => e[0] === 'clusters').map((e) => e[1]), [['Night', 'Night/Stills', 'Wardrobe']]);

  const night = h.boardByKey('Night');
  const stills = h.boardByKey('Night/Stills');
  assert.deepEqual(night.doc, [[...h.boards.entries()].find(([, b]) => b.key === 'Night/Stills')[0]], 'Night is born holding the Stills card');
  assert.deepEqual(stills.doc, []);
  for (const b of h.boards.values()) {
    for (const c of b.cards.values()) {
      assert.equal(c.pending, false);
      assert.equal(c.unplaced, true);
      assert.equal(c.src, `r2:${c.id}`);
      assert.equal(c.fileModified, 7);
    }
  }
  for (const rel of ['Night/a.jpg', 'Night/Stills/e.jpg', 'Wardrobe/f.jpg']) {
    const id = `c-${rel}`;
    const ledgerWaiting = at(h.log, (e) => e[0] === 'items' && e[1].includes(`${rel}:waiting`));
    const append = at(h.log, (e) => e[0] === 'append' && e[2].includes(id));
    const ledgerLanded = at(h.log, (e) => e[0] === 'items' && e[1].includes(`${rel}:landed`));
    const patch = at(h.log, (e) => e[0] === 'patch' && e[1].includes(id));
    assert.ok(ledgerWaiting >= 0 && ledgerWaiting < append, `${rel}: ledger knows the card before it exists`);
    assert.ok(ledgerLanded >= 0 && ledgerLanded < patch, `${rel}: ledger says landed before the patch`);
  }
  assert.deepEqual(h.log.filter((e) => e[0] === 'job').at(-1)[1], { status: 'done' });
});

test('the card cap: a refused batch halves, one refused card waits, and release() picks up exactly there', async () => {
  const h = harness({ cap: 3 });
  const job = createImportJob({ plan: planFor(0), deps: h.deps, clusterCost: 0, limits: { uploads: 1 } });
  const mid = await job.start();
  assert.equal(mid.status, 'waiting');
  assert.equal(mid.waitingReason, 'cards');
  assert.equal(mid.landed.files, 3, 'a, b, then c alone after Stills halved to one');
  assert.equal(mid.waiting.files, 3);
  assert.deepEqual(uploads(h.log).map((e) => e[1]), ['Night/a.jpg', 'Night/b.jpg', 'Night/Stills/c.jpg']);

  h.s.cap = Infinity;
  const end = await job.release();
  assert.equal(end.status, 'done');
  assert.equal(end.landed.files, 6);
  assert.equal(uploads(h.log).length, 6, 'nothing uploads twice');
  assert.equal(h.boardByKey('Night/Stills').cards.size, 3);
});

test('a full drive waits with its pending cards kept; release() brings them in under the same ids', async () => {
  const h = harness({ drive: 25 });
  const job = createImportJob({ plan: planFor(0), deps: h.deps, clusterCost: 0, limits: { uploads: 1 } });
  const mid = await job.start();
  assert.equal(mid.status, 'waiting');
  assert.equal(mid.waitingReason, 'storage');
  assert.equal(mid.landed.files, 2);
  const stills = h.boardByKey('Night/Stills');
  assert.equal(stills.cards.size, 3, 'the Stills cards stay, pending');
  assert.ok([...stills.cards.values()].every((c) => c.pending === true));

  h.s.drive = Infinity;
  const end = await job.release();
  assert.equal(end.status, 'done');
  assert.equal(stills.cards.size, 3, 're-adding them made no second set');
  assert.ok([...stills.cards.values()].every((c) => c.pending === false));
  assert.equal(h.log.filter((e) => e[0] === 'remove').length, 0);
  assert.deepEqual(uploads(h.log).map((e) => e[2]).slice(2, 5),
    ['c-Night/Stills/c.jpg', 'c-Night/Stills/d.jpg', 'c-Night/Stills/e.jpg']);
});

test('a file that fails is recorded with its path and its card removed; the rest still land', async () => {
  const h = harness({ failOn: ['Night/b.jpg'] });
  const end = await createImportJob({ plan: planFor(0), deps: h.deps, clusterCost: 0 }).start();
  assert.equal(end.status, 'done');
  assert.equal(end.landed.files, 5);
  assert.deepEqual(end.failed.map((f) => f.relPath), ['Night/b.jpg']);
  assert.ok(h.log.some((e) => e[0] === 'items' && e[1].includes('Night/b.jpg:failed')));
  assert.ok(h.log.some((e) => e[0] === 'remove' && e[1].includes('c-Night/b.jpg')));
  assert.deepEqual([...h.boardByKey('Night').cards.keys()], ['c-Night/a.jpg']);
});

test('clusterCost 1 makes only the clusters what fits pays for, and the rest after release()', async () => {
  let calls = 0;
  const h = harness({ budgets: () => (calls++ === 0 ? { cardsLeft: 4 } : { cardsLeft: null }) });
  const job = createImportJob({ plan: planFor(1), deps: h.deps, clusterCost: 1 });
  const mid = await job.start();
  assert.equal(mid.status, 'waiting');
  assert.equal(mid.waitingReason, 'cards', 'the planner stopped on cards: Stills would cost 2 with 1 left');
  assert.equal(mid.landed.files, 2);
  assert.deepEqual(h.log.filter((e) => e[0] === 'clusters').map((e) => e[1]), [['Night']]);

  const end = await job.release();
  assert.equal(end.status, 'done');
  assert.deepEqual(h.log.filter((e) => e[0] === 'clusters').map((e) => e[1]), [['Night'], ['Night/Stills', 'Wardrobe']]);
  assert.equal(h.boardByKey('Night/Stills').parent, 'Night');
  assert.deepEqual(h.boardByKey('Night').doc, [], 'made in an earlier round: its Stills card comes from the reconcile');
});

test('resuming from the ledger skips what landed and reuses its clusters and card ids', async () => {
  const h = harness();
  for (const [key, id] of [['Night', 'bN'], ['Night/Stills', 'bS'], ['Wardrobe', 'bW']]) {
    h.boards.set(id, { key, parent: null, doc: [], cards: new Map() });
  }
  h.boards.get('bS').cards.set('c-old', { id: 'c-old', pending: true });
  const job = createImportJob({
    plan: planFor(0), deps: h.deps, clusterCost: 0,
    seed: {
      jobId: 'job-9',
      created: [['Night', 'bN'], ['Night/Stills', 'bS'], ['Wardrobe', 'bW']],
      landed: ['Night/a.jpg', 'Night/b.jpg'],
      cardIds: [['Night/Stills/c.jpg', 'c-old']],
    },
  });
  assert.deepEqual(job.state.landed, { files: 2, bytes: 20 });
  const end = await job.start();
  assert.equal(end.status, 'done');
  assert.equal(end.landed.files, 6);
  assert.equal(h.log.filter((e) => e[0] === 'createJob' || e[0] === 'clusters').length, 0);
  assert.deepEqual(uploads(h.log).map((e) => e[1]), ['Night/Stills/c.jpg', 'Night/Stills/d.jpg', 'Night/Stills/e.jpg', 'Wardrobe/f.jpg']);
  assert.equal(uploads(h.log)[0][2], 'c-old');
  assert.equal(h.boards.get('bS').cards.get('c-old').pending, false);
  assert.equal(h.boards.get('bS').cards.size, 3);
});

test('cancel mid-upload aborts it, removes the batch\'s pending cards and says cancelled', async () => {
  let reached;
  const started = new Promise((r) => { reached = r; });
  const h = harness({
    uploadGate: (item, signal) => new Promise((resolve, reject) => {
      if (item.file.relPath !== 'Night/Stills/c.jpg') return resolve();
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      reached();
    }),
  });
  const job = createImportJob({ plan: planFor(0), deps: h.deps, clusterCost: 0, limits: { uploads: 1 } });
  const run = job.start();
  await started;
  await job.cancel();
  const end = await run;
  assert.equal(end.status, 'cancelled');
  assert.equal(h.boardByKey('Night/Stills').cards.size, 0, 'c, d and e are taken back off');
  assert.equal(h.boardByKey('Night').cards.size, 2, 'what landed stays');
  assert.deepEqual(h.log.filter((e) => e[0] === 'job').at(-1)[1], { status: 'cancelled' });
});

test('a room that is briefly down is retried with a backoff', async () => {
  const h = harness({ flaky: 1 });
  const end = await createImportJob({ plan: planFor(0), deps: h.deps, clusterCost: 0 }).start();
  assert.equal(end.status, 'done');
  assert.ok(h.s.clock >= 1000);
});

test('pendingCard and finishFields: the Files fields while it comes in, then the finished ones', () => {
  const at0 = { x: 80, y: 80 };
  const img = pendingCard({ route: 'image', kind: 'image', w: 240, h: 180, file: file('A/IMG_1.jpg') }, 'c1', at0);
  assert.equal(img.kind, 'image');
  assert.equal(img.pending, true);
  assert.equal(img.unplaced, true);
  assert.equal(img.fileModified, 7);
  const audio = pendingCard({ route: 'audio', kind: 'audio', w: 280, h: 96,
    file: { name: 'Loop 120bpm.WAV', size: 5, type: 'audio/wav', lastModified: 1 } }, 'c2', at0);
  assert.equal(audio.title, 'Loop 120bpm.WAV');
  assert.equal(audio.ext, 'wav');
  const doc = pendingCard({ route: 'file', kind: 'file', w: 200, h: 100,
    file: { name: 'notes.key', size: 9, type: '', lastModified: 1 } }, 'c3', at0);
  assert.deepEqual([doc.fileName, doc.sizeBytes, doc.ext], ['notes.key', 9, 'key']);

  const fields = finishFields({ route: 'image', kind: 'image', w: 240, h: 180, file: file('A/IMG_1.jpg') },
    { src: 'r2:k', key: 'k', width: 1000, height: 500 }, 'c1');
  assert.equal(fields.pending, false);
  assert.equal(fields.src, 'r2:k');
  assert.ok(!('x' in fields) && !('id' in fields) && !('kind' in fields));
});

test('spotFor puts file cards in a grid under the cluster cards', () => {
  assert.deepEqual(spotFor([], 0), { x: 80, y: 80 });
  assert.deepEqual(spotFor([{ x: 80, y: 80, w: 280, h: 220 }], 9), { x: 80 + 264, y: 324 + 264 });
});
