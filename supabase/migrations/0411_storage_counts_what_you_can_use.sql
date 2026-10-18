-- 0411 — Storage counts what you can use, and deleting frees it.
--
-- Until now the storage count was every images row that had not been
-- tombstoned, and none ever is: the orphan sweep only runs dry. So deleting a
-- card, a file or a whole cluster gave back nothing, previews and board
-- thumbnails counted whenever a client happened to declare their size, and a
-- free limit that binds would be a wall nobody could ever climb back over.
--
-- A file now counts while it is alive, is an ORIGINAL (previews and board
-- thumbnails are the product's own derived copies, and never count), and
-- either a cluster still uses it or it was uploaded within the last day — the
-- gap between an upload and the first save of the cluster it lands in.
--
-- "A cluster still uses it" is read from images.live_board_ids, which the
-- storage-liveness job (supabase/functions/storage-liveness) keeps current by
-- decoding each cluster's saved state with deleted content dropped. The raw
-- referenced_in_board_ids / ref_count stay exactly as they are and keep
-- guarding the orphan sweep: undo, the trash and version history can still
-- bring a deleted card back, and the sweep must never get ahead of them. The
-- two answer different questions — "could this file still be needed?" versus
-- "is anybody using it?" — and only storage asks the second.
--
-- Until the job has read a cluster (live_board_ids is null) the raw answer
-- stands, so nothing stops counting before it has been looked at.
--
-- Callers that live in the deployed PartyKit room (authorize_image_upload,
-- authorize_upload, record_upload_intent, finalize_upload_intent) keep their
-- signatures and return shapes: that code cannot be redeployed.

-- ── 1. The liveness the storage count reads ─────────────────────────────────

alter table public.images add column if not exists live_board_ids uuid[];

comment on column public.images.live_board_ids is
  'Clusters whose saved state still uses this file, read with deleted content dropped (storage-liveness, 0411). Null until a cluster that references it has been read; then the raw referenced_in_board_ids no longer decides the storage count. The orphan sweep never reads this.';

create index if not exists images_live_boards_gin on public.images using gin (live_board_ids);
-- The last day's uploads, per workspace, for the read-time arm of the count.
create index if not exists images_ws_recent_alive_idx
  on public.images (workspace_id, created_at) include (size_bytes)
  where deleted_at is null;

-- Which version of each cluster's saved state the job last read.
create table if not exists public.board_liveness (
  board_id       uuid primary key references public.boards(id) on delete cascade,
  doc_updated_at timestamptz not null,
  live_keys      integer not null default 0,
  checked_at     timestamptz not null default now()
);
alter table public.board_liveness enable row level security;
revoke all on table public.board_liveness from public, anon, authenticated;

-- ── 2. One definition of "counts" ───────────────────────────────────────────
-- The part of the rule that does not depend on the clock, so the rollup can
-- maintain it. The last-day arm is added at read time (_storage_used_bytes).
create or replace function public._image_counts(p_deleted_at timestamptz, p_path text, p_ref_count integer, p_live uuid[])
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select p_deleted_at is null
     and coalesce(p_path, '') !~ '/(previews|thumbs)/'
     and case when p_live is null then coalesce(p_ref_count, 0) > 0
              else cardinality(p_live) > 0 end
$function$;
revoke execute on function public._image_counts(timestamptz, text, integer, uuid[]) from public, anon, authenticated;

-- ── 3. The rollup follows the rule ──────────────────────────────────────────
-- Same shape as 0293: an UPDATE that changes nothing the count depends on is
-- write-free, so a reference moving between two clusters, or a variant stamp,
-- touches no storage_usage row.
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
    if public._image_counts(new.deleted_at, new.storage_path, new.ref_count, new.live_board_ids) then
      perform public._storage_usage_apply(
        public._image_owner(new.workspace_id), coalesce(new.size_bytes, 0), 1);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if public._image_counts(old.deleted_at, old.storage_path, old.ref_count, old.live_board_ids) then
      perform public._storage_usage_apply(
        public._image_owner(old.workspace_id), -coalesce(old.size_bytes, 0), -1);
    end if;
    return old;
  end if;

  v_old_counts := public._image_counts(old.deleted_at, old.storage_path, old.ref_count, old.live_board_ids);
  v_new_counts := public._image_counts(new.deleted_at, new.storage_path, new.ref_count, new.live_board_ids);

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

-- ── 4. What an owner is using ───────────────────────────────────────────────
create or replace function public._storage_used_bytes(p_owner uuid)
 returns bigint
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_used   bigint;
  v_recent bigint;
begin
  -- Files a cluster uses: the rollup, or the same rule summed live.
  select s.bytes_used into v_used from public.storage_usage s where s.owner_id = p_owner;
  if not found then
    select coalesce(sum(i.size_bytes), 0) into v_used
      from public.images i
      join public.workspaces w on w.id = i.workspace_id
     where w.created_by = p_owner
       and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids);
  end if;

  -- Plus the last day's uploads that no cluster's saved state has reached yet.
  select coalesce(sum(i.size_bytes), 0) into v_recent
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
   where w.created_by = p_owner
     and i.deleted_at is null
     and i.created_at > now() - interval '24 hours'
     and coalesce(i.storage_path, '') !~ '/(previews|thumbs)/'
     and not public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids);

  return coalesce(v_used, 0) + coalesce(v_recent, 0);
