-- 0537: Teams, part 9 — who pays: every card and storage gate.
--
-- STATUS: written 2026-10-22. Applied 2026-10-24 (owner's go), teams closed.
-- Live as migrations 20261024223509 teams_pay_gates_part1 through
-- 20261024223646 teams_pay_gates_part6, at function boundaries, each part one
-- transaction carrying its functions' grants, the proof last. Its 24 function
-- bodies match this file by md5.
--
-- A team workspace's cards and files are the team's to pay for, a personal
-- workspace's its owner's, and someone holding a team seat gets the seat perk
-- on their personal workspaces: no card cap and 50 GB more drive (S2b, plan
-- docs/superpowers/plans/2026-10-22-team-s2b-who-pays.md; design 2026-10-21,
-- "The Team plan" and "Seat perk"). Two resolvers do it:
--   _board_card_payer(board)   whose card meter a cluster is on: nobody's for
--                              a team's cluster or a perk holder's, else
--                              board_workspace_owner's answer;
--   _drive_quota_bytes / _drive_used_bytes(org, owner)
--                              the team's drive (0536's meter) when there is a
--                              team, else exactly the owner's helpers.
-- Every card gate already reads a null owner as "no cap", so the card gates
-- change one function name. With no team and no seat, every gate answers what
-- it answered before (probe D compares them on real accounts before this is
-- applied). 0536 must be live first (its meter, columns and trigger).
-- record_upload_intent, the third upload gate, follows in 0650: 0610 re-emitted
-- it, so a re-emit here would sort before the body that is live. Apply 0650
-- right after this file.
--
-- Re-emitted from the live bodies, with the lines marked 0537 and nothing
-- else changed. Rebased on (the md5 of each live prosrc, checked again before
-- applying):
--   enforce_demo_card_cap_trg      50cb8dd22a661b21947c4a16ff7e80c6
--   get_board_capacity             ec9c30ef6052765d91cf8f0660384357
--   scout_board_capacity           cc89a56b498a5dc2b5951a7ed597776b
--   restore_board                  2d21bf5f28fc94dcd8ce24e0968ae037
--   _owner_card_count              b24ac635de61bc4e3b9ff08bd8538637
--   _storage_used_bytes            e850b39d7893f404c350b7e70ba6a2f4
--   _storage_pending_bytes         28a1dac8ff93357dc27ff87dfc7aef7c
--   _storage_quota_bytes(uuid)     e71184b05d8e9b39ad348e6c06863c81
--   _storage_quota_if_blocks       130a22cada279f84fb3cc04d2f03e7d3
--   authorize_upload               c4389a2ffbb6cb8bb44223da67a70d2c
--   authorize_image_upload         4d7fe1e35952614de51eb402417545d5
--   storage_usage_trg              671bf94193e4d9e02551f56b097d31cc
--   reconcile_storage_usage        710ead8e81435a74e4b5eed989c7572d
-- A re-emit keeps its function's grants (create or replace), so no client
-- RPC's grants change here.

begin;

-- The Team plan's drive (design: max(1 TB, 250 GB a seat)) and the seat
-- perk's 50 GB, in the units the code already uses: 1 TB is 1 TiB, as in
-- _storage_quota_bytes().
create or replace function public._team_storage_floor_bytes()
returns bigint
language sql
immutable
set search_path = public
as $$
  select 1099511627776::bigint;
$$;

create or replace function public._team_storage_seat_bytes()
returns bigint
language sql
immutable
set search_path = public
as $$
  select 268435456000::bigint;
$$;

create or replace function public._seat_perk_storage_bytes()
returns bigint
language sql
immutable
set search_path = public
as $$
  select 53687091200::bigint;
$$;

-- The seat perk: while someone holds a seat in an open, active team that
-- keeps the perk on (organizations.seat_perk, on by default), their personal
-- workspaces have no card cap and 50 GB more drive. Leaving the team, or the
-- admins turning it off, takes it away; the gates then freeze whatever is
-- over, as they do for anyone over a limit.
create or replace function public._seat_perk_on(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.org_members m
      join public.organizations o on o.id = m.org_id
     where m.user_id = p_user
       and m.seat
       and o.closed_at is null
       and o.seat_perk
       and o.status = 'active');
