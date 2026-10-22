-- 0522: Teams, part 1 — the tables, and the hold that keeps them empty.
--
-- STATUS: written 2026-10-22. Applied 2026-10-22 (owner's go), teams closed.
-- Live as migration 20261022052543 teams_tables; its three function bodies
-- match this file by md5.
--
-- A Team (the database says organization) owns workspaces and their seats
-- (design: docs/superpowers/specs/2026-10-21-team-plan-and-editor-limit-design.md).
-- No organization row can exist until app_config.teams_open opens, or its
-- owner is listed in test_owner_ids (preview test accounts). With no rows,
-- every team branch in 0530–0533 is dormant and everything works as before.
--
-- Every table here is RPC-only: RLS on, no policies, no client grants. The
-- roster's privacy (names for everyone, emails for the owner and admins) is
-- enforced in get_team (0533), never by a policy a member could query around.

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
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  -- An open team always has its owner; deleting the owner's account fails
  -- here (prepare_account_deletion refuses first, 0530, with a readable hint).
  constraint organizations_open_has_owner check (closed_at is not null or owner_id is not null)
);
create index organizations_owner_open_idx on public.organizations (owner_id) where closed_at is null;

create table public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  seat       boolean generated always as (role <> 'viewer') stored,
  -- No 'added': an address always gets an invite, never a seat by itself (amendment G).
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

-- The team's join link, shaped as 0450's workspace_invite_links: a token
-- that expires and runs out, at most one unrevoked per team, and one row per
-- person who joined through it (what max_uses counts).
create table public.org_invite_links (
  token      uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  role       text not null default 'member' check (role in ('member', 'viewer')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses   integer not null check (max_uses between 1 and 100),
  revoked_at timestamptz
);
create unique index org_invite_links_one_live on public.org_invite_links (org_id) where revoked_at is null;

create table public.org_invite_link_joins (
  token     uuid references public.org_invite_links(token) on delete cascade,
  user_id   uuid references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (token, user_id)
);

create table public.org_domains (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  -- Lowercase ASCII only: an international domain arrives as its xn-- form
  -- (S4's Worker converts it), so one name can't hide behind another spelling.
  domain       text not null check (char_length(domain) <= 253
                                    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
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

-- Someone an admin removed (amendment G): the team link and the domain offer
-- refuse them until an admin's invite brings them back, which clears the row.
-- Leaving isn't recorded here.
create table public.org_removals (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  removed_by uuid references auth.users(id) on delete set null,
  removed_at timestamptz not null default now(),
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
alter table public.org_invite_links   enable row level security;
alter table public.org_invite_link_joins enable row level security;
alter table public.org_domains        enable row level security;
alter table public.org_domain_answers enable row level security;
alter table public.org_removals       enable row level security;
alter table public.org_join_requests  enable row level security;
alter table public.org_seat_changes   enable row level security;
revoke all on table public.organizations, public.org_members, public.org_invites,
  public.org_invite_links, public.org_invite_link_joins, public.org_domains,
  public.org_domain_answers, public.org_removals, public.org_join_requests, public.org_seat_changes
  from public, anon, authenticated;
revoke all on sequence public.org_seat_changes_id_seq from public, anon, authenticated;

revoke execute on function public._teams_open_for(uuid) from public, anon, authenticated;
revoke execute on function public._org_insert_gate() from public, anon, authenticated;
revoke execute on function public._freemail_domain(text) from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['organizations','org_members','org_invites','org_invite_links',
                           'org_invite_link_joins','org_domains','org_domain_answers',
                           'org_removals','org_join_requests','org_seat_changes'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '0522: % has RLS off', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', 'public.' || t, 'select,insert,update,delete,truncate,references,trigger') then
      raise exception '0522: % is reachable by a client', t;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception '0522: % has a policy; it must be RPC-only', t;
    end if;
    -- Roster emails must never sit in a realtime-published table.
    if exists (select 1 from pg_publication_tables pt
                where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = t) then
      raise exception '0522: % is published to realtime', t;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.workspaces', 'org_id', 'update')
     or has_column_privilege('authenticated', 'public.workspaces', 'org_visibility', 'update')
     or has_table_privilege('authenticated', 'public.workspaces', 'insert') then
    raise exception '0522: a client could set a workspace''s team';
  end if;
  if has_sequence_privilege('anon', 'public.org_seat_changes_id_seq', 'usage,select,update')
     or has_sequence_privilege('authenticated', 'public.org_seat_changes_id_seq', 'usage,select,update') then
    raise exception '0522: org_seat_changes_id_seq is reachable by a client';
  end if;
  foreach t in array array['public._teams_open_for(uuid)', 'public._org_insert_gate()',
                           'public._freemail_domain(text)'] loop
    if has_function_privilege('anon', t, 'execute')
       or has_function_privilege('authenticated', t, 'execute') then
      raise exception '0522: % is client-executable', t;
    end if;
  end loop;
  if public._teams_open_for(gen_random_uuid()) then
    raise exception '0522: teams are open for someone nobody listed';
  end if;
  if exists (select 1 from public.organizations) then
    raise exception '0522: an organization exists';
  end if;
end $$;

commit;
