// shareCaptureMigration.test.mjs — the sharing insight's recording fixes
// (0740 onward), read as text.
//
//   node --test src/lib/shareCaptureMigration.test.mjs
//
// 0740 records who put each new workspace member in, from a trigger that can
// fail without failing the join. It reads the joins as they are written
// today: 0606's claims insert the member before they mark the invitation
// claimed, and 0521's link join raises soleil.ws_link_join around its insert.
// A later restatement that changes either would file those members under
// 'other', so both are pinned here. The trigger's behaviour was proven on the
// live database by its own proof block; this holds the file to what was proven.
//
// 0741 restates derive_acquisition_channel (0708's v5) with one arm added: a
// first touch from a shared file is 'file_share'. Its body must be 0708's with
// only that arm added, its proof must keep 0708's asserts word for word, and
// the arm must read what the file page actually sends.
//
// 0742 restates get_file_share (0607's) with one key added to each of its two
// 'ok' answers: the share's id, which the /f/ page can log in place of the
// token. The Party worker hands the answer to the page minus its storage keys,
// so the id arrives with no worker change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, definitionsOf, latestDefinition } from './migrationText.mjs';
import { LINK_TOKEN_KEYS } from './linkTokens.js';
import { fileShareResponse } from './fileShareBundle.js';