$$;

-- Whose card meter a cluster's cards are on: nobody's while its workspace is
-- a team's (a team has no card cap) or while its owner has the seat perk;
-- otherwise the workspace's owner, exactly board_workspace_owner (0187).
create or replace function public._board_card_payer(p_board_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when w.org_id is not null or public._seat_perk_on(w.created_by) then null
              else w.created_by end
    from public.boards b
    join public.workspaces w on w.id = b.workspace_id
   where b.id = p_board_id;
$$;

create or replace function public._owner_card_count(p_owner uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(ci.weight), 0)::integer
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where w.created_by = p_owner
     and w.org_id is null      -- 0537: a team's cards are on no one's meter
     and b.deleted_at is null;
$$;
create or replace function public.enforce_demo_card_cap_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_tier  text;
  v_count integer;
  v_cap   integer;
  v_delta integer;
begin
  if tg_op = 'INSERT' and exists (
    select 1 from public.card_index
     where board_id = new.board_id and card_id = new.card_id
  ) then
    return new;
  end if;
  -- INSERT costs the row's own weight: an empty grid weighs 0 (0346).
  -- new.weight is already normalised: card_index_a_weight_by_kind sorts first (0403).
  v_delta := case when tg_op = 'UPDATE'
                  then greatest(coalesce(new.weight, 1) - coalesce(old.weight, 1), 0)
                  else greatest(coalesce(new.weight, 1), 0) end;
  -- 0403: a card moved onto a meter that never counted it (another payer's
  -- cluster, or out of one in the Trash) costs what an insert would.
  if tg_op = 'UPDATE' and new.board_id is distinct from old.board_id
     and (public._board_card_payer(new.board_id) is distinct from public._board_card_payer(old.board_id)
          or exists (select 1 from public.boards b where b.id = old.board_id and b.deleted_at is not null)) then
    v_delta := greatest(coalesce(new.weight, 1), 0);
  end if;
  if v_delta = 0 then
    return new;
  end if;
  -- 0537: the payer, not the owner: a team's cluster, or a seat holder's
  -- with the perk, is on no one's meter (_board_card_payer).
  v_owner := public._board_card_payer(new.board_id);
  if v_owner is null then
    return new;
  end if;
  select tier, coalesce(card_cap_base, 50) + coalesce(bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles where user_id = v_owner;
  if v_tier is distinct from 'demo' then
    return new;
  end if;
  v_count := public._owner_card_count(v_owner);
  if v_count + v_delta > coalesce(v_cap, 50) then
    raise exception
      'Demo accounts are limited to % cards. Invite friends or upgrade to add more.', coalesce(v_cap, 50)
      using errcode = '42501';
  end if;
  return new;
end $function$;
create or replace function public.get_board_capacity(p_board_id uuid)
returns table(is_capped boolean, used integer, cap integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_tier  text;
  v_cap   integer;
begin
  if not public.can_read_board(p_board_id) then
    raise exception 'you do not have access to this board' using errcode = '42501';
  end if;
  v_owner := public._board_card_payer(p_board_id);
  if v_owner is null then
    return query select false, 0, 0; return;
  end if;
  select p.tier, coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles p where p.user_id = v_owner;
  if v_tier is distinct from 'demo' then
    return query select false, 0, 0; return;
  end if;
  return query select true, public._owner_card_count(v_owner), coalesce(v_cap, 50);
end $function$;
create or replace function public.scout_board_capacity(p_board_id uuid, p_user_id uuid)
returns table(is_capped boolean, used integer, cap integer)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_owner uuid;
  v_tier  text;
  v_cap   integer;
begin
  -- Same predicate the rest of Scout authorizes with, so "may I write here"
  -- and "how much room is left here" can never disagree.
  if not public.scout_can_write_board(p_board_id, p_user_id) then
    raise exception 'you do not have access to this board' using errcode = '42501';
  end if;

  v_owner := public._board_card_payer(p_board_id);
  if v_owner is null then
    return query select false, 0, 0; return;
  end if;

  select p.tier, coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles p where p.user_id = v_owner;

  if v_tier is distinct from 'demo' then
    return query select false, 0, 0; return;
  end if;

  return query select true, public._owner_card_count(v_owner), coalesce(v_cap, 50);
end $function$;
create or replace function public.restore_board(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_owner      uuid;
  v_tier       text;
  v_cap        integer;
  v_used       integer;
  v_restoring  integer;
  v_deleted    boolean;
  v_deleted_at timestamptz;
  v_parent     uuid;
  v_home       uuid;
  v_batch      uuid[];
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to restore board %', p_board_id using errcode = '42501';
  end if;

  select (b.deleted_at is not null) into v_deleted
    from public.boards b where b.id = p_board_id;

  if coalesce(v_deleted, false) then
    select b.deleted_at, b.parent_board_id into v_deleted_at, v_parent
      from public.boards b where b.id = p_board_id;

    -- The batch soft_delete_board trashed together: this cluster plus the
    -- descendants that carry the same deleted_at.
    with recursive sub(id, depth) as (
      select p_board_id, 0
      union all
      select b.id, sub.depth + 1
        from public.boards b
        join sub on b.parent_board_id = sub.id
       where b.deleted_at = v_deleted_at
         and sub.depth < 64
    )
    select array_agg(id) into v_batch from sub;

    select coalesce(sum(ci.weight), 0)::integer into v_restoring
      from public.card_index ci
     where ci.board_id = any(v_batch);

    if v_restoring > 0 then
      v_owner := public._board_card_payer(p_board_id);   -- 0537: the payer
      if v_owner is not null then
        select p.tier, coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
          into v_tier, v_cap
          from public.profiles p where p.user_id = v_owner;
        if v_tier is not distinct from 'demo' then
          v_used := public._owner_card_count(v_owner);
          if v_used + v_restoring > coalesce(v_cap, 50) then
            raise exception
              'Restoring this cluster would take you to % cards, past your limit of %. Delete some cards first, or upgrade to Creator.',
              v_used + v_restoring, coalesce(v_cap, 50)
              using errcode = '42501';
          end if;
        end if;
      end if;
    end if;

    -- A parent still in the trash would leave the cluster reachable from
    -- nowhere, and doomed when the purge cascades from that parent: bring it
    -- back under the nearest live ancestor, or the workspace root, instead.
    if v_parent is not null
       and exists (select 1 from public.boards p where p.id = v_parent and p.deleted_at is not null) then
      v_home := public._live_home_for(p_board_id);
      if v_home is not null then
        update boards set parent_board_id = v_home, updated_at = now()
         where id = p_board_id;
      end if;
    end if;

    update boards set deleted_at = null, updated_at = now()
      where id = any(v_batch) and deleted_at = v_deleted_at;
  end if;
end;
$function$;
create or replace function public._storage_used_bytes(p_owner uuid)
 returns bigint
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_used bigint;
begin
  select s.bytes_used into v_used from public.storage_usage s where s.owner_id = p_owner;
  if found then return coalesce(v_used, 0); end if;

  select coalesce(sum(i.size_bytes), 0) into v_used
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
   where w.created_by = p_owner
     and w.org_id is null      -- 0537: a team's files fill the team's drive
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  return coalesce(v_used, 0);
end $function$;
create or replace function public._storage_pending_bytes(p_owner uuid)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(sum(u.bytes), 0)::bigint
    from public.upload_intents u
    join public.workspaces w on w.id = u.workspace_id
   where w.created_by = p_owner
     and w.org_id is null      -- 0537: a team's files fill the team's drive
     and u.claimed_at is null
     and u.created_at > now() - case when u.kind = 'multipart' then interval '24 hours'
                                     else interval '1 hour' end;
$function$;
-- A team's drive: its meter (0536) and what its uploads have reserved, the
-- twins of _storage_used_bytes and _storage_pending_bytes.
create or replace function public._org_storage_used_bytes(p_org uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_used bigint;
begin
  select s.bytes_used into v_used from public.org_storage_usage s where s.org_id = p_org;
  if found then return coalesce(v_used, 0); end if;
  select coalesce(sum(i.size_bytes), 0) into v_used
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
   where w.org_id = p_org
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  return coalesce(v_used, 0);
end;
$$;

create or replace function public._org_storage_pending_bytes(p_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(u.bytes), 0)::bigint
    from public.upload_intents u
    join public.workspaces w on w.id = u.workspace_id
   where w.org_id = p_org
     and u.claimed_at is null
     and u.created_at > now() - case when u.kind = 'multipart' then interval '24 hours'
                                     else interval '1 hour' end;
$$;

-- The trial drive until the team's first payment (design: 100 GB until the
-- first payment), then max(1 TB, 250 GB a seat) and the 1 TB blocks it pays
-- for. S3 writes first_paid_at and storage_blocks (0536).
create or replace function public._org_storage_quota_bytes(p_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case when o.first_paid_at is null
              then public._storage_quota_trial_bytes()
              else greatest(public._team_storage_floor_bytes(), public._team_storage_seat_bytes() * o.seats)
                   + o.storage_blocks::bigint * public._storage_addon_block_bytes()
         end
    from public.organizations o
   where o.id = p_org;
$$;

create or replace function public._storage_quota_bytes(p_owner uuid)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- An explicit per-account figure wins. Otherwise a paid or admin owner gets
  -- the drive Creator sells (storage_quota_bytes) — the trial drive while the
  -- subscription is still trialing (0413) — plus any extra storage that is
  -- still paid for (0415), and a free owner gets storage_quota_free_bytes
  -- (0387, owner decision 2026-10-06). On top of whichever it is, the storage
  -- earned by invitations (0416), which belongs to the person, not the plan.
  select coalesce(
    (select p.storage_quota_bytes from public.profiles p where p.user_id = p_owner),
    case when coalesce((select p.tier from public.profiles p where p.user_id = p_owner), 'demo') in ('paid', 'admin')
         then case when exists (select 1 from public.subscriptions s
                                 where s.user_id = p_owner and s.status = 'trialing')
                   then public._storage_quota_trial_bytes()
                   else public._storage_quota_bytes()
              end
              + public._storage_addon_blocks(p_owner)::bigint * public._storage_addon_block_bytes()
         else public._storage_quota_free_bytes()
    end
  ) + coalesce((select p.bonus_storage_bytes from public.profiles p where p.user_id = p_owner), 0)
    -- 0537: the seat perk's 50 GB, on top of whichever drive it is.
    + case when public._seat_perk_on(p_owner) then public._seat_perk_storage_bytes() else 0 end;
$function$;
create or replace function public._storage_quota_if_blocks(p_owner uuid, p_purchased integer)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- The full Creator drive (the storage-addon function refuses a trial or a
  -- per-account figure first), the blocks being asked about plus any comped
  -- ones, and the person's invite storage (0416) — the same terms
  -- _storage_quota_bytes(p_owner) adds, and since 0537 the seat perk.
  select public._storage_quota_bytes()
       + (least(greatest(coalesce(p_purchased, 0), 0), public._storage_addon_max_blocks())
          + public._storage_grant_blocks(p_owner))::bigint * public._storage_addon_block_bytes()
       + coalesce((select p.bonus_storage_bytes from public.profiles p where p.user_id = p_owner), 0)
    -- 0537: the seat perk's 50 GB, on top of whichever drive it is.
    + case when public._seat_perk_on(p_owner) then public._seat_perk_storage_bytes() else 0 end;
$function$;
-- Which drive a workspace's files fill, and how full it is: its team's when
-- it has one, else its owner's, through exactly the helpers the upload gates
-- called before. A quota is never null: a missing team reads as a drive of
-- zero, so an upload with nowhere to go is refused, not let through.
create or replace function public._drive_quota_bytes(p_org uuid, p_owner uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case when p_org is not null then public._org_storage_quota_bytes(p_org)
                       else public._storage_quota_bytes(p_owner) end, 0);
$$;

create or replace function public._drive_used_bytes(p_org uuid, p_owner uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case when p_org is not null
              then public._org_storage_used_bytes(p_org) + public._org_storage_pending_bytes(p_org)
              else public._storage_used_bytes(p_owner) + public._storage_pending_bytes(p_owner) end;
$$;

create or replace function public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
 returns table(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_org   uuid;   -- 0537
  v_quota bigint;
  v_used bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  select created_by, org_id into v_owner, v_org from public.workspaces where id = p_workspace_id;
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;

  if not public.can_write_workspace(p_workspace_id) then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;

  -- The drive is the only byte limit, on every plan (0413). Uploads presigned
  -- but not yet filed count too (0387).
  v_quota := public._drive_quota_bytes(v_org, v_owner);   -- 0537: the team's drive, else the owner's
  v_used := public._drive_used_bytes(v_org, v_owner);

  if v_used + v_bytes > v_quota then
    return query select false, v_used, v_quota, greatest(0, v_quota - v_used), 'over_quota'::text; return;
  end if;

  return query select true, v_used, v_quota, greatest(0, v_quota - v_used), 'ok'::text;
end $function$;
CREATE OR REPLACE FUNCTION public.authorize_image_upload(p_board_id uuid, p_bytes bigint)
 RETURNS TABLE(allow boolean, used bigint, quota bigint, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_org   uuid;   -- 0537
  v_quota bigint;
  v_used  bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  if not public.can_write_board(p_board_id) then
    return query select false, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;
  -- 0537: board_workspace_owner's read (0187), and the workspace's team.
  select w.created_by, w.org_id into v_owner, v_org
    from public.boards b join public.workspaces w on w.id = b.workspace_id
   where b.id = p_board_id;
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;
  v_quota := public._drive_quota_bytes(v_org, v_owner);   -- 0537: the team's drive, else the owner's
  -- Uploads presigned but not yet filed count too (0387).
  v_used  := public._drive_used_bytes(v_org, v_owner);
  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $function$;
-- Where a file's bytes are counted: its workspace's team's meter (0536), else
-- its owner's, _storage_usage_apply(_image_owner(workspace)) as before.
create or replace function public._storage_apply_ws(p_workspace_id uuid, p_bytes bigint, p_objects bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid;
  v_owner uuid;
begin
  select w.org_id, w.created_by into v_org, v_owner from public.workspaces w where w.id = p_workspace_id;
  if v_org is not null then
    perform public._org_storage_usage_apply(v_org, p_bytes, p_objects);
  else
    perform public._storage_usage_apply(v_owner, p_bytes, p_objects);
  end if;
end;
$$;

create or replace function public.storage_usage_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old_counts boolean;
  v_new_counts boolean;
begin
  if tg_op = 'INSERT' then
    if public._image_counts(new.deleted_at, new.storage_path, new.ref_count, new.live_board_ids, new.first_referenced_at) then
      perform public._storage_apply_ws(new.workspace_id, coalesce(new.size_bytes, 0), 1);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public._image_counts(old.deleted_at, old.storage_path, old.ref_count, old.live_board_ids, old.first_referenced_at) then
      perform public._storage_apply_ws(old.workspace_id, -coalesce(old.size_bytes, 0), -1);
    end if;
    return old;
  end if;

  v_old_counts := public._image_counts(old.deleted_at, old.storage_path, old.ref_count, old.live_board_ids, old.first_referenced_at);
  v_new_counts := public._image_counts(new.deleted_at, new.storage_path, new.ref_count, new.live_board_ids, new.first_referenced_at);

  if old.workspace_id is not distinct from new.workspace_id
     and coalesce(old.size_bytes, 0) = coalesce(new.size_bytes, 0)
     and v_old_counts = v_new_counts then
    return new;
  end if;

  if v_old_counts then
    perform public._storage_apply_ws(old.workspace_id, -coalesce(old.size_bytes, 0), -1);
  end if;
  if v_new_counts then
    perform public._storage_apply_ws(new.workspace_id, coalesce(new.size_bytes, 0), 1);
  end if;
  return new;
end $function$;
create or replace function public.reconcile_storage_usage()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  with truth as (
    select w.created_by as owner_id,
           coalesce(sum(i.size_bytes), 0)::bigint as bytes_used,
           count(*)::bigint as object_count
      from public.images i
      join public.workspaces w on w.id = i.workspace_id
     where w.created_by is not null
       and w.org_id is null      -- 0537: a team's files are on its own meter
       and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at)
     group by w.created_by
  ), upserted as (
    insert into public.storage_usage (owner_id, bytes_used, object_count, updated_at)
    select owner_id, bytes_used, object_count, now() from truth
    on conflict (owner_id) do update
      set bytes_used   = excluded.bytes_used,
          object_count = excluded.object_count,
          updated_at   = now()
    returning owner_id
  )
  select count(*) into v_rows from upserted;

  update public.storage_usage s
     set bytes_used = 0, object_count = 0, updated_at = now()
   where not exists (
     select 1 from public.images i
       join public.workspaces w on w.id = i.workspace_id
      where w.created_by = s.owner_id
        and w.org_id is null
        and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at)
   ) and (s.bytes_used <> 0 or s.object_count <> 0);

  -- 0537: the same for every team's meter (0536).
  with truth as (
    select w.org_id,
           coalesce(sum(i.size_bytes), 0)::bigint as bytes_used,
           count(*)::bigint as object_count
      from public.images i
      join public.workspaces w on w.id = i.workspace_id
     where w.org_id is not null
       and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at)
     group by w.org_id
  ), upserted as (
    insert into public.org_storage_usage (org_id, bytes_used, object_count, updated_at)
    select org_id, bytes_used, object_count, now() from truth
    on conflict (org_id) do update
      set bytes_used   = excluded.bytes_used,
          object_count = excluded.object_count,
          updated_at   = now()
    returning org_id
  )
  select v_rows + count(*) into v_rows from upserted;
  update public.org_storage_usage s
     set bytes_used = 0, object_count = 0, updated_at = now()
   where not exists (
     select 1 from public.images i
       join public.workspaces w on w.id = i.workspace_id
      where w.org_id = s.org_id
        and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at)
   ) and (s.bytes_used <> 0 or s.object_count <> 0);
  return v_rows;
end $function$;
revoke execute on function public._team_storage_floor_bytes() from public, anon, authenticated;
revoke execute on function public._team_storage_seat_bytes() from public, anon, authenticated;
revoke execute on function public._seat_perk_storage_bytes() from public, anon, authenticated;
revoke execute on function public._seat_perk_on(uuid) from public, anon, authenticated;
revoke execute on function public._board_card_payer(uuid) from public, anon, authenticated;
revoke execute on function public._org_storage_used_bytes(uuid) from public, anon, authenticated;
revoke execute on function public._org_storage_pending_bytes(uuid) from public, anon, authenticated;
revoke execute on function public._org_storage_quota_bytes(uuid) from public, anon, authenticated;
revoke execute on function public._drive_quota_bytes(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._drive_used_bytes(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._storage_apply_ws(uuid, bigint, bigint) from public, anon, authenticated;

-- The re-emitted functions keep live's grants (create or replace keeps an
-- ACL). Said again here, each a no-op live, so this file proves its own.
revoke execute on function public._owner_card_count(uuid) from public, anon, authenticated;
revoke execute on function public._storage_used_bytes(uuid) from public, anon, authenticated;
revoke execute on function public._storage_pending_bytes(uuid) from public, anon, authenticated;
revoke execute on function public._storage_quota_bytes(uuid) from public, anon, authenticated;
revoke execute on function public._storage_quota_if_blocks(uuid, integer) from public, anon, authenticated;
revoke execute on function public.enforce_demo_card_cap_trg() from public, anon, authenticated;
revoke execute on function public.reconcile_storage_usage() from public, anon, authenticated;
revoke execute on function public.scout_board_capacity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.scout_board_capacity(uuid, uuid) to service_role;
revoke execute on function public.restore_board(uuid) from public, anon;
grant execute on function public.restore_board(uuid) to authenticated;

do $$
declare
  v_fn text;
begin
  -- 0536 is live first: the team's meter, the columns S3 bills from, the
  -- apply helper the trigger and reconcile call.
  if to_regclass('public.org_storage_usage') is null
     or to_regprocedure('public._org_storage_usage_apply(uuid,bigint,bigint)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'organizations'
                       and column_name in ('first_paid_at', 'storage_blocks')
                     having count(*) = 2) then
    raise exception '0537 needs 0536 live first';
  end if;

  -- Every helper, new or re-emitted, is server-only.
  foreach v_fn in array array[
    'public._team_storage_floor_bytes()',
    'public._team_storage_seat_bytes()',
    'public._seat_perk_storage_bytes()',
    'public._seat_perk_on(uuid)',
    'public._board_card_payer(uuid)',
    'public._org_storage_used_bytes(uuid)',
    'public._org_storage_pending_bytes(uuid)',
    'public._org_storage_quota_bytes(uuid)',
    'public._drive_quota_bytes(uuid,uuid)',
    'public._drive_used_bytes(uuid,uuid)',
    'public._storage_apply_ws(uuid,bigint,bigint)',
    'public._owner_card_count(uuid)',
    'public._storage_used_bytes(uuid)',
    'public._storage_pending_bytes(uuid)',
    'public._storage_quota_bytes(uuid)',
    'public._storage_quota_if_blocks(uuid,integer)',
    'public.reconcile_storage_usage()',
    'public.enforce_demo_card_cap_trg()',
    'public.scout_board_capacity(uuid,uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0537: % is client-executable', v_fn;
    end if;
  end loop;

  -- The gates the app calls still answer it.
  foreach v_fn in array array[
    'public.get_board_capacity(uuid)',
    'public.restore_board(uuid)',
    'public.authorize_upload(uuid,bigint)',
    'public.authorize_image_upload(uuid,bigint)'] loop
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0537: % is not callable signed in', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.restore_board(uuid)', 'execute') then
    raise exception '0537: a write gate is callable signed out';
  end if;
  if not has_function_privilege('service_role', 'public.scout_board_capacity(uuid,uuid)', 'execute') then
    raise exception '0537: Scout (service role) cannot read a board''s capacity';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_team_storage_floor_bytes', '_team_storage_seat_bytes',
                                  '_seat_perk_storage_bytes', '_seat_perk_on', '_board_card_payer',
                                  '_org_storage_used_bytes', '_org_storage_pending_bytes',
                                  '_org_storage_quota_bytes', '_drive_quota_bytes', '_drive_used_bytes',
                                  '_storage_apply_ws', '_owner_card_count', 'enforce_demo_card_cap_trg',
                                  'get_board_capacity', 'scout_board_capacity', 'restore_board',
                                  '_storage_used_bytes', '_storage_pending_bytes', '_storage_quota_if_blocks',
                                  'authorize_upload', 'authorize_image_upload',
                                  'storage_usage_trg', 'reconcile_storage_usage')
              group by p.proname having count(*) > 1) then
    raise exception '0537: an overload exists (PGRST203)';
  end if;
  -- _storage_quota_bytes has always had two: the plan drive () and the person's (uuid).
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname = '_storage_quota_bytes') <> 2 then
    raise exception '0537: _storage_quota_bytes gained an overload';
  end if;

  -- Applying this changes nothing for anyone: no team, so no seat and no perk.
  if exists (select 1 from public.organizations) then
    raise exception '0537: an organization exists';
  end if;
end $$;

commit;
