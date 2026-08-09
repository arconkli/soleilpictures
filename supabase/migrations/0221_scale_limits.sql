-- 0221_scale_limits.sql
--
-- Make the limits that /api/v1 enforces settable PER ACCOUNT, and make the
-- checks that enforce them O(1) instead of O(everything the account owns).
--
-- WHY NOW. The stress case is a studio migrating ~25TB (~3M assets) with their
-- own program. Nothing here sells that or prices it — this migration only makes
-- sure the mechanisms exist and are proven, so the enterprise tier that arrives
-- later sets numbers rather than rebuilding the write path. Every default is
-- unchanged, so nothing moves for any account that exists today.
--
-- Four things:
--
--   1. A per-owner storage quota override. Today _storage_quota_bytes() reads
--      ONE app_config row (100GB) that applies to everybody, and
--      admin_set_storage_quota_bytes moves it for everybody at once. There is no
--      way to give one account a different number.
--
--   2. A storage rollup, because the quota CHECK does not scale. Both
--      authorize_upload and authorize_image_upload compute
--      sum(images.size_bytes) across every workspace the owner has, on EVERY
--      upload. EXPLAIN on production confirms an index-only scan over
--      images_ws_size_alive_idx — which is fine at 7,143 rows and is a scan of
--      millions of index entries per upload at 3M. Uploading N objects costs
--      O(N^2). A maintained counter turns each check into a single-row read.
--
--   3. A per-token request limit. api_token_resolve hard-codes
--      `v_limit constant integer := 1000` per hour. 3M objects at 1000/hour is
--      four months of wall clock.
--
--   4. A single-flight API session. api_sessions holds ONE refresh token per
--      user and the Worker caches an access token per ISOLATE, so N cold
--      isolates all refresh the same single-use token concurrently. The losers
--      fall back to minting a magiclink, and refresh-token reuse detection can
--      revoke the whole family — which has already happened in this project once
--      (the nightly staging handoff that forced every user back through OTP).
--      Caching the access token itself, with a claim so exactly one caller
--      refreshes, collapses that to one refresh per hour per user at any
--      concurrency.

-----------------------------------------------------------------------
-- 1. Per-owner storage quota override
--
-- On profiles rather than a new table: quota is keyed to the WORKSPACE OWNER
-- (board_workspace_owner → a user), which is exactly what profiles is keyed on,
-- and every caller already has the owner in hand. NULL means "use the global",
-- so this column is invisible until somebody sets it.
-----------------------------------------------------------------------
alter table public.profiles
  add column if not exists storage_quota_bytes bigint;

comment on column public.profiles.storage_quota_bytes is
  'Per-account storage ceiling in bytes. NULL = use the global app_config '
  'storage_quota_bytes. Set this for an enterprise account; do not move the '
  'global, which applies to everyone.';

-- Owner-aware quota. The no-argument form is KEPT and unchanged, because
-- admin_storage_stats, my_storage_usage and three admin RPCs call it to mean
-- "the default", and they are asking a different question than "what is this
-- account allowed".
create or replace function public._storage_quota_bytes(p_owner uuid)
returns bigint
language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select p.storage_quota_bytes from public.profiles p where p.user_id = p_owner),
    public._storage_quota_bytes()
  );
$$;
revoke all on function public._storage_quota_bytes(uuid) from public;
grant execute on function public._storage_quota_bytes(uuid) to authenticated;

-----------------------------------------------------------------------
-- 2. storage_usage — a maintained per-owner rollup
--
-- One row per workspace owner. Every quota check reads exactly one row instead
-- of aggregating the images table.
--
-- Correctness posture: this is a CACHE of a value that is always recomputable
-- from images, so it is seeded from truth below, reconciled by
-- reconcile_storage_usage() (scheduled nightly), and every reader falls back to
-- the live aggregate when no row exists. A counter that can drift silently
-- would be a way to give somebody unlimited storage, so it never gets to be the
-- only copy of the number.
-----------------------------------------------------------------------
create table if not exists public.storage_usage (
  owner_id     uuid primary key references auth.users(id) on delete cascade,
  bytes_used   bigint not null default 0,
  object_count bigint not null default 0,
  updated_at   timestamptz not null default now()
);

