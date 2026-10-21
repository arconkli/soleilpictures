# Editor limit S1a (server + client logic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the 10-editor limit in the database behind a switch that is off, and give the app the logic to read it. Nobody sees a change.

**Architecture:** Two migrations.
- **0520** adds:
  - the count (`_account_editor_grants` → `_account_editor_slots`);
  - the switch (`app_config.editor_limit`, `_editor_limit_on`);
  - the admission check (`_editor_admit`, one advisory lock per account);
  - the refusal (`_editor_refuse`, with stable hints);
  - the notices;
  - three RPCs.
- **0521** re-emits the six doors from their live bodies, each with one admission check. The two link claims let the person in as a viewer instead of refusing.

On the client, `lib/editorLimit.js` reads the refusal, `runInvites` stops at it, `boardsApi.js` wraps the RPCs, and a closed hold registers the feature. The UI (S1b) waits for the owner's S0 mockup pick.

**Tech Stack:** Postgres 15 / plpgsql on Supabase (MCP `execute_sql`, `apply_migration`); `node --test`; React (no UI in this plan).

Design: `docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md`. Approved plan: `~/.claude/plans/i-want-to-work-soft-ladybug.md`.

## Global Constraints

- The limit is **10 people who can edit, per account** (`workspaces.created_by`), across every workspace it owns.
  - Owner and co-owners count.
  - Viewers, banned accounts and service identities (`_is_service_identity`) never count.
  - A waiting editor invite (`pending_invites.role in ('editor','workspace')`, unclaimed, unexpired, `held_at is null`, sender not suspended) holds a place.
- **Off until launch:** `app_config.editor_limit = {"enforced": false, "test_owner_ids": []}`. With it off, `_editor_admit` returns `'ok'` before counting, so every door behaves exactly as it does today.
- **Re-emitting a door:**
  - start from its live `pg_get_functiondef` body (fetched 2026-10-21) and change only the lines marked `0521`;
  - no new overloads (PGRST203), no return-shape changes, no DROP.
- **Grants (0311):**
  - every `_` helper: `revoke execute … from public, anon, authenticated`;
  - each public RPC: `revoke … from public, anon` + `grant … to authenticated`;
  - each migration ends with a `has_function_privilege` proof block.
- **Do not apply** 0520 or 0521 (MCP `apply_migration`) until the rolled-back probe passes AND the owner says go. Each file's header carries `STATUS: … NOT APPLIED` until then.
- **Commits:**
  - commit by pathspec (`git commit -m … -- <paths>`) and push to `main` (`git push origin HEAD:main` after `git fetch` and an ancestry check);
  - never sweep other sessions' files;
  - `appHost.js` and `featureEvents.js` hold another session's uncommitted hunks, so Task 8 stages only its own hunk (see Task 8).
- The repo is public: no counts or revenue in commits or files.
- Copy: the refusal messages start `editor limit reached:` (never `invite limit reached`, which the invite budget owns).

## Files

| Path | Task | Responsibility |
|---|---|---|
| `supabase/migrations/0520_editor_limit_core.sql` (new) | 1–2 | switch, count, admit, refuse, notices, RPCs, grants, proofs |
| `supabase/migrations/0521_editor_limit_doors.sql` (new) | 3–4 | the six doors re-emitted with the check; proofs |
| `boards/src/lib/editorLimit.js` (new) | 1, 6 | limit constant + hints (Task 1); refusal parser + capacity normaliser (Task 6) |
| `boards/src/lib/editorLimitMigration.test.mjs` (new) | 1–4 | migration-contract test |
| `boards/src/lib/editorLimit.test.mjs` (new) | 6 | unit tests |
| `boards/src/lib/boardsApi.js` | 6 | `getEditorCapacity`, `askOwnerForEditorSlot`, `listMyAccountEditors` |
| `boards/src/lib/inviteSubmit.js`, `inviteSubmit.test.mjs` | 7 | stop at the editor limit |
| `boards/src/lib/appHost.js` | 8 | `editorLimitAllowed()` (closed) + `featureFlags()` |
| `boards/src/lib/featureEvents.js` | 8 | `editorLimit: { unmeasured }` |
| `boards/src/lib/analyticsEvents.js`, `analyticsEvents.test.mjs` | 8 | `EDITOR_LIMIT_VIEWER_FALLBACK` + `SERVER_EMITTED` |
| `boards/src/lib/billingCopy.js`, `billingCopy.test.mjs` | 8 | comments re-cite the new switch |

**Code blocks below are the files.** A block preceded by `<!-- write: PATH -->` creates the file. One preceded by `<!-- append: PATH -->` appends to it. Copy them exactly.

---

### Task 1: The switch, the count, and the check (0520 part 1)

**Files:**
- Create: `boards/src/lib/editorLimit.js`
- Create: `boards/src/lib/editorLimitMigration.test.mjs`
- Create: `supabase/migrations/0520_editor_limit_core.sql` (sections 1–3; Task 2 appends the rest)

**Interfaces:**
- Produces (SQL):
  - `_editor_limit() → integer` (10)
  - `_editor_limit_on(p_owner uuid) → boolean`
  - `_account_editor_grants(p_owner uuid) → table(user_id uuid, email text, source text, workspace_id uuid, board_id uuid)`
  - `_account_editor_slots(p_owner uuid) → table(slot_key text, user_id uuid, email text, source text)`, where source is `owner|member|share|pending`
  - `_account_editor_count(p_owner uuid) → integer`
  - `_editor_admit(p_workspace uuid, p_user uuid, p_email text default null) → text`, returning `'ok'|'already'|'full'`
  - `_editor_refuse(p_workspace uuid) → void`, which raises 42501 with hint `editor_limit` or `editor_limit_ask_owner`
- Produces (JS): `EDITOR_LIMIT = 10`, `EDITOR_LIMIT_HINT = 'editor_limit'`, `EDITOR_LIMIT_ASK_HINT = 'editor_limit_ask_owner'` from `lib/editorLimit.js`.

- [ ] **Step 1: Write the constants module**

<!-- write: boards/src/lib/editorLimit.js -->
```js
// editorLimit.js — the 10-editor limit on Free and Creator (0520/0521), as the
// app reads it. A personal account can have at most EDITOR_LIMIT people who
// can edit, counted across every workspace it owns. A door that would add one
// more refuses with one of the hints below; an edit link lets the person in as
// a viewer instead. Pure, so it runs in node.

// public._editor_limit() in 0520 says the same number;
// editorLimitMigration.test.mjs reads the SQL and holds them together.
export const EDITOR_LIMIT = 10;

// _editor_refuse (0520) raises with one of these hints. The account's owner
// can make room; anyone else can ask the owner to.
export const EDITOR_LIMIT_HINT = 'editor_limit';
export const EDITOR_LIMIT_ASK_HINT = 'editor_limit_ask_owner';
```

- [ ] **Step 2: Write the failing contract test (part 1)**

<!-- write: boards/src/lib/editorLimitMigration.test.mjs -->
```js
// 0520/0521: the 10-editor limit on Free and Creator, pinned at the source
// (the latest migration definition). A later rewrite of a door can't quietly
// drop its check, and a door that must NOT check can't quietly gain one: an
// invite claimed after it held its place, or a transfer, which is the freeze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestDefinition, definitionsOf, MIGRATIONS_DIR } from './migrationText.mjs';
import { EDITOR_LIMIT, EDITOR_LIMIT_HINT, EDITOR_LIMIT_ASK_HINT } from './editorLimit.js';

const CORE = '0520_editor_limit_core.sql';
const DOORS = '0521_editor_limit_doors.sql';
const fileText = (f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
const code = (s) => s.replace(/--[^\n]*/g, '');   // comments are not wiring
const def = (fn) => {
  const d = latestDefinition(fn);
  assert.ok(d, `no definition of ${fn}`);
  return d;
};

test('the limit is 10 in the database and in the app', () => {
  const d = def('_editor_limit');
  assert.equal(d.file, CORE);
  assert.match(code(d.body), new RegExp(`select\\s+${EDITOR_LIMIT}\\s*;`));
});

test('it is off until launch, and a malformed switch reads as off', () => {
  const sql = fileText(CORE);
  assert.ok(sql.includes(`values ('editor_limit', '{"enforced": false, "test_owner_ids": []}'::jsonb)`));
  assert.match(sql, /on conflict \(key\) do nothing;/);
  const on = code(def('_editor_limit_on').body);
  assert.match(on, /->>\s*'enforced'\s*=\s*'true'/, 'only a JSON true turns it on');
  assert.match(on, /jsonb_typeof\(c\.value -> 'test_owner_ids'\) = 'array'/);
  assert.match(on, /coalesce\(/, 'no row reads as off');
});

test('a place: the owner, editing members, editor shares on live clusters, waiting editor invites', () => {
  const g = code(def('_account_editor_grants').body);
  for (const s of [
    "m.role in ('owner', 'coowner', 'admin', 'editor')",
    "s.role = 'editor'",
    'b.deleted_at is null',
    "pi.role in ('editor', 'workspace')",
    'pi.claimed_at is null',
    'pi.expires_at > now()',
    'pi.held_at is null',
    'not public._sharer_suspended(pi.invited_by)',
    'not public._user_banned(u.id)',
    'not public._is_service_identity(u.id)',
  ]) assert.ok(g.includes(s), `_account_editor_grants lacks ${s}`);
  assert.doesNotMatch(g, /'viewer'/, 'a viewer never holds a place');
  const s = code(def('_account_editor_slots').body);
  assert.match(s, /distinct on \(g\.user_id\)/, 'an account counts once');
  assert.ok(s.includes('not exists (select 1 from accounts a where a.email = g.email)'),
    'an invite to an address whose account already holds a place is not counted again');
});

test('admission answers before counting when off, locks per account, and one comparison is the rule', () => {
  const a = code(def('_editor_admit').body);
  assert.match(a, /if v_owner is null or not public\._editor_limit_on\(v_owner\) then\s+return 'ok';/);
  assert.ok(a.includes("pg_advisory_xact_lock(hashtext('editor_slots:' || v_owner::text))"));
  assert.ok(a.indexOf('pg_advisory_xact_lock') < a.indexOf('_account_editor_slots'), 'lock, then count');
  assert.match(a, /if v_held then\s+return 'already';/);
  assert.match(a, /if v_used >= public\._editor_limit\(\) then\s+return 'full';/);
});

test('the refusal carries the hint the app reads, worded for who is asking', () => {
  const r = def('_editor_refuse').body;
  assert.ok(r.includes(`hint = '${EDITOR_LIMIT_HINT}'`));
  assert.ok(r.includes(`hint = '${EDITOR_LIMIT_ASK_HINT}'`));
  assert.match(r, /errcode = '42501'/);
  assert.match(r, /'editor limit reached:/);
  assert.doesNotMatch(r, /invite limit reached/, 'the invite budget owns that phrase');
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs`
Expected: FAIL. The first test fails with `no definition of _editor_limit`.

- [ ] **Step 4: Write 0520 sections 1–3**

