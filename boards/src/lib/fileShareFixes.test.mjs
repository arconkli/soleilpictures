// Text pins on supabase/migrations/0422_file_share_fixes.sql: the exact-only
// card and share lookups, the takedown that reads 'gone', the suspended
// inviter, the email normalisation, the reach check on comment notifications,
// the email link origin, and the grants.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SQL_PATH = new URL('../../../supabase/migrations/0422_file_share_fixes.sql', import.meta.url);
const sql = readFileSync(SQL_PATH, 'utf8');

// The LAST `create or replace function public.x(...) ... as $tag$ ... $tag$;`
// block for each name: what the database ends up running.
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
const fn = (n) => {
  assert.ok(fns.has(n), `0422 defines ${n}`);
  return fns.get(n);
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Statements only: strings and comments blanked.
const statements = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, '');

test('0422 has no DROP and no DELETE FROM statement (the MCP refuses them)', () => {
  assert.doesNotMatch(statements, /\bdrop\s/i);
  assert.doesNotMatch(statements, /\bdelete\s+from\b/i);
  assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g, "''"), /\bdelete\s+from\b/i, 'not even in a comment');
});

test('every function is security definer with an empty search_path and schema-qualified', () => {
  const expected = ['_file_share_card', '_file_share_find', '_file_share_access', '_file_share_resolve',
    'add_file_share_people', '_file_share_reaches', '_tg_file_share_person_email', '_tg_file_comment_notify'];
  assert.deepEqual([...fns.keys()].sort(), [...expected].sort());
  for (const [name, f] of fns) {
    assert.match(f.header, /security\s+definer/i, `${name} is security definer`);
    assert.match(f.header, /set\s+search_path\s*=\s*''/i, `${name} sets search_path = ''`);
    // Every table reference names its schema.
    for (const m of f.body.matchAll(/\b(?:from|join|update|into)\s+(?!public\.|auth\.|v_|chain\b|set\b|new\.)([a-z_]+)\b/gi)) {
      assert.fail(`${name} references an unqualified relation: ${m[0]}`);
    }
  }
});

test('_file_share_card is the exact (cluster, card) row on a live cluster, with no fallback or heal', () => {
  const b = fn('_file_share_card').body;
  assert.match(b, /join public\.boards b on b\.id = ci\.board_id and b\.deleted_at is null/);
  assert.match(b, /where ci\.board_id = p_share\.board_id and ci\.card_id = p_share\.card_id;/);
  assert.doesNotMatch(b, /workspace_id/, 'no workspace-wide lookup');
  assert.doesNotMatch(b, /\bupdate\b/i, 'no heal');
  assert.doesNotMatch(b, /order by/i);
});

test('_file_share_find is the exact (cluster, card) share, with no adoption', () => {
  const b = fn('_file_share_find').body;
  assert.match(b, /where s\.board_id = p_board and s\.card_id = p_card;/);
  assert.doesNotMatch(b, /\bupdate\b/i);
  assert.doesNotMatch(b, /workspace_id/);
});

test('the volatility of the re-emitted lookups is unchanged', () => {
  for (const n of ['_file_share_card', '_file_share_find', '_file_share_resolve']) {
    assert.doesNotMatch(fn(n).header, /\b(stable|immutable)\b/i, `${n} stays volatile`);
  }
  assert.match(fn('_file_share_access').header, /\bstable\b/i);
});

test('a takedown resolves to null (gone) for anyone but the signed-in team', () => {
  const b = fn('_file_share_resolve').body;
  const take = b.match(/if \(public\._sharer_suspended\(v_share\.created_by\)\s+or exists \(select 1 from public\.workspaces w\s+where w\.id = v_share\.workspace_id and public\._user_banned\(w\.created_by\)\)\)\s+and not \(auth\.uid\(\) is not null and coalesce\(public\.can_read_board\(v_share\.board_id\), false\)\) then\s+return null;/);
  assert.ok(take, 'the takedown guard is present');
  assert.ok(take.index < b.indexOf('_file_share_access('), 'it runs before access is decided');
  assert.doesNotMatch(b, /The heal may have moved it/);
});

