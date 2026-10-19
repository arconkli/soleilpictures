// Text pins on supabase/migrations/0426_doc_shares.sql: a doc can be shared
// with an edit role (without a DROP), the link counts only when presented,
// no answer a browser can get carries storage keys, the room's questions are
// the service role's, and the grants are proved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../../supabase/migrations/0426_doc_shares.sql', import.meta.url), 'utf8');

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
const fns = functionBlocks(sql);
const fn = (n) => fns.get(n) || assert.fail(`0426 defines ${n}`);
const statements = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');

test('no DROP and no DELETE FROM statement; the edit role is two new columns', () => {
  assert.doesNotMatch(statements, /\bdrop\s/i);
  assert.doesNotMatch(statements, /\bdelete\s+from\b/i);
  assert.match(sql, /alter table public\.file_share_people add column if not exists can_edit boolean not null default false;/);
  assert.match(sql, /alter table public\.file_shares add column if not exists link_can_edit boolean not null default false;/);
});

test('every function is security definer with an empty search_path', () => {
  for (const [name, f] of fns) {
    assert.match(f.header, /security definer/i, name);
    assert.match(f.header, /set search_path = ''/, name);
  }
});

test('a doc card can be shared; the media branch is the one 0421 made', () => {
  const f = fn('_file_share_file').body;
  assert.match(f, /if v_kind = 'doc' then\s+return jsonb_build_object\(\s+'kind', 'doc',/);
  assert.match(f, /'card_key', p_ci\.card_id\);/);
  const media = readFileSync(new URL('../../../supabase/migrations/0421_file_shares.sql', import.meta.url), 'utf8');
  const from0421 = media.slice(media.indexOf("  v_ref := v_meta->>(case v_kind when 'pdf'"), media.indexOf("    'risky', v_kind = 'file' and public._file_risky(v_name, v_mime)"));
  assert.ok(from0421.length > 500 && f.includes(from0421), 'the storage-file branch is byte-identical');
});

test('who may open or edit a doc: the team views, the link only when presented, editing a link needs an account', () => {
  const a = fn('_doc_share_access').body;
  assert.match(a, /if v_uid is not null and coalesce\(public\.can_write_board\(p_share\.board_id\), false\) then\s+return 'manage';/);
  assert.match(a, /v_best := case when v_team then 1 else 0 end;/, 'the team views');
  assert.match(a, /select max\(case when p\.can_edit then 2 else 1 end\)/);
  assert.match(a, /not public\._sharer_suspended\(p\.invited_by\)/, 'a suspended inviter’s people lose it');
  assert.match(a, /p\.email = v_email/);
  assert.match(a, /u\.email_confirmed_at is not null/);
  assert.match(a, /if coalesce\(p_token_ok, false\) and p_share\.link_access <> 'none'\s+and not public\._sharer_suspended\(p_share\.link_set_by\) then/);
  assert.match(a, /case when p_share\.link_can_edit and v_uid is not null then 2 else 1 end/);
  assert.match(a, /public\._sharer_suspended\(p_share\.created_by\)\s+or exists \(select 1 from public\.workspaces w\s+where w\.id = p_share\.workspace_id and public\._user_banned\(w\.created_by\)\)/, 'takedowns');
  const r = fn('_file_share_resolve').body;
  assert.match(r, /if v_file->>'kind' = 'doc' then\s+v_access := public\._doc_share_access\(v_share, true\);\s+else\s+v_access := public\._file_share_access\(v_share,/);
});

test('no answer a browser can get carries storage keys; the party reads them as the service role', () => {
  const g = fn('get_file_share').body;
  assert.doesNotMatch(g, /'keys'/);
  assert.doesNotMatch(g, /v_file->'src'|v_file->'poster'/);
  assert.match(g, /'room', \(v_r->>'share_id'\) \|\| case when v_edit then '\.edit\.' else '\.view\.' end/);
  assert.match(g, /'edit_needs_sign_in', v_uid is null and v_r->>'link_access' <> 'none'/);
  const p = fn('get_file_share_posters').body;
  assert.match(p, /v_out := v_out \|\| jsonb_build_object\(v_t::text, true\);/);
  assert.doesNotMatch(p, /v_out \|\| jsonb_build_object\(v_t::text, v_key\)/);
  for (const name of ['_file_share_keys', '_file_share_poster_keys', '_doc_room_target', '_doc_room_recheck']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`), name);
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`), name);
  }
});

test('the owner dialog speaks view | edit for a doc, view | comment for a file', () => {
  const set = fn('set_file_share').body;
  assert.match(set, /if v_link not in \('none', 'view', 'edit'\) then/);
  assert.match(set, /elsif v_link not in \('none', 'view', 'comment'\) then/);
  assert.match(set, /link_can_edit = excluded\.link_can_edit,/);
  const add = fn('add_file_share_people').body;
  assert.match(add, /if p_role is null or p_role not in \('view', 'edit'\) then/);
  assert.match(add, /can_edit = excluded\.can_edit,/);
  assert.match(add, /perform set_config\('app\.file_share_invite', 'on', true\);/, 'still the only place an un-revoke re-invites');
  const person = fn('set_file_share_person').body;
  assert.match(person, /set role = v_role, can_edit = v_can_edit, revoked_at = null/);
  assert.doesNotMatch(person, /file_share_invite/);
  const settings = fn('get_file_share_settings').body;
  assert.match(settings, /'role', case when v_kind = 'doc' and p\.can_edit then 'edit' else p\.role end,/);
});

test('a doc’s comments are in the doc; the room asks as the caller; a restore makes a new room', () => {
  assert.match(fn('add_file_comment').body, /if v_kind = 'doc' then\s+raise exception 'comments on a doc are made in the doc'/);
  assert.match(fn('get_file_comments').body, /or v_r->'file'->>'kind' = 'doc' then/);
  const room = fn('doc_room_access').body;
  assert.match(room, /public\._doc_share_access\(v_share, p_token is not null and p_token = v_share\.token\)/);
  assert.match(room, /if public\._doc_room_gen\(v_share\.board_id, v_share\.card_id\) <> v_m\[3\] then\s+return jsonb_build_object\('status', 'moved'\);/);
  assert.match(room, /if v_m\[2\] = 'edit' and \(v_uid is null or v_acc not in \('edit', 'manage'\)\) then/);
  assert.match(fn('_doc_room_gen').body, /from public\.board_state_version v where v\.board_id = p_board/);
  const re = fn('_doc_room_recheck').body;
  assert.match(re, /perform set_config\('request\.jwt\.claim\.sub', v_s->>'user_id', true\);/, 'auth.uid() reads claim.sub first');
  assert.match(re, /perform set_config\('request\.jwt\.claims', coalesce\(v_claims, ''\), true\);/, 'and the claims are put back');
  assert.match(sql, /grant execute on function public\.doc_room_access\(text, uuid\) to anon, authenticated, service_role;/);
});

test('the invitation names a doc and the edit role; the proof block covers the grants', () => {
  const t = fn('_tg_file_share_person_email').body;
  assert.match(t, /v_role := case when new\.can_edit then 'edit' else new\.role end;/);
  assert.match(t, /'kind', coalesce\(v_file->>'kind', 'file'\)/);
  assert.match(sql, /raise exception '0426: % is client-callable', v_sig;/);
  assert.match(sql, /raise exception '0426: get_file_share still answers storage keys';/);
  assert.match(sql, /raise exception '0426: _file_share_access changed';/);
});