<!-- write: supabase/migrations/0520_editor_limit_core.sql -->
```sql
-- 0520: the 10-editor limit on Free and Creator — who holds a place, and the
-- check every door makes.
--
-- STATUS: written 2026-10-21. NOT APPLIED until the owner says go.
--
-- The owner (2026-10-20): a personal account, Free or Creator, can have at most
-- 10 people who can edit; a group that needs more buys a Team (design:
-- docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md).
--
-- Counted per ACCOUNT, across every workspace it owns (workspaces.created_by,
-- which every limit already follows). The places:
--   * the owner;
--   * members who can edit (owner, coowner, admin, editor);
--   * editor shares on live clusters;
--   * editor invites still waiting on an address with no account.
-- One place per person. Service accounts (0375) and banned accounts don't
-- count; nor, ever, do viewers.
--
-- Off until launch: app_config.editor_limit = {"enforced": false,
-- "test_owner_ids": []}. With it off, _editor_admit answers 'ok' before it
-- counts anything, so the doors 0521 checks behave exactly as before. An
-- owner listed in test_owner_ids gets the real limit (preview test accounts).
--
-- 0521 puts _editor_admit in every door an editor comes in through.

begin;

-- ── 1. The switch ───────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('editor_limit', '{"enforced": false, "test_owner_ids": []}'::jsonb)
on conflict (key) do nothing;

create or replace function public._editor_limit()
returns integer
language sql
immutable
set search_path = public
as $$
  select 10;
$$;

-- On for everyone once launched, or for an owner listed for testing. A
-- malformed row reads as off: a typo here must never lock every door.
create or replace function public._editor_limit_on(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (c.value ->> 'enforced' = 'true')
        or (jsonb_typeof(c.value -> 'test_owner_ids') = 'array'
            and (c.value -> 'test_owner_ids') ? (p_owner::text))
      from public.app_config c
     where c.key = 'editor_limit'
  ), false);
$$;

-- ── 2. Who holds a place ────────────────────────────────────────────────────

-- Every grant of editing in the account, one row per grant: the owner, each
-- editing membership, each editor share on a live cluster, and each editor
-- invite still waiting on an address. _account_editor_slots folds these to one
-- place per person; list_my_account_editors says where each one edits.
create or replace function public._account_editor_grants(p_owner uuid)
returns table (user_id uuid, email text, source text, workspace_id uuid, board_id uuid)
language sql
stable
security definer
set search_path = public, auth
as $$
  with ws as (
    select w.id from public.workspaces w where w.created_by = p_owner
  ),
  people as (
    select p_owner as user_id, 'owner'::text as source,
           null::uuid as workspace_id, null::uuid as board_id
    union all
    select m.user_id, 'member', m.workspace_id, null::uuid
      from public.workspace_members m
     where m.workspace_id in (select ws.id from ws)
       and m.role in ('owner', 'coowner', 'admin', 'editor')
    union all
    select s.user_id, 'share', b.workspace_id, s.board_id
      from public.board_shares s
      join public.boards b on b.id = s.board_id
     where b.workspace_id in (select ws.id from ws)
       and b.deleted_at is null
       and s.role = 'editor'
  )
  select u.id, lower(u.email), pp.source, pp.workspace_id, pp.board_id
    from people pp
    join auth.users u on u.id = pp.user_id
   where not public._user_banned(u.id)
     and not public._is_service_identity(u.id)
  union all
  -- An invite holds its place until it is claimed, expires or is cancelled.
  -- One the outbound breaker holds (0369), or one sent by an account that is
  -- now suspended, will never be delivered, so it holds nothing.
  select null::uuid, lower(pi.email), 'pending', pi.workspace_id, pi.board_id
    from public.pending_invites pi
   where pi.workspace_id in (select ws.id from ws)
     and pi.role in ('editor', 'workspace')
     and pi.claimed_at is null
     and pi.expires_at > now()
     and pi.held_at is null
     and not public._sharer_suspended(pi.invited_by)
     and (pi.board_id is null
          or exists (select 1 from public.boards b
                      where b.id = pi.board_id and b.deleted_at is null));
$$;

-- One place per person: an account once, however many places it can edit; a
-- waiting invite once per address, and not at all when an account with that
-- address already holds a place.
create or replace function public._account_editor_slots(p_owner uuid)
returns table (slot_key text, user_id uuid, email text, source text)
language sql
stable
security definer
set search_path = public
as $$
  with g as (
    select * from public._account_editor_grants(p_owner)
  ),
  accounts as (
    select distinct on (g.user_id) g.user_id, g.email, g.source
      from g
     where g.user_id is not null
     order by g.user_id, case g.source when 'owner' then 0 when 'member' then 1 else 2 end
  )
  select 'u:' || a.user_id::text, a.user_id, a.email, a.source
    from accounts a
  union all
  select distinct 'e:' || g.email, null::uuid, g.email, 'pending'::text
    from g
   where g.user_id is null
     and not exists (select 1 from accounts a where a.email = g.email);
$$;

create or replace function public._account_editor_count(p_owner uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public._account_editor_slots(p_owner);
$$;

-- ── 3. The check every door makes ───────────────────────────────────────────

-- 'ok' to let one more person edit in this workspace's account; 'already' when
-- they hold a place (an account by id or address, an address by its invite);
-- 'full' when the account has no room. That one comparison is the whole rule,
-- freeze included: an account that ends up over the limit (a transfer, a
-- restore) keeps everyone it has and admits nobody new until it is under.
-- It takes a workspace, not an owner, so a Team's seats (S2a) branch here
-- without touching a door.
create or replace function public._editor_admit(p_workspace uuid, p_user uuid, p_email text default null)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_email text := lower(nullif(btrim(p_email), ''));
  v_used  integer;
  v_held  boolean;
begin
  select w.created_by into v_owner from public.workspaces w where w.id = p_workspace;
  if v_owner is null or not public._editor_limit_on(v_owner) then
    return 'ok';
  end if;

  if v_email is null and p_user is not null then
    select lower(u.email) into v_email from auth.users u where u.id = p_user;
  end if;

  -- One admission at a time per account, so two invites can't both take the
  -- last place. Held until the door's transaction ends.
  perform pg_advisory_xact_lock(hashtext('editor_slots:' || v_owner::text));

  select count(*)::integer,
         coalesce(bool_or((p_user is not null and s.user_id = p_user)
                          or (v_email is not null and s.email = v_email)), false)
    into v_used, v_held
    from public._account_editor_slots(v_owner) s;

  if v_held then
    return 'already';
  end if;
  if v_used >= public._editor_limit() then
    return 'full';
  end if;
  return 'ok';
end;
$$;

-- The refusal, worded for whoever is asking. The hint is the stable key the
-- app reads:
--   * 'editor_limit': the caller is the account's owner, who can make room;
--   * 'editor_limit_ask_owner': anyone else, who can ask the owner.
create or replace function public._editor_refuse(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select w.created_by into v_owner from public.workspaces w where w.id = p_workspace;
  if v_owner is not null and v_owner = auth.uid() then
    raise exception 'editor limit reached: you have % people who can edit across your workspaces, the most a personal plan allows',
      public._editor_limit()
      using errcode = '42501', hint = 'editor_limit';
  end if;
  raise exception 'editor limit reached: this account already has % people who can edit',
    public._editor_limit()
    using errcode = '42501', hint = 'editor_limit_ask_owner';
end;
$$;
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs`
Expected: PASS, 5 tests.

- [ ] **Step 6: No commit yet**

0520 opens with `begin;` and has no `commit;` until Task 2. Every session shares this checkout's `main`, so a local commit gets pushed by whoever pushes next. Task 2 commits the whole file.

---
### Task 2: Notices, the three RPCs, grants and proofs (0520 part 2)

**Files:**
- Modify: `boards/src/lib/editorLimitMigration.test.mjs` (append)
- Modify: `supabase/migrations/0520_editor_limit_core.sql` (append sections 4–7)

**Interfaces:**
- Consumes: Task 1's helpers.
- Produces (SQL):
  - `_notify_editor_limit(p_workspace uuid, p_board uuid, p_actor uuid, p_via text)`. `p_via` is one of `collab_link|workspace_link|ask`. It writes `notifications.kind = 'editors.limit_reached'` to the owner and co-owners, at most once a day per (recipient, actor, via).
  - `_notify_joined_as_viewer(p_user uuid, p_workspace uuid, p_board uuid)`, which writes `kind = 'editors.joined_as_viewer'` once a day per place.
  - `_editor_limit_fallback(p_workspace uuid, p_board uuid, p_joiner uuid, p_via text, p_upgrade boolean default false)`, which sends both notices plus the analytics event `editor_limit_viewer_fallback` and never raises.
  - `get_editor_capacity(p_board_id uuid default null, p_workspace_id uuid default null) → table(enforced boolean, editor_limit integer, used integer, pending integer, is_full boolean, i_am_account_owner boolean, subject text)`.
  - `ask_owner_for_editor_slot(p_board_id uuid default null, p_workspace_id uuid default null) → text`, one of `'sent'|'already_sent'|'not_full'|'owner'`.
  - `list_my_account_editors() → table(slot_key text, user_id uuid, email text, display_name text, source text, workspace_ids uuid[], board_ids uuid[])`.

- [ ] **Step 1: Append the failing tests**

<!-- append: boards/src/lib/editorLimitMigration.test.mjs -->
```js

test('the owner and co-owners hear, once a day per person and route, and a notice never breaks a door', () => {
  const n = def('_notify_editor_limit').body;
  assert.ok(n.includes("'editors.limit_reached'"));
  assert.match(n, /m\.role = 'coowner'/, 'co-owners manage the people too');
  assert.match(n, /continue when r\.user_id is not distinct from p_actor;/, 'not the person who caused it');
  assert.match(n, /interval '24 hours'/);
  assert.match(n, /exception when others then\s+raise warning/);
  const j = def('_notify_joined_as_viewer').body;
  assert.ok(j.includes("'editors.joined_as_viewer'"));
  assert.match(j, /interval '24 hours'/);
  assert.match(j, /exception when others then\s+raise warning/);
  const f = code(def('_editor_limit_fallback').body);
  assert.ok(f.includes('_notify_editor_limit(') && f.includes('_notify_joined_as_viewer('));
  assert.ok(f.includes("'editor_limit_viewer_fallback'"));
  assert.doesNotMatch(f, /token/i, 'a link token never reaches analytics (0474)');
});

test('the app can read the numbers, never who; only the owner gets the list', () => {
  const c = code(def('get_editor_capacity').body);
  assert.match(def('get_editor_capacity').body, /returns table\s*\(\s*enforced boolean,\s*editor_limit integer,\s*used integer,\s*pending integer,\s*is_full boolean,\s*i_am_account_owner boolean,\s*subject text\s*\)/i);
  assert.ok(c.includes('public.can_write_board(p_board_id)'));
  assert.ok(c.includes('public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)'));
  assert.doesNotMatch(c, /email/i, 'numbers only');
  const l = code(def('list_my_account_editors').body);
  assert.ok(l.includes('_account_editor_grants(auth.uid())') && l.includes('_account_editor_slots(auth.uid())'),
    'only the caller\'s own account');
  const a = code(def('ask_owner_for_editor_slot').body);
  for (const s of ["return 'owner';", "return 'not_full';", "return 'already_sent';", "return 'sent';"]) assert.ok(a.includes(s));
  assert.ok(a.includes("_notify_editor_limit(v_ws, p_board_id, auth.uid(), 'ask')"));
});

test('0520: helpers are revoked, the three calls are signed-in only, and the file proves it', () => {
  const sql = fileText(CORE);
  for (const h of [
    '_editor_limit()', '_editor_limit_on(uuid)', '_account_editor_grants(uuid)', '_account_editor_slots(uuid)',
    '_account_editor_count(uuid)', '_editor_admit(uuid, uuid, text)', '_editor_refuse(uuid)',
    '_notify_editor_limit(uuid, uuid, uuid, text)', '_notify_joined_as_viewer(uuid, uuid, uuid)',
    '_editor_limit_fallback(uuid, uuid, uuid, text, boolean)',
  ]) assert.ok(sql.includes(`revoke execute on function public.${h} from public, anon, authenticated;`), `${h} is not revoked`);
  for (const f of ['get_editor_capacity(uuid, uuid)', 'ask_owner_for_editor_slot(uuid, uuid)', 'list_my_account_editors()']) {
    assert.ok(sql.includes(`revoke execute on function public.${f} from public, anon;`), `${f}: anon`);
    assert.ok(sql.includes(`grant execute on function public.${f} to authenticated;`), `${f}: authenticated`);
  }
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /has_function_privilege\('authenticated'/);
  assert.match(sql, /commit;\s*$/);
  for (const fn of ['get_editor_capacity', 'ask_owner_for_editor_slot', 'list_my_account_editors', '_editor_admit', '_account_editor_slots'])
    assert.equal(definitionsOf(fn).length, 1, `${fn} is defined once (no overloads)`);
});
```

- [ ] **Step 2: Run and watch the three new tests fail**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs`
Expected: 5 pass, 3 fail (`no definition of _notify_editor_limit`, …).

- [ ] **Step 3: Append 0520 sections 4–7**

<!-- append: supabase/migrations/0520_editor_limit_core.sql -->
```sql

-- ── 4. Notices ──────────────────────────────────────────────────────────────

