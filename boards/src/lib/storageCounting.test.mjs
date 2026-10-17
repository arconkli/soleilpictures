// storageCounting.test.mjs — what counts toward an owner's storage (0411).
//
//   node --test src/lib/storageCounting.test.mjs
//
// A file counts while it is alive, is an original (never a preview or board
// thumbnail), and either a cluster still uses it or it was uploaded in the
// last day. "Still uses" is read with deleted content dropped
// (supabase/functions/_shared/liveKeys.mjs), because the room saves its Y.Doc
// with garbage collection off and a deleted card's key stays in those bytes.
// These pin each half of that to the code that enforces it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { latestDefinition, MIGRATIONS_DIR, migrationFiles } from './migrationText.mjs';
import { R2_KEY_PATTERN, base64ToBytes, liveKeysFromDoc, r2KeysInBytes } from '../../../supabase/functions/_shared/liveKeys.mjs';

const FUNCTIONS_DIR = new URL('../../../supabase/functions/', import.meta.url).pathname;
const allSql = () => migrationFiles().map((f) => readFileSync(MIGRATIONS_DIR + f, 'utf8')).join('\n');

test('one rule decides what counts, and previews and thumbnails never do', () => {
  const rule = latestDefinition('_image_counts').body;
  assert.match(rule, /p_deleted_at is null/);
  assert.match(rule, /!~ '\/\(previews\|thumbs\)\/'/, 'derived copies are not the owner\'s files');
  assert.match(rule, /\(p_first_ref is null\s+or case when p_live is null then coalesce\(p_ref_count, 0\) > 0\s+else cardinality\(p_live\) > 0 end\)/,
    'a file never placed counts; a placed file counts while a cluster uses it, raw answer until read');
  assert.match(allSql(), /revoke execute on function public\._image_counts\(timestamptz, text, integer, uuid\[\], timestamptz\) from public, anon, authenticated/);
});

