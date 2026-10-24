-- 0536: Teams, part 8 — who pays: the meters.
--
-- STATUS: written 2026-10-22. Applied 2026-10-24 (owner's go), teams closed.
-- Live as migrations 20261024223230 teams_pay_meters_part1 through
-- 20261024223245 teams_pay_meters_part3: the MCP refuses calls this size, so it
-- went in at statement boundaries, each part one transaction, the proof last.
-- Its 3 function bodies match this file by md5.
--
-- A team workspace's files fill the team's drive, not its owner's (S2b, plan
-- docs/superpowers/plans/2026-10-22-team-s2b-who-pays.md). This file adds the
-- team's meter and keeps it right as workspaces join and leave teams; 0537
-- points every card and storage gate at the right payer. Nothing here runs
-- for anyone until a team exists: the trigger fires only when a workspace's
-- org_id changes, and _workspace_set_owner is called only by the team RPCs
-- (0532), and no team can exist while app_config.teams_open is closed and
-- lists nobody (0522).
--
-- Applied before 0537 and on its own, because a trigger on workspaces takes a
-- lock that a rolled-back probe must never hold on production.
--
-- Re-emitted from the live body, with the lines marked 0536 and nothing else
-- changed. Rebased on (the md5 of the live prosrc, checked again before applying):
--   _workspace_set_owner  b5ed48b259e55b9ca0949ca82b0c7266

begin;

-- The trigger takes a brief lock on workspaces: don't queue behind production
-- traffic for it.
set local lock_timeout = '3s';

-- S3 writes both. The first payment ends a team's trial drive; each storage
-- block adds the 1 TB block Creator sells. organizations has no client
-- privileges (0522), so neither column is client-writable.
alter table public.organizations
  add column if not exists first_paid_at  timestamptz,
  add column if not exists storage_blocks integer not null default 0
    check (storage_blocks between 0 and 1000);

-- The team's drive meter, the twin of storage_usage (0221), which can't hold
-- a team: its key references auth.users.
create table if not exists public.org_storage_usage (
  org_id       uuid primary key references public.organizations(id) on delete cascade,
  bytes_used   bigint not null default 0,
  object_count bigint not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.org_storage_usage enable row level security;
revoke all on public.org_storage_usage from public, anon, authenticated;

-- _storage_usage_apply (0221), for a team.
create or replace function public._org_storage_usage_apply(p_org uuid, p_bytes bigint, p_objects bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or (coalesce(p_bytes, 0) = 0 and coalesce(p_objects, 0) = 0) then
    return;
  end if;
  insert into public.org_storage_usage as s (org_id, bytes_used, object_count, updated_at)
  values (p_org, greatest(0, coalesce(p_bytes, 0)), greatest(0, coalesce(p_objects, 0)), now())
  on conflict (org_id) do update
    set bytes_used   = greatest(0, s.bytes_used + coalesce(p_bytes, 0)),
        object_count = greatest(0, s.object_count + coalesce(p_objects, 0)),
        updated_at   = now();
end;
$$;

-- A workspace joining or leaving a team carries its files' bytes from the
-- old payer's meter to the new one's: the team's while it has an org_id, else
-- its owner's. The sum is transfer's (0530), the files that count.
create or replace function public._workspace_meter_follows_team_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bytes   bigint;
  v_objects bigint;
begin
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
    into v_bytes, v_objects
    from public.images i
   where i.workspace_id = new.id
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  if old.org_id is not null then
    perform public._org_storage_usage_apply(old.org_id, -v_bytes, -v_objects);
  else
    perform public._storage_usage_apply(old.created_by, -v_bytes, -v_objects);
  end if;
  if new.org_id is not null then
    perform public._org_storage_usage_apply(new.org_id, v_bytes, v_objects);
  else
    perform public._storage_usage_apply(new.created_by, v_bytes, v_objects);
  end if;
  return null;
end;
$$;

create or replace trigger workspaces_meter_follows_team
  after update of org_id on public.workspaces
  for each row when (old.org_id is distinct from new.org_id)
  execute function public._workspace_meter_follows_team_trg();

-- 0532's owner change, unchanged but for its storage move: a team
-- workspace's files are on the team's meter whoever owns it, so only a
-- personal workspace's bytes move between people. 0532 sets a workspace's
-- team before its owner, clears the team before handing it to someone, and
-- closing a team re-owns its workspaces while they are still the team's: the
-- trigger and this never move the same bytes.
create or replace function public._workspace_set_owner(p_ws uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     uuid;
  v_org     uuid;
  v_bytes   bigint;
  v_objects bigint;
begin
  if p_new_owner is null then
    raise exception 'a workspace needs an owner' using errcode = '22023';
  end if;
  select created_by, org_id into v_old, v_org from public.workspaces where id = p_ws for update;
  if v_old is not distinct from p_new_owner then return; end if;
  perform set_config('soleil.quiet_member_email', '1', true);
  update public.workspaces set created_by = p_new_owner where id = p_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (p_ws, p_new_owner, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  if v_old is not null then
    update public.workspace_members set role = 'editor' where workspace_id = p_ws and user_id = v_old;
  end if;
  if v_org is null then
    select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
      into v_bytes, v_objects
      from public.images i
     where i.workspace_id = p_ws
       and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
    if v_old is not null then
      perform public._storage_usage_apply(v_old, -v_bytes, -v_objects);
    end if;
    perform public._storage_usage_apply(p_new_owner, v_bytes, v_objects);
  end if;
end;
$$;

revoke execute on function public._org_storage_usage_apply(uuid, bigint, bigint) from public, anon, authenticated;
revoke execute on function public._workspace_meter_follows_team_trg() from public, anon, authenticated;
revoke execute on function public._workspace_set_owner(uuid, uuid) from public, anon, authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public._org_storage_usage_apply(uuid,bigint,bigint)',
    'public._workspace_meter_follows_team_trg()',
    'public._workspace_set_owner(uuid,uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0536: % is client-executable', v_fn;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.org_storage_usage', 'select')
     or has_table_privilege('authenticated', 'public.org_storage_usage', 'select')
     or has_table_privilege('authenticated', 'public.org_storage_usage', 'insert')
     or has_table_privilege('authenticated', 'public.org_storage_usage', 'update') then
    raise exception '0536: a client can reach org_storage_usage';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.org_storage_usage'::regclass) then
    raise exception '0536: org_storage_usage has RLS off';
  end if;
  if has_column_privilege('authenticated', 'public.organizations', 'first_paid_at', 'update')
     or has_column_privilege('authenticated', 'public.organizations', 'storage_blocks', 'update') then
    raise exception '0536: a client can write what S3 bills from';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgname = 'workspaces_meter_follows_team'
                    and t.tgrelid = 'public.workspaces'::regclass and not t.tgisinternal) then
    raise exception '0536: the meter trigger is missing';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_org_storage_usage_apply', '_workspace_meter_follows_team_trg',
                                  '_workspace_set_owner')
              group by p.proname having count(*) > 1) then
    raise exception '0536: an overload exists (PGRST203)';
  end if;

  -- Applying this changes nothing for anyone: no team exists.
  if exists (select 1 from public.organizations) then
    raise exception '0536: an organization exists';
  end if;
end $$;

commit;
