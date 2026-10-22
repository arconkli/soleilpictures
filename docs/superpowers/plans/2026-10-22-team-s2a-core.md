# Team S2a (teams core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Migration tasks (1–5) are main-model work (RLS / grant reasoning); the client pins and test runs (6–8) can go to `implementer` / `verifier`.

**Goal:** A Team exists in the database: it owns workspaces, has roles (owner / admin / member / viewer), counts seats, admits joiners by the admins' when-full rule, and every access path (RLS, realtime, the party server, the per-user helpers) knows about it. No organization row can exist until `app_config.teams_open` opens or the creator is a test owner, so applying this changes nothing for anyone.

**Architecture:** Five migrations: 0522, then 0530–0533 (renumbered under amendment F; the security session's Phase 1 holds 0523–0529).
- **0522** adds the tables, the hold, the workspace columns. Inert.
- **0530** gives the access choke points their team branch through ONE helper, `_org_ws_role_for(ws, user)`. Every predicate that already routes through `is_workspace_member` / `_workspace_member_can_write` / `can_manage_workspace` (can_read_board, can_write_board, can_write_workspace, board_tree, the six realtime policies, grid_layouts, conversations, the upload party…) inherits it without a text change. Adds the party re-check RPCs and the ownership invariants (personal workspace lookup, transfer, deletion).
- **0531** counts team seats and puts the team branch in `_editor_admit` and the other S1 helpers, so S1's six doors admit by seat without being touched.
- **0532** the team RPCs (create, workspaces in/out/private/create, people, invites, link, domains, requests, rules, seats, leave/remove, close).
- **0533** the reads: `get_team` (the TeamSnapshot of `lib/teamModel.js`, cut to the caller's role server-side), `list_my_teams`, `list_my_team_workspaces`, `my_workspace_role`.

Party: `auth.ts` `authWorkspace` asks an RPC instead of reading `workspace_members`; the board and workspace rooms' one-minute alarm re-checks every socket's access (it already re-checks bans) and closes or demotes.

**Why branches and not materialized membership rows:** the program and the 09-10 record put the org branch in the choke points. It also keeps the roster private: `workspace_user_directory`, `users_by_ids` and `list_messageable_users` show emails between people who share explicit `workspace_members` rows, so materializing the whole team into every team workspace would hand every member every address, against "emails for owner/admins only". The cost is that every direct `workspace_members` reader has to be listed and decided (Task 2's table). Closing a team DOES materialize (the owner decision says the freeze applies, so people keep editing).

**Tech Stack:** Postgres 15 / plpgsql on Supabase (MCP `execute_sql` for read-only and rolled-back probes; `apply_migration` only on the owner's go); `node --test`; the party is TypeScript on Cloudflare (wrangler 4).

Design: `docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md`; program `~/.claude/plans/i-want-to-work-soft-ladybug.md` (S2a row, Traps); re-cut of `docs/superpowers/specs/2026-09-10-enterprise-orgs-and-seats-design.md` (choke points, §Authorization). Format model: `docs/superpowers/plans/2026-10-21-editor-limit-s1a-server-and-logic.md`.

## Global Constraints

- **Hold:** `app_config.teams_open = {"open": false, "test_owner_ids": []}`. A BEFORE INSERT trigger on `organizations` refuses any row whose `owner_id` isn't allowed (`_teams_open_for`). With no organization rows, every new branch evaluates to null/false, so every predicate answers exactly as today (proven by the parity probe, Task 7).
- **Re-emitting a function:** start from its live `pg_get_functiondef` (read 2026-10-21, cross-checked against the latest migration file named in each task) and change only the lines marked `-- 05xx:`. No new overloads (PGRST203). No return-shape change, so no DROP (none in this plan; `create_workspace_with_root` is deliberately NOT re-signed, see Task 4).
- **Grants (0311):** every `_` helper `revoke execute … from public, anon, authenticated`; every client RPC `revoke … from public, anon` + `grant … to authenticated`; `peek_team_link` alone also `grant … to anon`; the party RPCs and `team_domain_mark_verified` are service-role only (`revoke … from public, anon, authenticated`). `create or replace` keeps an existing ACL, but every migration still ends with a `has_function_privilege` proof block covering what it touched. `revoke … from anon` is a no-op while PUBLIC holds it: always revoke from `public` too.
- **New tables:** this project's default ACL grants `arwdxtm` on new public tables to `anon` and `authenticated` (checked: `pg_default_acl`, role postgres, schema public), and `rwU` on sequences. Every new table gets `enable row level security`, `revoke all … from public, anon, authenticated`, NO policies (all access through definer RPCs), and its identity sequence revoked too. The proof block checks `has_table_privilege` is false for anon and authenticated.
- **RLS:** no policy text changes in S2a. The policies call the re-emitted functions; no function queries its own caller table from a policy (42P17 rule). The probe still runs a rolled-back real-user UPDATE and INSERT.
- **`= any(array)` is not sargable** (memory, hardening round 3): union in `unnest()` instead (`my_readable_board_ids`, `my_workspace_ids`).
- **Workspace invariants:** every workspace keeps a live root (`create_team_workspace` makes one in the same transaction; moves call `_ensure_workspace_root`). No path here writes `parent_board_id`. `boards.workspace_id` is not client-writable (checked: the column grant list has no `workspace_id`), and no RPC here moves a board between workspaces.
- **Team workspace ownership:** `workspaces.created_by` of a team workspace is always the team owner (Task 4 keeps it so), so the ~15 inline `created_by = auth.uid()` checks mean "the team owner" there. Until S2b re-keys billing, a team workspace's cards and storage count toward the team owner's personal plan; harmless while only test owners can make a team.
- **Hints the app will read** (constants in `lib/teamHints.js`, Task 6): `teams_closed`, `team_exists`, `team_seats_full`, `team_seats_ceiling`, `team_seats_ask_admin`, `team_seats_needed`, `team_workspace`, `team_owner`, `team_domain_freemail`, `team_domain_taken`, `team_domain_invalid`, `team_not_member`, `team_not_admin`, `team_not_owner`, `team_inbox_unproven` (amendment E), `team_view_only`, `new_account` (amendment G).
- **Do not apply** anything until the probes pass AND the owner says go (Task 9). File headers say `STATUS: written 2026-10-22. NOT APPLIED until the owner says go.`
- **Commits:** by pathspec, push to `main` after `git fetch` + ancestry check; other sessions' hunks are never swept. The repo is public: no counts, revenue or live figures in files or messages.
- **Numbers:** claim 0522–0526 by message to peers before writing (the block 0520–0559 is this program's; 0520/0521 are live).

## Files

| Path | Task | Responsibility |
|---|---|---|
| `supabase/migrations/0522_teams_tables.sql` | 1 | hold, tables, workspace columns, gate trigger, freemail list, proofs |
| `supabase/migrations/0530_teams_access.sql` | 2 | `_org_ws_role_for`, the choke points, per-user helpers, party RPCs, ownership invariants, proofs |
| `supabase/migrations/0531_teams_seats.sql` | 3 | seat count, `_team_admit`, `_org_add_seats`, S1 helpers' team branch, proofs |
| `supabase/migrations/0532_teams_rpcs.sql` | 4 | the team RPCs, quiet member emails, proofs |
| `supabase/migrations/0533_teams_read.sql` | 5 | `get_team`, `list_my_teams`, `list_my_team_workspaces`, `my_workspace_role`, proofs |
| `boards/src/lib/teamsMigration.test.mjs` (new) | 1–5 | migration-contract pins |
| `boards/src/lib/editorLimitMigration.test.mjs` | 3 | its file pins follow the five functions 0524 re-emits |
| `boards/src/lib/teamHints.js`, `teamHints.test.mjs` (new) | 6 | hint constants + a pin that each appears in the SQL |
| `boards/src/lib/analyticsEvents.js` | 6 | `TEAM_*` server events in `SERVER_EMITTED` |
| `boards/src/lib/appHost.js`, `featureEvents.js` | 6 | `teamsAllowed()` (closed) + `featureFlags()` + `teams: { unmeasured }` |
| `boards/src/lib/teamsApi.js` (new) | 6 | thin RPC wrappers (no UI) |
| `boards/party/auth.ts`, `board.ts`, `workspace.ts`, `index.ts` | 8 | RPC-based workspace auth; access re-check in both alarms |
| `boards/src/lib/teamsParty.test.mjs` (new) | 8 | source pins for the party changes |

Nothing here is a public surface (no route, `/api/v1` field, MCP tool, card kind, Settings tab, shortcut or enforced public limit changes; `GET /api/v1/workspaces` keeps its fields and simply returns team workspaces the caller can read), so `docsiteSurface.json` does not move. `npm test` proves it.

---

### Task 1: The hold and the tables (0522)

**Files:** create `supabase/migrations/0522_teams_tables.sql`; create `boards/src/lib/teamsMigration.test.mjs` (part 1).

**Interfaces produced:** tables `organizations`, `org_members`, `org_invites`, `org_domains`, `org_domain_answers`, `org_join_requests`, `org_seat_changes`; columns `workspaces.org_id`, `workspaces.org_visibility`; `_teams_open_for(uuid) → boolean`; `_freemail_domain(text) → boolean`; trigger `organizations_insert_gate`.

- [ ] **Step 1: Write the failing pins** (`teamsMigration.test.mjs`, same helpers as `editorLimitMigration.test.mjs`: `latestDefinition`, `code()` strips `--` comments):
  - the file inserts `('teams_open', '{"open": false, "test_owner_ids": []}'::jsonb)` with `on conflict (key) do nothing`;
  - `_teams_open_for` reads `->> 'open' = 'true'` and `jsonb_typeof(c.value -> 'test_owner_ids') = 'array'`, wrapped in `coalesce(…, false)`;
  - `create trigger organizations_insert_gate before insert on public.organizations`;
  - each of the seven tables appears in an `enable row level security` line and in a `revoke all on table` line naming `public, anon, authenticated`; the file contains no `create policy`;
  - `workspaces` gains exactly `org_id` and `org_visibility`, plus the pairing check; the file contains no `grant` on `workspaces`;
  - `organizations.owner_id` is `on delete set null` with the check `closed_at is not null or owner_id is not null`.
- [ ] **Step 2: Run, watch it fail** (`cd boards && node --test src/lib/teamsMigration.test.mjs`).
- [ ] **Step 3: Write 0522.**

```sql
-- 0522: Teams, part 1 — the tables, and the hold that keeps them empty.
--
-- STATUS: written 2026-10-22. NOT APPLIED until the owner says go.
--
-- A Team (the database says organization) owns workspaces and their seats
-- (design: docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md).
-- No organization row can exist until app_config.teams_open opens, or its
-- owner is listed in test_owner_ids (preview test accounts). With no rows,
-- every team branch in 0523–0526 is dormant and everything works as before.
--
-- Every table here is RPC-only: RLS on, no policies, no client grants. The
-- roster's privacy (names for everyone, emails for the owner and admins) is
-- enforced in get_team (0526), never by a policy a member could query around.

begin;

-- Applied for real before any probe (amendment A): fail fast rather than
-- queue behind production traffic for the workspaces lock.
set local lock_timeout = '3s';

insert into public.app_config (key, value)
values ('teams_open', '{"open": false, "test_owner_ids": []}'::jsonb)
on conflict (key) do nothing;

create or replace function public._teams_open_for(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select (c.value ->> 'open' = 'true')
        or (jsonb_typeof(c.value -> 'test_owner_ids') = 'array'
            and (c.value -> 'test_owner_ids') ? (p_user::text))
      from public.app_config c
     where c.key = 'teams_open'
  ), false);
$$;

create table public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 1 and 60),
  color              text check (color ~ '^#[0-9a-fA-F]{6}$'),
  owner_id           uuid references auth.users(id) on delete set null,
  status             text not null default 'active' check (status in ('active', 'view_only')),  -- S3 enforces
  seats              integer not null default 3 check (seats >= 3),
  -- Self-serve stops here ("Talk to us" above); support can raise it (amendment B).
  seat_ceiling       integer not null default 100 check (seat_ceiling between 3 and 10000),
  when_full          text not null default 'ask' check (when_full in ('ask', 'auto')),
  auto_monthly_limit integer check (auto_monthly_limit is null or auto_monthly_limit > 0),
  seat_perk          boolean not null default true,                                           -- S2b reads
  link_token         uuid not null default gen_random_uuid() unique,
  link_on            boolean not null default false,
  link_role          text not null default 'member' check (link_role in ('member', 'viewer')),
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  -- An open team always has its owner; deleting the owner's account fails
  -- here (prepare_account_deletion refuses first, 0523, with a readable hint).
  constraint organizations_open_has_owner check (closed_at is not null or owner_id is not null)
);
create index organizations_owner_open_idx on public.organizations (owner_id) where closed_at is null;

create table public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  seat       boolean generated always as (role <> 'viewer') stored,
  joined_via text not null check (joined_via in ('create', 'invite', 'link', 'domain', 'request')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);
create unique index org_members_one_owner on public.org_members (org_id) where role = 'owner';

create table public.org_invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  email      text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role       text not null check (role in ('admin', 'member', 'viewer')),
  token      uuid not null default gen_random_uuid() unique,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  claimed_at timestamptz,
  claimed_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
-- One open invite per address per team. ON CONFLICT against it must repeat
-- the predicate (the 0086/0227/0228 partial-index arbiter lesson); the RPCs
-- revoke expired rows first instead of relying on it.
create unique index org_invites_open_email on public.org_invites (org_id, email)
  where claimed_at is null and revoked_at is null;
create index org_invites_email_open_idx on public.org_invites (email)
  where claimed_at is null and revoked_at is null;

create table public.org_domains (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  domain       text not null check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  verified_at  timestamptz,
  join_on      boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (org_id, domain)
);
-- A domain can be verified by one team at a time.
create unique index org_domains_verified_once on public.org_domains (domain) where verified_at is not null;

-- "Asked once at next sign-in": one answer per (team, person), never shown to admins.
create table public.org_domain_answers (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  answer      text not null check (answer in ('joined', 'declined')),
  answered_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.org_join_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  wanted       text not null check (wanted in ('member', 'workspace_editor', 'board_editor')),
  via          text not null check (via in ('team_link', 'domain', 'workspace_link', 'collab_link', 'ask')),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  board_id     uuid references public.boards(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'kept', 'cancelled')),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references auth.users(id) on delete set null,
  check (wanted <> 'workspace_editor' or workspace_id is not null),
  check (wanted <> 'board_editor' or board_id is not null)
);
create unique index org_join_requests_one_open on public.org_join_requests (org_id, user_id) where status = 'pending';
create index org_join_requests_org_idx on public.org_join_requests (org_id, status, created_at);

-- Every change to the seat count, with why. S3 bills the rows whose billed_at
-- is null (an outbox), so S2a can add seats today without charging anyone,
-- and only test teams exist while it can.
create table public.org_seat_changes (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  delta       integer not null check (delta <> 0),
  seats_after integer not null,
  reason      text not null check (reason in ('create', 'admin_add', 'admin_remove', 'auto', 'approve', 'move_in')),
  actor       uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  billed_at   timestamptz
);
create index org_seat_changes_org_idx on public.org_seat_changes (org_id, created_at);

-- Workspaces: a team workspace has both, a personal one neither. Nullable,
-- no default: no table rewrite. Not client-writable: workspaces has
-- column-scoped UPDATE (name, settings, since 0317) and no INSERT grant.
alter table public.workspaces
  add column org_id uuid references public.organizations(id) on delete restrict,
  add column org_visibility text check (org_visibility in ('team', 'private'));
alter table public.workspaces
  add constraint workspaces_org_visibility_paired
  check ((org_id is null) = (org_visibility is null)) not valid;
alter table public.workspaces validate constraint workspaces_org_visibility_paired;
create index workspaces_org_idx on public.workspaces (org_id) where org_id is not null;

-- The hold, at the only place a row can be born.
create or replace function public._org_insert_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null or not public._teams_open_for(new.owner_id) then
    raise exception 'teams are not open yet' using errcode = '42501', hint = 'teams_closed';
  end if;
  return new;
end;
$$;
create trigger organizations_insert_gate
  before insert on public.organizations
  for each row execute function public._org_insert_gate();

-- Free-mail domains can't be a team's company domain (owner, 2026-10-20).
create or replace function public._freemail_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(btrim(p_domain)) in (
    'gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk','live.com','msn.com',
    'yahoo.com','yahoo.co.uk','ymail.com','rocketmail.com','icloud.com','me.com','mac.com','aol.com',
    'proton.me','protonmail.com','pm.me','gmx.com','gmx.de','gmx.net','web.de','mail.com','yandex.com',
    'yandex.ru','mail.ru','zohomail.com','fastmail.com','hey.com','tutanota.com','tuta.io','qq.com',
    '163.com','126.com','naver.com','hanmail.net','orange.fr','free.fr','laposte.net','libero.it',
    't-online.de','comcast.net','verizon.net','att.net','sbcglobal.net');
$$;

-- RPC-only tables.
alter table public.organizations      enable row level security;
alter table public.org_members        enable row level security;
alter table public.org_invites        enable row level security;
alter table public.org_domains        enable row level security;
alter table public.org_domain_answers enable row level security;
alter table public.org_join_requests  enable row level security;
alter table public.org_seat_changes   enable row level security;
revoke all on table public.organizations, public.org_members, public.org_invites, public.org_domains,
  public.org_domain_answers, public.org_join_requests, public.org_seat_changes
  from public, anon, authenticated;
revoke all on sequence public.org_seat_changes_id_seq from public, anon, authenticated;

revoke execute on function public._teams_open_for(uuid) from public, anon, authenticated;
revoke execute on function public._org_insert_gate() from public, anon, authenticated;
revoke execute on function public._freemail_domain(text) from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['organizations','org_members','org_invites','org_domains',
                           'org_domain_answers','org_join_requests','org_seat_changes'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '0522: % has RLS off', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete')
       or has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete') then
      raise exception '0522: % is reachable by a client', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0522: % has a policy; it must be RPC-only', t;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.workspaces', 'org_id', 'update')
     or has_column_privilege('authenticated', 'public.workspaces', 'org_visibility', 'update')
     or has_table_privilege('authenticated', 'public.workspaces', 'insert') then
    raise exception '0522: a client could set a workspace''s team';
  end if;
  if has_function_privilege('authenticated', 'public._teams_open_for(uuid)', 'execute')
     or has_function_privilege('anon', 'public._freemail_domain(text)', 'execute') then
    raise exception '0522: a helper is client-executable';
  end if;
  if public._teams_open_for(gen_random_uuid()) then
    raise exception '0522: teams are open for someone nobody listed';
  end if;
  if exists (select 1 from public.organizations) then
    raise exception '0522: an organization exists';
  end if;
end $$;

commit;
```

- [ ] **Step 4: Run the pins, watch them pass.** No commit yet (Task 2 continues the pins).

---

### Task 2: Every access path learns about teams (0523)

**Files:** create `supabase/migrations/0523_teams_access.sql`; append to `teamsMigration.test.mjs`.

**The rule, once:** `_org_ws_role_for(ws, user)` is the team-derived workspace role, in the workspace vocabulary:

| Team role | Team-visible workspace | Private team workspace |
|---|---|---|
| owner, admin | `coowner` | `coowner` (hand-overs) |
| member (holds a seat) | `editor` | — (explicit rows only) |
| viewer | `viewer` | — |

Null for a closed team, a personal workspace, or no org row. A person's effective access is the stronger of their explicit `workspace_members` / `board_shares` grant and this. Personal workspaces are never reached (no `org_id`), so "the team never sees personal workspaces" is structural.

**Choke-point inventory** (live bodies read 2026-10-21; "latest" = `migrationText.latestDefinition`):

| Function / path | Latest definition | S2a change |
|---|---|---|
| `is_workspace_member(ws)` | `0001_init.sql:69` (live adds nothing beyond it) | **re-emit**: `or _org_ws_role_for(ws, auth.uid()) is not null` |
| `_workspace_member_can_write(ws)` | `0391_workspace_coowner.sql:57` | **re-emit**: `or _org_ws_role_for(ws, auth.uid()) in ('coowner','editor')`; keeps the literal `in ('owner', 'coowner', 'admin', 'editor', 'service')` that `roleCheck.test.mjs:79` pins |
| `can_manage_workspace(ws)` | `0394_suspended_coowner_manages_nothing.sql:23` | **re-emit**: third OR `_org_ws_role_for(ws, auth.uid()) = 'coowner'` |
| `my_workspace_ids()` | `0319_read_suspend_gate.sql:71` | **re-emit**: union `unnest(_my_org_workspace_ids())` |
| `my_readable_board_ids()` (the `boards read` policy, 0294) | `0319_read_suspend_gate.sql:42` | **re-emit**: roots also from `unnest(_my_org_workspace_ids())` |
| `can_read_board` | `0373_audit_suspended_accounts_act_on_nothing.sql:466` | none: calls `is_workspace_member` per chain row |
| `can_write_board` | `0318_workspace_roles_real.sql:127` | none: `_workspace_member_can_write` + the creator branch (creator = team owner) |
| `can_write_workspace` | `0318_workspace_roles_real.sql:105` | none: same |
| realtime `ws:` read/write | `0010_realtime_broadcast_policies.sql:41,48` | none: `is_workspace_member` |
| realtime `board:` read / readers write, `y:` readers / writers | `0013_board_shares.sql:136,141,153,158` | none: `can_read_board` / `can_write_board` |
| `workspaces` "ws read by members", "ws update by creator or co-owner" (`0391:663`), `workspace_members` "wm read own workspaces", `pending_invites` / `board_shares` reads, `boards` insert/update/delete, `grid_layouts`, `conversations`, `conversation_participants` | live `pg_policies` | none: all call the functions above |
| `_user_can_read_board(user, board)` (mention notices, `notify_comment_mention`) | `0207_comment_mention_notifications.sql:71` | **re-emit**: `or _org_ws_role_for(chain.workspace_id, p_user_id) is not null` |
| `scout_can_write_board(board, user)` | `0213_scout_identity_claim.sql:53` | **re-emit**: `or coalesce(_org_ws_role_for(chain.workspace_id, p_user_id) in ('coowner','editor'), false)` |
| `_file_share_reaches(share, user)` | `0422_file_share_fixes.sql:289` | **re-emit**: `or public._org_ws_role_for(p_share.workspace_id, p_user) is not null` in its first test |
| `_workspace_invite_link_live(token)` | `0450_workspace_invite_links.sql:122` | **re-emit**: the maker may also be a team owner/admin (`or public._org_ws_role_for(l.workspace_id, l.created_by) = 'coowner'`); otherwise a link an admin makes with `create_workspace_invite_link` (which accepts them via `can_manage_workspace`) is born dead |
| `workspace_user_directory()` | `0084_lock_down_views.sql:30` | **re-emit**: in a team workspace, the email (and the email-as-title fallback) only for the owner/admins (`can_manage_workspace`) or your own row; personal workspaces unchanged |
| `merge_workspace_settings` | `0392_workspace_name_icon_managers_only.sql:23` | **re-emit**: explicit roles OR `_org_ws_role_for(…) in ('coowner','editor')` (keeps 'service' out, as today) |
| `get_or_create_personal_workspace` | `0400_personal_workspace_is_your_own.sql:29` | **re-emit**: `and w.org_id is null` (a team owner's oldest workspace may now be a team one) |
| `transfer_workspace_ownership` | `0412_storage_counts_files_never_placed.sql:144` | **re-emit**: refuse a team workspace (hint `team_workspace`) |
| `prepare_account_deletion` | `0388_audit_deletion_heir_can_edit.sql:34` | **re-emit**: refuse while the account owns an open team (hint `team_owner`) |
| `prepare_admin_account_deletion` | `0408_admin_deletion_hands_workspaces_over.sql:22` | **re-emit**: same refusal (admin tooling for a banned team owner is an S4 item) |
| `my_deletion_impact` | `0388_audit_deletion_heir_can_edit.sql:79` | **re-emit**: adds key `owns_team` (jsonb key added, no shape change) |
| party `authWorkspace` reads `workspace_members` directly (`boards/party/auth.ts:245-259`) | — | new RPC `can_open_workspace`; Task 8 |
| party board/workspace sockets authorized once (`board.ts:235-262` re-checks bans only) | — | service RPCs `party_board_access` and `party_workspace_access`, both the security session's (0620–0622, PTY-1; amendment H) |
| client workspace list = own `workspace_members` rows (`lib/bootQueries.js:25-29`), `getMyWorkspaceRole` (`lib/boardsApi.js:144-157`) | — | server reads `list_my_team_workspaces`, `my_workspace_role` (0526); the client merge is S4 |

**Deliberately unchanged** (each named in the migration header so a reviewer sees the decision):
- `board_workspace_owner` (S2b re-keys who pays), `create_workspace_with_root` (no overload/DROP; a separate `create_team_workspace`, Task 4), `delete_workspace` (already owner-only = team owner), `leave_workspace` / `remove_workspace_member` / `set_workspace_member_role` (explicit rows; the team admin reaches them through `can_manage_workspace`), `_deletion_heir` (a team owner can't be deleted).
- `_board_readers` (schedule fan-out; Schedule is retired and never ships).
- `can_message`, `list_messageable_users`, `users_by_ids`, the `member_profiles` read policy: they pair explicit rows, so team-derived mates neither DM each other nor see each other's emails through them until S4 decides (privacy-safe default).
- `claim_collab_link`: a team viewer opening an edit link in a team workspace gets today's `noop` (they are already a member); upgrading goes through the team (a request). Open question 10.

- [ ] **Step 1: Append the failing pins:**
  - each **re-emit** row's latest definition is in `0523_teams_access.sql` and its code (comments stripped) contains `_org_ws_role_for(`, except `get_or_create_personal_workspace` (`org_id is null`), `transfer_workspace_ownership` (`hint = 'team_workspace'`), the two deletion functions (`hint = 'team_owner'`), `my_deletion_impact` (`'owns_team'`);
  - `can_read_board`, `can_write_board`, `can_write_workspace` latest files are still 0373/0318/0318 (they inherit; a later rewrite that inlines `workspace_members` would lose the branch) and still call `is_workspace_member(` / `_workspace_member_can_write(`;
  - `my_readable_board_ids` and `my_workspace_ids` call `_my_org_workspace_ids()` through `unnest(` and contain no `= any(`;
  - `_org_ws_role_for` joins `organizations` with `closed_at is null` and maps exactly owner/admin→coowner, member→editor, viewer→viewer, the last two only under `org_visibility = 'team'`;
  - 0530 never defines `party_board_access` or `party_workspace_access` (0620–0622's, amendment H), and its proof requires both live and service-only;
  - `can_open_workspace` and `my_workspace_role` are granted to authenticated only.
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Write 0523.** Order: helpers → choke points → per-user helpers → invariants → new RPCs → grants → proofs. The new helpers:

```sql
create or replace function public._org_ws_role_for(p_ws uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when m.role in ('owner', 'admin') then 'coowner'
           when w.org_visibility = 'team' and m.role = 'member' then 'editor'
           when w.org_visibility = 'team' and m.role = 'viewer' then 'viewer'
         end
    from public.workspaces w
    join public.organizations o on o.id = w.org_id and o.closed_at is null
    join public.org_members m on m.org_id = w.org_id and m.user_id = p_user
   where w.id = p_ws
     and p_user is not null;
$$;

-- The team workspaces the caller can open (any team role on a team-visible
-- one; owner/admin on every one). One query, for the two set readers.
create or replace function public._my_org_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(w.id), '{}'::uuid[])
    from public.org_members m
    join public.organizations o on o.id = m.org_id and o.closed_at is null
    join public.workspaces w on w.org_id = m.org_id
   where m.user_id = auth.uid()
     and (m.role in ('owner', 'admin') or w.org_visibility = 'team');
$$;

-- Rank of a workspace role, for "the stronger of two".
create or replace function public._ws_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_role when 'owner' then 6 when 'coowner' then 5 when 'admin' then 4
                     when 'editor' then 3 when 'service' then 2 when 'viewer' then 1 else 0 end;
$$;
```

The choke-point diffs against the live bodies (whole bodies go in the file):

```sql
-- is_workspace_member (0001:69)
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  )
  -- 0523: or the team's role for them here.
  or public._org_ws_role_for(ws, auth.uid()) is not null;

-- _workspace_member_can_write (0391:57)
  select coalesce(public._workspace_member_role(ws) in ('owner', 'coowner', 'admin', 'editor', 'service'), false)
      -- 0523: a team owner/admin anywhere in the team, a member where the team can see.
      or coalesce(public._org_ws_role_for(ws, auth.uid()) in ('coowner', 'editor'), false);

-- can_manage_workspace (0394:23): inside the existing parenthesis, a third OR
       or public._org_ws_role_for(ws, auth.uid()) = 'coowner'

-- my_workspace_ids (0319:71)
  select case when public._actor_active()
              then coalesce((select array_agg(distinct s.id) from (
                     select wm.workspace_id as id from workspace_members wm where wm.user_id = auth.uid()
                     union all
                     select unnest(public._my_org_workspace_ids())) s), '{}'::uuid[])
              else '{}'::uuid[] end;

-- my_readable_board_ids (0319:42): the anchor's workspace test becomes
    where b.workspace_id in (
            select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
            union all
            select unnest(public._my_org_workspace_ids())   -- 0523
          )
       or exists (select 1 from board_shares s where s.board_id = b.id and s.user_id = auth.uid())
```

`workspace_user_directory` (0084:30), whole body:

```sql
  select wm.user_id, wm.workspace_id,
         case when w.org_id is null or wm.user_id = auth.uid() or public.can_manage_workspace(wm.workspace_id)
              then coalesce(u.raw_user_meta_data->>'full_name', u.email)
              -- 0523: in a team workspace a member reads names, never addresses.
              else coalesce(nullif(btrim(p.display_name), ''), u.raw_user_meta_data->>'full_name', 'Someone')
         end as title,
         case when w.org_id is null or wm.user_id = auth.uid() or public.can_manage_workspace(wm.workspace_id)
              then u.email end as email,
         u.created_at
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    join auth.users u on u.id = wm.user_id
    left join public.profiles p on p.user_id = wm.user_id
   where public.is_workspace_member(wm.workspace_id);
```

The invariants (diffs):

```sql
-- get_or_create_personal_workspace (0400:29)
  select w.* into v_ws from workspaces w
   where w.created_by = p_user_id
     and w.org_id is null            -- 0523: a team's workspace is never your personal one
   order by w.created_at asc limit 1;

-- transfer_workspace_ownership (0412:144): select org_id with created_by, then
  if v_org is not null then
    raise exception 'a team workspace belongs to its team; move it out of the team first'
      using errcode = '42501', hint = 'team_workspace';
  end if;

-- prepare_account_deletion (0388:34) and prepare_admin_account_deletion (0408:22), after the ban check
  if exists (select 1 from public.organizations o
              where o.owner_id = p_user_id and o.closed_at is null) then
    raise exception 'this account owns a team; close the team first'
      using errcode = '42501', hint = 'team_owner';
  end if;
```

The new RPCs:

```sql
-- The workspace room's door (party/auth.ts): may the caller be in this workspace?
create or replace function public.can_open_workspace(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public._actor_active() and public.is_workspace_member(p_workspace_id);
$$;

-- What the app should call the caller's role here: the stronger of their row and the team's.
create or replace function public.my_workspace_role(p_workspace_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select r from (
    select (select m.role from public.workspace_members m
             where m.workspace_id = p_workspace_id and m.user_id = auth.uid()) as r
    union all
    select public._org_ws_role_for(p_workspace_id, auth.uid())
  ) x
  where public._actor_active() and r is not null
  order by public._ws_role_rank(r) desc
  limit 1;
$$;

-- The rooms' minute re-checks, party_board_access and party_workspace_access,
-- are the security session's (0620–0622, amendment H). 0530 requires both
-- live and never redefines them.
```

Grants: `_org_ws_role_for(uuid,uuid)`, `_my_org_workspace_ids()`, `_ws_role_rank(text)` revoked from `public, anon, authenticated`; `can_open_workspace(uuid)`, `my_workspace_role(uuid)` revoked from `public, anon`, granted to `authenticated`; the proof requires 0620–0622's `party_board_access(uuid,uuid[])` and `party_workspace_access(uuid,uuid[])` live, callable by the service role and by no client. Re-emitted functions keep their ACLs (create or replace); the proof block re-asserts the live ones: `is_workspace_member` callable by anon (it is today, via PUBLIC), `can_manage_workspace` authenticated-only, `_workspace_member_can_write` / `_user_can_read_board` / `_file_share_reaches` / `_workspace_invite_link_live` not client-callable, `workspace_user_directory` authenticated-only, `prepare_account_deletion` / `prepare_admin_account_deletion` not authenticated. Plus: no overloads among every name touched; and, with no organization rows, `_my_org_workspace_ids()` is empty for a random uid.

- [ ] **Step 4: Run every test that reads these bodies:** `node --test src/lib/teamsMigration.test.mjs src/lib/roleCheck.test.mjs src/lib/securityAudit.test.mjs src/lib/storageCounting.test.mjs src/lib/workspaceInviteLink.test.mjs src/lib/fileShareFixes.test.mjs src/lib/messageAccess.test.mjs src/lib/fileGateMigration.test.mjs`. Where an old test pins "latest definition is file X" for a function 0523 re-emits, change only the file name it expects and keep every content assertion (the re-emit must still satisfy them: e.g. `securityAudit.test.mjs:391` still finds `if public._user_banned(p_user_id) then`, `storageCounting.test.mjs:67` still finds the storage move, `workspaceInviteLink.test.mjs:21-30` still finds each liveness clause).
- [ ] **Step 5: No commit yet.**

---

### Task 3: Seats, and the team branch of the editor limit (0524)

**Files:** create `supabase/migrations/0524_teams_seats.sql`; append pins; update `editorLimitMigration.test.mjs` file pins.

**Interfaces produced:** `_org_role(org, user) → text`, `_org_is_admin(org, user) → boolean`, `_team_seat_grants(org)`, `_team_seat_slots(org) → (slot_key, user_id, email, source)`, `_team_seats_used(org) → integer`, `_team_auto_added_this_month(org) → integer`, `_org_add_seats(org, n, reason, actor) → integer`, `_team_admit(org, user, email) → 'ok'|'already'|'full'`, `_team_request_and_notify(ws, board, joiner, via)`.

**What holds a seat** (the analog of `_account_editor_slots`, 0520:68/123): team owner, admins and members; explicit editors in the team's workspaces (`workspace_members` owner/coowner/admin/editor; `board_shares` editor on live boards), guests included; waiting editor invites in team workspaces (0520's filters: unclaimed, unexpired, `held_at is null`, sender not suspended, board live); open team invites for admin/member. Banned and service identities never. One slot per person; an address slot only when no account with that address holds one.

- [ ] **Step 1: Pins:** `_editor_admit` (latest 0524) calls `_team_admit(` before `_editor_limit_on(` and its personal branch is otherwise byte-identical to 0520:167 (compare `bodyText` with the team lines removed); `_account_editor_grants` has `w.org_id is null`; `_team_seat_grants` has `held_at is null`, `_user_banned`, `_is_service_identity`, `oi.revoked_at is null`; `_team_admit` takes `pg_advisory_xact_lock(hashtext('team_seats:'`; `_editor_refuse` carries both team hints; `_editor_limit_fallback` branches to `_team_request_and_notify(` and returns before `_notify_editor_limit(`; `get_editor_capacity` returns `'team'::text` in its team branch; every `_` helper revoked; no overloads. In `editorLimitMigration.test.mjs`, the asserts that pin `_editor_admit`, `_editor_refuse`, `_editor_limit_fallback`, `get_editor_capacity`, `ask_owner_for_editor_slot`, `_account_editor_grants` to `CORE` now expect `0524_teams_seats.sql`; every content assert stays.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Write 0524.**

```sql
create or replace function public._org_role(p_org uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select m.role from public.org_members m
    join public.organizations o on o.id = m.org_id and o.closed_at is null
   where m.org_id = p_org and m.user_id = p_user;
$$;

create or replace function public._org_is_admin(p_org uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public._org_role(p_org, p_user) in ('owner', 'admin'), false);
$$;

create or replace function public._team_seat_grants(p_org uuid)
returns table (user_id uuid, email text, source text, workspace_id uuid, board_id uuid,
               role text, invite_id uuid, sent_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  with ws as (
    select w.id from public.workspaces w where w.org_id = p_org
  ),
  people as (
    select m.user_id, 'team'::text as source, null::uuid as workspace_id, null::uuid as board_id, m.role
      from public.org_members m
     where m.org_id = p_org and m.role in ('owner', 'admin', 'member')
    union all
    select m.user_id, 'member', m.workspace_id, null::uuid, m.role::text
      from public.workspace_members m
     where m.workspace_id in (select ws.id from ws)
       and m.role in ('owner', 'coowner', 'admin', 'editor')
    union all
    select s.user_id, 'share', b.workspace_id, s.board_id, s.role::text
      from public.board_shares s
      join public.boards b on b.id = s.board_id
     where b.workspace_id in (select ws.id from ws)
       and b.deleted_at is null
       and s.role = 'editor'
  )
  select u.id, lower(u.email), pp.source, pp.workspace_id, pp.board_id, pp.role, null::uuid, null::timestamptz
    from people pp
    join auth.users u on u.id = pp.user_id
   where not public._user_banned(u.id)
     and not public._is_service_identity(u.id)
  union all
  select null::uuid, lower(pi.email), 'pending', pi.workspace_id, pi.board_id, pi.role::text, pi.id, pi.created_at
    from public.pending_invites pi
   where pi.workspace_id in (select ws.id from ws)
     and pi.role in ('editor', 'workspace')
     and pi.claimed_at is null
     and pi.expires_at > now()
     and pi.held_at is null
     and not public._sharer_suspended(pi.invited_by)
     and (pi.board_id is null
          or exists (select 1 from public.boards b where b.id = pi.board_id and b.deleted_at is null))
  union all
  select null::uuid, oi.email, 'team_invite', null::uuid, null::uuid, oi.role, oi.id, oi.created_at
    from public.org_invites oi
   where oi.org_id = p_org
     and oi.role in ('admin', 'member')
     and oi.claimed_at is null
     and oi.revoked_at is null
     and oi.expires_at > now()
     and not public._sharer_suspended(oi.invited_by);
$$;

-- _team_seat_slots: 0520's _account_editor_slots fold (0520:123) over
-- _team_seat_grants, with 'pending' and 'team_invite' as address slots and
-- the account order team(0) < member(1) < share(2).
-- _team_seats_used(org) = count(*) of it.

create or replace function public._team_auto_added_this_month(p_org uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.delta), 0)::integer
    from public.org_seat_changes c
   where c.org_id = p_org and c.reason = 'auto'
     and c.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
$$;

-- The one writer of organizations.seats in S2a. S3 bills the rows (billed_at).
create or replace function public._org_add_seats(p_org uuid, p_n integer, p_reason text, p_actor uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_after integer;
begin
  if p_n is null or p_n = 0 then
    select seats into v_after from public.organizations where id = p_org;
    return v_after;
  end if;
  update public.organizations set seats = seats + p_n
   where id = p_org and closed_at is null
   returning seats into v_after;
  if v_after is null then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  insert into public.org_seat_changes (org_id, delta, seats_after, reason, actor)
  values (p_org, p_n, v_after, p_reason, p_actor);
  return v_after;
end;
$$;

-- May one more person edit in this team? Free seats first. When none is
-- left, the admins' rule: 'auto' adds what's needed (within their monthly
-- number, if they set one); 'ask' answers 'full', and the door decides
-- (refuse, or let them in as a viewer with a request).
create or replace function public._team_admit(p_org uuid, p_user uuid, p_email text default null)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_org   public.organizations%rowtype;
  v_email text := lower(nullif(btrim(p_email), ''));
  v_used  integer;
  v_held  boolean;
  v_need  integer;
begin
  select * into v_org from public.organizations where id = p_org and closed_at is null;
  if not found then return 'full'; end if;
  if v_email is null and p_user is not null then
    select lower(u.email) into v_email from auth.users u where u.id = p_user;
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org::text));
  select count(*)::integer,
         coalesce(bool_or((p_user is not null and s.user_id = p_user)
                          or (v_email is not null and s.email = v_email)), false)
    into v_used, v_held
    from public._team_seat_slots(p_org) s;
  if v_held then return 'already'; end if;
  if v_used < v_org.seats then return 'ok'; end if;
  if v_org.when_full = 'auto' then
    v_need := v_used + 1 - v_org.seats;
    if v_org.auto_monthly_limit is null
       or public._team_auto_added_this_month(p_org) + v_need <= v_org.auto_monthly_limit then
      perform public._org_add_seats(p_org, v_need, 'auto', auth.uid());
      return 'ok';
    end if;
  end if;
  return 'full';
end;
$$;
```

`_team_request(p_org, p_user, p_wanted, p_via, p_ws, p_board) → uuid` (0524, the core both migrations use; amendment D): upserts the one pending request for `(org, user)` and notifies every owner/admin except the user, kind `team.join_request` (title NOT NULL: "{name} asked to edit {place}"; body "{team} has no free seats. Approve to give them one.", or for `via = 'ask'` / `'team_link'` / `'domain'` a body that fits, e.g. "They can view now. Approve to give them a seat."), deduped per (recipient, user) within 24 h; returns the request id.

`_team_request_and_notify(p_workspace, p_board, p_joiner, p_via)` (the doors' viewer fallback): resolves the workspace's org; calls `_team_request` with `wanted` = `board_editor` when `p_via = 'collab_link'` and a board is given, else `workspace_editor` (via `collab_link` / `workspace_link`); then notifies the joiner, kind `team.joined_as_viewer` ("You joined {place} as a viewer" / "{team} has no free seats, so you can view for now. We asked its admins."); logs analytics `team_seat_viewer_fallback {via, workspace_id, board_id}`. Wrapped in `exception when others then raise warning`, like `_notify_editor_limit` (0520:257): it must never break a claim.

The five S1 re-emits (from the live bodies, = 0520's text):

```sql
-- _account_editor_grants (0520:68): personal accounts count personal workspaces only.
  with ws as (
    select w.id from public.workspaces w where w.created_by = p_owner and w.org_id is null   -- 0524
  ),

-- _editor_admit (0520:167): v_org added to the declare and the first select, then
  if v_org is not null then
    return public._team_admit(v_org, p_user, p_email);   -- 0524: a team workspace counts the team's seats
  end if;
  -- (the personal body below is unchanged)

-- _editor_refuse (0520:212), before the personal branch
  if v_org is not null then
    if public._org_is_admin(v_org, auth.uid()) then
      raise exception 'team seats full: every seat is in use; add a seat to add another editor'
        using errcode = '42501', hint = 'team_seats_full';
    end if;
    raise exception 'team seats full: ask an admin of the team for another seat'
      using errcode = '42501', hint = 'team_seats_ask_admin';
  end if;

-- _editor_limit_fallback (0520:370), first lines
  if exists (select 1 from public.workspaces w where w.id = p_workspace and w.org_id is not null) then
    perform public._team_request_and_notify(p_workspace, p_board, p_joiner, p_via);
    return;
  end if;

-- get_editor_capacity (0520:398), after the access check: v_org with v_owner, then
  if v_org is not null then
    return query
      select true, o.seats,
             (count(*) filter (where s.source not in ('pending', 'team_invite')))::integer,
             (count(*) filter (where s.source in ('pending', 'team_invite')))::integer,
             count(*) >= o.seats
               and (o.when_full = 'ask'
                    or (o.auto_monthly_limit is not null
                        and public._team_auto_added_this_month(v_org) >= o.auto_monthly_limit)),
             public._org_is_admin(v_org, auth.uid()),
             'team'::text
        from public.organizations o
        left join public._team_seat_slots(v_org) s on true
       where o.id = v_org
       group by o.seats, o.when_full, o.auto_monthly_limit;
    return;
  end if;

-- ask_owner_for_editor_slot (0520:449): team branch after the access check —
-- 'owner' when the caller is a team owner/admin; 'not_full' when used < seats
-- or the rule is auto under its number; 'already_sent' when the caller sent a
-- 'team.seats_full' notice in 24 h; else notify every owner/admin (kind
-- 'team.seats_full', data {via:'ask'}) and 'sent'.
```

Grants: every new `_` helper revoked from `public, anon, authenticated`; re-emits keep ACLs; the proof block repeats 0520's two loops for the re-emitted names plus the new helpers, the no-overload check across `_editor_admit, _team_admit, _team_seat_slots, _team_seat_grants, get_editor_capacity, ask_owner_for_editor_slot`, and: with no organizations, `_editor_admit` on a random workspace still returns `'ok'` (personal path, limit off).

- [ ] **Step 4: Run** `teamsMigration`, `editorLimitMigration`, `roleCheck`, `workspaceInviteLink`. Then commit 0522–0524 + the tests by pathspec, written-not-applied, and push.

---

### Task 4: The team RPCs (0525)

**Files:** create `supabase/migrations/0525_teams_rpcs.sql`; append pins.

**Common shape of every RPC here:** `security definer`, `set search_path = public` (`, auth` where it reads `auth.users`); first lines `if auth.uid() is null or not public._actor_active() then raise … '42501'`; then the caller check named in the table; `pg_advisory_xact_lock(hashtext('team_seats:' || org))` before any seat arithmetic; every member-row insert runs after `perform set_config('soleil.quiet_member_email', '1', true)` (see `_tg_workspace_member_email` below).

**Internals (revoked from clients):**

```sql
-- One owner per workspace move. Re-uses transfer_workspace_ownership's
-- storage move (0412:144, the _image_counts sum and the two
-- _storage_usage_apply calls) verbatim, so files follow the owner the way a
-- transfer moves them. The previous owner keeps editing (row → 'editor').
create or replace function public._workspace_set_owner(p_ws uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old uuid; v_bytes bigint; v_objects bigint;
begin
  select created_by into v_old from public.workspaces where id = p_ws for update;
  if v_old is not distinct from p_new_owner then return; end if;
  perform set_config('soleil.quiet_member_email', '1', true);
  update public.workspaces set created_by = p_new_owner where id = p_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_ws, p_new_owner, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  if v_old is not null then
    update public.workspace_members set role = 'editor' where workspace_id = p_ws and user_id = v_old;
  end if;
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint into v_bytes, v_objects
    from public.images i
   where i.workspace_id = p_ws
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  if v_old is not null then perform public._storage_usage_apply(v_old, -v_bytes, -v_objects); end if;
  perform public._storage_usage_apply(p_new_owner, v_bytes, v_objects);
end;
$$;

-- Move a personal workspace into a team. The caller must own it; the team
-- owner becomes its owner (created_by), the caller stays as an editor.
-- Everyone in it keeps what they had ("Everyone in them kept what they had").
create or replace function public._org_move_in(p_ws uuid, p_org uuid, p_actor uuid, p_may_add_seats boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_w public.workspaces%rowtype; v_owner uuid; v_used integer; v_seats integer;
begin
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org::text));
  select * into v_w from public.workspaces where id = p_ws for update;
  if not found then raise exception 'workspace not found' using errcode = 'P0002'; end if;
  if v_w.org_id is not null then
    raise exception 'that workspace is already in a team' using errcode = '22023', hint = 'team_workspace';
  end if;
  if v_w.created_by is distinct from p_actor then
    raise exception 'only its owner can move a workspace into a team' using errcode = '42501';
  end if;
  select owner_id into v_owner from public.organizations where id = p_org and closed_at is null;
  update public.workspaces set org_id = p_org, org_visibility = 'team' where id = p_ws;
  perform public._workspace_set_owner(p_ws, v_owner);
  perform public._ensure_workspace_root(p_ws, p_actor);
  v_used := public._team_seats_used(p_org);
  select seats into v_seats from public.organizations where id = p_org;
  if v_used > v_seats then
    if not p_may_add_seats then
      raise exception 'moving this workspace in needs % more seat(s)', v_used - v_seats
        using errcode = '42501', hint = 'team_seats_needed', detail = (v_used - v_seats)::text;
    end if;
    perform public._org_add_seats(p_org, v_used - v_seats, 'move_in', p_actor);
  end if;
end;
$$;
```

- `_org_remove_person(p_org, p_user, p_notify boolean)`: delete the `org_members` row; delete their `workspace_members` rows in the team's workspaces except role `owner`; delete their `board_shares` on boards in the team's workspaces (the 0318 cascade pattern; `board_shares_remember_removal` records them, so an admin's undo works through `restore_board_share`); cancel their pending requests; notify `team.removed` when `p_notify`. Their open sockets drop within a minute (Task 8).
- `_team_request(...)` is defined in 0524 (amendment D); 0525's `claim_team_link`, `answer_team_offer` and `ask_team_for_edit` call it, and never re-define it.
- `_tg_workspace_member_email` re-emitted from `0450_workspace_invite_links.sql:422`: its early return also fires on `current_setting('soleil.quiet_member_email', true) = '1'` (team moves, team creation and close insert rows nobody should get a "you were added" email for).

**Client RPCs** (each `revoke … from public, anon; grant … to authenticated` unless noted):

| RPC | Caller check | Does |
|---|---|---|
| `create_team(p_name text, p_color text default null, p_workspace_ids uuid[] default '{}', p_seats integer default 3) → uuid` | signed in, active; owns no open team (`team_exists`); `p_seats` 3–100 | insert `organizations` (the gate trigger refuses unless allowed: `teams_closed`), owner row (`joined_via 'create'`), `org_seat_changes` `create`; `_org_move_in(ws, org, uid, true)` for each listed workspace; analytics `team_created` |
| `create_team_workspace(p_org_id uuid, p_name text, p_root_name text default 'Studio', p_private boolean default false) → jsonb` | team role owner/admin/member ("any member with a seat"); `p_private` only for owner/admin, else `team_not_admin` | as `create_workspace_with_root` (0375:477): workspace `created_by` = team owner, `org_id`, `org_visibility`; rows: team owner `owner`, caller `editor` (if not the owner); root board `created_by` = caller + `board_state`. Returns `{workspace_id, root_board_id}` (same shape) |
| `preview_move_into_team(p_workspace_id uuid, p_org_id uuid) → table(seats_needed int, editors int)` | as `move_workspace_into_team` | runs `_org_move_in(…, true)` inside `begin … exception` that always raises after counting, so the answer is exact and nothing stays (the setup wizard's "this needs N more seats") |
| `move_workspace_into_team(p_workspace_id uuid, p_org_id uuid, p_add_seats boolean default false) → void` | owns the workspace; team role owner/admin/member; `p_add_seats` honoured for owner/admin only | `_org_move_in` |
| `move_workspace_out_of_team(p_workspace_id uuid, p_to_user uuid default null) → void` | team owner/admin; to anyone but the team owner, the owner only (`team_not_owner`, amendment G) | `p_to_user` default the team owner; must be an org member who holds a seat and isn't banned; `org_id`/`org_visibility` → null; `_workspace_set_owner(ws, to_user)`; notice `team.workspace_moved_out` to them. Team-derived access ends (no materializing — open question 9) |
| `set_team_workspace_private(p_workspace_id uuid, p_private boolean) → void` | team owner/admin | `org_visibility` ← private/team; private from team-visible runs `_offboard_member(ws, p)` for each member and viewer with no explicit row there (amendment G) |
| `rename_team(p_org_id uuid, p_name text, p_color text default null) → void` | owner/admin | |
| `invite_to_team(p_org_id uuid, p_emails text[], p_role text default 'member', p_add_seats boolean default false) → jsonb` | owner/admin, `_actor_can_send()`; `p_role` `admin` owner-only; ≤ 50 addresses | normalise, de-dupe; already a member or an open invite → `already`; else revoke that address's expired invite, insert `org_invites`. Never a direct add, and nothing in the answer says whether an address has an account (amendment G). Seats for admin/member: needed = addresses that hold no slot; if `used + needed > seats`: `p_add_seats` → `_org_add_seats(shortfall, 'admin_add')`, else `team_seats_needed` (detail = shortfall). Returns `{invited, already, skipped:[{email, reason}]}`. **No email is sent in S2a** (S4 adds the template and `_notify_email('team_invite', …)` under the 0369 breaker and the invite budget) |
| `revoke_team_invite(p_invite_id uuid) → void` | owner/admin of its team | `revoked_at = now()` |
| `accept_team_invite(p_token uuid) → table(org_id uuid, role text, status text)` | signed in, inbox proven (`team_inbox_unproven`); the invite's address = the caller's address | `org_members` row with the invite's role, no seat gate (its slot was held when sent, as `claim_pending_invite` 0371:312); `claimed_at/by`; deletes the caller's `org_removals` row; status `joined` / `already` / `expired` / `revoked` |
| `claim_my_team_invites() → integer` | signed in; returns 0 unless the inbox is proven | claims every open invite to it (S4 calls it at boot; the fragile signup trigger path is not touched) |
| `set_team_role(p_org_id uuid, p_user_id uuid, p_role text, p_add_seats boolean default false) → void` | owner/admin; never the owner's row, never yourself; to or from `admin` owner-only | insiders: `admin` / `member` / `viewer` (`viewer → member/admin` needs a free seat or `p_add_seats`, else `team_seats_needed`; an admin's explicit action never consults the when-full rule). `admin → member/viewer` first runs `_offboard_member` for each private team workspace they hold no `workspace_members` row in (requirement 3; where they still reach a workspace, a lower role takes nothing, as `set_workspace_member_role`). Outsiders (no org row): `viewer` demotes all their editor grants in the team's workspaces; `guest` is only reached by approving a request |
| `remove_from_team(p_org_id uuid, p_user_id uuid) → void` | owner/admin; not the owner; an admin target owner-only | `_org_remove_person(…, true)`; for an outsider, deletes their explicit grants in the team's workspaces |
| `leave_team(p_org_id uuid) → void` | any team role but owner | `_org_remove_person(…, false)` |
| `add_team_seats(p_org_id uuid, p_n integer) → integer` | owner/admin ("admins can add seats"); total ≤ 100 (self-serve) | `_org_add_seats(n, 'admin_add')` |
| `remove_team_seat(p_org_id uuid) → integer` | owner/admin | floor `greatest(3, used)`; `_org_add_seats(-1, 'admin_remove')` |
| `set_team_when_full(p_org_id uuid, p_mode text, p_monthly_limit integer default null) → void` | owner/admin | mode `ask`/`auto`; limit null or 1–1000 (the admins' own number, or none) |
| `set_team_seat_perk(p_org_id uuid, p_on boolean) → void` | owner/admin | stored for S2b |
| `set_team_link(p_org_id uuid, p_on boolean default null, p_role text default null) → void` | owner/admin | `link_on`, `link_role` (`member`/`viewer`) |
| `reset_team_link(p_org_id uuid) → uuid` | owner/admin | new `link_token` |
| `peek_team_link(p_token uuid) → table(status text, team_name text, role text)` | anyone (**also granted to anon**, like `peek_workspace_invite_link` 0450:247) | `ok` with `_safe_label(name, 60, 'a team')` and role; else `off` / `not_found` (closed team, banned owner, link off all read `off`); never says who is in it |
| `claim_team_link(p_token uuid) → table(org_id uuid, role text, status text)` | signed in, active; link on, team open, owner not banned | already in → `already`; link role viewer → viewer row, `joined`; member → `_team_admit`: ok/already → member row `joined`; full → viewer row + `_team_request(member, 'team_link')`, status `requested`. Analytics `team_joined {via, status}` |
| `add_team_domain(p_org_id uuid, p_domain text) → jsonb` | owner/admin; ≤ 10 domains | normalise (`lower`, trim, strip `@` and a trailing dot); shape fails → `team_domain_invalid`; `_freemail_domain` → `team_domain_freemail`; verified by another team → `team_domain_taken`. Returns `{domain, txt_name, txt_value, verified}` with `txt_name` = the domain, `txt_value` = `soleil-verification=<verify_token>` (open question 13) |
| `set_team_domain_on(p_org_id uuid, p_domain text, p_on boolean)`, `remove_team_domain(p_org_id uuid, p_domain text)` | owner/admin | |
| `team_domain_mark_verified(p_org_id uuid, p_domain text) → boolean` | **service role only** (S4's DNS check in the Worker calls it) | `verified_at = now()`; the unique index refuses a domain another team verified first |
| `my_team_offers() → table(org_id uuid, name text, letter text, color text, mode text)` | signed in; nothing unless the inbox is proven | open teams with a verified, `join_on` domain = the caller's address domain, caller not in it and not removed from it (`org_removals`), no `org_domain_answers` row; `mode` = `auto` when the account was created after `verified_at` (new accounts auto-join), else `ask` (asked once). Admins never learn who has an account: this reads only the caller |
| `answer_team_offer(p_org_id uuid, p_join boolean) → table(org_id uuid, role text, status text)` | the offer must be in `my_team_offers()` | records the answer once; join → `_team_admit`: member `joined`, or viewer + `_team_request(member, 'domain')` `requested` |
| `approve_team_request(p_request_id uuid, p_add_seat boolean default false) → text` | owner/admin of its team; pending | the requester already holds a slot → no seat needed; else free seat, else `p_add_seat` → `_org_add_seats(1, 'approve')`, else `team_seats_full`. Grant: `member` → org role member; `workspace_editor` → their workspace row → `editor` (insert if gone); `board_editor` → their share → `editor`. Status `approved`; notice `team.request_approved`. Returns `approved` |
| `keep_team_request_viewer(p_request_id uuid) → void` | owner/admin | status `kept` |
| `close_team(p_org_id uuid) → jsonb` | owner only (`team_not_owner`) | for each team workspace: write each team member's `_org_ws_role_for` into `workspace_members` (`on conflict (workspace_id, user_id) do update set role = excluded.role where _ws_role_rank(excluded.role) > _ws_role_rank(workspace_members.role) and workspace_members.role not in ('owner', 'service')`), then `org_id`/`org_visibility` → null (created_by is already the owner; assert, else `_workspace_set_owner`); revoke open invites, delete domains, cancel requests, `link_on = false`, delete `org_members`, `closed_at = now()`; notice `team.closed` to everyone who was in it. Returns `{workspaces_moved}`. The owner's personal limit then counts them: over 10 is the S1 freeze, as the owner decision says. S3 prefixes "the subscription has ended" |

Notification kinds (all `title` NOT NULL, all short plain sentences, recorded in the header; at most one a day per person, kind, team and workspace, amendment G): `team.removed`, `team.join_request`, `team.joined_as_viewer`, `team.request_approved`, `team.seats_full`, `team.workspace_moved_out`, `team.closed`. Analytics server events: `team_created`, `team_joined`, `team_seat_viewer_fallback`, `team_closed` (Task 6 registers them).

- [ ] **Step 1: Pins:** each client RPC above is revoked from `public, anon` and granted to `authenticated`; `peek_team_link` also `to anon`; `team_domain_mark_verified` revoked from `public, anon, authenticated`; each RPC body has `_actor_active()` and the right role helper (`_org_is_admin(`, or the owner test for `close_team`); `create_team` contains no direct seat insert besides the `create` change row; `invite_to_team` contains no `_notify_email(` (S2a sends nothing); `close_team` contains the `on conflict (workspace_id, user_id) do update` with `_ws_role_rank(`; `create_team_workspace` inserts a root board and `board_state` in the same body; no `parent_board_id` write anywhere in 0522–0526 except `create_team_workspace`'s root insert (`parent_board_id` null); no overloads among every name in the file.
- [ ] **Step 2–3:** watch fail; write 0525 (bodies per the table; proofs as 0520 §7).
- [ ] **Step 4:** run pins; no commit yet.

---

### Task 5: The reads the page renders (0526)

**Files:** create `supabase/migrations/0526_teams_read.sql`; append pins.

- `list_my_teams() → table(org_id uuid, name text, letter text, color text, role text, holds_seat boolean)`: the caller's open teams. Feeds the workspace menu and "Team or Personal" (offered only where `holds_seat`).
- `list_my_team_workspaces() → table(workspace_id uuid, role text, created_at timestamptz, org_id uuid, org_name text, private boolean, workspace jsonb)`: team workspaces the caller can open through the team but has no `workspace_members` row in (`role` = `_org_ws_role_for`; `workspace` = `to_jsonb(w)`, so S4 merges them into `membershipWorkspaces` without a second fetch and without duplicates).
- `get_team(p_org_id uuid) → jsonb`: the `TeamSnapshot` of `boards/src/lib/teamModel.js` (header comment), cut on the server. Caller must hold an org role, else 42501 hint `team_not_member`. `v_admin := role in ('owner', 'admin')`.

```
{
  id, name, letter: upper(left(btrim(name), 1)), color, sample: false,
  status,                                   -- organizations.status ('active' until S3)
  me: { id: auth.uid(), role },             -- 'viewer' possible (contract addition, Q11)
  admins: [{ id, name }],                   -- owner first, then admins by joined date
  people: Person[],                         -- below
  requests: v_admin ? Request[] : null,
  plan: null, storage: null, unpaid: null,  -- S3
  seats: v_admin ? { bought, used, pending } : null,   -- contract addition (Q11); plan.seats in S3
  whenFull: v_admin ? { mode, monthlyLimit } : null,
  joining: v_admin ? { link: { on, token, role: 'editor'|'viewer' },
                       domains: [{ domain, verified, on, txtName, txtValue }] } : null,
  workspaces: [{ id, name, letter, color: settings->>'color', private }]
              -- admins: all; others: those they can open (team-visible + private with a row)
}
```

People (one query of CTEs, then `jsonb_agg`):
1. **Insiders:** `org_members` → `role` = owner/admin/member/viewer, `outside: false`.
2. **Outsiders:** people with an explicit grant in the team's workspaces (`workspace_members` any role but `service`, or `board_shares` on live boards) and no org row; `role` = `guest` if any grant edits (wm owner/coowner/admin/editor, share editor), else `viewer`; `outside: true`.
3. **Invites** (admins only): open `org_invites` (`id` = `'invite:' || id`, `name` = email, `role` member/viewer, `invited: { role: 'editor'|'viewer', sentAt }`), and waiting `pending_invites` in team workspaces (`outside: true`, `role` guest/viewer), each address once and never when an account with it is already listed.
- `where`: names of the team workspaces the person can open (explicit row or `_org_ws_role_for`), plus `"{workspace}, one cluster"` / `"{workspace}, N clusters"` for share-only reach; `everywhere` = owner/admin, or can open every team workspace. (Q11)
- `email`: `u.email` only when `v_admin`, else null. `online`/`lastSeenAt`: from `user_presence.last_seen_at` (epoch ms; online = within 2 minutes) only when `v_admin`, else `false`/null. `color`: `profiles.color`. `name`: `profiles.display_name`, else `raw_user_meta_data->>'full_name'`, else (admins) the address, else `'Someone'` — a member never receives an address, not even as a fallback name.
- Requests: pending `org_join_requests` → `{ id, personId: user_id, name, workspace: coalesce(workspace name, board's workspace name, team name), color }`.
- Times are epoch milliseconds (`(extract(epoch from t) * 1000)::bigint`), as the client model uses.

- `my_workspace_role` lives in 0523 (Task 2); nothing else here writes.

- [ ] **Step 1: Pins:** `get_team` checks the caller's role first; every `u.email` in its body sits inside `case when v_admin`; the member branch returns `requests`, `whenFull`, `joining`, `seats` as null; no `org_domain_answers` read anywhere but `my_team_offers`/`answer_team_offer`; grants authenticated-only; no overloads.
- [ ] **Step 2–4:** watch fail, write, pass. Commit 0525–0526 + pins by pathspec (written, not applied) and push.

---

### Task 6: Client constants, hold, events, wrappers (no UI)

**Files:** `boards/src/lib/teamHints.js` (+ test), `analyticsEvents.js` (+ its test), `appHost.js`, `featureEvents.js`, `teamsApi.js` (new).

- [ ] **Step 1:** `teamHints.js` exports `TEAM_HINT` (one key per hint in Global Constraints) and `teamRefusal(err)` → `{ kind, needed }` (reads `err.hint`, `Number(err.details)` for `team_seats_needed`), modelled on `editorLimitRefusal` in `lib/editorLimit.js`. `teamHints.test.mjs`: each hint string appears in the 0522–0526 SQL (`fileText`), and `teamRefusal` maps a fake PostgrestError for each.
- [ ] **Step 2:** `analyticsEvents.js`: `TEAM_CREATED`, `TEAM_JOINED`, `TEAM_SEAT_VIEWER_FALLBACK`, `TEAM_CLOSED`, each `// SERVER:` and in `SERVER_EMITTED`, as `EDITOR_LIMIT_VIEWER_FALLBACK` (line 485) does; run `analyticsEvents.test.mjs`.
- [ ] **Step 3:** `appHost.js`: `teamsAllowed()` closed (dev opt-in `soleil.dev.teams`), shaped like `editorLimitAllowed()` (line 162), and `featureFlags()` gains `teams`; `featureEvents.js` `teams: { unmeasured: 'S2a server only; S4 instruments the page' }` (memory: every new hold needs an entry). Run `featureEvents`/`appHost` tests.
- [ ] **Step 4:** `teamsApi.js`: one async wrapper per RPC in Tasks 2–5, each `const { data, error } = await supabase.rpc(…); if (error) throw error; return data;` (never `.catch()` on the builder). No caller yet; the S4 page swaps `teamReducer`'s actions for these.
- [ ] **Step 5:** `npm test`. Commit by pathspec (`appHost.js` / `featureEvents.js` may carry other sessions' hunks: stage only yours, as S1a Task 8 did). Push.

"Team or Personal" on create (the program's S2a line) is UI: it waits for the S0 pick and is built in S4's plan on `listMyTeams()` + `createTeamWorkspace()`, behind `teamsAllowed()`.

---

### Task 7: The rolled-back probes against the real database

Same mechanics as S1a Task 5: each probe is ONE `do $probe$ … $probe$;` that executes the migrations' text and the checks, and always ends in `raise exception 'PROBE_REPORT …'`, so nothing persists. `build_probe.py` (scratchpad, never committed) strips `--` comment lines and `begin;`/`commit;`, asserts the `$mNNNN$`/`$probe$` tags appear in no source, and prints the length. **Each probe string must stay under ~45k characters.** The planned split:

- **Probe A** = 0522 + 0523 + checks A (access).
- **Probe B** = 0522 + 0523 + 0524 + checks B (seats). If over the budget, B runs after step 1 of Task 9 (0522–0523 live), carrying only 0524.
- **Probe C** = 0525 + 0526 + checks C (RPCs, snapshot), run against 0522–0524 live (Task 9 step 2), or carrying them if it fits.

Actors: `set_config('request.jwt.claims', json_build_object('sub', X, 'role', 'authenticated')::text, true)` and `set_config('request.jwt.claim.sub', X::text, true)` per actor; RLS checks additionally `execute 'set local role authenticated'` … `execute 'reset role'`. Fixtures through live doors where one exists (`create_workspace_with_root`, `share_board`, `invite_workspace_member`, `create_collab_link`/`claim_collab_link`, and in C the new RPCs); fixture users on `@probe.invalid`, 30 days old, as S1a. The probe makes the owner a test owner by updating `teams_open.test_owner_ids` inside the probe (rolled back). Report lines only: `ok`/`FAIL`, counts and timings, never ids or addresses.

**Checks A (access):**
1. *Parity before/after DDL.* Before executing 0522/0523, for a sample of real users (the ones with the most memberships and shares, plus a random handful; ids stay inside the block), record md5 of `my_readable_board_ids()` (sorted), md5 of `my_workspace_ids()`, `is_workspace_member` / `can_manage_workspace` / `_workspace_member_can_write` for each of their workspaces, `can_read_board` / `can_write_board` for up to 5 of their boards, `workspace_user_directory()` md5, `get_or_create`'s chosen workspace id (read via a select with the 0400 predicate, not the writer). Execute the DDL. Recompute. Report `parity: N users, M answers, 0 differ`.
2. *Gate.* As a non-listed user, a direct `insert into organizations` (as postgres, owner_id = them) raises hint `teams_closed`; listing them lets it through.
3. *Matrix.* Team T (owner O, admin A, members M1 M2, viewer V), team-visible workspace W1 (moved in from O by direct DDL fixture: `org_id`, `org_visibility`, O's owner row), private W2, an outside guest G with an editor share on a W1 cluster, a stranger S, and O's personal workspace P. For each actor × {W1 root, W1 child, W2 root, P root}: `is_workspace_member`, `can_manage_workspace`, `can_read_board`, `can_write_board`, membership of `my_workspace_ids()` / `my_readable_board_ids()`. Expected: O, A everything on W1/W2; M1 read+write W1, nothing W2; V read W1 only; G read+write the shared cluster subtree only; S nothing; nobody but O on P.
4. *Real RLS.* As `authenticated`: `select count(*) from boards where workspace_id = W1` (M1 > 0, S = 0); `update boards set name = name where id = W1root` row counts (M1 1, V 0, S 0) and the same UPDATE by a real sampled user on one of their own boards (1) — the rolled-back real-user UPDATE; `insert into boards` into W1 (M1 ok, V raises); `insert into realtime.messages (topic, extension, payload, event, private) values ('y:'||W1root, 'broadcast', '{}', 'probe', true)` after `set_config('realtime.topic', 'y:'||W1root, true)` (M1 ok, V raises 42501); the same for `board:` (V ok: readers write) and `ws:` (V ok, S raises). If the `authenticated` role lacks INSERT on `realtime.messages`, evaluate each policy's `with_check` expression directly and report `realtime via expressions`.
5. *Private flip.* Set W2 → team: M1 gains W2; W1 → private: M1 loses W1 (the matrix shrinks), O/A keep it.
6. *Party RPCs.* 0621's `party_board_access(W1root, [O, A, M1, V, G, S])` equals rows of the matrix (the org branch reaches it through the predicates); afterwards `auth.uid()` equals the actor set before the call (claims restored); `party_workspace_access(W1, …)` likewise; `can_open_workspace(W1)` as V true, as S false. As `authenticated`, calling `party_board_access` raises 42501.
7. *Directory privacy.* As M1, `workspace_user_directory()` rows for W1 carry no `@` in email or title; as A they do.
8. *Invariants.* `transfer_workspace_ownership(W1, M1)` as O raises hint `team_workspace`; `prepare_account_deletion(O)` (as postgres) raises `team_owner`; with O's oldest workspace moved into T, the 0523 `get_or_create_personal_workspace(O)` returns a different, personal workspace with a live root (it creates one: allowed inside the probe).
9. *Timing.* `explain (analyze, buffers)` of `select my_readable_board_ids()` for the heaviest sampled real user, before and after the DDL. Report both in ms.

**Checks B (seats):** seats = 3, O + A + M1 hold them (`_team_seats_used = 3`). `share_board(W1root, G2 address, 'editor')` as O raises `team_seats_full`, as M1 `team_seats_ask_admin`; `get_editor_capacity(p_workspace_id => W1)` says `subject = 'team'`, full; `ask_owner_for_editor_slot` as M1 → `sent`, again → `already_sent`, O and A each have one `team.seats_full` notice. `set when_full = 'auto', limit 1`: the share succeeds, seats = 4, one `org_seat_changes` row `auto`; the next one is refused (limit). A viewer link: `claim_collab_link` on an editor link in W1 while full in `ask` → share `viewer`, one pending `org_join_requests` (`board_editor`, `collab_link`), O and A notified once, the joiner gets `team.joined_as_viewer`, and NO `editors.limit_reached` row exists. The same with `claim_workspace_invite_link` (`workspace_editor`). A banned member frees a seat; a service identity never holds one; a waiting editor invite in W1 holds one; an open `org_invites` member holds one. O's personal count `_account_editor_count(O)` ignores W1's people. With T's workspaces' `org_id` set to null by a fixture, every door behaves as S1 (0520's personal path).

**Checks C (RPCs, snapshot):** `create_team` refused for a non-listed user (`teams_closed`), works for the listed one, refuses a second (`team_exists`); `create_team_workspace` as a member makes a workspace with exactly one live root and `created_by` = O; `preview_move_into_team` answers the shortfall and leaves no trace (`org_id` still null after); `move_workspace_into_team` without seats raises `team_seats_needed` with the count in `detail`, with `p_add_seats` as O moves it and storage usage moved from mover to O equals the workspace's counted bytes; `invite_to_team` as A for an existing account adds a member and for a new address stores an invite, a second call says `already`; `set_team_role` admin changes refused for A, allowed for O; `claim_team_link` as a stranger when full → viewer + `requested`, `approve_team_request` without a seat raises `team_seats_full`, with `p_add_seat` approves and the person can write W1; `peek_team_link` works as `anon` and reveals no person; domains: `gmail.com` refused (`team_domain_freemail`), a domain verified by another fixture team refused (`team_domain_taken`), `team_domain_mark_verified` refused as authenticated, works as service role; `my_team_offers` for a fresh account on that domain says `auto`, for an older one `ask`; `answer_team_offer(false)` and then `my_team_offers()` is empty; `remove_from_team(M1)` → M1's W1 rows/shares gone and `party_board_access` says no for M1; `get_team` as M2: the whole JSON text contains no `@`, `requests`/`joining`/`whenFull`/`seats` are null, private W2 absent; as A: emails present, invites present; as a stranger: 42501; `close_team` as A refused, as O: every W1/W2 person who could edit still can (explicit rows now), `org_id` null, O's `_account_editor_count` includes them, `organizations.closed_at` set, `list_my_teams()` empty for M2.

- [ ] **Steps:** write the three checks files, build, run each through `mcp__supabase__execute_sql`, expect `PROBE_REPORT` with only `ok` lines; then confirm nothing stayed: `select (select count(*) from auth.users where email like '%@probe.invalid'), (select count(*) from pg_proc where proname = '_org_ws_role_for'), (select count(*) from pg_class where relname = 'organizations')` → `0, 0, 0` (before any apply). Keep the report for Task 9's message. No commit.

---

### Task 8: The party server

**Files:** `boards/party/auth.ts`, `board.ts`, `workspace.ts`, `index.ts`; `boards/src/lib/teamsParty.test.mjs` (source pins).

- [ ] **Step 1: `authWorkspaceUncached`** (`auth.ts:245-259`): POST `rpc/can_open_workspace` `{p_workspace_id}` with the caller's bearer; `true` → ok. If the RPC answers 404 (0523 not live yet), fall back to today's `workspace_members` read, so the party can deploy before or after the migration.
- [ ] **Steps 2–4: the rooms' re-checks are the security session's (amendment H).** Their PTY-1 added `party_board_access` (0620, 0621) and `party_workspace_access` (0622), the helpers `accessAmong` / `workspaceAccessAmong` in `auth.ts`, the alarms in `board.ts` and `workspace.ts` (close 4401), and a Workspace door in `index.ts` that refuses a suspended account. Task 8 touches none of that. Step 1's door must stay equal to their re-check: `can_open_workspace` is `_actor_active() and is_workspace_member(…)`, the same predicate as `party_workspace_access`.
- [ ] **Step 4b: The upload party's foreign-prefix check** (`upload.ts:926`, review 2026-10-22). When a board's workspace differs from the room's, it reads `workspace_members` directly to prove the caller belongs to the room's workspace, so a team member with no explicit row there is refused. Ask `rpc/can_open_workspace` `{p_workspace_id: workspaceId}` with the caller's token instead: `true` → allowed; anything else, an error or a 404 before 0530 is live included, → fall back to today's read, which still fails closed. Pin it in `teamsParty.test.mjs`.
- [x] **Step 5: Client reconnect: done by the security session (PTY-1).** On 4401 (access ended) or 4403 both `yPartyKit.js` and `workspacePartyKit.js` stop: an `accessEnded` flag clears `shouldConnect`, the token reconnector, unpark and SIGNED_IN check it, and the board client fires `soleil-board-access-ended`. 4409 (role changed, lost write) reconnects read-only. Nothing left for Task 8.
- [ ] **Step 6: Pins** (`teamsParty.test.mjs`, reading the `.ts` files as text): `authWorkspaceUncached` posts to `rpc/can_open_workspace`; the 404 fallback exists; the upload party's foreign-prefix check asks `rpc/can_open_workspace` and falls back to today's read.
- [ ] **Step 7:** `npm test`; commit by pathspec; push. **Deploy** (`cd boards && npm run deploy:party`) only after claiming the party deploy by message (memory: claim by message) and after 0523 is live (Task 9), though the fallbacks make either order safe.

---

### Task 9: Hand-off: apply on the owner's go

Nothing here runs without the owner's explicit go.

- [x] **0522 applied 2026-10-22 on the owner's go** (amendment A's first step; migration `20261022052543 teams_tables`). Before: none of its tables, columns or functions existed, and nothing held a lock on `workspaces`. After: its three function bodies match the file by md5 and are server-only; the 10 tables have RLS on, no policies, no client privileges and no realtime publication; no client can set a workspace's team; `teams_open` is closed and no team exists. The security advisor's only note on them is the intended "RLS enabled, no policy".

**Before every apply** (amendments E and F), one read-only query, and stop on any miss:
- every function the file re-emits still has the live `md5(prosrc)` recorded in its header ("Rebased on"). A difference means another session applied first: rebase that function onto the live body, re-run its probe, then apply;
- 0532 needs the security session's `_session_proves_inbox()` (their 0600) and `_offboard_member(uuid, uuid)` (their Phase 1) live, because it calls both;
- the file numbers still sort after every applied migration that re-emits the same functions (`supabase_migrations.schema_migrations`).

- [ ] **Step 1: Ask.** Tell the owner plainly: what probes A–C proved (their ok lines, the parity line, the timing); that applying changes nothing for anyone, because no team can exist while `teams_open` is closed and lists nobody; that 0523 re-emits the hottest read path (`my_readable_board_ids`, behind every board read), with the measured before/after; that the apply goes in two steps, each only after its probe passes. Ask for a go.
- [ ] **Step 2: On "go":** `apply_migration` `teams_tables` (0522), `teams_access` (0523), `teams_seats` (0524). Stop at the first error. Verify live = files (md5 of each re-emitted `prosrc`, as S1a Task 9 step 3). Run the parity check of probe A alone against live (read-only: compare against the pre-apply snapshot the probe printed as md5s). Deploy the party (Task 8 step 7).
- [ ] **Step 3:** run probe C against live 0522–0524; on all ok, apply `teams_rpcs` (0525), `teams_read` (0526); verify live = files; `select count(*) from organizations` = 0; `select value from app_config where key = 'teams_open'` = `{"open": false, "test_owner_ids": []}`.
- [ ] **Step 4:** headers → `STATUS: applied <date> (owner's go).`; commit by pathspec; push.
- [ ] **Step 5: Memory:** update `project_team_plan_editor_limit_2026_10_21.md`: 0522–0526 LIVE, teams closed, probes passed; the test-owner listing step for preview (the owner's account id goes into `teams_open.test_owner_ids` by a one-row update when the S4 page is ready).

---

## Carried forward

**S2b:** `billing_subject(ws)` = the team for `org_id` not null (team workspaces then stop counting toward the team owner's personal cards/storage); the seat perk reads `organizations.seat_perk` and `org_members.seat`; `transfer_workspace_ownership` is re-emitted again there (the freeze line), from 0523's body.
**S3:** `organizations.status` view-only enforcement (a branch in `_workspace_member_can_write` and the upload gates); billing reads `org_seat_changes where billed_at is null`; `create_team` moves behind checkout; `close_team` refuses while a subscription is live; the auto rule's monthly window may become the billing period.
**S4:** the `/team` page swaps `teamReducer` for `teamsApi.js`; workspace list merges `list_my_team_workspaces`; `getMyWorkspaceRole` → `my_workspace_role`; invite emails (template + `_notify_email` under the 0369 breaker and invite budget); the DNS TXT check (Worker → `team_domain_mark_verified`); boot calls `claim_my_team_invites` and `my_team_offers`; "Team or Personal" on create; client hint handling (`teamRefusal`); team-derived DMs (`can_message`, `list_messageable_users`, `member_profiles`) decided; admin tooling for a banned team owner; a JS freemail list mirroring `_freemail_domain` with a parity pin.
**S5:** `teams_open.open = true` in the switch migration; docs for `/team`.

## Decisions (main session, 2026-10-22, from the owner's rules in the design record)

1. **Team owner and admins are co-owners in every team workspace.** The owner's rules give admins the people, links and domains, and owner+admins open private workspaces for hand-overs.
2. **A member who creates or moves in a team workspace is an editor there.** "An admin can make one private" reserves workspace management for admins. S4's copy must say it when a member moves one in: the team's admins manage it, and you keep editing.
3. **Yes**, `created_by` = the team owner; the personal-plan counting until S2b is harmless while only test owners can make a team.
4. **Every address gets an invite** (amended by G; this first said existing accounts are added straight away, as workspace invites do at 0391:156). Adding an account by its address trusted an address nobody had proven and told the inviter which addresses have accounts. Only an inbox-proven session at that address accepts. The domain path still asks first, because nobody named those people.
5. **Yes**, a ledger in S2a; an admin's action that needs a seat passes an explicit add (the UI shows the price first); S3 charges the rows.
6. **Calendar months, UTC**, until S3 decides on the billing period.
7. **One open team per owner** in v1 (`team_exists`). This can be relaxed later without a migration.
8. **Yes for S2a.** S4 adds "make an admin the owner" (carried forward below) before launch, because an owner who leaves a company must be able to hand the team over.
9. **It goes to the team owner by default**, or to another seat holder the admin picks. Team-derived access ends; explicit rows stay.
10. **A viewer stays a viewer when they open an edit link**: today's `noop` for workspace members (0371:430) holds for team viewers too. Asking is explicit: new RPC `ask_team_for_edit` (Task 4, amendment C). It never grants a seat on its own, even when one is free, because an admin made them a viewer.
11. **Accepted.** The UI session updates `lib/teamModel.js`'s TeamSnapshot header and `teamCan` for `viewer` in S4.
12. **Yes.** Leaving or removal deletes every explicit grant in the team's workspaces, which frees the seat. A former member comes back as a guest only by a new invite.
13. **Yes**: TXT on the domain itself, `soleil-verification=<token>`. The T1b preview copy uses the same prefix.
14. **Three steps, not two**, because of the lock (amendment A):
    - 0522 alone first, on its own go: it is inert, and its locks are short metadata locks.
    - Then probes A–C, carrying only function re-emits.
    - Then 0523–0526 on a second go.

## Amendments (main session, 2026-10-22)

**A. Probes never hold a table lock on production.** 0522's `alter table workspaces add column` takes an ACCESS EXCLUSIVE lock on `workspaces`. Run inside a rolled-back probe, it would hold that lock for the whole probe, seconds, while every board read waits behind it. So:
- 0522 is applied for real first, on the owner's go, with `set lock_timeout = '3s'` at the top so it fails fast instead of queueing.
- Probes A–C then carry only `create or replace function` text and fixtures. Function replacement inside a transaction doesn't block other sessions' callers (catalog MVCC).
- Task 9 becomes three steps:
  1. go → apply 0522, verify;
  2. probes A, B, C against live 0522;
  3. go → apply 0523–0524, verify; then 0525–0526, verify.
- Probe A's parity snapshot is taken in the probe before its own re-emits, so it still compares today's answers with 0523's.

**B. The self-serve ceiling.** "Self-serve up to 100, Talk to us above" is enforced, not just shown:
- `organizations.seat_ceiling integer not null default 100 check (seat_ceiling between 3 and 10000)` (0522). A support action can raise it for an Enterprise deal without a migration.
- `_org_add_seats` raises `team seats ceiling` with hint `team_seats_ceiling` when `seats + p_n > seat_ceiling` (0524).
- `_team_admit`'s auto branch answers `'full'` instead of exceeding the ceiling (never raise inside a claim).
- `add_team_seats` checks `seat_ceiling`, not a literal 100 (0525).
- `team_seats_ceiling` joins the hint list (Global Constraints, `lib/teamHints.js`).

**C. A viewer's explicit ask** (decision 10). `org_join_requests.via` also allows `'ask'` (0522). New client RPC in 0525:

| RPC | Caller check | Does |
|---|---|---|
| `ask_team_for_edit(p_workspace_id uuid, p_board_id uuid default null) → text` | signed in, active. The workspace is a team workspace of an open team, and the caller can read it (or the board) but not write it | Returns `can_edit` when they already can, and `not_in_team` when the workspace isn't a team's. Otherwise it upserts the one pending request for (org, caller): wanted `board_editor` with a board, else `workspace_editor`; via `'ask'`. It notifies owner/admins (`team.join_request`, deduped per recipient and asker for 24 h), never grants, and returns `sent` / `already_sent` |

Probe C adds: as V, `ask_team_for_edit(W1)` → `sent`, again → `already_sent`, O and A notified once; as M1 → `can_edit`; approving it gives V an explicit `editor` row in W1, and `_team_seats_used` goes up by one.

**D. One request core, in 0524.** `_team_request` lives in 0524 next to `_team_request_and_notify`, which calls it, so 0525 depends only on what is already live when it applies. 0525's RPCs call it; no migration after 0524 re-defines it.

**Carried forward, added to S4:**
- Team-ownership transfer: owner → an admin, with the billing hand-off in S3's terms.
- The boot's landing for a buyer who moved every workspace into the team. `get_or_create_personal_workspace` now skips team workspaces, so on a new device they'd land in a fresh, empty personal workspace. S4 decides whether the boot lands in the team's workspace instead.
- A JS mirror of `_freemail_domain`, with a parity pin, is already listed.

**E. The security audit's Team requirements** (the security session, owner-approved 2026-10-21; its plan's "Team-plan security requirements"). Each one lands in a stage:

| # | Requirement | Where |
|---|---|---|
| 1 | **Domain auto-join.** Needs proof of inbox, a random TXT token for each team, daily re-checks, exact domains only, one team per domain, and refuses free-mail and public-suffix domains | 0522: `org_domains.token` random, one verified team per domain (`team_domain_taken`), domains lowercase ASCII only (an IDN arrives as `xn--`; the S4 Worker converts it, and a unicode address fails closed). 0532: `team_domain_mark_verified(p_org_id, p_domain, p_ok, p_token)` verifies only while `p_token` is the row's current token, and `p_ok = false` clears `verified_at` (auto-join pauses). The four address-based RPCs need `_session_proves_inbox()` (security Phase 0): the actions (`accept_team_invite`, `answer_team_offer`) raise hint `team_inbox_unproven`, and the boot calls (`claim_my_team_invites`, `my_team_offers`) answer 0 / nothing (amendment G). Auto-join runs only from those signed-in RPCs, never from the `auth.users` trigger. S4: the daily Worker check refuses public suffixes (the full list) before it ever verifies |
| 2 | **One choke point.** One org helper in the choke points, the realtime policies and the party re-check; no table subqueries itself | 0530 `_org_ws_role_for`, already the design; Task 8 asks the same predicates |
| 3 | **Removal offboards.** A seat frees only after `_offboard_member` runs | 0532: `_org_remove_person` calls `_offboard_member(ws, user)` (security Phase 1) for every team workspace before deleting rows; `move_workspace_out_of_team` calls it for each person losing team-derived access |
| 4 | **Visibility.** An admin opening a private team workspace writes a `security_events` row. Roster emails never sit in a realtime-published table | S4 logs `_log_security_event('workspace.private_opened', ws, {board_id})` on the server, in the path the app opens a workspace through (a STABLE function can't write, so S4 picks the function), never as a separate courtesy call from the client. 0522 proves no team table is in `supabase_realtime`; emails come only from `get_team`, cut by role (0533) |
| 5 | **Team links** follow `_workspace_invite_link_live`'s rules, plus seat-cost guards | 0522: `org_invite_links` + `org_invite_link_joins` replace the link columns. 0532: `_team_link_live` mirrors 0450:122 (also: team open, owner not banned, maker still owner/admin), with the live `create_workspace_invite_link`'s constants. A claim that needs a seat in `ask` mode joins as a viewer and files a request |
| 6 | **Seat counting** takes a per-org advisory lock; the Stripe org branch is idempotent by event id and never activates a personal tier | 0531 `_team_admit` / `_org_add_seats`; Stripe in S3 |
| 7 | **"Require two-step sign-in"** for a team | S4/S5, reusing the security session's Phase 4 predicate |
| 8 | **Integrations** (webhooks, service accounts, OAuth apps) belong to the team, with an OAuth client allowlist | S4. Until then, `_offboard_member` deactivates what a departing member created, which fails safe |
| 9 | **Unpaid and closed teams fail closed** in the choke points | 0530: for a team whose status isn't active, `_org_ws_role_for` gives owner/admin `viewer` everywhere and members/viewers `viewer` on team-visible workspaces only. S3 sets the status. `close_team` turns access into explicit rows (the freeze) |
| 10 | **The audit log** ships before Enterprise, as the security log | The design spec's Enterprise line is updated |

**F. Numbers and re-emits.** The security session's Phase 1 takes 0523–0529 for re-emits of functions both sessions touch (`claim_collab_link`, `claim_workspace_invite_link`, `remove_workspace_member`, `leave_workspace`, `transfer_workspace_ownership`, `_resolve_share_target`, `create_collab_link`, `can_write_board`, `my_readable_board_ids`) and for `_offboard_member`. It keeps 0600–0649 for everything else. So:
- 0522 keeps its number. 0523 → **0530** (access), 0524 → **0531** (seats), 0525 → **0532** (RPCs), 0526 → **0533** (reads). Task references to the old numbers mean these.
- File order is apply order, because `latestDefinition` reads the highest file. Whoever applies out of order renumbers their unapplied file above the other.
- Pins that a function routes through a helper read its content (`can_write_board` still calls `_workspace_member_can_write(`; `can_read_board` still calls `is_workspace_member(`), never "the latest file is 0318".
- **Task 9 gains a rebase check before every apply.** Each file records, in its header, the md5 of the live `prosrc` it was rebased on for every function it re-emits. Before applying, compare those md5s with the live ones. Any difference means another session applied first: rebase that function onto the live body, re-run its probe, then apply.

**G. The adversarial review of 0532/0533 (main session, 2026-10-22), before any apply.** Each fix is in the files and pinned in `teamsMigration.test.mjs` / `teamsRpcMigration.test.mjs`:
- **Always invite.** `invite_to_team` never adds an account directly and its answer never says whether an address has an account: every new address gets an `org_invites` row, which only an inbox-proven session at that address accepts. Returns `{invited, already, skipped}`. No `team.added` notice, and `org_members.joined_via` has no `'added'`. This amends decision 4.
- **A removal sticks.** New table `org_removals (org_id, user_id, removed_by, removed_at)` in 0522. `_org_remove_person(p_org, p_user, p_removed)` revokes that address's open team invites, deletes its unclaimed `pending_invites` in the team's workspaces, answers the domain offer `declined`, and, for a removal (not a leave), records the row. `claim_team_link` answers `removed` to them and `my_team_offers` skips them. Only a new invite brings them back: accepting it deletes the row.
- **Lock order.** `pg_advisory_xact_lock(hashtext('team_seats:' || org))` comes before any row lock in every function that takes both, and whatever was read before the lock is read again under it (`for update`). `_workspace_set_owner` is the one exception; its callers hold the team lock. `approve_team_request` cancels a banned requester's request and returns `cancelled` (a raise rolled the cancel back).
- **Making a workspace private offboards.** From team-visible to private, `set_team_workspace_private` runs `_offboard_member(ws, p)` for each team member and viewer with no explicit row there. The owner and admins still open it (decision 1).
- **Only the team owner hands a workspace to someone else.** `move_workspace_out_of_team` to anyone but the team owner needs the owner (`team_not_owner`), so an admin can't move one out to themselves.
- **A view-only team gains nothing.** `create_team_workspace` and `_org_move_in` refuse a team whose status isn't active (`team_view_only`). `create_team_workspace` also applies `create_workspace_with_root`'s new-account cap (4, `new_account`), counting team workspaces whose root the caller made.
- **Notices dedupe.** `_team_notify` sends at most one a day per person, kind, team and workspace.
- **Inbox proof only.** Every address match gates on `_session_proves_inbox()` alone; `email_confirmed_at` and `last_sign_in_at` appear nowhere in 0532/0533 (security session: under autoconfirm a users row proves only that someone typed the address). `claim_team_link` trusts a slot held by address (`_team_admit` → `already`) only when the inbox is proven. 0532's proof block fails unless `_session_proves_inbox()` and `_offboard_member(uuid,uuid)` are live and not client-executable, so 0530–0533 apply only after the security session's Phase 1.
- **`get_team` counts only what the caller sees.** People's workspace counts, grants and "Everywhere" are computed over the workspaces the caller can see, so the roster never reveals a private workspace.
- **Checked before the go:** every "Rebased on" md5 in 0530–0532 matches live, and 0522 + 0530–0533 compile, grants and proof blocks included, in a throwaway local Postgres 17 built from live's catalog (tables, keys, grants, function signatures and ACLs).

**H. The rooms' re-checks are the security session's (2026-10-22).** Their PTY-1 (removed or downgraded members kept live sockets) owns both: `party_board_access(p_board uuid, p_users uuid[]) returns table(user_id uuid, can_read boolean, can_write boolean)` (0620; 0621 makes read = `array[p_board] && my_readable_board_ids()`, exactly the board room's door, so the re-check never refuses someone the door admits) and `party_workspace_access(p_workspace uuid, p_users uuid[]) returns table(user_id uuid, can_open boolean)` (0622), both service role only, with the party's alarms and helpers. 0530 had its own copies. The board one had other parameter names and would have failed at apply, and either would have replaced theirs out of file order. So 0530 defines neither, and its proof requires both live and service-only. The org branch reaches them through `my_readable_board_ids`, `can_write_board` and `is_workspace_member`. Task 8 keeps Step 1 (the Workspace door asks `can_open_workspace`), 4b and 6; Step 5 (the clients stop on 4401) is theirs too.