const FILE_0708 = '0708_mcp_drafts_measured.sql';
const FILE_0740 = '0740_workspace_member_adds.sql';
const FILE_0741 = '0741_channel_credits_file_shares.sql';
const FILE_0607 = '0607_file_shares_follow_their_sharer.sql';
const FILE_0742 = '0742_file_share_says_its_id.sql';
const sqlOf = (file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
const sql0740 = sqlOf(FILE_0740);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const definedIn = (fn, file) => definitionsOf(fn).find((d) => d.file === file)?.body ?? null;
const JOINED_VIA = ['system', 'service', 'workspace_link', 'direct_add', 'email_invite', 'other'];

test('0740: the table is closed to every client and follows its workspace and its people', () => {
  assert.match(sql0740, /workspace_id uuid not null references public\.workspaces\(id\) on delete cascade/);
  assert.match(sql0740, /user_id +uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(sql0740, /added_by +uuid references auth\.users\(id\) on delete set null/);
  assert.ok(sql0740.includes('alter table public.workspace_member_adds enable row level security;'));
  assert.ok(sql0740.includes('revoke all on table public.workspace_member_adds from public, anon, authenticated;'));
  assert.doesNotMatch(sql0740, /create policy/i, 'no policy: no client reads it');
  assert.doesNotMatch(sql0740, /grant [^;]* to (anon|authenticated)/i);
  const check = sql0740.match(/joined_via +text not null check \(joined_via in\s+\(([^)]*)\)\)/);
  assert.ok(check, 'joined_via has its check');
  assert.deepEqual(check[1].split(',').map((s) => s.trim().replace(/'/g, '')), JOINED_VIA);
});

test('0740: one trigger, after insert only, and its function is no client\'s to call', () => {
  assert.match(sql0740, /create or replace trigger workspace_member_added_trigger\s+after insert on public\.workspace_members\s+for each row execute function public\._tg_workspace_member_added\(\);/);
  assert.doesNotMatch(sql0740, /after (insert or )?update/i, 'a role change is not a new member');
  assert.ok(sql0740.includes('revoke execute on function public._tg_workspace_member_added() from public, anon, authenticated;'));
  const fn = latestDefinition('_tg_workspace_member_added');
  assert.equal(fn.file, FILE_0740);
  assert.match(fn.body, /language plpgsql security definer set search_path = '' as \$\$/);
});

test('0740: the bookkeeping can fail, the join cannot', () => {
  const body = latestDefinition('_tg_workspace_member_added').body;
  assert.match(body, /begin\s+begin\s+v_actor := auth\.uid\(\);[\s\S]*exception when others then\s+raise warning '_tg_workspace_member_added: % \(%\)', sqlerrm, sqlstate;\s+end;\s+return new;\s+end;\s+\$\$;$/);
  assert.doesNotMatch(body, /raise exception/);
});

test('0740: a join is read in the order the header gives, and only as one of the checked values', () => {
  const body = latestDefinition('_tg_workspace_member_added').body;
  const arms = ["v_via := 'service'", "v_via := 'system'", "v_via := 'workspace_link'", "v_via := 'direct_add'",
                "then 'email_invite' else 'other'"];
  const at = arms.map((s) => body.indexOf(s));
  assert.ok(at.every((i) => i > 0), `each arm is there: ${at}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in that order');
  assert.match(body, /new\.role = 'owner'\s+or new\.user_id = v_creator\s+or current_setting\('soleil\.quiet_member_email', true\) = '1' then\s+v_via := 'system';/);
  assert.match(body, /current_setting\('soleil\.ws_link_join', true\) = '1' then\s+v_via := 'workspace_link';/);
  assert.match(body, /v_actor is not null and v_actor <> new\.user_id then\s+v_via := 'direct_add';\s+v_by +:= v_actor;/);
  assert.match(body, /pi\.board_id is null\s+and pi\.claimed_at is null/);
  const written = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).filter((v) => JOINED_VIA.includes(v));
  assert.deepEqual([...new Set(written)].sort(), [...JOINED_VIA].sort());
});

test("0740 reads 0606's claims as they are: the member goes in before the invitation is marked claimed", () => {
  for (const fn of ['claim_pending_invite', '_claim_pending_invites_for_user']) {
    const body = latestDefinition(fn).body;
    const insert = body.search(/insert into workspace_members \(workspace_id, user_id, role\)/);
    const claimed = body.search(/update pending_invites\s+set claimed_at/);
    assert.ok(insert > 0 && claimed > 0, `${fn} has both statements`);
    assert.ok(insert < claimed, `${fn} inserts the member first, or every invited member reads 'other'`);
  }
});

test('0740 reads the link join as it is: the flag is up around its insert', () => {
  const body = latestDefinition('claim_workspace_invite_link').body;
  assert.match(body, /perform set_config\('soleil\.ws_link_join', '1', true\);\s+insert into public\.workspace_members/);
  assert.match(body, /perform set_config\('soleil\.ws_link_join', '', true\);/);
});

test("0740's proof checks the gates and exercises three joins, undone by its own code", () => {
  const proof = sql0740.slice(sql0740.lastIndexOf('do $proof$'));
  assert.ok(proof.includes("'public.workspace_member_adds'"));
  assert.ok(proof.includes("'public._tg_workspace_member_added()'"));
  assert.match(proof, /array\['public', 'anon', 'authenticated'\]/);
  for (const via of ['direct_add', 'workspace_link', 'email_invite']) {
    assert.ok(proof.includes(`v_via is distinct from '${via}'`), `the proof checks a ${via}`);
  }
  assert.match(proof, /raise exception '0740: proven' using errcode = 'SL740';\s+exception when sqlstate 'SL740' then/);
});

// ── 0741: the channel learns shared files ───────────────────────────────────
const SHARE_ARM = "  if nullif(fs->>'share_token','') is not null or utm_s = 'share_link'   then return 'share_link';   end if;\n";
const FILE_ARM =
  "  -- A shared file (0741): its page, or its sign-in links (file_token, utm_source=file_share).\n" +
  "  if nullif(fs->>'file_token','') is not null or utm_s = 'file_share' or lp like '/f/%' then return 'file_share'; end if;\n";

test("0741's channel is 0708's with one arm added, right after the share link's, and it is the one that runs", () => {
  const before = definedIn('derive_acquisition_channel', FILE_0708);
  const now = definedIn('derive_acquisition_channel', FILE_0741);
  assert.ok(before && now, 'defined in both files');
  assert.equal(before.split(SHARE_ARM).length, 2, "0708's share link arm is there exactly once");
  assert.equal(now, before.replace(SHARE_ARM, SHARE_ARM + FILE_ARM));
  assert.equal(latestDefinition('derive_acquisition_channel').file, FILE_0741);
});

test("0741's proof keeps 0708's asserts word for word and proves the new arm", () => {
  const sql0708 = sqlOf(FILE_0708);
  const sql0741 = sqlOf(FILE_0741);
  const from = sql0708.indexOf('  -- The channel: a keep page is its own');
  const kept = sql0708.slice(from, sql0708.indexOf('end $proof$;', from));
  assert.ok(from > 0 && kept.includes("'mcp_draft', 'keep page'"));
  assert.ok(sql0741.includes(kept), "0708's asserts, unchanged");
  for (const [bag, want] of [
    ['{"file_token":"x"}', 'file_share'],
    ['{"landing_path":"/f/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"}', 'file_share'],
    ['{"utm_source":"file_share","utm_medium":"cta"}', 'file_share'],
    ['{"share_token":"x","file_token":"y"}', 'share_link'],
    ['{"landing_path":"/f/x","gclid":"x"}', 'google_ads'],
    ['{"landing_path":"/features"}', 'direct'],
  ]) {
    assert.ok(sql0741.includes(`derive_acquisition_channel('${bag}'::jsonb) = '${want}'`), `${bag} → ${want}`);
  }
  assert.match(sql0741, /provolatile from pg_proc p\s+where p\.oid = 'public\.derive_acquisition_channel\(jsonb\)'::regprocedure\) <> 'i'/);
});

test('the arm reads what the file page sends, no event carries the token, and the admin names the channel', () => {
  const page = read('../components/fileShare/FileSharePage.jsx');
  assert.match(page, /return `\/\?back=file&file_token=\$\{t\}&utm_source=file_share&utm_medium=\$\{medium\}&utm_campaign=\$\{t\}`;/);
  assert.match(page, /href=\{`\/\?utm_source=file_share&utm_medium=cta&utm_campaign=\$\{encodeURIComponent\(token\)\}`\}/);
  assert.ok(LINK_TOKEN_KEYS.includes('file_token'), 'buildRow drops file_token from every event');
  assert.match(read('../pages/admin/AdminUserDetailParts.jsx'), /\bfile_share: +\{ variant: 'share', +display: 'Shared file', +dot: true \}/);
});

// ── 0742: a shared file's answer names its share ────────────────────────────
const DOC_OK = "    return jsonb_build_object(\n      'status', 'ok',\n";
const FILE_OK = "  return jsonb_build_object(\n    'status', 'ok',\n";

test("0742's get_file_share is 0607's with the share's id in both 'ok' answers, and it is the one that runs", () => {
  const before = definedIn('get_file_share', FILE_0607);
  const now = definedIn('get_file_share', FILE_0742);
  assert.ok(before && now, 'defined in both files');
  for (const anchor of [DOC_OK, FILE_OK]) assert.equal(before.split(anchor).length, 2, 'each answer opens once');
  assert.equal(now, before
    .replace(DOC_OK, DOC_OK + "      'share_id', v_r->>'share_id',\n")
    .replace(FILE_OK, FILE_OK + "    'share_id', v_r->>'share_id',\n"));
  assert.equal(latestDefinition('get_file_share').file, FILE_0742);
  assert.doesNotMatch(now, /'keys'|v_file->'src'|v_file->'poster'/, 'still no storage keys');
});

test("0742's proof checks the page's grants, the keys, and both answers", () => {
  const proof = sqlOf(FILE_0742).slice(sqlOf(FILE_0742).lastIndexOf('do $proof$'));
  assert.match(proof, /has_function_privilege\('anon', 'public\.get_file_share\(uuid\)', 'execute'\)/);
  assert.match(proof, /has_function_privilege\('authenticated', 'public\.get_file_share\(uuid\)', 'execute'\)/);
  assert.match(proof, /raise exception '0742: get_file_share answers storage keys';/);
  assert.match(proof, /string_to_array\(v_def, '''share_id'', v_r->>''share_id'','\), 1\) <> 3/);
});

test("the Party worker's bundle hands the page the share's id, and never its keys", async () => {
  const out = await fileShareResponse(
    { status: 'ok', share_id: 'share-1', access: 'view', allow_download: false,
      file: { kind: 'image', name: 'a.png' }, keys: { src: 'r2:__fs/t/src' } },
    async () => 'https://signed.example/src', null);
  assert.equal(out.share_id, 'share-1');
  assert.equal(out.keys, undefined);
  assert.equal(out.urls.src, 'https://signed.example/src');
  assert.deepEqual(await fileShareResponse({ status: 'sign_in', share_id: 'x' }, async () => '', null), { status: 'sign_in' });
});