-- The owner, and the workspace's co-owners (who manage its people), hear when
-- someone couldn't be made an editor because the account is full: an edit
-- link let someone in as a viewer, or someone asked for room.
--   * Never the person who caused it.
--   * Once a day per (recipient, who, how).
-- A notice must never break the door that sends it.
create or replace function public._notify_editor_limit(p_workspace uuid, p_board uuid, p_actor uuid, p_via text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner uuid;
  v_ws    text;
  v_board text;
  v_name  text;
  v_where text;
  r       record;
begin
  select w.created_by, nullif(btrim(w.name), '') into v_owner, v_ws
    from public.workspaces w where w.id = p_workspace;
  if v_owner is null or not public._editor_limit_on(v_owner) then
    return;
  end if;
  if p_board is not null then
    select nullif(btrim(b.name), '') into v_board from public.boards b where b.id = p_board;
  end if;
  v_where := coalesce('"' || coalesce(v_board, v_ws) || '"', 'your workspace');
  select coalesce(nullif(btrim(p.display_name), ''), u.email, 'Someone')
    into v_name
    from auth.users u left join public.profiles p on p.user_id = u.id
   where u.id = p_actor;
  v_name := coalesce(v_name, 'Someone');

  for r in
    select v_owner as user_id
    union
    select m.user_id from public.workspace_members m
     where m.workspace_id = p_workspace and m.role = 'coowner'
  loop
    continue when r.user_id is not distinct from p_actor;
    continue when exists (
      select 1 from public.notifications n
       where n.user_id = r.user_id
         and n.kind = 'editors.limit_reached'
         and n.actor_id is not distinct from p_actor
         and n.data ->> 'via' = p_via
         and n.created_at > now() - interval '24 hours');
    insert into public.notifications (user_id, kind, workspace_id, board_id, actor_id, title, body, data)
    values (
      r.user_id, 'editors.limit_reached', p_workspace, p_board, p_actor,
      case p_via
        when 'ask' then format('%s asked for room to add an editor', v_name)
        else format('%s joined %s as a viewer', v_name, v_where)
      end,
      case p_via
        when 'ask' then format('Your account has %s people who can edit, the most a personal plan allows. Remove someone to make room.', public._editor_limit())
        else format('They opened an edit link, but your account already has %s people who can edit, so they can view only. Remove someone to make room, then make them an editor.', public._editor_limit())
      end,
      jsonb_build_object('via', p_via, 'editor_limit', public._editor_limit(),
                         'account_owner', r.user_id = v_owner));
  end loop;
exception when others then
  raise warning '_notify_editor_limit failed for %: %', p_workspace, sqlerrm;
end;
$$;

-- The person an edit link let in as a viewer learns why. It lands in their
-- notifications, and as a toast while the app is open. App also shows it once
-- on the next load, because a link is claimed before the app subscribes. Once
-- a day per place.
create or replace function public._notify_joined_as_viewer(p_user uuid, p_workspace uuid, p_board uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place text;
begin
  if exists (select 1 from public.notifications n
              where n.user_id = p_user
                and n.kind = 'editors.joined_as_viewer'
                and n.workspace_id = p_workspace
                and n.board_id is not distinct from p_board
                and n.created_at > now() - interval '24 hours') then
    return;
  end if;
  select coalesce(nullif(btrim(b.name), ''), nullif(btrim(w.name), ''))
    into v_place
    from public.workspaces w
    left join public.boards b on b.id = p_board
   where w.id = p_workspace;
  insert into public.notifications (user_id, kind, workspace_id, board_id, title, body, data)
  values (
    p_user, 'editors.joined_as_viewer', p_workspace, p_board,
    format('You joined %s as a viewer', coalesce('"' || v_place || '"', 'it')),
    format('Its owner''s plan already has %s people who can edit, so you can view for now. We told the owner.', public._editor_limit()),
    jsonb_build_object('editor_limit', public._editor_limit()));
exception when others then
  raise warning '_notify_joined_as_viewer failed for %: %', p_user, sqlerrm;
end;
$$;

-- An edit link let someone in as a viewer because the account was full. Send
-- both notices and log editor_limit_viewer_fallback, so the read can tell how
-- often the limit turns someone away. Never raises.
create or replace function public._editor_limit_fallback(p_workspace uuid, p_board uuid, p_joiner uuid, p_via text, p_upgrade boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._notify_editor_limit(p_workspace, p_board, p_joiner, p_via);
  perform public._notify_joined_as_viewer(p_joiner, p_workspace, p_board);
  begin
    insert into public.analytics_events (user_id, event, props)
    values (p_joiner, 'editor_limit_viewer_fallback',
            jsonb_build_object('via', p_via, 'upgrade', p_upgrade,
                               'workspace_id', p_workspace, 'board_id', p_board));
  exception when others then null;
  end;
end;
$$;

-- ── 5. What the app can ask ─────────────────────────────────────────────────

-- The numbers for the share panel and Members:
--   * is the limit on for this account;
--   * how many places are taken, and how many of those by waiting invites;
--   * is it full;
--   * is the caller the account's owner (who can make room; anyone else asks).
-- Numbers only, never who. `subject` is 'account' for now; a Team will say
-- 'team' (S2a).
create or replace function public.get_editor_capacity(p_board_id uuid default null, p_workspace_id uuid default null)
returns table (enforced boolean, editor_limit integer, used integer, pending integer,
               is_full boolean, i_am_account_owner boolean, subject text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ws    uuid := p_workspace_id;
  v_owner uuid;
  v_on    boolean;
  v_used  integer;
  v_pend  integer;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  if p_board_id is not null then
    select b.workspace_id into v_ws from public.boards b
     where b.id = p_board_id and b.deleted_at is null;
    if v_ws is null or not public.can_write_board(p_board_id) then
      raise exception 'you do not have access to this cluster' using errcode = '42501';
    end if;
  elsif v_ws is null
     or not (public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  select w.created_by into v_owner from public.workspaces w where w.id = v_ws;
  v_on := v_owner is not null and public._editor_limit_on(v_owner);
  select (count(*) filter (where s.source <> 'pending'))::integer,
         (count(*) filter (where s.source = 'pending'))::integer
    into v_used, v_pend
    from public._account_editor_slots(v_owner) s;

  return query select v_on, public._editor_limit(), v_used, v_pend,
                      v_on and v_used + v_pend >= public._editor_limit(),
                      v_owner is not distinct from auth.uid(),
                      'account'::text;
end;
$$;

-- Someone who isn't the owner, turned away by the limit, asks the owner (and
-- co-owners) to make room. A door that refuses rolls back everything it did,
-- its notices included, so asking is a call of its own. It returns:
--   * 'sent';
--   * 'already_sent': they asked within the last day;
--   * 'not_full': there's room after all, or the limit is off for the account;
--   * 'owner': it is their own account.
create or replace function public.ask_owner_for_editor_slot(p_board_id uuid default null, p_workspace_id uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws    uuid := p_workspace_id;
  v_owner uuid;
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if p_board_id is not null then
    select b.workspace_id into v_ws from public.boards b
     where b.id = p_board_id and b.deleted_at is null;
    if v_ws is null or not public.can_write_board(p_board_id) then
      raise exception 'you do not have access to this cluster' using errcode = '42501';
    end if;
  elsif v_ws is null
     or not (public.can_manage_workspace(v_ws) or public._workspace_member_can_write(v_ws)) then
    raise exception 'you do not have access to this workspace' using errcode = '42501';
  end if;

  select w.created_by into v_owner from public.workspaces w where w.id = v_ws;
  if v_owner = auth.uid() then
    return 'owner';
  end if;
  if not public._editor_limit_on(v_owner)
     or public._account_editor_count(v_owner) < public._editor_limit() then
    return 'not_full';
  end if;
  if exists (select 1 from public.notifications n
              where n.user_id = v_owner
                and n.kind = 'editors.limit_reached'
                and n.actor_id = auth.uid()
                and n.data ->> 'via' = 'ask'
                and n.created_at > now() - interval '24 hours') then
    return 'already_sent';
  end if;
  perform public._notify_editor_limit(v_ws, p_board_id, auth.uid(), 'ask');
  return 'sent';
end;
$$;

-- The owner's own list: everyone holding a place, plus the invites still
-- waiting, with where each one can edit, so the owner can choose whom to remove.
create or replace function public.list_my_account_editors()
returns table (slot_key text, user_id uuid, email text, display_name text, source text,
               workspace_ids uuid[], board_ids uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null or not public._actor_active() then
    raise exception 'sign in to see this' using errcode = '42501';
  end if;
  return query
  with g as (
    select * from public._account_editor_grants(auth.uid())
  )
  select s.slot_key, s.user_id, s.email,
         (select nullif(btrim(p.display_name), '') from public.profiles p where p.user_id = s.user_id),
         s.source,
         array(select distinct g.workspace_id from g
                where g.workspace_id is not null
                  and ((s.user_id is not null and g.user_id = s.user_id)
                       or (s.user_id is null and g.user_id is null and g.email = s.email))),
         array(select distinct g.board_id from g
                where g.board_id is not null
                  and ((s.user_id is not null and g.user_id = s.user_id)
                       or (s.user_id is null and g.user_id is null and g.email = s.email)))
    from public._account_editor_slots(auth.uid()) s
   order by (s.source = 'owner') desc, (s.source = 'pending'), s.email;
end;
$$;

-- ── 6. Grants (0311) ────────────────────────────────────────────────────────

revoke execute on function public._editor_limit() from public, anon, authenticated;
revoke execute on function public._editor_limit_on(uuid) from public, anon, authenticated;
revoke execute on function public._account_editor_grants(uuid) from public, anon, authenticated;
revoke execute on function public._account_editor_slots(uuid) from public, anon, authenticated;
revoke execute on function public._account_editor_count(uuid) from public, anon, authenticated;
revoke execute on function public._editor_admit(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._editor_refuse(uuid) from public, anon, authenticated;
revoke execute on function public._notify_editor_limit(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._notify_joined_as_viewer(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._editor_limit_fallback(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

revoke execute on function public.get_editor_capacity(uuid, uuid) from public, anon;
revoke execute on function public.ask_owner_for_editor_slot(uuid, uuid) from public, anon;
revoke execute on function public.list_my_account_editors() from public, anon;
grant execute on function public.get_editor_capacity(uuid, uuid) to authenticated;
grant execute on function public.ask_owner_for_editor_slot(uuid, uuid) to authenticated;
grant execute on function public.list_my_account_editors() to authenticated;

-- ── 7. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public._editor_limit()', 'public._editor_limit_on(uuid)',
    'public._account_editor_grants(uuid)', 'public._account_editor_slots(uuid)',
    'public._account_editor_count(uuid)', 'public._editor_admit(uuid,uuid,text)',
    'public._editor_refuse(uuid)', 'public._notify_editor_limit(uuid,uuid,uuid,text)',
    'public._notify_joined_as_viewer(uuid,uuid,uuid)',
    'public._editor_limit_fallback(uuid,uuid,uuid,text,boolean)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0520: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.get_editor_capacity(uuid,uuid)',
    'public.ask_owner_for_editor_slot(uuid,uuid)',
    'public.list_my_account_editors()'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0520: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0520: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('get_editor_capacity', 'ask_owner_for_editor_slot',
                                  'list_my_account_editors', '_editor_admit',
                                  '_account_editor_slots', '_account_editor_grants')
              group by p.proname having count(*) > 1) then
    raise exception '0520: an overload exists (PGRST203)';
  end if;

  -- Applying this changes nothing for anyone: the switch is off and lists nobody.
  if public._editor_limit_on(gen_random_uuid()) then
    raise exception '0520: the limit is on for an owner nobody listed';
  end if;
end $$;

commit;
```

- [ ] **Step 4: Run and watch all eight pass**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit and push (written, not applied)**

```bash
cd /Users/andrewconklin/soleilpictures-1
F="boards/src/lib/editorLimit.js boards/src/lib/editorLimitMigration.test.mjs supabase/migrations/0520_editor_limit_core.sql"
git add $F && git commit -q -F <msg-file> -- $F
git fetch -q origin main && git merge-base --is-ancestor origin/main HEAD && git push -q origin HEAD:main
```
The message says what 0520 does in house style (one long sentence), that it is written but NOT applied, and ends with the Co-Authored-By line.

---
### Task 3: The four refusing doors (0521 part 1)

**Files:**
- Modify: `boards/src/lib/editorLimitMigration.test.mjs` (append)
- Create: `supabase/migrations/0521_editor_limit_doors.sql` (header and four doors; Task 4 appends the two claims and closes the file)

**Interfaces:**
- Consumes: `_editor_admit`, `_editor_refuse` (Task 1).
- Produces: `share_board`, `invite_workspace_member`, `set_workspace_member_role` and `restore_board_share`, each re-emitted with the same signature and return. When full they raise 42501 with hint `editor_limit` or `editor_limit_ask_owner`.

The bodies below are the live `pg_get_functiondef` text from 2026-10-21, with only the `0521` lines added. Tests in `inviteAbuse.test.mjs`, `inviteUpsert.test.mjs` and `roleCheck.test.mjs` read these bodies too, and must stay green. The check always sits behind its own `if`, never in the same `and`: Postgres doesn't promise to evaluate `and` left to right, and `_editor_admit` takes a lock.

- [ ] **Step 1: Append the failing tests**

<!-- append: boards/src/lib/editorLimitMigration.test.mjs -->
```js

const REFUSING = ['share_board', 'invite_workspace_member', 'set_workspace_member_role', 'restore_board_share'];
const CLAIMS = ['claim_collab_link', 'claim_workspace_invite_link'];

test('every door an editor comes in through checks the limit, and 0188\'s brake is gone', () => {
  for (const fn of [...REFUSING, ...CLAIMS]) {
    const d = latestDefinition(fn);
    if (!d || d.file !== DOORS) continue;   // Task 4 adds the claims
    assert.match(code(d.body), /public\._editor_admit\(/, `${fn} must check the limit`);
    assert.doesNotMatch(code(d.body), /_collab_editor_cap/, `${fn} still calls 0188's brake`);
  }
  for (const fn of REFUSING) assert.equal(def(fn).file, DOORS, `${fn}'s latest definition must be 0521`);
});

test('the doors that must not check: a claimed invite held its place when sent; a transfer is the freeze', () => {
  for (const fn of ['claim_pending_invite', '_claim_pending_invites_for_user', 'transfer_workspace_ownership',
                    'prepare_account_deletion', 'service_account_register', 'create_collab_link',
                    'create_workspace_invite_link']) {
    const d = latestDefinition(fn);
    assert.ok(d, `no definition of ${fn}`);
    assert.doesNotMatch(code(d.body), /_editor_admit\(/, `${fn} must not check the limit`);
  }
});

test('a refusing door checks only for an editor, and before it spends an invite or writes the row that emails', () => {
  for (const fn of ['share_board', 'invite_workspace_member']) {
    const b = code(def(fn).body);
    const pending = b.slice(b.indexOf('if v_user is null then'));
    assert.ok(pending.indexOf('_editor_admit(') > 0
      && pending.indexOf('_editor_admit(') < pending.indexOf('_invite_budget_take()'), `${fn}: a waiting invite checks first`);
    const last = b.lastIndexOf('_editor_admit(');
    assert.ok(last < b.lastIndexOf('_invite_budget_take()'), `${fn}: an account checks before the budget`);
    for (const m of b.matchAll(/_editor_admit\(/g)) {
      const before = b.slice(Math.max(0, m.index - 120), m.index);
      assert.match(before, /if p_role = 'editor' then\s+if public\.$/, `${fn}: only an editor grant is checked`);
    }
  }
  const share = code(def('share_board').body);
  const found = share.slice(share.indexOf('if FOUND then'));
  assert.ok(found.indexOf('you can only change the access of people you invited') < found.indexOf('_editor_admit('),
    'share_board: the "people you invited" rule still answers first');
  assert.ok(found.indexOf('_editor_admit(') < found.indexOf('update board_shares'), 'share_board: a viewer → editor change checks');
  const inv = code(def('invite_workspace_member').body);
  assert.ok(inv.indexOf("return 'already_member';") < inv.lastIndexOf('_editor_admit('),
    'invite_workspace_member: an existing member is "already a member", never "full"');
  const role = code(def('set_workspace_member_role').body);
  assert.match(role, /if p_role in \('coowner', 'editor'\)\s+and exists \(select 1 from workspace_members m[\s\S]*?m\.role = 'viewer'\) then\s+if public\._editor_admit\(p_workspace_id, p_user_id, null\) = 'full' then/,
    'set_workspace_member_role: only a viewer made an editor or co-owner is checked');
  const restore = code(def('restore_board_share').body);
  assert.match(restore, /if r\.role = 'editor' then\s+if public\._editor_admit\(v_workspace, r\.user_id, null\) = 'full' then/);
  for (const fn of REFUSING) assert.match(code(def(fn).body), /perform public\._editor_refuse\(/, `${fn} refuses`);
});
```

- [ ] **Step 2: Run and watch the new tests fail**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs`
Expected: the 3 new tests fail; for example `share_board's latest definition must be 0521` (actual `0391_workspace_coowner.sql`).

- [ ] **Step 3: Write 0521's header and the four doors**

<!-- write: supabase/migrations/0521_editor_limit_doors.sql -->
```sql
-- 0521: the 10-editor limit (0520) at every door an editor comes in through.
--
-- STATUS: written 2026-10-21. NOT APPLIED until the owner says go.
--
-- Each function below is its live body (pg_get_functiondef, 2026-10-21) with
-- the lines marked 0521 and nothing else changed. With app_config.editor_limit
-- off, _editor_admit answers 'ok' before it counts, so every door behaves as
-- it did.
--
--   share_board, invite_workspace_member   an editor invite or share: refused when full
--   set_workspace_member_role              viewer → editor or co-owner: refused when full
--   restore_board_share                    undoing an editor's removal: refused when full
--   claim_collab_link                      an edit link: in as a viewer when full
--   claim_workspace_invite_link            the same for a whole-workspace link
--
-- Not checked, on purpose:
--   * claim_pending_invite and the signup backstop: the invite held its place
--     when it was sent;
--   * transfer_workspace_ownership and the deletion heir: an account over the
--     limit keeps everyone, which is the freeze (S2b re-emits the transfer and
--     adds a freeze line to its notice);
--   * service_account_register: not a person;
--   * making a link: a link holds no place; the person opening it is checked.
--
-- The check always sits behind its own `if`: Postgres doesn't promise to
-- evaluate `and` left to right, and _editor_admit takes a lock.
--
-- 0188's brake (_collab_editor_cap) is no longer called from share_board or
-- claim_collab_link; the function and its app_config row go at launch.

begin;

-- ── share_board ─────────────────────────────────────────────────────────────

create or replace function public.share_board(p_board_id uuid, p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner                uuid;
  v_is_owner             boolean;
  v_user                 uuid;
  v_workspace            uuid;
  v_my_tier              text;
  v_existing_invited_by  uuid;
  v_email_norm           text := lower(trim(p_email));
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once. Owners never reach
  -- can_write_board below, so they never met this check before.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  -- (The 0147 "demo can only invite viewers" block was here. Editor
  -- collaboration is open on every plan; owner-pays caps (0187) are the
  -- resource gate. The 10-editor limit (0520) is checked below.)

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner from workspaces w where w.id = v_workspace;
  -- 0391: a co-owner manages everyone's shares, like the owner.
  v_is_owner := public.can_manage_workspace(v_workspace);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to share this board'
      using errcode = '42501';
  end if;

  -- 0521: 0188's dormant editor-seat brake was here. The 10-editor limit
  -- replaces it, checked below wherever an editor is granted, before any
  -- invite is spent or email sent.

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- Pending path: invitee has no account yet. Re-inviting/refreshing is an
    -- "add" action — allowed for owners and editors; latest inviter owns the
    -- not-yet-claimed pending row.
    --
    -- 0521: a waiting editor invite holds a place, so it needs a free one
    -- (re-sending one that already holds it passes).
    if p_role = 'editor' then
      if public._editor_admit(v_workspace, null, v_email_norm) = 'full' then
        perform public._editor_refuse(v_workspace);
      end if;
    end if;
    --
    -- 0358: only a NEW row fires the invite email (the trigger is AFTER
    -- INSERT), so only a new row spends budget; a refresh does not.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.board_id = p_board_id
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    --
    -- The predicate must match pending_invites_board_unclaimed_uniq EXACTLY —
    -- including `board_id is not null`. Without it Postgres cannot infer the
    -- arbiter and every call raises 42P10 (see migration 0227's header).
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null and board_id is not null
    do update set role       = excluded.role,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  -- Editors may add anyone, but may only CHANGE an existing share if they
  -- created it. A brand-new INSERT is always allowed (subject to tier/role).
  select invited_by into v_existing_invited_by
  from board_shares where board_id = p_board_id and user_id = v_user;
  if FOUND then
    if not v_is_owner and v_existing_invited_by is distinct from auth.uid() then
      raise exception 'you can only change the access of people you invited'
        using errcode = '42501';
    end if;
    -- 0521: a viewer made an editor takes a place; an editor staying one
    -- already has it.
    if p_role = 'editor' then
      if public._editor_admit(v_workspace, v_user, v_email_norm) = 'full' then
        perform public._editor_refuse(v_workspace);
      end if;
    end if;
    -- 0360: they already have access, so this is a role change, not a new
    -- share. It sends no email and spends no budget; before, the panel's role
    -- picker re-sent "X shared Y with you" and used up an invite every time.
    update board_shares
       set role = p_role, invited_by = auth.uid()
     where board_id = p_board_id and user_id = v_user;
    return 'granted';
  end if;

  -- 0521: a new editor share takes a place.
  if p_role = 'editor' then
    if public._editor_admit(v_workspace, v_user, v_email_norm) = 'full' then
      perform public._editor_refuse(v_workspace);
    end if;
  end if;

  -- 0358: the share_notifications row below emails `board_shared`, so a new
  -- share spends budget.
  perform public._invite_budget_take();

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());

  return 'granted';
end;
$function$;

-- ── invite_workspace_member ─────────────────────────────────────────────────

create or replace function public.invite_workspace_member(p_workspace_id uuid, p_email text, p_role text default 'editor')
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user        uuid;
  v_my_tier     text;
  v_email_norm  text := lower(trim(p_email));
begin
  if p_role not in ('editor','viewer') then
    raise exception 'workspace member role must be editor or viewer'
      using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce((select tier from public.profiles where user_id = auth.uid()), 'demo')
    into v_my_tier;
  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;

  -- 0391: the owner or a co-owner.
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can add members'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- 0521: a waiting editor invite holds a place, so it needs a free one
    -- (re-sending one that already holds it passes).
    if p_role = 'editor' then
      if public._editor_admit(p_workspace_id, null, v_email_norm) = 'full' then
        perform public._editor_refuse(p_workspace_id);
      end if;
    end if;
    -- 0358: only a new pending row fires the invite email, so only it spends.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.workspace_id = p_workspace_id
                      and pi.board_id is null
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    -- 0318: 'workspace' is what both claim paths turn into an editor membership;
    -- a viewer invite must stay 'viewer' or the claim promotes it.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, p_workspace_id, null,
            case when p_role = 'viewer' then 'viewer' else 'workspace' end,
            auth.uid())
    on conflict (lower(email), workspace_id) where claimed_at is null and board_id is null
    do update set role       = case when p_role = 'viewer' then 'viewer' else 'workspace' end,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot invite yourself' using errcode = '22023';
  end if;

  -- 0358: an existing member is told so without spending budget; a new one
  -- gets the `workspace_invite` email, so it spends.
  if exists (select 1 from workspace_members m
              where m.workspace_id = p_workspace_id and m.user_id = v_user) then
    return 'already_member';
  end if;

  -- 0521: a new editing member takes a place.
  if p_role = 'editor' then
    if public._editor_admit(p_workspace_id, v_user, v_email_norm) = 'full' then
      perform public._editor_refuse(p_workspace_id);
    end if;
  end if;

  perform public._invite_budget_take();

  begin
    insert into workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_user, p_role);
  exception when unique_violation then
    return 'already_member';
  end;

  return 'granted';
end;
$function$;

-- ── set_workspace_member_role ───────────────────────────────────────────────

create or replace function public.set_workspace_member_role(p_workspace_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner uuid;
begin
  if p_role not in ('coowner', 'editor', 'viewer') then
    raise exception 'role must be coowner, editor or viewer' using errcode = '22023';
  end if;
  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can change roles' using errcode = '42501';
  end if;
  if p_user_id = v_owner then
    raise exception 'the owner''s role is ownership; transfer it instead' using errcode = '42501';
  end if;
  -- 0521: a viewer made an editor or co-owner takes a place; a move between
  -- editor and co-owner, or down to viewer, doesn't.
  if p_role in ('coowner', 'editor')
     and exists (select 1 from workspace_members m
                  where m.workspace_id = p_workspace_id
                    and m.user_id = p_user_id
                    and m.role = 'viewer') then
    if public._editor_admit(p_workspace_id, p_user_id, null) = 'full' then
      perform public._editor_refuse(p_workspace_id);
    end if;
  end if;
  update workspace_members
     set role = p_role
   where workspace_id = p_workspace_id
     and user_id = p_user_id
     and role in ('coowner', 'editor', 'viewer');
  if not found then
    raise exception 'not a member with a changeable role' using errcode = 'P0002';
  end if;
end;
$function$;

-- ── restore_board_share ─────────────────────────────────────────────────────

create or replace function public.restore_board_share(p_board_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  r            public.board_share_removals%rowtype;
  v_is_manager boolean;
  v_workspace  uuid;
begin
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select * into r from public.board_share_removals s
   where s.board_id = p_board_id and s.user_id = p_user_id;
  -- An undo, not a share: the remover, while the undo is on screen.
  if not found or r.removed_by is distinct from auth.uid()
     or r.removed_at < now() - interval '15 minutes' then
    raise exception 'that access can no longer be put back' using errcode = '42501';
  end if;

  select b.workspace_id, public.can_manage_workspace(b.workspace_id)
    into v_workspace, v_is_manager
    from public.boards b where b.id = p_board_id and b.deleted_at is null;
  if not found then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;
  if not coalesce(v_is_manager, false) and not public.can_write_board(p_board_id) then
    raise exception 'you do not have permission to manage this board''s access'
      using errcode = '42501';
  end if;

  -- 0521: putting an editor back takes a place again, and someone may have
  -- taken it since.
  if r.role = 'editor' then
    if public._editor_admit(v_workspace, r.user_id, null) = 'full' then
      perform public._editor_refuse(v_workspace);
    end if;
  end if;

  -- No _invite_budget_take and no share_notifications row: nothing is sent.
  insert into public.board_shares (board_id, user_id, role, invited_by, created_at, via_link_token)
  values (r.board_id, r.user_id, r.role,
          (select u.id from auth.users u where u.id = r.invited_by),
          r.shared_at,
          (select l.token from public.public_share_links l where l.token = r.via_link_token))
  on conflict (board_id, user_id) do nothing;
  return 'restored';
end $function$;
```

- [ ] **Step 4: Run the whole suite**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs src/lib/inviteAbuse.test.mjs src/lib/inviteUpsert.test.mjs src/lib/roleCheck.test.mjs`
Expected: all pass. If an existing test fails, a body drifted from the live text: diff it against `pg_get_functiondef` and fix it there, never in the old test.

- [ ] **Step 5: No commit yet.** 0521 opens with `begin;` and has no `commit;` until Task 4 finishes it.

---
### Task 4: The two link claims, proofs, commit (0521 part 2)

**Files:**
- Modify: `boards/src/lib/editorLimitMigration.test.mjs` (append)
- Modify: `supabase/migrations/0521_editor_limit_doors.sql` (append the claims and the proofs, then `commit;`)

**Interfaces:**
- Consumes: `_editor_admit`, `_editor_limit_fallback` (Tasks 1–2).
- Produces: `claim_collab_link(uuid)` and `claim_workspace_invite_link(uuid)` with the same return tables and status words.
  - When full, an editor link inserts the person as a **viewer** and returns `role = 'viewer'`, `status = 'joined'`.
  - When full, a viewer on the cluster who opens an editor link stays a viewer and gets `('viewer', 'already')` back instead of `'upgraded'`.
  - Both cases call `_editor_limit_fallback`.

- [ ] **Step 1: Append the failing tests**

<!-- append: boards/src/lib/editorLimitMigration.test.mjs -->
```js

test('an edit link opened when full lets them in as a viewer, tells them and the owner, and never refuses', () => {
  for (const [fn, via] of [['claim_collab_link', 'collab_link'], ['claim_workspace_invite_link', 'workspace_link']]) {
    const d = def(fn);
    assert.equal(d.file, DOORS, `${fn}'s latest definition must be 0521`);
    const b = code(d.body);
    assert.match(b, /if v_link\.role = 'editor' then\s+if public\._editor_admit\(/, `${fn}: only an edit link is checked`);
    assert.match(b, /v_role := 'viewer';\s+v_fallback := true;/, `${fn}: falls back to viewer`);
    assert.ok(b.includes(`'${via}', false)`), `${fn}: notices and event on a fresh join`);
    assert.doesNotMatch(b, /_editor_refuse\(/, `${fn}: a link never refuses`);
    assert.doesNotMatch(b, /_collab_editor_cap/, `${fn}: 0188's brake is gone`);
    assert.doesNotMatch(b, /v_link\.role, auth\.uid\(\)/, `${fn}: the role granted is v_role, not the link's`);
  }
  const c = code(def('claim_collab_link').body);
  const up = c.slice(c.indexOf("if v_existing.role = 'viewer' and v_link.role = 'editor' then"));
  assert.ok(up.indexOf('_editor_admit(') < up.indexOf("set role = 'editor'"), 'the upgrade checks before it upgrades');
  assert.ok(up.includes("'collab_link', true)"), 'a blocked upgrade is logged as one');
});

test('the claims keep their shape and words (AuthGate, check_instrumentation 0472 and the link tests read them)', () => {
  assert.match(def('claim_collab_link').body,
    /returns table\s*\(\s*workspace_id uuid,\s*board_id uuid,\s*role text,\s*status text\s*\)/i);
  assert.match(def('claim_workspace_invite_link').body,
    /returns table\s*\(\s*workspace_id uuid,\s*role text,\s*status text\s*\)/i);
  const c = def('claim_collab_link').body;
  for (const s of ["'noop'::text", "'upgraded'::text", "'already'::text", "v_status       text := 'joined'"]) assert.ok(c.includes(s), `claim_collab_link lost ${s}`);
  const w = def('claim_workspace_invite_link').body;
  for (const s of ["'dead'::text", "'member'::text", "'joined'::text", "'status', 'joined'"]) assert.ok(w.includes(s), `claim_workspace_invite_link lost ${s}`);
});

test('0521: the doors keep their grants, have no overloads, and the file proves it', () => {
  const sql = fileText(DOORS);
  for (const sig of ['share_board(uuid,text,text)', 'invite_workspace_member(uuid,text,text)',
                     'set_workspace_member_role(uuid,uuid,text)', 'restore_board_share(uuid,uuid)',
                     'claim_collab_link(uuid)', 'claim_workspace_invite_link(uuid)'])
    assert.ok(sql.includes(`'public.${sig}'`), `0521 must prove ${sig}`);
  assert.match(sql, /having count\(\*\) > 1/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(code(sql), /\bdrop\s+function\b/i, 'no DROP: create or replace keeps each ACL');
});
```

- [ ] **Step 2: Run and watch the three new tests fail**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs`
Expected: 3 failures, for example `claim_collab_link's latest definition must be 0521` (actual `0371_…`).

- [ ] **Step 3: Append the claims, the proofs and `commit;`**

<!-- append: supabase/migrations/0521_editor_limit_doors.sql -->
```sql

-- ── claim_collab_link ───────────────────────────────────────────────────────

create or replace function public.claim_collab_link(p_token uuid)
returns table(workspace_id uuid, board_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public, auth
as $function$
#variable_conflict use_column
declare
  v_link         public_share_links%rowtype;
  v_workspace    uuid;
  v_owner        uuid;
  v_existing     board_shares%rowtype;
  v_role         text;
  v_fallback     boolean := false;
  v_joiner_name  text;
  v_status       text := 'joined';
  v_is_new_user  boolean;
  v_has_card     boolean;
  v_ref_ins      int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join' using errcode = '42501';
  end if;
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select * into v_link from public_share_links where token = p_token;
  if not found or v_link.kind is distinct from 'invite' then
    raise exception 'invite link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'this invite link was turned off' using errcode = '22023';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'this invite link has expired' using errcode = '22023';
  end if;
  -- 0371: a link from a banned account, or a new one under review, is off.
  if public._sharer_suspended(v_link.created_by) then
    raise exception 'this invite link was turned off' using errcode = '22023';
  end if;

  select b.workspace_id, w.created_by into v_workspace, v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = v_link.board_id and b.deleted_at is null;
  if v_workspace is null then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;
  -- 0371: and nobody joins a banned account's cluster.
  if public._user_banned(v_owner) then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;

  -- Already the owner / a workspace member — nothing to grant.
  if v_owner = auth.uid() or is_workspace_member(v_workspace) then
    return query select v_workspace, v_link.board_id, 'owner'::text, 'noop'::text;
    return;
  end if;

  select * into v_existing
  from board_shares bs
  where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
  if found then
    if v_existing.role = 'viewer' and v_link.role = 'editor' then
      -- 0521: when the account has no room for another editor, a viewer who
      -- opens an edit link stays a viewer, is told why, and the owner hears.
      if public._editor_admit(v_workspace, auth.uid(), null) = 'full' then
        perform public._editor_limit_fallback(v_workspace, v_link.board_id, auth.uid(), 'collab_link', true);
        return query select v_workspace, v_link.board_id, 'viewer'::text, 'already'::text;
        return;
      end if;
      update board_shares bs
         set role = 'editor', via_link_token = coalesce(bs.via_link_token, v_link.token)
       where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
      return query select v_workspace, v_link.board_id, 'editor'::text, 'upgraded'::text;
    else
      return query select v_workspace, v_link.board_id, v_existing.role, 'already'::text;
    end if;
    return;
  end if;

  -- 0521: 0188's dormant brake was here, and it refused the join. The
  -- 10-editor limit lets them in as a viewer instead, then tells them why and
  -- tells the owner (below, once the share exists).
  v_role := v_link.role;
  if v_link.role = 'editor' then
    if public._editor_admit(v_workspace, auth.uid(), null) = 'full' then
      v_role := 'viewer';
      v_fallback := true;
    end if;
  end if;

  insert into board_shares (board_id, user_id, role, invited_by, via_link_token)
  values (v_link.board_id, auth.uid(), v_role, v_link.created_by, v_link.token)
  on conflict (board_id, user_id) do nothing;

  -- Payoff notification to the link creator (in-app toast + email via the
  -- share_notifications trigger). Never let it break the claim.
  begin
    if v_link.created_by is not null and v_link.created_by <> auth.uid() then
      select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
        into v_joiner_name
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      where u.id = auth.uid();
      insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
      values (v_link.created_by, v_link.board_id, v_role, auth.uid(), 'joined', v_joiner_name);
    end if;
  exception when others then
    raise warning 'claim_collab_link: joined notification failed: %', sqlerrm;
  end;

  -- 0521: in as a viewer because the account is full: say so, both ways.
  if v_fallback then
    perform public._editor_limit_fallback(v_workspace, v_link.board_id, auth.uid(), 'collab_link', false);
  end if;

  -- Referral ledger (0163 parity): a NEW account (< 7 days) joining via a
  -- collab link credits the link creator, source='collab'. If the referee
  -- already placed their first card, grant the referrer reward immediately
  -- (the _stamp_first_card trigger has already fired and won't again).
  begin
    select (u.created_at > now() - interval '7 days') into v_is_new_user
    from auth.users u where u.id = auth.uid();
    if coalesce(v_is_new_user, false)
       and v_link.created_by is not null
       and v_link.created_by <> auth.uid() then
      insert into public.referrals (referrer_id, referee_id, source, status, meta)
      values (v_link.created_by, auth.uid(), 'collab', 'pending',
              jsonb_build_object('via', 'invite_link', 'token', v_link.token::text))
      on conflict (referee_id) do nothing;
      get diagnostics v_ref_ins = row_count;
      if v_ref_ins > 0 then
        update public.profiles
           set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
         where user_id = auth.uid();
        insert into public.analytics_events (user_id, event, props)
        values (auth.uid(), 'referral_signup',
                jsonb_build_object('source', 'collab', 'via', 'invite_link'));
        select (first_card_at is not null) into v_has_card
        from public.profiles where user_id = auth.uid();
        if coalesce(v_has_card, false) then
          perform public.grant_referral_reward(auth.uid());
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'claim_collab_link: referral block failed: %', sqlerrm;
  end;

  -- Server-fired analytics (mirrors referral_signup's pattern).
  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'invite_link_claimed',
            jsonb_build_object('board_id', v_link.board_id, 'role', v_role, 'status', v_status));
  exception when others then null;
  end;

  return query select v_workspace, v_link.board_id, v_role, v_status;
end;
$function$;

-- ── claim_workspace_invite_link ─────────────────────────────────────────────

create or replace function public.claim_workspace_invite_link(p_token uuid)
returns table(workspace_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public, auth
as $function$
#variable_conflict use_column
declare
  c_burst        constant integer  := 15;
  c_burst_window constant interval := interval '10 minutes';
  v_link        public.workspace_invite_links%rowtype;
  v_owner       uuid;
  v_mine        text;
  v_recent      integer;
  v_ins         integer := 0;
  v_role        text;
  v_fallback    boolean := false;
  v_is_new_user boolean;
  v_has_card    boolean;
  v_ref_ins     integer := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  -- One join at a time per link, so the use count and the burst count are exact.
  select * into v_link from public.workspace_invite_links l where l.token = p_token for update;
  if not found or not public._workspace_invite_link_live(p_token) then
    return query select null::uuid, null::text, 'dead'::text;
    return;
  end if;

  select w.created_by into v_owner from public.workspaces w where w.id = v_link.workspace_id;
  if v_owner = auth.uid() then
    return query select v_link.workspace_id, 'owner'::text, 'member'::text;
    return;
  end if;
  select m.role into v_mine from public.workspace_members m
   where m.workspace_id = v_link.workspace_id and m.user_id = auth.uid();
  if v_mine is not null then
    return query select v_link.workspace_id, v_mine, 'member'::text;
    return;
  end if;

  -- A burst: the link is being passed around far beyond a team. Turn it off
  -- for good and page; the people already in stay in.
  select count(*) into v_recent
    from public.workspace_invite_link_joins j
   where j.token = v_link.token and j.joined_at > now() - c_burst_window;
  if v_recent >= c_burst then
    update public.workspace_invite_links l
       set revoked_at = now(), revoked_reason = 'burst'
     where l.token = v_link.token;
    perform public.ops_alert_raise(
      'workspace_link_burst',
      'A workspace invite link was turned off for too many joins at once',
      v_recent || ' joins within ' || (extract(epoch from c_burst_window) / 60)::integer
        || ' minutes on one link into workspace ' || v_link.workspace_id
        || ', made by ' || v_link.created_by
        || E'.\nThe link is off for good. The people it let in are still members.',
      true, 'workspace_link_burst:' || v_link.workspace_id, interval '1 hour', v_link.created_by);
    return query select null::uuid, null::text, 'dead'::text;
    return;
  end if;

  -- 0521: when the account has no room for another editor, an edit link lets
  -- them in as a viewer; the join still counts toward the link's uses.
  v_role := v_link.role;
  if v_link.role = 'editor' then
    if public._editor_admit(v_link.workspace_id, auth.uid(), null) = 'full' then
      v_role := 'viewer';
      v_fallback := true;
    end if;
  end if;

  -- They clicked Join; the member email trigger skips this insert.
  perform set_config('soleil.ws_link_join', '1', true);
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_link.workspace_id, auth.uid(), v_role)
  on conflict (workspace_id, user_id) do nothing;
  get diagnostics v_ins = row_count;
  perform set_config('soleil.ws_link_join', '', true);
  if v_ins = 0 then
    return query select v_link.workspace_id,
      (select m.role from public.workspace_members m
        where m.workspace_id = v_link.workspace_id and m.user_id = auth.uid()),
      'member'::text;
    return;
  end if;

  insert into public.workspace_invite_link_joins (token, workspace_id, user_id)
  values (v_link.token, v_link.workspace_id, auth.uid());

  -- The maker hears about it (in-app, and email through share_notifications).
  -- _joined_notification never raises.
  perform public._joined_notification(v_link.created_by, null, v_link.workspace_id, v_role, auth.uid());

  -- 0521: in as a viewer because the account is full: say so, both ways.
  if v_fallback then
    perform public._editor_limit_fallback(v_link.workspace_id, null, auth.uid(), 'workspace_link', false);
  end if;

  -- A new account joining is the maker's referral, as on a collab link.
  begin
    select (u.created_at > now() - interval '7 days') into v_is_new_user
    from auth.users u where u.id = auth.uid();
    if coalesce(v_is_new_user, false) and v_link.created_by <> auth.uid() then
      insert into public.referrals (referrer_id, referee_id, source, status, meta)
      values (v_link.created_by, auth.uid(), 'collab', 'pending',
              jsonb_build_object('via', 'workspace_link', 'workspace_id', v_link.workspace_id::text))
      on conflict (referee_id) do nothing;
      get diagnostics v_ref_ins = row_count;
      if v_ref_ins > 0 then
        update public.profiles
           set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
         where user_id = auth.uid();
        insert into public.analytics_events (user_id, event, props)
        values (auth.uid(), 'referral_signup',
                jsonb_build_object('source', 'collab', 'via', 'workspace_link'));
        select (first_card_at is not null) into v_has_card
        from public.profiles where user_id = auth.uid();
        if coalesce(v_has_card, false) then
          perform public.grant_referral_reward(auth.uid());
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'claim_workspace_invite_link: referral block failed: %', sqlerrm;
  end;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'workspace_link_claimed',
            jsonb_build_object('workspace_id', v_link.workspace_id, 'role', v_role, 'status', 'joined'));
  exception when others then null;
  end;

  return query select v_link.workspace_id, v_role, 'joined'::text;
end;
$function$;

-- ── Proofs (the 0311 habit) ─────────────────────────────────────────────────
-- create or replace kept each door's grants; prove it, and that no overload
-- appeared.

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.share_board(uuid,text,text)',
    'public.invite_workspace_member(uuid,text,text)',
    'public.set_workspace_member_role(uuid,uuid,text)',
    'public.restore_board_share(uuid,uuid)',
    'public.claim_collab_link(uuid)',
    'public.claim_workspace_invite_link(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0521: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0521: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('share_board', 'invite_workspace_member', 'set_workspace_member_role',
                                  'restore_board_share', 'claim_collab_link', 'claim_workspace_invite_link')
              group by p.proname having count(*) > 1) then
    raise exception '0521: a door has an overload (PGRST203)';
  end if;
end $$;

commit;
```

- [ ] **Step 4: Run every test that reads these bodies**

Run: `cd boards && node --test src/lib/editorLimitMigration.test.mjs src/lib/workspaceInviteLink.test.mjs src/lib/inviteAbuse.test.mjs src/lib/inviteUpsert.test.mjs src/lib/roleCheck.test.mjs src/lib/securityAudit.test.mjs`
Expected: all pass. Then run `cd boards && npm test` and expect it green, apart from failures that `git stash`-free inspection shows are another session's work in progress. Name those in the report.

- [ ] **Step 5: Commit and push (written, not applied)**

```bash
cd /Users/andrewconklin/soleilpictures-1
F="boards/src/lib/editorLimitMigration.test.mjs supabase/migrations/0521_editor_limit_doors.sql"
git add $F && git commit -q -F <msg-file> -- $F
git fetch -q origin main && git merge-base --is-ancestor origin/main HEAD && git push -q origin HEAD:main
```

---
### Task 5: The rolled-back probe against the real database

**Files:**
- Create (scratchpad only, never committed): `probe_editor_limit.sql`, built by `build_probe.py`

**Why this shape:** the probe runs both migrations and every check inside **one** `do $probe$ … $probe$;` statement that always ends in `raise exception 'PROBE_REPORT …'`. A single statement that raises rolls back everything it did, the `create or replace function`s included, whatever transaction mode the MCP endpoint uses. Checked on 2026-10-21: a multi-statement `execute $m$ … $m$` with a nested `do $$` runs inside a DO block as `postgres`, and the final raise leaves nothing behind. It applies nothing.

- [ ] **Step 1: Write the probe's checks**

<!-- write: SCRATCH/probe_checks.sql -->
```sql
  -- fixtures: an owner and 15 people, 30 days old (so the invite budget is
  -- the everyday 20, not a new account's 5); addresses on .invalid
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', o, 'authenticated', 'authenticated',
          'probe-owner@probe.invalid', '{"provider":"email"}', '{}',
          now() - interval '30 days', now(), now() - interval '30 days');
  for i in 1..15 loop
    p := p || gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at, email_confirmed_at)
    values ('00000000-0000-0000-0000-000000000000', p[i], 'authenticated', 'authenticated',
            format('probe-%s@probe.invalid', i), '{"provider":"email"}', '{}',
            now() - interval '30 days', now(), now() - interval '30 days');
  end loop;
  update public.app_config
     set value = jsonb_build_object('enforced', false, 'test_owner_ids', jsonb_build_array(o::text))
   where key = 'editor_limit';

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  v := public.create_workspace_with_root('Probe', 'Probe root');
  ws := (v ->> 'workspace_id')::uuid;
  root := (v ->> 'root_board_id')::uuid;
  insert into public.boards (workspace_id, parent_board_id, name, created_by)
  values (ws, root, 'Probe child', o) returning id into child;

  -- 1. a fresh account holds one place: its owner
  n := public._account_editor_count(o);
  rep := rep || format(E'\n%s 1 owner only: %s', case when n = 1 then 'ok' else 'FAIL' end, n);

  -- 2. eight editors by share, 3. one waiting editor invite: 10 places
  for i in 1..8 loop
    r := public.share_board(root, format('probe-%s@probe.invalid', i), 'editor');
  end loop;
  r := public.share_board(root, 'nobody-1@probe.invalid', 'editor');
  n := public._account_editor_count(o);
  rep := rep || format(E'\n%s 2-3 eight shares + one invite: %s places, invite=%s',
                       case when n = 10 and r = 'pending' then 'ok' else 'FAIL' end, n, r);

  -- 4. the owner's 11th editor is refused, worded for the owner
  begin
    perform public.share_board(root, 'probe-9@probe.invalid', 'editor');
    rep := rep || E'\nFAIL 4 an 11th editor got in';
  exception when others then
    get stacked diagnostics h = pg_exception_hint, m = message_text;
    rep := rep || format(E'\n%s 4 owner refused: hint=%s msg=%s', case when h = 'editor_limit' then 'ok' else 'FAIL' end, h, m);
  end;

  -- 5. a viewer still gets in when full
  r := public.share_board(root, 'probe-9@probe.invalid', 'viewer');
  rep := rep || format(E'\n%s 5 viewer when full: %s', case when r = 'granted' then 'ok' else 'FAIL' end, r);

  -- 6. an editor (not the owner) adding an editor is told to ask the owner
  perform set_config('request.jwt.claims', json_build_object('sub', p[1], 'role', 'authenticated')::text, true);
  begin
    perform public.share_board(root, 'probe-10@probe.invalid', 'editor');
    rep := rep || E'\nFAIL 6 an editor added an 11th';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    rep := rep || format(E'\n%s 6 editor refused: hint=%s', case when h = 'editor_limit_ask_owner' then 'ok' else 'FAIL' end, h);
  end;

  -- 7. asking: sent, then already_sent; one notice for the owner
  r := public.ask_owner_for_editor_slot(root, null);
  r2 := public.ask_owner_for_editor_slot(root, null);
  select count(*) into n from public.notifications
   where user_id = o and kind = 'editors.limit_reached' and data ->> 'via' = 'ask';
  rep := rep || format(E'\n%s 7 ask: %s then %s, owner notices=%s',
                       case when r = 'sent' and r2 = 'already_sent' and n = 1 then 'ok' else 'FAIL' end, r, r2, n);

  -- 8. a place already held passes: the invite re-sent, an editor on a second cluster
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  r := public.share_board(root, 'nobody-1@probe.invalid', 'editor');
  r2 := public.share_board(child, 'probe-1@probe.invalid', 'editor');
  rep := rep || format(E'\n%s 8 held places pass: %s, %s',
                       case when r = 'pending' and r2 = 'granted' then 'ok' else 'FAIL' end, r, r2);

  -- 9. the numbers: an editor sees them, the owner is told it's theirs, a stranger is refused
  perform set_config('request.jwt.claims', json_build_object('sub', p[1], 'role', 'authenticated')::text, true);
  select to_jsonb(c) into v from public.get_editor_capacity(root, null) c;
  rep := rep || format(E'\n%s 9a capacity as an editor: %s',
                       case when (v->>'enforced')::boolean and (v->>'used')::int = 9 and (v->>'pending')::int = 1
                                 and (v->>'is_full')::boolean and not (v->>'i_am_account_owner')::boolean
                            then 'ok' else 'FAIL' end, v);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  select to_jsonb(c) into v from public.get_editor_capacity(null, ws) c;
  rep := rep || format(E'\n%s 9b capacity as the owner: mine=%s', case when (v->>'i_am_account_owner')::boolean then 'ok' else 'FAIL' end, v->>'i_am_account_owner');
  perform set_config('request.jwt.claims', json_build_object('sub', p[10], 'role', 'authenticated')::text, true);
  begin
    perform public.get_editor_capacity(root, null);
    rep := rep || E'\nFAIL 9c a stranger read the numbers';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    rep := rep || format(E'\n%s 9c stranger refused: %s', case when st = '42501' then 'ok' else 'FAIL' end, st);
  end;

  -- 10. an edit link when full: in as a viewer, told, owner told, event logged
  tok := gen_random_uuid();
  insert into public.public_share_links (token, board_id, role, created_by, kind)
  values (tok, root, 'editor', o, 'invite');
  select to_jsonb(c) into v from public.claim_collab_link(tok) c;   -- still p10
  select count(*) into n from public.notifications where user_id = p[10] and kind = 'editors.joined_as_viewer';
  select count(*) into n2 from public.notifications where user_id = o and kind = 'editors.limit_reached' and data ->> 'via' = 'collab_link';
  select count(*) into n3 from public.analytics_events where user_id = p[10] and event = 'editor_limit_viewer_fallback';
  select bs.role into r from public.board_shares bs where bs.board_id = root and bs.user_id = p[10];
  rep := rep || format(E'\n%s 10 collab link when full: %s share=%s joiner=%s owner=%s event=%s places=%s',
                       case when v->>'role' = 'viewer' and v->>'status' = 'joined' and r = 'viewer'
                                 and n = 1 and n2 = 1 and n3 = 1 and public._account_editor_count(o) = 10
                            then 'ok' else 'FAIL' end, v, r, n, n2, n3, public._account_editor_count(o));

  -- 11. opening it again: still a viewer, no second notice either way
  select to_jsonb(c) into v from public.claim_collab_link(tok) c;
  select count(*) into n from public.notifications where user_id = p[10] and kind = 'editors.joined_as_viewer';
  select count(*) into n2 from public.notifications where user_id = o and kind = 'editors.limit_reached' and data ->> 'via' = 'collab_link';
  rep := rep || format(E'\n%s 11 reopened: %s joiner=%s owner=%s',
                       case when v->>'role' = 'viewer' and v->>'status' = 'already' and n = 1 and n2 = 1 then 'ok' else 'FAIL' end, v, n, n2);

  -- 12. a viewer opening an edit link when full is not upgraded
  perform set_config('request.jwt.claims', json_build_object('sub', p[9], 'role', 'authenticated')::text, true);
  select to_jsonb(c) into v from public.claim_collab_link(tok) c;
  select count(*) into n from public.analytics_events
   where user_id = p[9] and event = 'editor_limit_viewer_fallback' and (props ->> 'upgrade')::boolean;
  rep := rep || format(E'\n%s 12 upgrade blocked: %s event=%s',
                       case when v->>'role' = 'viewer' and v->>'status' = 'already' and n = 1 then 'ok' else 'FAIL' end, v, n);

  -- 13. a whole-workspace edit link when full: a viewer member
  wtok := gen_random_uuid();
  insert into public.workspace_invite_links (token, workspace_id, role, created_by, expires_at, max_uses)
  values (wtok, ws, 'editor', o, now() + interval '7 days', 25);
  perform set_config('request.jwt.claims', json_build_object('sub', p[11], 'role', 'authenticated')::text, true);
  select to_jsonb(c) into v from public.claim_workspace_invite_link(wtok) c;
  select m.role into r from public.workspace_members m where m.workspace_id = ws and m.user_id = p[11];
  select count(*) into n from public.notifications where user_id = o and kind = 'editors.limit_reached' and data ->> 'via' = 'workspace_link';
  rep := rep || format(E'\n%s 13 workspace link when full: %s member=%s owner=%s',
                       case when v->>'role' = 'viewer' and v->>'status' = 'joined' and r = 'viewer' and n = 1 then 'ok' else 'FAIL' end, v, r, n);

  -- 14. invite_workspace_member: an existing member is "already", a new address is refused
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  r := public.invite_workspace_member(ws, 'probe-11@probe.invalid', 'editor');
  begin
    perform public.invite_workspace_member(ws, 'nobody-2@probe.invalid', 'editor');
    rep := rep || E'\nFAIL 14 a workspace invite got in when full';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    rep := rep || format(E'\n%s 14 member=%s, new invite hint=%s',
                         case when r = 'already_member' and h = 'editor_limit' then 'ok' else 'FAIL' end, r, h);
  end;

  -- 15. making a viewer member an editor is refused when full
  begin
    perform public.set_workspace_member_role(ws, p[11], 'editor');
    rep := rep || E'\nFAIL 15 a viewer member became an editor when full';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    rep := rep || format(E'\n%s 15 role change refused: hint=%s', case when h = 'editor_limit' then 'ok' else 'FAIL' end, h);
  end;

  -- 16. a banned editor frees a place, and the role change then goes through
  insert into public.profiles (user_id, banned_at) values (p[2], now())
  on conflict (user_id) do update set banned_at = now();
  n := public._account_editor_count(o);
  perform public.set_workspace_member_role(ws, p[11], 'editor');
  rep := rep || format(E'\n%s 16 banned frees a place: %s, then %s',
                       case when n = 9 and public._account_editor_count(o) = 10 then 'ok' else 'FAIL' end, n, public._account_editor_count(o));

  -- 17. a service identity never takes a place
  svc := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', svc, 'authenticated', 'authenticated',
          'svc+probe@service.soleilpictures.com', '{"provider":"email"}', '{"service_account":"true"}', now(), now());
  insert into public.board_shares (board_id, user_id, role, invited_by) values (root, svc, 'editor', o);
  n := public._account_editor_count(o);
  rep := rep || format(E'\n%s 17 service identity: %s', case when n = 10 then 'ok' else 'FAIL' end, n);

  -- 18. the freeze: pushed over by a restore-like write, everyone keeps
  -- editing, nobody new gets in, and an invite sent earlier still lands
  insert into public.board_shares (board_id, user_id, role, invited_by) values (root, p[12], 'editor', o), (root, p[13], 'editor', o);
  perform set_config('request.jwt.claims', json_build_object('sub', p[12], 'role', 'authenticated')::text, true);
  b := public.can_write_board(root);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  begin
    perform public.share_board(root, 'probe-14@probe.invalid', 'editor');
    rep := rep || E'\nFAIL 18 someone new got in over the limit';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    rep := rep || format(E'\n%s 18a over the limit: %s places, over-limit editor writes=%s, new one hint=%s',
                         case when public._account_editor_count(o) = 12 and b and h = 'editor_limit' then 'ok' else 'FAIL' end,
                         public._account_editor_count(o), b, h);
  end;
  -- nobody-1 holds its place from step 3; their sign-up claims it (by the
  -- invite's token, as the email link does) although the account is over
  insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', late, 'authenticated', 'authenticated',
          'nobody-1@probe.invalid', '{"provider":"email"}', '{}', now(), now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', late, 'role', 'authenticated')::text, true);
  begin
    perform public.claim_pending_invite(pi.token) from public.pending_invites pi
     where lower(pi.email) = 'nobody-1@probe.invalid' and pi.claimed_at is null;
  exception when others then
    get stacked diagnostics m = message_text;
    rep := rep || format(E'\n(18b claim raised: %s)', m);
  end;
  select bs.role into r from public.board_shares bs where bs.board_id = root and bs.user_id = late;
  rep := rep || format(E'\n%s 18b an invite sent earlier lands although over: %s', case when r = 'editor' then 'ok' else 'FAIL' end, r);

  -- 19. undoing an editor's removal when full is refused
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  delete from public.board_shares where board_id = root and user_id = p[3];
  insert into public.board_share_removals (board_id, user_id, role, invited_by, shared_at, removed_by, removed_at)
  values (root, p[3], 'editor', o, now() - interval '1 day', o, now())
  on conflict do nothing;
  begin
    perform public.restore_board_share(root, p[3]);
    rep := rep || E'\nFAIL 19 an undo got back in over the limit';
  exception when others then
    get stacked diagnostics h = pg_exception_hint;
    rep := rep || format(E'\n%s 19 undo refused: hint=%s', case when h = 'editor_limit' then 'ok' else 'FAIL' end, h);
  end;

  -- 20. the owner's list holds every place
  select count(*) into n from public.list_my_account_editors();
  rep := rep || format(E'\n%s 20 list rows=%s places=%s', case when n = public._account_editor_count(o) then 'ok' else 'FAIL' end, n, public._account_editor_count(o));

  -- 21. off again: every door as before
  update public.app_config set value = '{"enforced": false, "test_owner_ids": []}'::jsonb where key = 'editor_limit';
  r := public.share_board(root, 'probe-14@probe.invalid', 'editor');
  select to_jsonb(c) into v from public.get_editor_capacity(root, null) c;
  rep := rep || format(E'\n%s 21 off: share=%s enforced=%s full=%s admit=%s',
                       case when r = 'granted' and not (v->>'enforced')::boolean and not (v->>'is_full')::boolean
                                 and public._editor_admit(ws, p[15], null) = 'ok' then 'ok' else 'FAIL' end,
                       r, v->>'enforced', v->>'is_full', public._editor_admit(ws, p[15], null));

  -- 22. what the count costs on this account
  execute 'explain (analyze, format json) select * from public._account_editor_slots($1)' into v using o;
  rep := rep || format(E'\ninfo 22 _account_editor_slots: %s ms', v -> 0 ->> 'Execution Time');

  raise exception 'PROBE_REPORT%', rep;
```

- [ ] **Step 2: Build the probe**

<!-- write: SCRATCH/build_probe.py -->
```python
# Wraps 0520, 0521 and the checks in ONE do-block that always raises, so the
# database keeps nothing. Usage: python3 -I build_probe.py REPO SCRATCH
import re, sys, pathlib
repo, scratch = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
mig = repo / 'supabase' / 'migrations'
def body(name):
    text = (mig / name).read_text()
    return re.sub(r'(?m)^(begin|commit);\s*$', '', text)
for tag in ('$m0520$', '$m0521$', '$probe$'):
    for name in ('0520_editor_limit_core.sql', '0521_editor_limit_doors.sql'):
        assert tag not in (mig / name).read_text(), f'{tag} appears in {name}'
checks = (scratch / 'probe_checks.sql').read_text()
out = f"""do $probe$
declare
  o uuid := gen_random_uuid();  p uuid[] := array[]::uuid[];  late uuid := gen_random_uuid();
  svc uuid;  ws uuid;  root uuid;  child uuid;  tok uuid;  wtok uuid;
  v jsonb;  r text;  r2 text;  h text;  m text;  st text;  b boolean;
  n int;  n2 int;  n3 int;  i int;  rep text := '';
begin
  execute $m0520${body('0520_editor_limit_core.sql')}$m0520$;
  execute $m0521${body('0521_editor_limit_doors.sql')}$m0521$;
{checks}
end $probe$;
"""
(scratch / 'probe_editor_limit.sql').write_text(out)
print(len(out), 'chars')
```

Run: `python3 -I SCRATCH/build_probe.py /Users/andrewconklin/soleilpictures-1 SCRATCH`

- [ ] **Step 3: Run it**

Run the file's text through `mcp__supabase__execute_sql` (project `ehlhlmbpwwalmeisvmdp`).
Expected: an error whose message starts `PROBE_REPORT`. Every line should read `ok`, plus the `info 22` timing, which should be well under 50 ms. Any other error means a migration or a check failed before the report: fix it and re-run.

- [ ] **Step 4: Confirm it left nothing**

Run (read-only):
```sql
select (select count(*) from auth.users where email like '%@probe.invalid') as fixture_users,
       (select count(*) from pg_proc where proname = '_editor_admit') as editor_admit_exists,
       (select count(*) from public.app_config where key = 'editor_limit') as switch_row;
```
Expected: `0, 0, 0`.

- [ ] **Step 5: Record the report** (the ok lines and the timing) in the Task 9 hand-off message to the owner. No commit.

---
### Task 6: Reading the refusal and the numbers (client)

**Files:**
- Modify: `boards/src/lib/editorLimit.js` (append)
- Create: `boards/src/lib/editorLimit.test.mjs`
- Modify: `boards/src/lib/boardsApi.js` (an import, plus three wrappers after `inviteWorkspaceMember`)

**Interfaces:**
- Consumes: `EDITOR_LIMIT`, `EDITOR_LIMIT_HINT`, `EDITOR_LIMIT_ASK_HINT` (Task 1), and the RPCs (Task 2).
- Produces (JS):
  - `editorLimitRefusal(err) → null | { ask: boolean }`
  - `normalizeEditorCapacity(rowOrRows) → null | { enforced, limit, used, pending, taken, left, full, isAccountOwner, subject }`
  - `getEditorCapacity({ boardId?, workspaceId? }) → Promise<capacity|null>`
  - `askOwnerForEditorSlot({ boardId?, workspaceId? }) → Promise<'sent'|'already_sent'|'not_full'|'owner'>`
  - `listMyAccountEditors() → Promise<row[]>`

- [ ] **Step 1: Write the failing unit tests**

<!-- write: boards/src/lib/editorLimit.test.mjs -->
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EDITOR_LIMIT, EDITOR_LIMIT_HINT, EDITOR_LIMIT_ASK_HINT,
  editorLimitRefusal, normalizeEditorCapacity,
} from './editorLimit.js';

test('a refusal is read from its hint, the way supabase-js hands it over', () => {
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: EDITOR_LIMIT_HINT, code: '42501' }), { ask: false });
  assert.deepEqual(editorLimitRefusal({ message: 'x', hint: EDITOR_LIMIT_ASK_HINT, code: '42501' }), { ask: true });
});

test('a wrapper that kept only the message is still understood', () => {
  assert.deepEqual(editorLimitRefusal(new Error('editor limit reached: you have 10 people who can edit across your workspaces, the most a personal plan allows')), { ask: false });
  assert.deepEqual(editorLimitRefusal(new Error('editor limit reached: this account already has 10 people who can edit')), { ask: true });
});

test('anything else is not the editor limit', () => {
  assert.equal(editorLimitRefusal(new Error('invite limit reached: try tomorrow')), null);
  assert.equal(editorLimitRefusal({ message: 'this account is suspended', hint: 'sending_on_hold' }), null);
  assert.equal(editorLimitRefusal(null), null);
  assert.equal(editorLimitRefusal(undefined), null);
});

test('the numbers come back in one shape, array or row', () => {
  const row = { enforced: true, editor_limit: 10, used: 9, pending: 1, is_full: true, i_am_account_owner: false, subject: 'account' };
  const want = { enforced: true, limit: 10, used: 9, pending: 1, taken: 10, left: 0, full: true, isAccountOwner: false, subject: 'account' };
  assert.deepEqual(normalizeEditorCapacity(row), want);
  assert.deepEqual(normalizeEditorCapacity([row]), want);
  assert.equal(normalizeEditorCapacity([]), null);
  assert.equal(normalizeEditorCapacity(null), null);
});

test('a missing limit falls back to the app\'s number, and left never goes below 0', () => {
  const c = normalizeEditorCapacity({ enforced: true, used: 12, pending: 0, is_full: true });
  assert.equal(c.limit, EDITOR_LIMIT);
  assert.equal(c.left, 0);
  assert.equal(c.subject, 'account');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd boards && node --test src/lib/editorLimit.test.mjs`
Expected: FAIL with `editorLimitRefusal` not exported (SyntaxError on the import).

- [ ] **Step 3: Append the helpers**

<!-- append: boards/src/lib/editorLimit.js -->
```js

// What a failed share, invite or role change means for the limit: null when
// it wasn't the limit, else { ask }, which is true when the caller isn't the
// account's owner and can only ask them. supabase-js keeps the hint on the
// error it hands back. A wrapper that re-threw a plain Error keeps only the
// message, and _editor_refuse starts that with "editor limit reached:".
export function editorLimitRefusal(err) {
  const hint = err?.hint;
  if (hint === EDITOR_LIMIT_HINT) return { ask: false };
  if (hint === EDITOR_LIMIT_ASK_HINT) return { ask: true };
  const msg = String(err?.message ?? '');
  if (!/^editor limit reached:/i.test(msg)) return null;
  return { ask: !/^editor limit reached: you have/i.test(msg) };
}

// get_editor_capacity's row (0520) in the app's words. null while unknown:
// callers treat unknown as room, because the server refuses anyway.
export function normalizeEditorCapacity(rowOrRows) {
  const r = Array.isArray(rowOrRows) ? rowOrRows[0] : rowOrRows;
  if (!r) return null;
  const limit = Number(r.editor_limit ?? EDITOR_LIMIT);
  const used = Number(r.used ?? 0);
  const pending = Number(r.pending ?? 0);
  return {
    enforced: Boolean(r.enforced),
    limit,
    used,
    pending,
    taken: used + pending,
    left: Math.max(0, limit - used - pending),
    full: Boolean(r.is_full),
    isAccountOwner: Boolean(r.i_am_account_owner),
    subject: r.subject || 'account',
  };
}
```

- [ ] **Step 4: Add the wrappers to `boardsApi.js`**

Add next to the existing imports at the top of `boards/src/lib/boardsApi.js`:
```js
import { normalizeEditorCapacity } from './editorLimit.js';
```
Insert directly after the closing `}` of `export async function inviteWorkspaceMember(…)`:
```js

// The 10-editor limit (0520). Numbers only: is the limit on for the account
// that owns this cluster or workspace, how many of its places are taken, and
// is it full. Pass a boardId (editors of it may ask) or a workspaceId.
export async function getEditorCapacity({ boardId = null, workspaceId = null } = {}) {
  const { data, error } = await supabase
    .rpc('get_editor_capacity', { p_board_id: boardId, p_workspace_id: workspaceId });
  if (error) throw error;
  return normalizeEditorCapacity(data);
}

// Someone the limit turned away asks the account's owner (and co-owners) to
// make room. 'sent' | 'already_sent' | 'not_full' | 'owner'.
export async function askOwnerForEditorSlot({ boardId = null, workspaceId = null } = {}) {
  const { data, error } = await supabase
    .rpc('ask_owner_for_editor_slot', { p_board_id: boardId, p_workspace_id: workspaceId });
  if (error) throw error;
  return data;
}

// The owner's own list of everyone holding a place, waiting invites included,
// with the workspaces and clusters each one can edit.
export async function listMyAccountEditors() {
  const { data, error } = await supabase.rpc('list_my_account_editors');
  if (error) throw error;
  return data || [];
}
```

- [ ] **Step 5: Run the tests and the build check**

Run: `cd boards && node --test src/lib/editorLimit.test.mjs src/lib/editorLimitMigration.test.mjs`
Expected: PASS.
Run: `cd boards && npx vite build --logLevel error >/dev/null && echo BUILD_OK` (only proves the import graph resolves; don't ship the output)
Expected: `BUILD_OK`.

- [ ] **Step 6: Commit and push**

```bash
cd /Users/andrewconklin/soleilpictures-1
F="boards/src/lib/editorLimit.js boards/src/lib/editorLimit.test.mjs boards/src/lib/boardsApi.js"
git diff -- boards/src/lib/boardsApi.js | grep '^[+-]' | grep -v '^+++\|^---'   # only your lines?
git add $F && git commit -q -F <msg-file> -- $F
git fetch -q origin main && git merge-base --is-ancestor origin/main HEAD && git push -q origin HEAD:main
```
If `boardsApi.js` holds someone else's uncommitted lines, stage only your hunk instead. Use the index technique in Task 8, Step 5.

---

### Task 7: An invite run stops at the editor limit

**Files:**
- Modify: `boards/src/lib/inviteSubmit.js`
- Modify: `boards/src/lib/inviteSubmit.test.mjs` (append)

**Interfaces:**
- Consumes: `editorLimitRefusal` (Task 6).
- Produces: when an address hits the editor limit, `runInvites` returns `limit: { kind: 'editors', ask: boolean, reason: string, unsent: string[] }`. The budget's `limit` keeps its shape `{ reason, unsent }`, which existing callers and tests rely on.

- [ ] **Step 1: Append the failing test**

<!-- append: boards/src/lib/inviteSubmit.test.mjs -->
```js

test('the editor limit stops the run, says whether to ask the owner, and hands back what it never reached', async () => {
  const sent = [];
  const r = await runInvites(['a@x.co', 'b@x.co', 'c@x.co'], async (e) => {
    sent.push(e);
    if (e === 'b@x.co') {
      const err = new Error('editor limit reached: this account already has 10 people who can edit');
      err.hint = 'editor_limit_ask_owner';
      throw err;
    }
    return 'granted';
  });
  assert.deepEqual(sent, ['a@x.co', 'b@x.co'], 'nothing is tried after the limit');
  assert.deepEqual(r.granted, ['a@x.co']);
  assert.deepEqual(r.fail, []);
  assert.deepEqual(r.limit, {
    kind: 'editors', ask: true,
    reason: 'editor limit reached: this account already has 10 people who can edit',
    unsent: ['b@x.co', 'c@x.co'],
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd boards && node --test src/lib/inviteSubmit.test.mjs`
Expected: the new test FAILS (`r.limit` is null and `b@x.co` lands in `fail`).

- [ ] **Step 3: Implement**

In `boards/src/lib/inviteSubmit.js`, add the import after the header comment:
```js
import { editorLimitRefusal } from './editorLimit.js';
```
Replace the `catch` block in `runInvites`:
```js
    } catch (e) {
      const msg = e?.message || String(e);
      if (INVITE_LIMIT_RE.test(msg)) { limit = { reason: inviteLimitReason(msg), unsent: list.slice(i) }; break; }
      fail.push({ email, reason: msg });
    }
```
with:
```js
    } catch (e) {
      const msg = e?.message || String(e);
      if (INVITE_LIMIT_RE.test(msg)) { limit = { reason: inviteLimitReason(msg), unsent: list.slice(i) }; break; }
      // 0521: the account has no room for another editor. One run sends every
      // address with the same role, so the rest would be refused the same way.
      const full = editorLimitRefusal(e);
      if (full) { limit = { kind: 'editors', ask: full.ask, reason: msg, unsent: list.slice(i) }; break; }
      fail.push({ email, reason: msg });
    }
```
Extend the doc comment above `runInvites` so its result line reads:
```js
//   → { granted: [email], pending: [email], fail: [{email, reason}],
//       limit: null | { reason, unsent: [email] }                        (the invite budget)
//              | { kind: 'editors', ask, reason, unsent: [email] } }     (the 10-editor limit, 0521)
```

- [ ] **Step 4: Run**

Run: `cd boards && node --test src/lib/inviteSubmit.test.mjs src/lib/editorLimit.test.mjs`
Expected: PASS (all, the old budget test included).

- [ ] **Step 5: Commit and push** (`inviteSubmit.js`, `inviteSubmit.test.mjs`) by pathspec, as in Task 6, Step 6.

---
### Task 8: The hold and the registries

**Files:**
- Modify: `boards/src/lib/appHost.js`: add `editorLimitAllowed()` after `touchPassAllowed()`, and list it in `featureFlags()`
- Modify: `boards/src/lib/featureEvents.js`: add the `editorLimit` entry after `scoutConnect`
- Modify: `boards/src/lib/analyticsEvents.js`: add the `EDITOR_LIMIT_VIEWER_FALLBACK` key after `WORKSPACE_LINK_CLAIMED`
- Modify: `boards/src/lib/analyticsEvents.test.mjs`: add a `SERVER_EMITTED` entry
- Modify: `boards/src/lib/billingCopy.js` (lines 111 and 248) and `billingCopy.test.mjs` (line 114): comments only

**Interfaces:**
- Produces: `editorLimitAllowed() → boolean` and `EDITOR_LIMIT_DEV_FLAG = 'soleil.dev.editorLimit'`. The hold is closed everywhere except dev with the flag. S1b opens it on the preview host once the UI exists.

**Why each registry:**
- `sessionContext.test.mjs` fails when an exported `*Allowed()` is missing from `featureFlags()`.
- `featureEvents.test.mjs` fails when a hold has no entry. A closed hold may say `unmeasured`. A hold counts as open only when its body is exactly `return true;`.
- `analyticsEvents.test.mjs` fails when an EV key is neither emitted in `src` nor listed in `SERVER_EMITTED`.

- [ ] **Step 1: Run the three registry tests (green before the change)**

Run: `cd boards && node --test src/lib/sessionContext.test.mjs src/lib/featureEvents.test.mjs src/lib/analyticsEvents.test.mjs src/lib/billingCopy.test.mjs`
Expected: PASS. If one is already red from another session's work in progress, note it and carry on.

- [ ] **Step 2: Add the hold** (in `appHost.js`, after `touchPassAllowed`'s closing `}`)

```js

// ---------------------------------------------------------------------------
// The 10-editor limit
//
// Free and Creator can have at most 10 people who can edit (owner,
// 2026-10-20); a group that needs more buys a Team. The real switch is the
// server's, app_config.editor_limit (0520): off until launch, with a list of
// test accounts. This hold keeps the app's side of it closed until the Team
// plan launches with it: the share panel's count, "Ask the owner", the
// joined-as-viewer toast, and "Join as an editor" no longer saying "free".
// It stays OFF in the sidebar release. Opt-in on dev with localStorage
// soleil.dev.editorLimit = '1'.
export const EDITOR_LIMIT_DEV_FLAG = 'soleil.dev.editorLimit';
export function editorLimitAllowed() {
  if (!import.meta.env.DEV) return false;
  try { return window.localStorage.getItem(EDITOR_LIMIT_DEV_FLAG) === '1'; } catch (_) { return false; }
}
```
In `featureFlags()`, after the line `    touchPass: touchPassAllowed,` add:
```js
    editorLimit: editorLimitAllowed,
```

- [ ] **Step 3: Register its events**

In `featureEvents.js`, after the `scoutConnect: { … },` entry:
```js
  editorLimit: {
    unmeasured: 'The editor limit has no screens yet: the share panel, Members and the joined-as-viewer toast wait on the owner\'s mockup pick. The server already logs editor_limit_viewer_fallback (0520/0521).',
  },
```
In `analyticsEvents.js`, after the `WORKSPACE_LINK_CLAIMED` line:
```js
  EDITOR_LIMIT_VIEWER_FALLBACK: 'editor_limit_viewer_fallback', // SERVER: an edit link let someone in as a viewer because the account had 10 people who can edit {via:'collab_link'|'workspace_link', upgrade, workspace_id, board_id}
```
In `analyticsEvents.test.mjs`, in `SERVER_EMITTED`, after the `WORKSPACE_LINK_CLAIMED` entry:
```js
  ['EDITOR_LIMIT_VIEWER_FALLBACK', '0520_editor_limit_core.sql (_editor_limit_fallback, called from 0521)'],
```

- [ ] **Step 4: Re-cite the switch in billingCopy's comments**

In `billingCopy.js` line 111, replace
`// unlimited free collaborators are free too (collab_free_editor_cap is null) —`
with
`// collaborators are free too (0520's editor_limit is off until the Team plan launches) —`.

In `billingCopy.js` line 248, replace
`    // (collab_free_editor_cap is null). Both are true; only one is Creator's.`
with
`    // (0520's editor_limit is off until the Team plan launches). Both are true; only one is Creator's.`

In `billingCopy.test.mjs` line 114, replace
`// so are unlimited collaborators (collab_free_editor_cap is null). Selling`
with
`// so are collaborators (0520's editor_limit is off until the Team plan launches). Selling`.

Run: `cd boards && node --test src/lib/sessionContext.test.mjs src/lib/featureEvents.test.mjs src/lib/analyticsEvents.test.mjs src/lib/billingCopy.test.mjs && npm test`
Expected: PASS.

- [ ] **Step 5: Commit only your hunks**

`appHost.js` and `featureEvents.js` hold another session's uncommitted work (the files page look). A pathspec commit would ship it, so stage your own lines through the index:
```bash
cd /Users/andrewconklin/soleilpictures-1
S=<scratchpad>
for f in boards/src/lib/appHost.js boards/src/lib/featureEvents.js; do
  git show HEAD:$f > $S/$(basename $f).head            # what main has
  # apply ONLY your edits from Steps 2–3 to the .head copy (same old/new strings), then:
  git diff --no-index $S/$(basename $f).head $S/$(basename $f).mine > $S/$(basename $f).patch || true
done
# rewrite each patch's a/ b/ paths to the repo path, then:
git apply --cached $S/appHost.js.patch $S/featureEvents.js.patch
git add boards/src/lib/analyticsEvents.js boards/src/lib/analyticsEvents.test.mjs boards/src/lib/billingCopy.js boards/src/lib/billingCopy.test.mjs
git diff --cached --name-only    # exactly these six files, nothing else
git diff --cached -- boards/src/lib/appHost.js boards/src/lib/featureEvents.js   # only your lines
git commit -q -F <msg-file>      # no pathspec: the index holds exactly your hunks
git fetch -q origin main && git merge-base --is-ancestor origin/main HEAD && git push -q origin HEAD:main
```
The working tree keeps both sessions' lines; the other session's next commit carries only theirs.

---

### Task 9: Hand-off: apply on the owner's go

Nothing in this task runs without the owner's explicit "go" on applying 0520 and 0521.

- [ ] **Step 1: Ask.** Tell the owner, plainly:
  - what the probe proved (its ok lines);
  - that applying changes nothing for anyone, because the switch is off and lists nobody;
  - that it puts the checks in place for launch.

  Ask for a go.
- [ ] **Step 2: On "go", apply** with `mcp__supabase__apply_migration`, `name: editor_limit_core` (0520's text), then `name: editor_limit_doors` (0521's text). Stop at the first error.
- [ ] **Step 3: Verify live = files.** Run:
  ```sql
  select p.proname, md5(regexp_replace(prosrc, '\s+', ' ', 'g'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('share_board', 'invite_workspace_member', 'set_workspace_member_role',
                       'restore_board_share', 'claim_collab_link', 'claim_workspace_invite_link');
  ```
  Then compare against the same md5 over each `$function$…$function$` body in 0521, computed locally. Also check `select value from app_config where key = 'editor_limit'` returns `{"enforced": false, "test_owner_ids": []}`.
- [ ] **Step 4: Mark the files applied.** In both headers, change `STATUS: written 2026-10-21. NOT APPLIED until the owner says go.` to `STATUS: applied <date> (owner's go).` Commit by pathspec and push.
- [ ] **Step 5: Memory.** Update `project_team_plan_editor_limit_2026_10_21.md`: 0520/0521 LIVE (off), and the probe passed.

---

## Next: S1b (UI), after the owner's S0 pick

These are not in this plan. Each item waits on the mockup pick and gets its own plan:
- `hooks/useEditorCapacity.js`, modelled on `useBoardCapacity.js`. It is invalidated after a share, an invite, a role change, an unshare, a revoke or a restore.
- `ShareModal.jsx`:
  - the outcome of `submitInvite`;
  - "Ask the owner" → `askOwnerForEditorSlot`;
  - "Can edit" disabled when full;
  - "Editors N of 10";
  - the "Editors are free" copy at 909/912 under the hold.
- `MembersTab.jsx`: the same, plus the owner's list (`listMyAccountEditors`) with revoke on pending rows.
- `setup/InviteStep.jsx`: render `limit.kind === 'editors'`.
- `JoinBoardCard.jsx`, `WorkspaceJoinCard.jsx`: no "free" under the hold.
- `App.jsx`: the one-time joined-as-viewer toast (deduped by id), and `NotificationsPanel` rendering `editors.limit_reached` → Members.
- No Notifications entry of our own. The release coordinator is building a bell into the new sidebar
  for the 10-22 release, mocked up first, with the owner picking where it goes. The owner's notice
  (`editors.limit_reached`) opens from that bell, so S1b builds on whichever placement the owner
  picks, and the sidebar never gets two ways in.
- `featureEvents.editorLimit` gets real exposure, action, outcome and failure events (`EDITOR_LIMIT_SEEN`, `EDITOR_LIMIT_REFUSED`, `EDITOR_LIMIT_ASK_SENT`, `EDITOR_LIMIT_NOTICE_OPEN`) in place of `unmeasured`.
- The hold opens on the preview host. `tests/editor-limit.spec.js` with RPC route mocks.

Carried to S5 (launch):
- `_instrumentation_pairs` gains `editor_limit_viewer_fallback`. Re-emit it from **0475**'s body, not 0472's (data-collection session, 10-21).
- Drop `_collab_editor_cap`, `admin_set_collab_editor_cap` and the `collab_free_editor_cap` row.
- Flip `editor_limit.enforced`.
- Copy and docs.

Carried to S2b: the transfer notice's freeze line, since S2b re-emits `transfer_workspace_ownership` anyway.
