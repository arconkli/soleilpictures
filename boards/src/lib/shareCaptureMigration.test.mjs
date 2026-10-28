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
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR, latestDefinition } from './migrationText.mjs';

const FILE_0740 = '0740_workspace_member_adds.sql';
const sql0740 = readFileSync(join(MIGRATIONS_DIR, FILE_0740), 'utf8');
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
