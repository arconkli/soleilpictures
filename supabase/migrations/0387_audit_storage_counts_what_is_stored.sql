-- 0387 — storage counts what was actually stored; free accounts get 5 GB
-- (audit AC-5, owner decision 2026-10-06).
--
-- The quota trusted the client twice. The presign asked "how many bytes?" and
-- believed the answer, while the PUT URL let any number of bytes through. Then
-- the images row carried whatever size_bytes the client wrote, and the usage
-- counter added that. Declare 0, upload a gigabyte, file it as 0: the drive
-- never filled. Every account, free or paid, also had the same 100 GB.
--
-- Now:
--   - a free owner's quota is storage_quota_free_bytes (app_config, default
--     5 GiB); paid and admin owners keep storage_quota_bytes (100 GiB); an
--     explicit profiles.storage_quota_bytes still wins.
--   - the upload party signs Content-Length into every PUT URL, so R2 refuses
--     a body of any other size, and records an upload intent — key and bytes —
--     before it hands the key out. A multipart upload's intent is finalized
--     with R2's own count of the finished object, and refused (the party
--     deletes the object) if that runs past what was declared.
--   - an images row takes its size_bytes from the intent for its key, not from
--     the client; uploads presigned in the last day but not yet filed count
--     against the quota; size_bytes can no longer be negative.

begin;

-- ── 1. Quotas ───────────────────────────────────────────────────────────────

insert into public.app_config (key, value)
values ('storage_quota_free_bytes', jsonb_build_object('bytes', 5368709120))
on conflict (key) do nothing;

create or replace function public._storage_quota_free_bytes()
returns bigint
language sql stable security definer
set search_path = public as $$
  select coalesce((select (value->>'bytes')::bigint from public.app_config where key = 'storage_quota_free_bytes'),
                  5368709120);
