// importResume.test.mjs — finding a bulk import a reload stopped, telling it
// from one another tab is running, and what its runner starts from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IMPORT_LOCK, lockImport, runningImportIds, findStoppedImports, loadImportSeed, stoppedTitle, matchStopped, askToRead,
  STOPPED_WITHIN_DAYS,
} from './importResume.js';

// navigator.locks, as far as these use it: request() grants at once unless
// the name is held, and query() lists what is held.
function fakeLocks(heldElsewhere = []) {
  const held = new Map(heldElsewhere.map((n) => [n, 'other-tab']));
  return {
    held,
    request: (name, opts, cb) => {
      if (held.has(name)) return Promise.resolve(cb(null));
      held.set(name, 'this-tab');
      return Promise.resolve(cb({ name })).then(() => { held.delete(name); });
    },
    query: async () => ({ held: [...held.keys()].map((name) => ({ name, mode: 'exclusive' })), pending: [] }),
  };
}

// A PostgREST query, as these build one: every filter is recorded, and the
// rows come from `rows(query)` once it is awaited.
function fakeSupabase(rows) {
  const queries = [];
  return {
    queries,
    from(table) {
      const q = { table, filters: [] };
      queries.push(q);
      const chain = {
        select: (cols) => { q.cols = cols; return chain; },
        eq: (c, v) => { q.filters.push(['eq', c, v]); return chain; },
        in: (c, v) => { q.filters.push(['in', c, v]); return chain; },
        gte: (c, v) => { q.filters.push(['gte', c, v]); return chain; },
        order: (c) => { q.order = c; return chain; },
        limit: (n) => { q.limit = n; return chain; },
        range: (a, b) => { q.range = [a, b]; return chain; },
        then: (ok, bad) => Promise.resolve(rows(q)).then(ok, bad),
      };
      return chain;
    },
  };
}

test('lockImport holds the job\'s lock until released; one held elsewhere is never queued for', async () => {
  const locks = fakeLocks();
  const release = lockImport(locks, 'job-1');
  await Promise.resolve();
  assert.deepEqual([...(await runningImportIds(locks))], ['job-1']);
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal((await runningImportIds(locks)).size, 0);

  const busy = fakeLocks([`${IMPORT_LOCK}job-2`]);
  const none = lockImport(busy, 'job-2');
  none();
  assert.equal(busy.held.get(`${IMPORT_LOCK}job-2`), 'other-tab', 'still the other tab\'s');
  assert.doesNotThrow(() => lockImport(null, 'job-3')(), 'no Web Locks: nothing to hold');
});

test('findStoppedImports: unfinished, recent, this workspace, and running in no tab', async () => {
  const sb = fakeSupabase(() => ({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null }));
  const got = await findStoppedImports({ supabase: sb, workspaceId: 'ws-1', locks: fakeLocks([`${IMPORT_LOCK}b`, 'something-else']), now: Date.parse('2026-10-19T12:00:00Z') });
  assert.deepEqual(got.map((j) => j.id), ['a', 'c'], 'b runs in another tab');
  const q = sb.queries[0];
  assert.equal(q.table, 'import_jobs');
  assert.deepEqual(q.filters, [
    ['eq', 'workspace_id', 'ws-1'],
    ['in', 'status', ['running', 'paused', 'waiting', 'failed']],
    ['gte', 'updated_at', '2026-09-19T12:00:00.000Z'],
  ]);
  assert.equal(await findStoppedImports({ supabase: fakeSupabase(() => ({ data: null, error: { message: 'down' } })), workspaceId: 'ws-1' }).then((r) => r.length), 0, 'a failed read finds none');
});

test('loadImportSeed reads the ledger a page at a time: clusters, landed files, every card id', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ rel_path: `Night/${i}.jpg`, status: i < 3 ? 'landed' : i === 3 ? 'waiting' : 'failed', card_id: `c${i}` }));
  const sb = fakeSupabase((q) => {
    const all = q.table === 'import_folders' ? [{ rel_path: 'Night', board_id: 'bN' }] : items;
    return { data: all.slice(q.range[0], q.range[1] + 1), error: null };
  });
  const seed = await loadImportSeed({ supabase: sb, jobId: 'job-1', pageSize: 2 });
  assert.deepEqual(seed, {
    jobId: 'job-1',
    created: [['Night', 'bN']],
    landed: ['Night/0.jpg', 'Night/1.jpg', 'Night/2.jpg'],
    cardIds: items.map((i) => [i.rel_path, i.card_id]),
  });
  assert.equal(sb.queries.filter((q) => q.table === 'import_items').length, 3, 'two full pages, then the short one');

  const broken = fakeSupabase(() => ({ data: null, error: { message: 'permission denied', code: '42501' } }));
  await assert.rejects(loadImportSeed({ supabase: broken, jobId: 'job-1' }), /permission denied/);
});

test('stoppedTitle names it as the running import did', () => {
  assert.equal(stoppedTitle({ tops: ['Night Shift'] }), 'Night Shift');
  assert.equal(stoppedTitle({ tops: ['A', 'B', 'C'] }), '3 folders');
  assert.equal(stoppedTitle({ zips: ['takeout-001.zip'] }), 'takeout-001');
  assert.equal(stoppedTitle({}), 'Import');
});

test('matchStopped: the same folders, in any order, on the same cluster', () => {
  const entries = [
    { key: 'k1', phase: 'job', stopped: null },
    { key: 'k2', phase: 'stopped', stopped: { jobId: 'j2', targetBoardId: 'studio', tops: ['Night', 'Day'] } },
  ];
  assert.equal(matchStopped(entries, { boardId: 'studio', tops: ['Day', 'Night'] })?.key, 'k2');
  assert.equal(matchStopped(entries, { boardId: 'elsewhere', tops: ['Day', 'Night'] }), null);
  assert.equal(matchStopped(entries, { boardId: 'studio', tops: ['Night'] }), null);
  assert.equal(matchStopped(entries, { boardId: 'studio', tops: [] }), null);
});

test('askToRead: asks only what isn\'t granted yet, and stops at the first refusal', async () => {
  const asked = [];
  const handle = (name, now, answer) => ({
    name,
    queryPermission: async () => now,
    requestPermission: async () => { asked.push(name); return answer; },
  });
  assert.equal(await askToRead([handle('a', 'granted'), handle('b', 'prompt', 'granted')]), true);
  assert.deepEqual(asked, ['b']);
  asked.length = 0;
  assert.equal(await askToRead([handle('c', 'prompt', 'denied'), handle('d', 'prompt', 'granted')]), false);
  assert.deepEqual(asked, ['c']);
  assert.equal(await askToRead([{ name: 'safari' }]), false, 'no permission API: drop it again');
  assert.equal(await askToRead([]), false);
});

test('the ledger is purged only after a stopped import stops being offered (0440)', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0440_import_ledger_purge.sql', import.meta.url), 'utf8');
  const m = sql.match(/cron\.schedule\('purge-import-ledger', '[^']+', \$\$select public\.purge_old_import_ledger\((\d+)\)\$\$\)/);
  assert.ok(m, 'the purge job is scheduled in 0440');
  assert.ok(Number(m[1]) > STOPPED_WITHIN_DAYS, `the purge (${m[1]} days) must outlast the offer (${STOPPED_WITHIN_DAYS} days)`);
});
