-- 0412 — A file nobody has placed yet still counts; a file a cluster let go of
-- does not.
--
-- 0411 counted a file while a cluster used it, plus a last-day grace for the
-- gap between an upload and its cluster's first save. That grace was the wrong
-- shape. A file uploaded through the API and never placed is still stored,
-- listable and downloadable (GET /api/v1/images), so after a day it was held
-- for free; and a resumable bulk migration keeps a backlog of unplaced files
-- far longer than a day.
--
-- The line is drawn where it belongs instead: a file counts until a cluster
-- that used it lets go of it. images.first_referenced_at (set by
-- recompute_image_refs the first time any cluster's saved state names the
-- file) separates "not placed yet" — counts, however old — from "placed, then
-- deleted" — released. The count no longer depends on the clock, so the
-- rollup carries all of it and the read-time arm goes away.

create or replace function public._image_counts(p_deleted_at timestamptz, p_path text, p_ref_count integer, p_live uuid[], p_first_ref timestamptz)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select p_deleted_at is null
     and coalesce(p_path, '') !~ '/(previews|thumbs)/'
     and (p_first_ref is null
          or case when p_live is null then coalesce(p_ref_count, 0) > 0
                  else cardinality(p_live) > 0 end)
$function$;
revoke execute on function public._image_counts(timestamptz, text, integer, uuid[], timestamptz) from public, anon, authenticated;

create or replace function public.storage_usage_trg()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old_owner  uuid;
  v_new_owner  uuid;
  v_old_counts boolean;
  v_new_counts boolean;
begin
  if tg_op = 'INSERT' then
    if public._image_counts(new.deleted_at, new.storage_path, new.ref_count, new.live_board_ids, new.first_referenced_at) then
      perform public._storage_usage_apply(
        public._image_owner(new.workspace_id), coalesce(new.size_bytes, 0), 1);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public._image_counts(old.deleted_at, old.storage_path, old.ref_count, old.live_board_ids, old.first_referenced_at) then
      perform public._storage_usage_apply(
        public._image_owner(old.workspace_id), -coalesce(old.size_bytes, 0), -1);
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

  v_old_owner := public._image_owner(old.workspace_id);
  v_new_owner := public._image_owner(new.workspace_id);

  if v_old_counts then
    perform public._storage_usage_apply(v_old_owner, -coalesce(old.size_bytes, 0), -1);
  end if;
  if v_new_counts then
    perform public._storage_usage_apply(v_new_owner, coalesce(new.size_bytes, 0), 1);
  end if;
  return new;
end $function$;

-- The rollup now holds the whole count.
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
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  return coalesce(v_used, 0);
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
        and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at)
   ) and (s.bytes_used <> 0 or s.object_count <> 0);

  return v_rows;
end $function$;