$$;
revoke execute on function public._storage_quota_free_bytes() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._storage_quota_bytes(p_owner uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- An explicit per-account figure wins. Otherwise a paid or admin owner gets
  -- the drive Creator sells (storage_quota_bytes) and a free owner gets
  -- storage_quota_free_bytes (0387, owner decision 2026-10-06).
  select coalesce(
    (select p.storage_quota_bytes from public.profiles p where p.user_id = p_owner),
    case when coalesce((select p.tier from public.profiles p where p.user_id = p_owner), 'demo') in ('paid', 'admin')
         then public._storage_quota_bytes()
         else public._storage_quota_free_bytes()
    end
  );
$function$;

-- ── 2. Upload intents ───────────────────────────────────────────────────────

create table if not exists public.upload_intents (
  storage_key  text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bytes        bigint not null check (bytes >= 0),
  kind         text not null check (kind in ('put', 'multipart')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  finalized_at timestamptz,
  claimed_at   timestamptz
);
create index if not exists upload_intents_pending_idx on public.upload_intents (workspace_id) where claimed_at is null;
alter table public.upload_intents enable row level security;
revoke all on table public.upload_intents from public, anon, authenticated;

-- Called by the upload party, as the uploader, BEFORE it returns the key — so
-- the first writer for a fresh key is always the party. A key is
-- <workspace>/<uuid>.<ext>; the right checked is the one the party checked.
create or replace function public.record_upload_intent(p_key text, p_bytes bigint, p_kind text, p_board_id uuid default null)
returns boolean
language plpgsql security definer
set search_path = public as $$
declare
  v_ws uuid;
  v_n  integer;
begin
  if auth.uid() is null or p_key is null or p_bytes is null or p_bytes < 0
     or p_kind is null or p_kind not in ('put', 'multipart')
     or p_key !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,8}$' then
    return false;
  end if;
  v_ws := split_part(p_key, '/', 1)::uuid;
  if not (public.can_write_workspace(v_ws)
          or (p_board_id is not null and public.can_write_board(p_board_id)
              and (public._board_in_workspace(p_board_id, v_ws) or public.is_workspace_member(v_ws)))) then
    return false;
  end if;
  insert into public.upload_intents (storage_key, workspace_id, bytes, kind, created_by)
  values (p_key, v_ws, p_bytes, p_kind, auth.uid())
  on conflict (storage_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke execute on function public.record_upload_intent(text, bigint, text, uuid) from public, anon;
grant execute on function public.record_upload_intent(text, bigint, text, uuid) to authenticated;

-- A finished multipart object's real size, from R2. It may not run past what
-- was declared and quota-checked, with 1% or 1 MB of slack; false tells the
-- party to delete the object.
create or replace function public.finalize_upload_intent(p_key text, p_bytes bigint)
returns boolean
language plpgsql security definer
set search_path = public as $$
declare
  v_ok boolean;
begin
  if auth.uid() is null or p_bytes is null or p_bytes < 0 then
    return false;
  end if;
  update public.upload_intents u
     set bytes = p_bytes, finalized_at = now()
   where u.storage_key = p_key
     and u.kind = 'multipart'
     and u.finalized_at is null
     and u.created_by = auth.uid()
     and p_bytes <= u.bytes + greatest(u.bytes / 100, 1048576)
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;
revoke execute on function public.finalize_upload_intent(text, bigint) from public, anon;
grant execute on function public.finalize_upload_intent(text, bigint) to authenticated;

create or replace function public._storage_pending_bytes(p_owner uuid)
returns bigint
language sql stable security definer
set search_path = public as $$
  select coalesce(sum(u.bytes), 0)::bigint
    from public.upload_intents u
    join public.workspaces w on w.id = u.workspace_id
   where w.created_by = p_owner
     and u.claimed_at is null
     and u.created_at > now() - interval '24 hours';
$$;
revoke execute on function public._storage_pending_bytes(uuid) from public, anon, authenticated;

-- The images row takes its size from the intent for its key.
create or replace function public._tg_image_size_from_intent()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_bytes bigint;
begin
  update public.upload_intents
     set claimed_at = coalesce(claimed_at, now())
   where storage_key = new.storage_path
  returning bytes into v_bytes;
  if v_bytes is not null then
    new.size_bytes := v_bytes;
  end if;
  return new;
end;
$$;
revoke execute on function public._tg_image_size_from_intent() from public, anon, authenticated;

create trigger images_size_from_intent
  before insert on public.images
  for each row execute function public._tg_image_size_from_intent();

alter table public.images
  add constraint images_size_bytes_nonnegative check (size_bytes is null or size_bytes >= 0) not valid;
alter table public.images validate constraint images_size_bytes_nonnegative;

create or replace function public.purge_old_upload_intents(p_days integer)
returns integer
language plpgsql security definer
set search_path = public as $$
declare v_n integer;
begin
  delete from public.upload_intents where created_at < now() - make_interval(days => p_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.purge_old_upload_intents(integer) from public, anon, authenticated;

select cron.schedule('purge-upload-intents', '33 3 * * *', $$select public.purge_old_upload_intents(7)$$);

-- ── 3. The quota counts what is in flight ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.authorize_image_upload(p_board_id uuid, p_bytes bigint)
 RETURNS TABLE(allow boolean, used bigint, quota bigint, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner uuid;
  v_quota bigint;
  v_used  bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  if not public.can_write_board(p_board_id) then
    return query select false, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;
  v_owner := public.board_workspace_owner(p_board_id);
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;
  v_quota := public._storage_quota_bytes(v_owner);
  -- Uploads presigned but not yet filed count too (0387).
  v_used  := public._storage_used_bytes(v_owner) + public._storage_pending_bytes(v_owner);
  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $function$;

CREATE OR REPLACE FUNCTION public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
 RETURNS TABLE(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- A free owner may upload any file up to the free file cap. Past it the
  -- answer is the one the client turns into the Creator offer.
  select coalesce(tier, 'demo') into v_owner_tier from public.profiles where user_id = v_owner;
  if coalesce(v_owner_tier, 'demo') not in ('paid', 'admin') and v_bytes > v_free_file_cap then
    return query select false, 0::bigint, v_quota, 0::bigint, 'owner_not_paid'::text; return;
  end if;

  -- Uploads presigned but not yet filed count too (0387).
  v_used := public._storage_used_bytes(v_owner) + public._storage_pending_bytes(v_owner);

  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      greatest(0, v_quota - v_used),
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $function$;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array['public._storage_quota_free_bytes()', 'public._storage_pending_bytes(uuid)',
                           'public._storage_quota_bytes(uuid)', 'public._tg_image_size_from_intent()',
                           'public.purge_old_upload_intents(integer)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0387: % is client-callable', f;
    end if;
  end loop;
  foreach f in array array['public.record_upload_intent(text,bigint,text,uuid)', 'public.finalize_upload_intent(text,bigint)'] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0387: % grants are wrong', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.upload_intents', 'select')
     or has_table_privilege('authenticated', 'public.upload_intents', 'insert') then
    raise exception '0387: upload_intents is client-readable or writable';
  end if;
  if public._storage_quota_free_bytes() <> 5368709120 then
    raise exception '0387: the free quota is not 5 GiB';
  end if;
  if exists (select 1 from public.storage_usage s join public.profiles p on p.user_id = s.owner_id
              where coalesce(p.tier, 'demo') not in ('paid', 'admin') and p.storage_quota_bytes is null
                and s.bytes_used > 5368709120) then
    raise exception '0387: a free owner is already over the new quota';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-upload-intents' and active) then
    raise exception '0387: the purge job is missing';
  end if;
end $$;

commit;
