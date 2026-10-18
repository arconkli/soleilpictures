// Text pins on supabase/migrations/0421_file_shares.sql: the grants, the
// gate and invariant re-emits, the repoint re-emit, and the limits the client
// mirrors in fileShares.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FILE_COMMENT_MAX_CHARS, FILE_COMMENT_BURST, FILE_COMMENT_BURST_MINUTES, FILE_COMMENT_DAILY,
  FILE_SHARE_PEOPLE_PER_CALL, SHAREABLE_KINDS, RISKY_EXTENSIONS, RISKY_MIMES,
} from './fileShares.js';

const SQL_PATH = new URL('../../../supabase/migrations/0421_file_shares.sql', import.meta.url);
const sql = readFileSync(SQL_PATH, 'utf8');

// Every `create or replace function public.x(...) ... as $tag$ ... $tag$;` block.
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
    out.set(m[1], {
      header: rest.slice(0, tag.index),
      body: rest.slice(open, close),
      all: rest.slice(0, close + tag[1].length),
    });
  }
  return out;
}

const fns = functionBlocks(sql);
const REEMITS = new Set(['_outbound_gate', 'check_security_invariants', 'repoint_card_refs']);
const PUBLIC_RPCS = [
  'get_file_share(uuid)',
  'get_file_comments(uuid)',
  'get_file_share_settings(uuid, text)',
  'set_file_share(uuid, text, text, boolean)',
  'add_file_share_people(uuid, text, text[], text)',
  'set_file_share_person(uuid, text, text, text)',
  'add_file_comment(uuid, text, integer, integer, uuid)',
  'resolve_file_comment(uuid, boolean)',
  'delete_file_comment(uuid)',
  'restore_file_comment(uuid)',
];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Statements only: the live _outbound_gate carries the word "drop" inside an
// alert's text ('Release or drop them from the Security tab.'), and a re-emit
// must keep the live text.
const statements = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');

test('0421 has no DROP and no DELETE FROM statement (the MCP refuses them)', () => {
  assert.doesNotMatch(statements, /\bdrop\s/i);
  assert.doesNotMatch(statements, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g, "''"), /\bdelete\s+from\b/i, 'not even in a comment');
});

test('every new function is security definer with an empty search_path', () => {
  assert.ok(fns.size >= 15, 'the blocks were found');
  for (const [name, f] of fns) {
    if (REEMITS.has(name)) continue;
    assert.match(f.header, /security\s+definer/i, `${name} is security definer`);
    assert.match(f.header, /set\s+search_path\s*=\s*''/i, `${name} sets search_path = ''`);
  }
});

test('the re-emits keep their live search_path', () => {
  assert.match(fns.get('_outbound_gate').header, /set search_path = public, auth\s*$/);
  assert.match(fns.get('check_security_invariants').header, /SET search_path TO 'public'\s*$/);
  assert.match(fns.get('repoint_card_refs').header, /SET search_path TO ''\s*$/);
});