test('the rollup applies the rule on insert, delete and update, and an update that changes nothing is free', () => {
  const trg = latestDefinition('storage_usage_trg').body;
  assert.equal((trg.match(/public\._image_counts\(/g) || []).length, 4, 'insert, delete, and both sides of an update');
  assert.match(trg, /and v_old_counts = v_new_counts then\s+return new;/, 'a reference moving between clusters writes nothing');
});

test('an owner\'s used bytes are the rollup, which no longer depends on the clock', () => {
  const used = latestDefinition('_storage_used_bytes').body;
  assert.match(used, /from public\.storage_usage s where s\.owner_id = p_owner/);
  assert.doesNotMatch(used, /interval '24 hours'/, 'an unplaced file counts however old (0412)');
  assert.match(used, /public\._image_counts\(i\.deleted_at, i\.storage_path, i\.ref_count, i\.live_board_ids, i\.first_referenced_at\)/);
  const rec = latestDefinition('reconcile_storage_usage').body;
  assert.equal((rec.match(/public\._image_counts\(/g) || []).length, 2, 'the nightly truth and its zeroing use the same rule');
});

test('a single PUT that never landed stops holding space after an hour', () => {
  const pend = latestDefinition('_storage_pending_bytes').body;
  assert.match(pend, /case when u\.kind = 'multipart' then interval '24 hours'\s+else interval '1 hour' end/);
});

test('the Settings meter reads the owner\'s own quota, the same numbers the gates use', () => {
  const meter = latestDefinition('my_storage_usage').body;
  assert.match(meter, /public\._storage_quota_bytes\(v_uid\)/);
  assert.doesNotMatch(meter, /_storage_quota_bytes\(\)/, 'the no-argument form is the paid drive for everyone');
  assert.match(meter, /public\._storage_used_bytes\(v_uid\) \+ public\._storage_pending_bytes\(v_uid\)/);
});

test('an owner with no room left hears "full" before "too big"', () => {
  const gate = latestDefinition('authorize_upload').body;
  const full = gate.indexOf("'over_quota'::text; return;");
  const big = gate.indexOf("'owner_not_paid'::text; return;");
  assert.ok(full > 0 && big > 0 && full < big, 'the quota answer comes first');
});

test('a transfer moves only the bytes that count', () => {
  const t = latestDefinition('transfer_workspace_ownership').body;
  assert.match(t, /and public\._image_counts\(i\.deleted_at, i\.storage_path, i\.ref_count, i\.live_board_ids, i\.first_referenced_at\);/);
});

test('a purged cluster releases the files it never placed, and only a purged one', () => {
  const sql = allSql();
  assert.match(sql, /create or replace trigger images_release_on_board_purge\s+before update of board_id on public\.images/);
  const rel = latestDefinition('_tg_images_release_on_board_purge').body;
  assert.match(rel, /new\.board_id is null and old\.board_id is not null and new\.first_referenced_at is null\s+and not exists \(select 1 from public\.boards b where b\.id = old\.board_id\)/);
  assert.match(rel, /new\.first_referenced_at := now\(\);/);
});

test('emptying the trash releases a purged cluster\'s references at once, and only a purged one', () => {
  const sql = allSql();
  assert.match(sql, /create or replace trigger board_state_release_refs\s+after delete on public\.board_state/);
  const rel = latestDefinition('_tg_board_state_release_refs').body;
  assert.match(rel, /if exists \(select 1 from public\.boards b where b\.id = old\.board_id\) then\s+return old;/,
    'a writer deleting board_state directly releases nothing');
  assert.match(rel, /array_remove\(i\.referenced_in_board_ids, old\.board_id\)/);
  assert.match(rel, /array_remove\(i\.live_board_ids, old\.board_id\)/);
});

test('the liveness job\'s calls are service-role only, and it runs every minute', () => {
  const sql = allSql();
  for (const sig of ['storage_liveness_due\\(integer, bigint\\)', 'storage_liveness_record\\(uuid, timestamptz, text\\[\\]\\)']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${sig} from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${sig} to service_role`));
  }
  assert.match(sql, /cron\.schedule\('storage-liveness', '\* \* \* \* \*', \$\$select public\._cron_edge_post\('storage-liveness'\)\$\$\)/);
  const rec = latestDefinition('storage_liveness_record').body;
  assert.match(rec, /if p_keys is null then[\s\S]*public\._r2_keys_in_doc\(bs\.doc\)/,
    'a state the job could not decode falls back to the raw scan');
  assert.match(rec, /coalesce\(i\.live_board_ids, i\.referenced_in_board_ids, '\{\}'::uuid\[\]\)/,
    'a cluster not read yet keeps the raw answer');
});

test('the job scans for keys exactly as _r2_keys_in_doc does', () => {
  const scan = latestDefinition('_r2_keys_in_doc').body;
  const m = scan.match(/'(r2:\(\[[^']+\]\{20,\}\))'/);
  assert.ok(m, 'found the SQL pattern');
  assert.equal(m[1].replace(/\\\\/g, '\\'), R2_KEY_PATTERN.replace(/\\\\/g, '\\'));
});

test('the job reads its Yjs at the version the app ships, pinned', () => {
  const src = readFileSync(FUNCTIONS_DIR + 'storage-liveness/index.ts', 'utf8');
  const pinned = src.match(/"npm:yjs@(\d+\.\d+\.\d+)"/);
  assert.ok(pinned, 'yjs is imported at an exact version');
  const installed = JSON.parse(readFileSync(new URL('../../node_modules/yjs/package.json', import.meta.url), 'utf8')).version;
  assert.equal(pinned[1], installed, 'the edge function and the app decode with the same Yjs');
  assert.match(src, /import \{ liveKeysFromDoc \} from "\.\.\/_shared\/liveKeys\.mjs";/);
});

// ── the decode itself ────────────────────────────────────────────────────────

const WS = '11111111-1111-1111-1111-111111111111';
const key = (c, ext) => `${WS}/${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}.${ext}`;
const toB64 = (bytes) => Buffer.from(bytes).toString('base64');

function roomDoc() {
  // As the room keeps it: garbage collection off (y-partykit with persist).
  const doc = new Y.Doc({ gc: false });
  const cards = doc.getMap('cards');
  const put = (id, src) => doc.transact(() => { const c = new Y.Map(); c.set('src', src); cards.set(id, c); }, 'local');
  return { doc, cards, put };
}

test('a deleted card\'s file is in the raw bytes but not in what the cluster uses', () => {
  const { doc, cards, put } = roomDoc();
  put('a', 'r2:' + key('a', 'jpg'));
  put('b', 'r2:' + key('b', 'mp4'));
  doc.transact(() => cards.delete('b'), 'local');
  const raw = Y.encodeStateAsUpdate(doc);
  assert.deepEqual(r2KeysInBytes(raw), [key('a', 'jpg'), key('b', 'mp4')].sort(), 'the raw scan still finds the deleted file');
  assert.deepEqual(liveKeysFromDoc(Y, toB64(raw)), [key('a', 'jpg')], 'only the card still on the cluster counts');
});

test('a replaced value releases the file it replaced', () => {
  const { doc, cards, put } = roomDoc();
  put('a', 'r2:' + key('a', 'jpg'));
  doc.transact(() => cards.get('a').set('src', 'r2:' + key('c', 'png')), 'local');
  assert.deepEqual(liveKeysFromDoc(Y, toB64(Y.encodeStateAsUpdate(doc))), [key('c', 'png')]);
});

test('the decode loses nothing that is live: the state it reads still syncs with the room', () => {
  const { doc, cards, put } = roomDoc();
  put('a', 'r2:' + key('a', 'jpg'));
  put('b', 'r2:' + key('b', 'mp4'));
  doc.transact(() => cards.delete('b'), 'local');
  const raw = Y.encodeStateAsUpdate(doc);
  const fresh = new Y.Doc();
  Y.applyUpdate(fresh, base64ToBytes(toB64(raw)));
  Y.applyUpdate(fresh, raw);
  assert.deepEqual(Object.keys(fresh.getMap('cards').toJSON()), ['a']);
});

test('the key scan matches only plain runs, as the SQL scan does', () => {
  const k = key('d', 'webp');
  const bytes = new Uint8Array([0x01, 0xff, ...Buffer.from('r2:' + k), 0x00, 0x80, ...Buffer.from('r2:short')]);
  assert.deepEqual(r2KeysInBytes(bytes), [k]);
});

test('an empty saved state uses nothing, rather than failing to decode', () => {
  assert.deepEqual(liveKeysFromDoc(Y, ''), []);
  assert.deepEqual(liveKeysFromDoc(Y, null), []);
});