end $function$;

-- Presigned uploads not yet filed. A single PUT's URL lives for minutes, so
-- an unclaimed 'put' intent stops counting after an hour; a multipart upload
-- can run for hours and keeps its day.
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
     and u.claimed_at is null
     and u.created_at > now() - case when u.kind = 'multipart' then interval '24 hours'
                                     else interval '1 hour' end;
$function$;

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
       and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids)
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
        and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids)
   ) and (s.bytes_used <> 0 or s.object_count <> 0);

  return v_rows;
end $function$;

-- The Settings meter. It used the global paid drive for everyone, so a free
-- account was told it had the paid allowance; it now reads the same per-owner
-- numbers the upload gates use.
create or replace function public.my_storage_usage()
 returns table(used bigint, quota bigint, remaining bigint, is_paid boolean)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_used  bigint;
  v_quota bigint;
  v_tier  text;
begin
  v_quota := public._storage_quota_bytes(v_uid);
  v_used  := public._storage_used_bytes(v_uid) + public._storage_pending_bytes(v_uid);
  select coalesce(tier, 'demo') into v_tier from public.profiles where user_id = v_uid;
  return query select coalesce(v_used, 0), v_quota, greatest(0, v_quota - coalesce(v_used, 0)),
                      coalesce(v_tier, 'demo') in ('paid', 'admin');
end;
$function$;

-- ── 5. The upload gate answers "full" before "too big" ──────────────────────
-- Same signature and return shape (the deployed room calls it). Only the order
-- moves: an owner with no room left hears that, instead of being offered a
-- plan for one file while every other upload is also refused.
create or replace function public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
 returns table(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_owner_tier text;
  v_quota bigint;
  v_used bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
  -- = FREE_FILE_CAP in boards/src/lib/fileIngest.js (50 MB). Pinned by test.
  v_free_file_cap constant bigint := 52428800;
begin
  select created_by into v_owner from public.workspaces where id = p_workspace_id;
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;

  if not public.can_write_workspace(p_workspace_id) then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;

  v_quota := public._storage_quota_bytes(v_owner);
  -- Uploads presigned but not yet filed count too (0387).
  v_used := public._storage_used_bytes(v_owner) + public._storage_pending_bytes(v_owner);

  if v_used + v_bytes > v_quota then
    return query select false, v_used, v_quota, greatest(0, v_quota - v_used), 'over_quota'::text; return;
  end if;

  -- A free owner may upload any file up to the free file cap. Past it the
  -- answer is the one the client turns into the Creator offer.
  select coalesce(tier, 'demo') into v_owner_tier from public.profiles where user_id = v_owner;
  if coalesce(v_owner_tier, 'demo') not in ('paid', 'admin') and v_bytes > v_free_file_cap then
    return query select false, v_used, v_quota, greatest(0, v_quota - v_used), 'owner_not_paid'::text; return;
  end if;

  return query select true, v_used, v_quota, greatest(0, v_quota - v_used), 'ok'::text;
end $function$;

-- ── 6. A transfer moves what counts ─────────────────────────────────────────
-- Re-emitted from the live 0397 body; only the byte sum changes, to the rule
-- above, so the old owner is not credited for files that never counted.
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
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids);
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

