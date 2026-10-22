// Text pins on supabase/migrations/0424_shared_with_me.sql and the 0425 fix:
// the Shared page's lists go through the same resolver as the /f/ page, the
// table is closed to clients, the undo of "Stop sharing" never re-invites,
// and the grants are proved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const sql24 = read('0424_shared_with_me.sql');
const sql25 = read('0425_shared_with_me_link_opens.sql');

// The `create or replace function public.x(...) ... as $tag$ ... $tag$;` blocks.
function functionBlocks(src) {
  const out = new Map();
  const head = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi;
  let m;
  while ((m = head.exec(src))) {
    const rest = src.slice(m.index);
    const tag = rest.match(/\bas\s*(\$[a-z_]*\$)/i);
    assert.ok(tag, `${m[1]} has a dollar-quoted body`);
    const open = tag.index + tag[0].length;
    const close = rest.indexOf(tag[1], open);
    assert.ok(close > open, `${m[1]} body is closed`);
    out.set(m[1], { header: rest.slice(0, tag.index), body: rest.slice(open, close) });
  }
  return out;
}
const fns24 = functionBlocks(sql24);
const fns25 = functionBlocks(sql25);
// What the database runs: 0425's definition where it re-emits one.
const fn = (n) => fns25.get(n) || fns24.get(n) || assert.fail(`no definition of ${n}`);
const statements = (src) => src.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');

test('0424 and 0425 have no DROP and no DELETE FROM statement (the MCP refuses them)', () => {
  for (const src of [sql24, sql25]) {
    assert.doesNotMatch(statements(src), /\bdrop\s/i);
    assert.doesNotMatch(statements(src), /\bdelete\s+from\b/i);
  }
});

test('every function is security definer with an empty search_path', () => {
  for (const [name, f] of [...fns24, ...fns25]) {
    assert.match(f.header, /security definer/i, `${name} is security definer`);
    assert.match(f.header, /set search_path = ''/, `${name} pins search_path`);
  }
});

test('file_share_seen is closed to clients; only the RPCs touch it', () => {
  assert.match(sql24, /alter table public\.file_share_seen enable row level security;/);
  assert.match(sql24, /revoke all on table public\.file_share_seen from public, anon, authenticated;/);
  assert.doesNotMatch(sql24, /create policy/i);
});

test('the lists resolve every row the way the /f/ page does', () => {
  const list = fn('list_shared_with_me').body;
  assert.match(list, /v_r := public\._file_share_resolve\(v_row\.token\);/);
  assert.match(list, /public\._file_share_rank\(v_access\) < 1/);
  assert.match(list, /coalesce\(public\.can_read_board\(v_row\.board_id\), false\)/, 'the team finds files in the cluster');
  assert.match(list, /where f\.created_by <> v_uid/, 'not your own shares');
  assert.match(list, /seen\.hidden_at is null/);
  // Invitations made before the account existed count, by confirmed email.
  assert.match(list, /u\.email_confirmed_at is not null/);
  assert.match(list, /where p\.user_id is null and p\.revoked_at is null and p\.email = v_email;/);
  // No keys and no email in a row.
  assert.doesNotMatch(list, /'src'|'poster'|'keys'|'email'/);
  const mine = fn('list_my_file_shares').body;
  assert.match(mine, /v_r := public\._file_share_resolve\(v_f\.token\);/);
  assert.match(mine, /v_r->>'access' <> 'manage'/, 'only what you can still manage');
});

test('opening and hiding record how the file reaches you now (0425)', () => {
  for (const n of ['mark_file_share_opened', 'hide_shared_file']) {
    assert.ok(fns25.has(n), `0425 re-emits ${n}`);
    assert.match(fn(n).body, /source = excluded\.source/);
    assert.match(fn(n).body, /then 'person' else 'link' end;/);
  }
  const mark = fn('mark_file_share_opened').body;
  assert.match(mark, /v_share\.created_by = v_uid/);
  assert.match(mark, /can_read_board\(v_share\.board_id\)/);
  assert.match(mark, /hidden_at = null/, 'opening puts a hidden file back');
  // A guessed token can't plant a row.
  assert.match(fn('hide_shared_file').body, /_file_share_resolve\(p_token\)->>'access', 'none'\)\) < 1/);
});

test('Stop sharing removes everyone at one stamp, and its undo brings back only those rows, silently', () => {
  const stop = fn('stop_file_share').body;
  assert.match(stop, /can_write_board\(p_board\)/);
  assert.match(stop, /set revoked_at = v_at/);
  assert.match(stop, /'stopped_at', v_at/);
  const undo = fn('undo_stop_file_share').body;
  assert.match(undo, /can_write_board\(p_board\)/);
  assert.match(undo, /p\.revoked_at = p_stopped_at/);
  assert.doesNotMatch(undo, /file_share_invite/, 'the invitation trigger needs app.file_share_invite; the undo never sets it');
});

test('posters are keys for the party only, for files the caller can open', () => {
  const p = fn('get_file_share_posters').body;
  assert.match(p, /cardinality\(p_tokens\) > 50/);
  assert.match(p, /_file_share_rank\(v_r->>'access'\) < 1/);
});

test('grants: signed-in only, proved', () => {
  for (const sig of [
    'list_shared_with_me(integer, timestamptz)', 'mark_file_share_opened(uuid)', 'hide_shared_file(uuid, boolean)',
    'list_my_file_shares(integer)', 'stop_file_share(uuid, text)', 'undo_stop_file_share(uuid, text, text, timestamptz)',
    'get_file_share_posters(uuid[])',
  ]) {
    const esc = sig.replace(/[()[\]]/g, '\\$&');
    assert.match(sql24, new RegExp(`revoke all on function public\\.${esc} from public, anon;`));
    assert.match(sql24, new RegExp(`grant execute on function public\\.${esc} to authenticated, service_role;`));
    assert.match(sql24, new RegExp(`'public\\.${esc}'`), `${sig} is in the proof block`);
  }
  assert.match(sql24, /revoke execute on function public\._file_share_person_card\(uuid\) from public, anon, authenticated;/);
  assert.match(sql24, /has_function_privilege\('anon', v_sig, 'execute'\)/);
  assert.match(sql25, /has_function_privilege\('anon', v_sig, 'execute'\)/);
});