-- Same posture as api_tokens: RLS on with NO policies, and grants revoked, so
-- the only way in is through a SECURITY DEFINER function. A client-writable
-- storage counter is a client-writable storage quota.
alter table public.storage_usage enable row level security;
revoke all on table public.storage_usage from anon, authenticated;

-- The owner of the workspace an image belongs to. STABLE so the trigger can
-- call it once per row without re-planning.
create or replace function public._image_owner(p_workspace_id uuid)
returns uuid
language sql stable security definer
set search_path = public as $$
  select w.created_by from public.workspaces w where w.id = p_workspace_id;
$$;
revoke all on function public._image_owner(uuid) from public;

-- Apply a delta to an owner's rollup. Upserts, so an owner with no row yet gets
-- one at their first upload.
create or replace function public._storage_usage_apply(
  p_owner uuid, p_bytes bigint, p_objects bigint
)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  if p_owner is null or (coalesce(p_bytes, 0) = 0 and coalesce(p_objects, 0) = 0) then
    return;
  end if;
  insert into public.storage_usage as s (owner_id, bytes_used, object_count, updated_at)
  values (p_owner, greatest(0, coalesce(p_bytes, 0)), greatest(0, coalesce(p_objects, 0)), now())
  on conflict (owner_id) do update
    set bytes_used   = greatest(0, s.bytes_used + coalesce(p_bytes, 0)),
        object_count = greatest(0, s.object_count + coalesce(p_objects, 0)),
        updated_at   = now();
end $$;
revoke all on function public._storage_usage_apply(uuid, bigint, bigint) from public;

-- Maintain the rollup on every images mutation.
--
-- "Alive" is the same predicate the quota aggregate uses (deleted_at is null),
-- so a soft delete decrements and an undelete increments. The UPDATE branch
-- handles a row moving between workspaces (and therefore between owners),
-- because images.workspace_id is not immutable.
create or replace function public.storage_usage_trg()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_old_owner uuid;
  v_new_owner uuid;
  v_old_alive boolean;
  v_new_alive boolean;
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is null then
      perform public._storage_usage_apply(
        public._image_owner(new.workspace_id), coalesce(new.size_bytes, 0), 1);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.deleted_at is null then
      perform public._storage_usage_apply(
        public._image_owner(old.workspace_id), -coalesce(old.size_bytes, 0), -1);
    end if;
    return old;
  end if;

  -- UPDATE. Back out the old contribution, add the new one. Doing it as two
  -- deltas rather than a diff keeps the workspace-moved case correct without a
  -- special branch.
  v_old_alive := old.deleted_at is null;
  v_new_alive := new.deleted_at is null;
  v_old_owner := public._image_owner(old.workspace_id);
  v_new_owner := public._image_owner(new.workspace_id);

  if v_old_alive then
    perform public._storage_usage_apply(v_old_owner, -coalesce(old.size_bytes, 0), -1);
  end if;
  if v_new_alive then
    perform public._storage_usage_apply(v_new_owner, coalesce(new.size_bytes, 0), 1);
  end if;
  return new;
end $$;
revoke all on function public.storage_usage_trg() from public;

drop trigger if exists storage_usage_maintain on public.images;
create trigger storage_usage_maintain
  after insert or update or delete on public.images
  for each row execute function public.storage_usage_trg();