-- ── 7. Emptying the trash frees space at once ───────────────────────────────
-- A purged cluster's board_state goes with it (ON DELETE CASCADE), but the
-- references it held stayed until the nightly recompute. Release them now. The
-- guard means a writer deleting board_state directly (that policy exists)
-- releases nothing: only a cluster that is really gone gives its files back.
create or replace function public._tg_board_state_release_refs()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.boards b where b.id = old.board_id) then
    return old;
  end if;
  update public.images i
     set referenced_in_board_ids = array_remove(i.referenced_in_board_ids, old.board_id),
         ref_count               = coalesce(cardinality(array_remove(i.referenced_in_board_ids, old.board_id)), 0),
         live_board_ids          = case when i.live_board_ids is null then null
                                        else array_remove(i.live_board_ids, old.board_id) end
   where i.referenced_in_board_ids @> array[old.board_id]
      or i.live_board_ids @> array[old.board_id];
  return old;
end;
$function$;
revoke execute on function public._tg_board_state_release_refs() from public, anon, authenticated;

create or replace trigger board_state_release_refs
  after delete on public.board_state
  for each row execute function public._tg_board_state_release_refs();

-- ── 8. The job's two calls (service role only) ──────────────────────────────
-- Clusters whose saved state changed since the job last read them, oldest
-- first, cut off at a character budget so one run stays small. The first row
-- always comes back, however large.
create or replace function public.storage_liveness_due(p_limit integer default 40, p_max_chars bigint default 3000000)
 returns table(board_id uuid, doc text, updated_at timestamptz)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with due as (
    select bs.board_id, bs.updated_at
      from public.board_state bs
      left join public.board_liveness bl on bl.board_id = bs.board_id
     where bl.board_id is null or bs.updated_at > bl.doc_updated_at
     order by bs.updated_at, bs.board_id
     limit greatest(1, least(coalesce(p_limit, 40), 200))
  ), sized as (
    select d.board_id, d.updated_at, bs.doc, coalesce(octet_length(bs.doc), 0)::bigint as n
      from due d
      join public.board_state bs on bs.board_id = d.board_id
  ), run as (
    select s.*, sum(s.n) over (order by s.updated_at, s.board_id) as running
      from sized s
  )
  select r.board_id, r.doc, r.updated_at
    from run r
   where r.running - r.n < coalesce(p_max_chars, 3000000)
   order by r.updated_at, r.board_id;
$function$;