test('a person added by a suspended account no longer gets access', () => {
  const b = fn('_file_share_access').body;
  assert.match(b, /where p\.share_id = p_share\.id and p\.revoked_at is null\s+and not public\._sharer_suspended\(p\.invited_by\)\s+and \(p\.user_id = v_uid/);
  // The rest of the ladder is the 0421 text.
  assert.match(b, /public\._sharer_suspended\(p_share\.created_by\)/);
  assert.match(b, /public\._sharer_suspended\(p_share\.link_set_by\)/);
  assert.match(b, /interval '72 hours'/);
});

test('add_file_share_people normalises each email and tightens the check', () => {
  const b = fn('add_file_share_people').body;
  assert.match(b, /v_strip   text := ' ' \|\| chr\(9\) \|\| chr\(10\) \|\| chr\(13\) \|\| '"''<>';/);
  assert.match(b, /v_norm := btrim\(coalesce\(v_e, ''\), v_strip\);\s+v_norm := regexp_replace\(v_norm, '\^mailto:', '', 'i'\);\s+v_norm := lower\(btrim\(v_norm, v_strip\)\);/);
  assert.ok(b.includes(String.raw`if v_norm !~ '^[^@\s"''<>(),;:\[\]]+@[^@\s"''<>(),;:\[\]]+\.[^@\s"''<>(),;:\[\]]+$'`));
  assert.ok(!b.includes(String.raw`'^[^@\s]+@[^@\s]+\.[^@\s]+$'`), 'the loose 0421 check is gone');
  // Unchanged: the cap, the budget, the invite GUC, confirmed-only binding.
  assert.match(b, /cardinality\(p_emails\) > 20/);
  assert.match(b, /perform public\._invite_budget_take\(\);/);
  assert.match(b, /set_config\('app\.file_share_invite', 'on', true\)/);
  assert.match(b, /lower\(u\.email\) = v_norm and u\.email_confirmed_at is not null/);
});

test('the email normalisation behaves as the SQL does (JS model of btrim/regexp)', () => {
  const strip = ' \t\n\r"\'<>';
  const bt = (s) => {
    let a = 0; let z = s.length;
    while (a < z && strip.includes(s[a])) a++;
    while (z > a && strip.includes(s[z - 1])) z--;
    return s.slice(a, z);
  };
  const norm = (e) => bt(bt(e ?? '').replace(/^mailto:/i, '')).toLowerCase();
  const ok = (e) => /^[^@\s"'<>(),;:[\]]+@[^@\s"'<>(),;:[\]]+\.[^@\s"'<>(),;:[\]]+$/.test(norm(e));
  assert.equal(norm(' "A@X.com" '), 'a@x.com');
  assert.equal(norm('MailTo:a@x.com'), 'a@x.com');
  assert.equal(norm('<mailto:a@x.com>'), 'a@x.com');
  assert.equal(norm("'a@x.com'"), 'a@x.com');
  assert.ok(ok('A.b+c@sub.x.io'));
  assert.ok(!ok('mailto:mailto:a@x.com'), 'only one mailto: is stripped');
  assert.ok(!ok('a(b)@x.com'));
  assert.ok(!ok('a@x.co;m'));
  assert.ok(!ok('a@x.com]'));
});

test('_file_share_reaches is the definer-side reach check the notifications use', () => {
  const f = fn('_file_share_reaches');
  assert.match(sql, /create or replace function public\._file_share_reaches\(p_share public\.file_shares, p_user uuid\)\s+returns boolean/);
  const b = f.body;
  assert.match(b, /if p_user is null or p_share\.id is null or public\._user_banned\(p_user\) then\s+return false;/);
  assert.match(b, /w\.id = p_share\.workspace_id and w\.created_by = p_user/);
  assert.match(b, /from public\.workspace_members m\s+where m\.workspace_id = p_share\.workspace_id and m\.user_id = p_user/);
  assert.match(b, /with recursive chain as/);
  assert.match(b, /join public\.board_shares s on s\.board_id = chain\.id and s\.user_id = p_user\s+where chain\.deleted_at is null/);
  assert.match(b, /from auth\.users u where u\.id = p_user and u\.email_confirmed_at is not null/);
  assert.match(b, /p\.revoked_at is null/);
  assert.match(b, /p\.user_id = p_user\s+or \(p\.user_id is null and v_email is not null and p\.email = v_email\)/);
  assert.match(b, /p_share\.link_access = 'comment'\s+and exists \(select 1 from public\.file_comments c\s+where c\.share_id = p_share\.id and c\.author = p_user and c\.deleted_at is null\)/);
  assert.doesNotMatch(b, /auth\.uid\(\)/, 'it judges p_user, never the caller');
});

test('the comment trigger notifies the creator and the parent author only while they reach the file', () => {
  const b = fn('_tg_file_comment_notify').body;
  assert.match(b, /if v_share\.created_by is distinct from new\.author\s+and public\._file_share_reaches\(v_share, v_share\.created_by\) then/);
  assert.match(b, /and v_parent_author is distinct from v_share\.created_by\s+and public\._file_share_reaches\(v_share, v_parent_author\) then/);
  const reach = b.indexOf('_file_share_reaches(v_share, v_share.created_by)');
  assert.ok(reach >= 0 && reach < b.indexOf("insert into public.notifications"), 'checked before the bell row');
  // Unchanged: throttle, preference, presence.
  assert.match(b, /interval '30 minutes'/);
  assert.match(b, /public\._email_pref_enabled\(v_share\.created_by, 'email_comment_replies'\)/);
  assert.match(b, /public\._is_user_online\(v_share\.created_by\)/);
});

const ORIGIN = String.raw`'origin', coalesce((select value #>> '{}' from public.app_config where key = 'file_share_link_origin'),`;

test('both share emails carry the link origin from app_config, defaulting to production', () => {
  const share = fn('_tg_file_share_person_email').body;
  const comment = fn('_tg_file_comment_notify').body;
  for (const [name, b, tpl] of [['_tg_file_share_person_email', share, 'file_shared'], ['_tg_file_comment_notify', comment, 'file_commented']]) {
    const call = b.slice(b.indexOf(`_notify_email('${tpl}'`));
    assert.ok(call.length > 0, `${name} still sends ${tpl}`);
    const payload = call.slice(0, call.indexOf(';'));
    assert.ok(payload.includes(ORIGIN), `${name}'s ${tpl} payload carries origin`);
    assert.match(payload, /'https:\/\/clusters\.soleilpictures\.com'\)/, `${name} falls back to production`);
  }
  assert.match(share, /perform public\._notify_email\('file_shared', new\.email,/);
  assert.match(share, /select u\.email into v_sharer from auth\.users u/, 'still names the sharer by email');
  assert.match(sql, /insert into public\.app_config \(key, value\)\s+values \('file_share_link_origin', to_jsonb\('https:\/\/main-soleil-boards\.arconkli\.workers\.dev'::text\)\)\s+on conflict \(key\) do nothing;/);
});

test('grants: add_file_share_people stays signed-in only, every helper stays revoked', () => {
  const sig = 'add_file_share_people(uuid, text, text[], text)';
  assert.match(sql, new RegExp(`revoke all on function public\\.${esc(sig)} from public;`));
  assert.match(sql, new RegExp(`revoke all on function public\\.${esc(sig)} from anon;`));
  assert.match(sql, new RegExp(`grant execute on function public\\.${esc(sig)} to authenticated, service_role;`));
  const anon = [...sql.matchAll(/grant execute on function [^;]+ to ([^;]+);/g)].filter((m) => /\banon\b/.test(m[1]));
  assert.deepEqual(anon, [], 'no new anon grant');
  for (const h of ['_file_share_card(public.file_shares)', '_file_share_find(uuid, text)',
    '_file_share_access(public.file_shares, boolean)', '_file_share_resolve(uuid)',
    '_file_share_reaches(public.file_shares, uuid)', '_tg_file_share_person_email()', '_tg_file_comment_notify()']) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${esc(h)} from public, anon, authenticated;`), `${h} revoked`);
  }
});

test('the closing proof block checks the grants and the new behaviour', () => {
  const proof = sql.slice(sql.lastIndexOf('do $$'));
  assert.match(proof, /has_function_privilege\('anon', 'public\.add_file_share_people\(uuid, text, text\[\], text\)', 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', 'public\.add_file_share_people/);
  assert.match(proof, /'public\.get_file_share\(uuid\)', 'public\.get_file_comments\(uuid\)'/);
  assert.match(proof, /'public\._file_share_reaches\(public\.file_shares, uuid\)'/);
  assert.match(proof, /has_function_privilege\('public', v_sig, 'execute'\)/);
  assert.match(proof, /search_path=""/);
  assert.match(proof, /_sharer_suspended\(p\.invited_by\)/);
  assert.match(proof, /file_share_link_origin/);
  assert.match(proof, /end \$\$;\s*$/);
});