-- Recompute every owner's rollup from the images table. The counter is only
-- ever a cache; this is what makes that claim true. Scheduled nightly below.
create or replace function public.reconcile_storage_usage()
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  v_rows integer;
begin
  with truth as (
    select w.created_by as owner_id,
           coalesce(sum(i.size_bytes), 0)::bigint as bytes_used,
           count(*)::bigint as object_count
      from public.images i
      join public.workspaces w on w.id = i.workspace_id
     where i.deleted_at is null and w.created_by is not null
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

  -- Owners who now hold nothing keep a row at zero rather than losing it, so
  -- "no row" unambiguously means "never computed" and the readers below can
  -- treat it as a cache miss rather than as zero bytes.
  update public.storage_usage s
     set bytes_used = 0, object_count = 0, updated_at = now()
   where not exists (
     select 1 from public.images i
       join public.workspaces w on w.id = i.workspace_id
      where w.created_by = s.owner_id and i.deleted_at is null
   ) and (s.bytes_used <> 0 or s.object_count <> 0);

  return v_rows;
end $$;
revoke all on function public.reconcile_storage_usage() from public;

-- Seed from truth, so the counter is correct the moment the trigger starts
-- maintaining it rather than counting up from zero.
select public.reconcile_storage_usage();

-- Read an owner's usage, preferring the rollup and falling back to the live
-- aggregate when there is no row yet. The fallback is what makes a missing or
-- lost counter a performance problem instead of a correctness one.
create or replace function public._storage_used_bytes(p_owner uuid)
returns bigint
language plpgsql stable security definer
set search_path = public as $$
declare
  v_used bigint;
begin
  select s.bytes_used into v_used from public.storage_usage s where s.owner_id = p_owner;
  if found then return v_used; end if;

  select coalesce(sum(i.size_bytes), 0) into v_used
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
   where w.created_by = p_owner and i.deleted_at is null;
  return coalesce(v_used, 0);
end $$;
revoke all on function public._storage_used_bytes(uuid) from public;
grant execute on function public._storage_used_bytes(uuid) to authenticated;

-----------------------------------------------------------------------
-- 3. The two upload gates, on the owner-aware quota and the rollup
--
-- Behaviour is otherwise IDENTICAL to 0154 / 0187 — same signatures, same
-- reasons, same tier rule on authorize_upload. Only the two numbers change how
-- they are obtained.
-----------------------------------------------------------------------
create or replace function public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
returns table(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
language plpgsql stable security definer
set search_path = public as $$
declare
  v_owner uuid;
  v_owner_tier text;
  v_quota bigint;
  v_used bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  select created_by into v_owner from public.workspaces where id = p_workspace_id;
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;

  if not (public.can_write_workspace(p_workspace_id) or public.is_workspace_member(p_workspace_id)) then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;

  v_quota := public._storage_quota_bytes(v_owner);

  select coalesce(tier, 'demo') into v_owner_tier from public.profiles where user_id = v_owner;
  if coalesce(v_owner_tier, 'demo') not in ('paid', 'admin') then
    return query select false, 0::bigint, v_quota, 0::bigint, 'owner_not_paid'::text; return;
  end if;

  v_used := public._storage_used_bytes(v_owner);

  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      greatest(0, v_quota - v_used),
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $$;
revoke all on function public.authorize_upload(uuid, bigint) from public;
grant execute on function public.authorize_upload(uuid, bigint) to authenticated;

create or replace function public.authorize_image_upload(p_board_id uuid, p_bytes bigint)
returns table(allow boolean, used bigint, quota bigint, reason text)
language plpgsql stable security definer
set search_path = public as $$
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
  v_used  := public._storage_used_bytes(v_owner);
  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $$;
revoke all on function public.authorize_image_upload(uuid, bigint) from public;
grant execute on function public.authorize_image_upload(uuid, bigint) to authenticated;

-- Set one account's ceiling. Deliberately separate from
-- admin_set_storage_quota_bytes, which moves the GLOBAL default — the two have
-- been confused before and the blast radius is very different.
create or replace function public.admin_set_account_quota_bytes(p_user_id uuid, p_bytes bigint)
returns bigint
language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.profiles
     set storage_quota_bytes = case when p_bytes is null or p_bytes <= 0 then null else p_bytes end
   where user_id = p_user_id;
  return public._storage_quota_bytes(p_user_id);
end $$;
revoke all on function public.admin_set_account_quota_bytes(uuid, bigint) from public;
grant execute on function public.admin_set_account_quota_bytes(uuid, bigint) to authenticated;

-----------------------------------------------------------------------
-- 4. Per-token request limit
--
-- NULL means the 1000/hour default, so every token that exists keeps exactly
-- the budget it has today.
-----------------------------------------------------------------------
alter table public.api_tokens
  add column if not exists req_limit integer;

comment on column public.api_tokens.req_limit is
  'Requests per hour for this token. NULL = the 1000/hour default.';

-- Recreated only to read the per-token limit. Everything else — the metering
-- before the revoked/expired checks, the `a` alias that keeps req_count
-- unambiguous against the OUT parameter, the identical answer for
-- unknown/revoked/expired — is 0220's and is deliberately unchanged.
create or replace function public.api_token_resolve(p_token_hash text)
returns table(
  user_id    uuid,
  token_id   uuid,
  scopes     text[],
  reason     text,
  req_count  integer,
  req_limit  integer,
  req_reset  timestamptz
)
language plpgsql security definer
set search_path = public, auth as $$
declare
  t        public.api_tokens%rowtype;
  v_limit  integer;
  v_valid  boolean;
  v_count  integer;
  v_reset  timestamptz;
begin
  select * into t from public.api_tokens where token_hash = p_token_hash;

  if not found then
    return query select null::uuid, null::uuid, null::text[], 'unknown'::text,
                        null::integer, 1000, null::timestamptz;
    return;
  end if;

  v_limit := coalesce(t.req_limit, 1000);

  v_valid := t.revoked_at is null
             and (t.expires_at is null or t.expires_at > now());

  update public.api_tokens a
     set req_window   = case when now() - a.req_window > interval '1 hour' then now() else a.req_window end,
         req_count    = case when now() - a.req_window > interval '1 hour' then 1 else a.req_count + 1 end,
         last_used_at = case when v_valid then now() else a.last_used_at end
   where a.id = t.id
  returning a.req_count, a.req_window + interval '1 hour'
       into v_count, v_reset;

  if v_count > v_limit then
    return query select null::uuid, null::uuid, null::text[], 'rate_limited'::text,
                        v_count, v_limit, v_reset;
    return;
  end if;

  if t.revoked_at is not null then
    return query select null::uuid, null::uuid, null::text[], 'revoked'::text,
                        v_count, v_limit, v_reset;
    return;
  end if;
  if t.expires_at is not null and t.expires_at <= now() then
    return query select null::uuid, null::uuid, null::text[], 'expired'::text,
                        v_count, v_limit, v_reset;
    return;
  end if;

  return query select t.user_id, t.id, t.scopes, null::text, v_count, v_limit, v_reset;
end;
$$;
revoke all on function public.api_token_resolve(text) from public;

create or replace function public.admin_set_token_rate_limit(p_token_id uuid, p_limit integer)
returns integer
language plpgsql security definer
set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.api_tokens
     set req_limit = case when p_limit is null or p_limit <= 0 then null else p_limit end
   where id = p_token_id;
  return coalesce((select req_limit from public.api_tokens where id = p_token_id), 1000);
end $$;
revoke all on function public.admin_set_token_rate_limit(uuid, integer) from public;
grant execute on function public.admin_set_token_rate_limit(uuid, integer) to authenticated;

-----------------------------------------------------------------------
-- 5. Single-flight API sessions
--
-- api_sessions already stores the refresh token, which is strictly more
-- powerful than an access token (it mints them indefinitely), so caching the
-- access token here is not a new class of secret at rest. The table keeps its
-- posture: RLS on, no policies, grants revoked, reachable only through these
-- SECURITY DEFINER functions with the service role.
-----------------------------------------------------------------------
alter table public.api_sessions
  add column if not exists access_token text,
  add column if not exists refresh_claimed_at timestamptz;

-- Either hand back a still-valid access token, or grant EXACTLY ONE caller the
-- right to go and refresh.
--
-- The claim is what makes this single-flight. Without it, N cold Worker
-- isolates each read the same single-use refresh token and race to rotate it:
-- one wins, the rest fall back to minting a magiclink, and Supabase's reuse
-- detection can revoke the whole token family. The claim expires after 20s so a
-- caller that dies mid-refresh cannot wedge the account.
--
-- p_skew: treat a token expiring within this many seconds as already expired,
-- so a request never starts work with a token that dies mid-flight.
create or replace function public.api_session_begin(p_user_id uuid, p_skew integer default 120)
returns table(access_token text, refresh_token text, claimed boolean)
language plpgsql security definer
set search_path = public as $$
declare
  s public.api_sessions%rowtype;
  v_claim boolean := false;
begin
  select * into s from public.api_sessions a where a.user_id = p_user_id for update;

  if found
     and s.access_token is not null
     and s.access_token_exp is not null
     and s.access_token_exp > now() + make_interval(secs => greatest(0, coalesce(p_skew, 0)))
  then
    return query select s.access_token, s.refresh_token, false;
    return;
  end if;

  -- Nobody holds a live claim → this caller takes it and does the work.
  if not found then
    insert into public.api_sessions (user_id, refresh_claimed_at, updated_at)
    values (p_user_id, now(), now())
    on conflict (user_id) do update set refresh_claimed_at = now()
    returning true into v_claim;
    return query select null::text, null::text, true;
    return;
  end if;

  if s.refresh_claimed_at is null or s.refresh_claimed_at < now() - interval '20 seconds' then
    update public.api_sessions a set refresh_claimed_at = now() where a.user_id = p_user_id;
    v_claim := true;
  end if;

  -- claimed=false with a null token means "someone else is refreshing right
  -- now" — the caller should wait briefly and ask again rather than start a
  -- second rotation.
  return query select null::text, s.refresh_token, v_claim;
end $$;
revoke all on function public.api_session_begin(uuid, integer) from public;

create or replace function public.api_session_store(
  p_user_id uuid, p_access_token text, p_refresh_token text, p_expires_in integer
)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  insert into public.api_sessions as a
    (user_id, access_token, refresh_token, access_token_exp, refresh_claimed_at, updated_at)
  values (
    p_user_id, p_access_token, p_refresh_token,
    now() + make_interval(secs => greatest(60, coalesce(p_expires_in, 3600))),
    null, now()
  )
  on conflict (user_id) do update
    set access_token      = excluded.access_token,
        -- Never overwrite a good refresh token with null: a refresh response
        -- that omits one leaves the stored token still valid, and clearing it
        -- would force a magiclink mint on the next cold isolate.
        refresh_token     = coalesce(excluded.refresh_token, a.refresh_token),
        access_token_exp  = excluded.access_token_exp,
        refresh_claimed_at = null,
        updated_at        = now();
end $$;
revoke all on function public.api_session_store(uuid, text, text, integer) from public;

-- Release a claim without storing anything, so a failed refresh does not hold
-- the account hostage for the full 20s claim window.
create or replace function public.api_session_release(p_user_id uuid)
returns void
language sql security definer
set search_path = public as $$
  update public.api_sessions set refresh_claimed_at = null where user_id = p_user_id;
$$;
revoke all on function public.api_session_release(uuid) from public;

-----------------------------------------------------------------------
-- 6. Nightly reconcile
--
-- 03:55, after the two api purges 0220 scheduled (03:45 / 03:50) and before the
-- Worker's 04:00 R2 sweep.
-----------------------------------------------------------------------
do $$ begin
  perform cron.unschedule('reconcile_storage_usage');
exception when others then null;
end $$;
select cron.schedule('reconcile_storage_usage', '55 3 * * *',
                     $$ select public.reconcile_storage_usage(); $$);
