// importDeps.test.mjs — the real deps behind importJob, against fake clients.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { encodeClusterDoc, makeImportDeps } from './importDeps.js';
import { buildClusterCards } from './folderImport.js';

function fakeSupabase({ rpcError = null, writeError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => { calls.push(['rpc', fn, args]); return { data: rpcError ? null : 3, error: rpcError }; },
    from: (table) => ({
      insert: async (row) => { calls.push(['insert', table, row]); return { error: writeError }; },
      update: (fields) => ({ eq: async (col, val) => { calls.push(['update', table, fields, col, val]); return { error: writeError }; } }),
      upsert: async (rows, opts) => { calls.push(['upsert', table, rows, opts]); return { error: writeError }; },
    }),
  };
}

const base = (over = {}) => ({
  supabase: fakeSupabase(), workspaceId: 'ws-1', targetBoardId: 'target-1', userId: 'u-1', source: 'folder',
  sourceRef: { tops: ['Night Shift'] }, budgets: async () => ({}), newId: () => 'new-id',
  clusters: { appendCards: async () => ({ ok: true }), patchCards: async () => ({ ok: true }), removeCards: async () => ({ ok: true }) },
  uploads: {}, ...over,
});

test('encodeClusterDoc: a new cluster\'s first doc holds its cluster cards, as the room decodes it', () => {
  const cards = buildClusterCards(['child-a', 'child-b'], []);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(Buffer.from(encodeClusterDoc(cards), 'base64')));
  const m = doc.getMap('cards');
  assert.deepEqual([...m.keys()].sort(), ['child-a', 'child-b']);
  assert.equal(m.get('child-a').get('kind'), 'board');
  assert.equal(m.get('child-b').get('x'), cards[1].x);
  assert.equal(encodeClusterDoc([]), 'AAA=', 'an empty doc is the migration\'s default');
});

test('createJob makes its own id and writes the import row; setJob updates it', async () => {
  const supabase = fakeSupabase();
  const deps = makeImportDeps(base({ supabase }));
  assert.equal(await deps.createJob({ totals: { files: 3 } }), 'new-id');
  assert.deepEqual(supabase.calls[0], ['insert', 'import_jobs', {
    id: 'new-id', workspace_id: 'ws-1', target_board_id: 'target-1', source: 'folder',
    source_ref: { tops: ['Night Shift'] }, totals: { files: 3 },
  }]);
  await deps.setJob('new-id', { status: 'waiting', waiting_reason: 'cards' });
  assert.deepEqual(supabase.calls[1], ['update', 'import_jobs', { status: 'waiting', waiting_reason: 'cards' }, 'id', 'new-id']);
});

test('the RPCs get their p_ arguments, and a database refusal throws without retry', async () => {
  const supabase = fakeSupabase();
  const deps = makeImportDeps(base({ supabase }));
  await deps.createClusters('j', [{ key: 'A' }]);
  await deps.putItems('j', [{ rel_path: 'A/a.jpg', status: 'landed' }]);
  assert.deepEqual(supabase.calls.map((c) => [c[1], Object.keys(c[2])]), [
    ['import_create_clusters', ['p_job', 'p_rows']], ['import_items_put', ['p_job', 'p_items']],
  ]);
  const refused = makeImportDeps(base({ supabase: fakeSupabase({ rpcError: { code: '22023', message: 'parent first' } }) }));
  await assert.rejects(refused.createClusters('j', []), (e) => e.code === '22023' && e.retry === false);
  const offline = makeImportDeps(base({ supabase: fakeSupabase({ rpcError: { message: 'TypeError: Failed to fetch' } }) }));
  await assert.rejects(offline.putItems('j', []), (e) => e.retry === true);
});

test('a route\'s refusal throws with its status and code: the cap, a room that is down', async () => {
  const deps = makeImportDeps(base({ clusters: {
    appendCards: async () => ({ ok: false, status: 402, error: 'limit_reached', message: 'that would go past the card limit' }),
    patchCards: async () => ({ ok: false, status: 503, error: 'room_unavailable', retry: true }),
    removeCards: async ({ cardIds }) => ({ ok: true, removed: cardIds }),
  } }));
  await assert.rejects(deps.appendCards('b', []), (e) => e.status === 402 && e.code === 'limit_reached' && !e.retry);
  await assert.rejects(deps.patchCards('b', []), (e) => e.status === 503 && e.retry === true);
  assert.deepEqual((await deps.removeCards('b', ['c1'])).removed, ['c1']);
});

test('upload goes to the same function the folder drop uses, with the same arguments', async () => {
  const seen = [];
  const rec = (name) => async (opts) => { seen.push([name, opts]); return { src: 'r2:k' }; };
  const uploads = { uploadImage: rec('image'), uploadVideo: rec('video'), uploadAudio: rec('audio'), uploadPdf: rec('pdf'), uploadFile: rec('file') };
  const deps = makeImportDeps(base({ uploads, canAttemptFiles: true }));
  const signal = new AbortController().signal;
  const f = { name: 'IMG_1.jpg', size: 3, type: 'image/jpeg' };
  for (const route of ['image', 'video', 'audio', 'pdf', 'largeMedia', 'file']) {
    await deps.upload({ route, file: f }, f, { boardId: 'b', cardId: 'c', signal, onProgress: null });
  }
  assert.deepEqual(seen.map((s) => s[0]), ['image', 'video', 'audio', 'pdf', 'file', 'file']);
  assert.equal(seen[0][1].workspaceId, 'ws-1');
  assert.equal(seen[0][1].cardId, 'c');
  assert.equal(seen[0][1].userId, 'u-1');
  assert.equal(seen[1][1].maxDurationSec, Number.POSITIVE_INFINITY, 'a paid owner\'s video has no length cap');
  assert.equal(seen[4][1].signal, signal, 'the multipart upload can be cancelled');
  assert.equal(seen[0][1].signal, undefined);
});

test('indexClusterCards writes card_index rows for the new clusters\' cluster cards', async () => {
  const supabase = fakeSupabase();
  const deps = makeImportDeps(base({ supabase }));
  await deps.indexClusterCards([{ boardId: 'parent', cards: buildClusterCards(['kid'], []) }]);
  const [, table, rows, opts] = supabase.calls[0];
  assert.equal(table, 'card_index');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].board_id, 'parent');
  assert.equal(rows[0].card_id, 'kid');
  assert.equal(rows[0].kind, 'board');
  assert.deepEqual(opts, { onConflict: 'board_id,card_id' });
});