-- Re-emitted from 0411 (the live 0397 body); only the rule's arguments change.
create or replace function public.transfer_workspace_ownership(p_workspace_id uuid, p_new_owner uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old     uuid;
  v_name    text;
  v_tier    text;
  v_cap     integer;
  v_count   integer;
  v_role    text;
  v_bytes   bigint;
  v_objects bigint;
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- A banned account's clusters stop serving, so it can't be handed one.
  if public._user_banned(p_new_owner) then
    raise exception 'that account cannot own a workspace' using errcode = '42501';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'cannot transfer ownership to yourself'
      using errcode = '22023';
  end if;

  select created_by, name into v_old, v_name from workspaces where id = p_workspace_id;
  if v_old is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;
  if v_old <> auth.uid() then
    raise exception 'only the current owner can transfer ownership'
      using errcode = '42501';
  end if;
  select role into v_role from workspace_members
   where workspace_id = p_workspace_id and user_id = p_new_owner;
  if v_role is null then
    raise exception 'new owner must already be a workspace member'
      using errcode = '42704';
  end if;
  -- 0397: only someone who can edit it. A viewer or a service account would
  -- receive a workspace they cannot run, from an owner just demoted to editor.
  if v_role not in ('coowner', 'admin', 'editor') then
    raise exception 'only an editor or co-owner can become the owner — make them an editor first'
      using errcode = '42501';
  end if;

  update workspaces set created_by = p_new_owner where id = p_workspace_id;
  update workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;
  update workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_old;

  -- 0397: the workspace's stored files now count toward the new owner, as the
  -- nightly reconcile would decide; move them now rather than at 03:55 UTC.
  -- 0411: only the files that count (_image_counts) — the rollup holds no others.
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
    into v_bytes, v_objects
    from public.images i
   where i.workspace_id = p_workspace_id
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  perform public._storage_usage_apply(v_old, -v_bytes, -v_objects);
  perform public._storage_usage_apply(p_new_owner, v_bytes, v_objects);

  -- 0395: tell the new owner, with their own numbers (counted AFTER the
  -- hand-over, so this workspace is included). Only the free plan has a card
  -- cap (enforce_demo_card_cap_trg), so only it gets numbers.
  begin
    select coalesce(p.tier, 'demo'), coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
      into v_tier, v_cap
      from public.profiles p where p.user_id = p_new_owner;
    v_tier  := coalesce(v_tier, 'demo');
    v_cap   := coalesce(v_cap, 50);
    v_count := public._owner_card_count(p_new_owner);

    insert into public.notifications (user_id, kind, workspace_id, actor_id, title, body, data)
    values (
      p_new_owner,
      'workspace.ownership_received',
      p_workspace_id,
      auth.uid(),
      format('You now own "%s"', coalesce(nullif(btrim(v_name), ''), 'a workspace')),
      case
        when v_tier = 'demo' and v_count > v_cap then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards, so no new cards can be added to workspaces you own until you upgrade or clear space.', v_count, v_cap)
        when v_tier = 'demo' then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards.', v_count, v_cap)
        else
          'Its cards, files and storage now count toward your plan.'
      end,
      jsonb_build_object(
        'card_count', v_count,
        'card_limit', case when v_tier = 'demo' then v_cap end,
        'over_limit', (v_tier = 'demo' and v_count > v_cap)
      )
    );
  exception when others then
    raise warning 'transfer_workspace_ownership: could not notify the new owner of %: %', p_workspace_id, sqlerrm;
  end;
end;
$function$;

-- A file never placed lives in the cluster it was uploaded into
-- (images.board_id). When that cluster is purged, the foreign key nulls
-- board_id: stamp the file as having had its cluster, so it is released like
-- any other file a cluster let go of. images has no client UPDATE policy, so
-- the foreign-key action and server functions are the only writers of board_id.
create or replace function public._tg_images_release_on_board_purge()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.board_id is null and old.board_id is not null and new.first_referenced_at is null
     and not exists (select 1 from public.boards b where b.id = old.board_id) then
    new.first_referenced_at := now();
  end if;
  return new;
end;
$function$;
revoke execute on function public._tg_images_release_on_board_purge() from public, anon, authenticated;

create or replace trigger images_release_on_board_purge
  before update of board_id on public.images
  for each row execute function public._tg_images_release_on_board_purge();

comment on column public.images.first_referenced_at is
  'When a cluster''s saved state first named this file (recompute_image_refs). Also stamped when the cluster it was uploaded into is purged before it was ever placed (0412). Null means the file has never had a cluster: it still counts toward storage, however old.';

-- The read-time arm's index has nothing left to serve. It is kept for now: an
-- index removal is its own reviewed change, and it costs one btree.

select public.reconcile_storage_usage();

do $$
begin
  if has_function_privilege('anon', 'public._image_counts(timestamptz, text, integer, uuid[], timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public._image_counts(timestamptz, text, integer, uuid[], timestamptz)', 'execute') then
    raise exception '0412: _image_counts is callable by a client';
  end if;
  if has_function_privilege('authenticated', 'public._storage_used_bytes(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.reconcile_storage_usage()', 'execute') then
    raise exception '0412: a storage helper is callable by a client';
  end if;
  if has_function_privilege('authenticated', 'public._tg_images_release_on_board_purge()', 'execute') then
    raise exception '0412: a trigger function is callable by a client';
  end if;
  if not has_function_privilege('authenticated', 'public.transfer_workspace_ownership(uuid, uuid)', 'execute') then
    raise exception '0412: transfer_workspace_ownership lost its grant';
  end if;
end $$;