-- Record the keys one cluster's state still uses. A null key list means the
-- job could not decode the state: fall back to the raw scan, so a bad row
-- never makes a cluster's files look unused.
create or replace function public.storage_liveness_record(p_board_id uuid, p_doc_updated_at timestamptz, p_keys text[] default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_keys text[];
  v_n    integer := 0;
begin
  if p_board_id is null or p_doc_updated_at is null then
    return 0;
  end if;
  if not exists (select 1 from public.boards b where b.id = p_board_id) then
    return 0;
  end if;

  if p_keys is null then
    select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
      from public.board_state bs
      cross join lateral public._r2_keys_in_doc(bs.doc) as k
     where bs.board_id = p_board_id;
  else
    select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
      from unnest(p_keys) as k
     where k is not null and k <> '';
  end if;

  -- Every file this cluster might touch: the ones it uses now, the ones it
  -- was last seen using, and the ones the raw scan still finds in it (where a
  -- deleted card's file is found, and released).
  with candidates as (
    select i.id from public.images i where i.storage_path = any (v_keys)
    union
    select i.id from public.images i where i.live_board_ids @> array[p_board_id]
    union
    select i.id from public.images i where i.referenced_in_board_ids @> array[p_board_id]
  ), computed as (
    select i.id,
           -- Clusters not read yet keep the raw answer until they are.
           case when i.storage_path = any (v_keys)
                then (select coalesce(array_agg(distinct b order by b), '{}'::uuid[])
                        from unnest(array_remove(coalesce(i.live_board_ids, i.referenced_in_board_ids, '{}'::uuid[]), p_board_id)
                                    || array[p_board_id]) as b)
                else coalesce(array_remove(coalesce(i.live_board_ids, i.referenced_in_board_ids, '{}'::uuid[]), p_board_id), '{}'::uuid[])
           end as new_live
      from public.images i
     where i.id in (select c.id from candidates c)
  )
  update public.images i
     set live_board_ids = c.new_live
    from computed c
   where i.id = c.id
     and i.live_board_ids is distinct from c.new_live;
  get diagnostics v_n = row_count;

  insert into public.board_liveness (board_id, doc_updated_at, live_keys, checked_at)
  values (p_board_id, p_doc_updated_at, coalesce(cardinality(v_keys), 0), now())
  on conflict (board_id) do update
    set doc_updated_at = greatest(public.board_liveness.doc_updated_at, excluded.doc_updated_at),
        live_keys      = excluded.live_keys,
        checked_at     = now();

  return v_n;
end;
$function$;

revoke execute on function public.storage_liveness_due(integer, bigint) from public, anon, authenticated;
revoke execute on function public.storage_liveness_record(uuid, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.storage_liveness_due(integer, bigint) to service_role;
grant execute on function public.storage_liveness_record(uuid, timestamptz, text[]) to service_role;

-- Every minute. A run with nothing due is one indexed query.
select cron.unschedule(jobid) from cron.job where jobname = 'storage-liveness';
select cron.schedule('storage-liveness', '* * * * *', $$select public._cron_edge_post('storage-liveness')$$);

-- ── 9. Re-seed the rollup on the new rule ───────────────────────────────────
select public.reconcile_storage_usage();

-- ── 10. Prove the grants (the 0311 habit) ───────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('public._image_counts(timestamptz, text, integer, uuid[])'),
      ('public._tg_board_state_release_refs()'),
      ('public.storage_liveness_due(integer, bigint)'),
      ('public.storage_liveness_record(uuid, timestamptz, text[])'),
      ('public._storage_used_bytes(uuid)'),
      ('public._storage_pending_bytes(uuid)'),
      ('public.reconcile_storage_usage()')
    ) as t(sig)
  loop
    if has_function_privilege('anon', r.sig, 'execute') or has_function_privilege('authenticated', r.sig, 'execute') then
      raise exception '0411: % is callable by a client', r.sig;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.storage_liveness_due(integer, bigint)', 'execute')
     or not has_function_privilege('service_role', 'public.storage_liveness_record(uuid, timestamptz, text[])', 'execute') then
    raise exception '0411: the storage-liveness job cannot call its functions';
  end if;
  if not has_function_privilege('authenticated', 'public.my_storage_usage()', 'execute')
     or has_function_privilege('anon', 'public.my_storage_usage()', 'execute') then
    raise exception '0411: my_storage_usage must be for signed-in callers only';
  end if;
  if not has_function_privilege('authenticated', 'public.authorize_upload(uuid, bigint)', 'execute')
     or not has_function_privilege('authenticated', 'public.transfer_workspace_ownership(uuid, uuid)', 'execute') then
    raise exception '0411: a re-emitted client RPC lost its grant';
  end if;
  if has_table_privilege('authenticated', 'public.board_liveness', 'select')
     or has_table_privilege('anon', 'public.board_liveness', 'select') then
    raise exception '0411: board_liveness is readable by a client';
  end if;
end $$;