test('every _file_ helper and _tg_file_ trigger is revoked from public, anon and authenticated', () => {
  const helpers = [...fns.keys()].filter((n) => /^_(tg_)?file_/.test(n));
  assert.ok(helpers.length >= 8, `found helpers: ${helpers.join(', ')}`);
  for (const name of helpers) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\)\\s+from public, anon, authenticated;`),
      `${name} is revoked`);
  }
});

test('the anon grants are exactly get_file_share and get_file_comments', () => {
  const anon = [...sql.matchAll(/grant execute on function public\.(\w+\([^)]*\)) to ([^;]+);/g)]
    .filter((m) => /\banon\b/.test(m[2])).map((m) => m[1]).sort();
  assert.deepEqual(anon, ['get_file_comments(uuid)', 'get_file_share(uuid)']);
  for (const sig of PUBLIC_RPCS) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${esc(sig)} from public;`), `${sig} revoked from public`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${esc(sig)} to (anon, )?authenticated, service_role;`),
      `${sig} granted to authenticated`);
  }
});

test('get_file_share and get_file_comments are volatile (they heal and stamp)', () => {
  for (const n of ['get_file_share', 'get_file_comments', '_file_share_resolve', '_file_share_card']) {
    assert.doesNotMatch(fns.get(n).header, /\b(stable|immutable)\b/i, `${n} is volatile`);
  }
});

test('_outbound_gate classifies file_shared as stranger mail and file_commented as member mail', () => {
  const gate = fns.get('_outbound_gate').body;
  assert.match(gate, /when p_template in \('pending_invite', 'board_shared', 'workspace_invite', 'file_shared'\) then 'stranger'/);
  assert.match(gate, /when p_template in \('mention_email', 'comment_reply_email', 'schedule_update', 'invite_accepted', 'file_commented'\) then 'member'/);
  assert.match(gate, /exception when others then[\s\S]*return 'hold';\s*end;\s*$/, 'still fails closed');
});

test('the invariants allowlist names both new email triggers', () => {
  const inv = fns.get('check_security_invariants').body;
  const list = inv.match(/p\.prosrc ~ '_notify_email\\\('\s+and p\.proname not in \(([^)]+)\)/);
  assert.ok(list, 'the allowlist is found');
  for (const n of ['_tg_file_share_person_email', '_tg_file_comment_notify', '_tg_comment_reply_email', '_tg_share_notification_email']) {
    assert.ok(list[1].includes(`'${n}'`), `${n} is allowed`);
  }
});

test('the email triggers send only their own templates, naming the sharer by email', () => {
  const share = fns.get('_tg_file_share_person_email').body;
  assert.match(share, /perform public\._notify_email\('file_shared', new\.email,/);
  assert.match(share, /select u\.email into v_sharer from auth\.users u/);
  assert.match(share, /current_setting\('app\.file_share_invite', true\)/);
  const comment = fns.get('_tg_file_comment_notify').body;
  assert.match(comment, /perform public\._notify_email\('file_commented',/);
  assert.match(comment, /interval '30 minutes'/);
  assert.match(comment, /public\._email_pref_enabled\(v_share\.created_by, 'email_comment_replies'\)/);
  assert.match(comment, /public\._is_user_online\(v_share\.created_by\)/);
  assert.match(fns.get('add_file_share_people').body, /set_config\('app\.file_share_invite', 'on', true\)/);
  assert.match(fns.get('add_file_share_people').body, /perform public\._invite_budget_take\(\);/);
  assert.match(sql, /create or replace trigger \w+\s+after insert or update of revoked_at on public\.file_share_people/);
  assert.match(sql, /create or replace trigger \w+\s+after insert on public\.file_comments/);
});

test('repoint_card_refs keeps its guards and the starred count, and moves file shares too', () => {
  const r = fns.get('repoint_card_refs').body;
  assert.match(r, /public\.can_write_board\(p_from\)/);
  assert.match(r, /public\.can_write_board\(p_to\)/);
  assert.match(r, /jsonb_array_length\(p_pairs\) > 500/);
  assert.match(r, /if v_ws_from is null or v_ws_from is distinct from v_ws_to then\s+return 0;/);
  const starred = r.indexOf('update public.starred_items s');
  const diag = r.indexOf('get diagnostics v_n = row_count;');
  const files = r.indexOf('update public.file_shares f');
  assert.ok(starred > 0 && diag > starred && files > diag, 'starred update, its count, then the file_shares update');
  assert.ok(r.indexOf('return v_n;') > files, 'still returns the starred count');
});

test('access checks the takedown helpers and the 72h risky-link rule', () => {
  const a = fns.get('_file_share_access').body;
  assert.match(a, /public\._sharer_suspended\(p_share\.created_by\)/);
  assert.match(a, /public\._user_banned\(w\.created_by\)/);
  assert.match(a, /interval '72 hours'/);
  assert.match(fns.get('set_file_share').body, /public\._account_is_new\(\)/);
  assert.match(fns.get('set_file_share').body, /hint = 'new_account_risky'/);
});

test('the SQL limits equal the client constants', () => {
  assert.match(sql, new RegExp(`char_length\\(btrim\\(body\\)\\) between 1 and ${FILE_COMMENT_MAX_CHARS}`));
  const add = fns.get('add_file_comment').body;
  assert.match(add, new RegExp(`char_length\\(v_body\\) > ${FILE_COMMENT_MAX_CHARS}`));
  assert.match(add, new RegExp(`interval '${FILE_COMMENT_BURST_MINUTES} minutes'`));
  assert.match(add, new RegExp(`v_n_burst >= ${FILE_COMMENT_BURST}\\b`));
  assert.match(add, /interval '1 day'/);
  assert.match(add, new RegExp(`v_n_day >= ${FILE_COMMENT_DAILY}\\b`));
  assert.match(add, /hint = 'comment_rate_limited'/);
  assert.match(add, /pg_advisory_xact_lock\(hashtext\('file_comment:' \|\| v_uid::text\)\)/);
  assert.match(fns.get('add_file_share_people').body,
    new RegExp(`cardinality\\(p_emails\\) > ${FILE_SHARE_PEOPLE_PER_CALL}`));
});

test('the shareable kinds and the risky lists match fileShares.js', () => {
  const parseArray = (s) => s.split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  const file = fns.get('_file_share_file').body;
  const kinds = file.match(/v_kind <> all \(array\[([^\]]+)\]\)/);
  assert.ok(kinds, 'the kinds array');
  assert.deepEqual(parseArray(kinds[1]), [...SHAREABLE_KINDS]);
  const risky = fns.get('_file_risky').body;
  const arrays = [...risky.matchAll(/array\[([^\]]+)\]/g)].map((m) => parseArray(m[1]));
  assert.equal(arrays.length, 2, 'one extension list, one mime list');
  assert.deepEqual(arrays[0], [...RISKY_EXTENSIONS]);
  assert.deepEqual(arrays[1], [...RISKY_MIMES]);
});

test('tables are server-only: RLS on, no policies, no client grants', () => {
  for (const t of ['file_shares', 'file_share_people', 'file_comments']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security;`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${t} from public, anon, authenticated;`));
  }
  assert.doesNotMatch(sql, /create\s+policy/i);
});

test('the closing proof block checks grants, RLS and the takedown markers', () => {
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(proof, /has_function_privilege\('anon'/);
  assert.match(proof, /has_function_privilege\('authenticated'/);
  assert.match(proof, /relrowsecurity/);
  assert.match(proof, /has_table_privilege\('anon'/);
  assert.match(proof, /position\('_sharer_suspended' in/);
  assert.match(proof, /position\('file_shares' in/);
});

test('a comment a manager removed stays removed: an author undoes only their own delete', () => {
  assert.match(sql, /deleted_by\s+uuid references auth\.users \(id\) on delete set null/);
  const del = sql.slice(sql.indexOf('function public.delete_file_comment('), sql.indexOf('function public.restore_file_comment('));
  assert.match(del, /set deleted_at = now\(\), deleted_by = v_uid/);
  const res = sql.slice(sql.indexOf('function public.restore_file_comment('), sql.indexOf('-- ── D. Notifications'));
  assert.match(res, /v_c\.author = v_uid and v_c\.deleted_by = v_uid\s+and v_c\.deleted_at > now\(\) - interval '1 day'/);
});

test('a link opened by a suspended account grants nothing', () => {
  const acc = sql.slice(sql.indexOf('function public._file_share_access('), sql.indexOf('function public._file_share_resolve('));
  assert.match(acc, /p_share\.link_access <> 'none'\s+and not public\._sharer_suspended\(p_share\.link_set_by\)/);
});
