-- 0413 — The new storage limits: free files of any size, Creator's 1TB drive,
-- and a trial drive until the first payment.
--
-- Owner decisions, 2026-10-17:
--   • Free stops at its card cap OR its storage, whichever comes first, and —
--     since storage is now a real limit — takes any file at any size. The
--     per-file cap that used to stop a free owner's video, audio, PDF or file
--     is gone; the drive decides. (The free drive itself is unchanged.)
--   • Creator's drive grows to 1 TiB.
--   • While a Creator subscription is still in its free trial the drive is
--     the trial drive; the first payment lifts it to the full 1 TiB. A trial
--     costs a card and an email, and without this every trial is a terabyte
--     stored for as long as the account exists.
--
-- Binary units throughout, as before: a GiB is labelled "GB" and a TiB "TB"
-- (billingCopy.js FREE_STORAGE_LABEL / CREATOR_STORAGE_LABEL; gen-docs.mjs
-- checks both against the fallbacks below).
--
-- authorize_upload keeps its signature and return shape: the deployed PartyKit
-- room calls it and cannot be redeployed. It simply never answers
-- 'owner_not_paid' any more.

-- ── 1. The figures ──────────────────────────────────────────────────────────
-- The seeds in 0154 / 0387 are `on conflict do nothing`, so only an update moves
-- a live value.
insert into public.app_config (key, value, updated_at)
values ('storage_quota_bytes', jsonb_build_object('bytes', 1099511627776), now())
on conflict (key) do update set value = excluded.value, updated_at = now();

insert into public.app_config (key, value, updated_at)
values ('storage_quota_trial_bytes', jsonb_build_object('bytes', 107374182400), now())
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ── 2. Whose drive is how big ───────────────────────────────────────────────
-- The per-owner form comes FIRST in this file: tests and gen-docs read the
-- first definition of _storage_quota_bytes in the latest migration. The trial
-- drive's helper comes before both: a SQL function is checked when it is made,
-- so the one it calls has to exist first.
create or replace function public._storage_quota_trial_bytes()
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select (value->>'bytes')::bigint from public.app_config where key = 'storage_quota_trial_bytes'),
    107374182400
  );
$function$;
revoke execute on function public._storage_quota_trial_bytes() from public, anon, authenticated;

create or replace function public._storage_quota_bytes(p_owner uuid)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- An explicit per-account figure wins. Otherwise a paid or admin owner gets
  -- the drive Creator sells (storage_quota_bytes) — the trial drive while the
  -- subscription is still trialing (0413) — and a free owner gets
  -- storage_quota_free_bytes (0387, owner decision 2026-10-06).
  select coalesce(
    (select p.storage_quota_bytes from public.profiles p where p.user_id = p_owner),
    case when coalesce((select p.tier from public.profiles p where p.user_id = p_owner), 'demo') in ('paid', 'admin')
         then case when exists (select 1 from public.subscriptions s
                                 where s.user_id = p_owner and s.status = 'trialing')
                   then public._storage_quota_trial_bytes()
                   else public._storage_quota_bytes()
              end
         else public._storage_quota_free_bytes()
    end
  );
$function$;

create or replace function public._storage_quota_bytes()
 returns bigint
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select (value->>'bytes')::bigint from public.app_config where key = 'storage_quota_bytes'),
    1099511627776
  );
$function$;

create or replace function public.admin_set_storage_quota_bytes(p_bytes bigint)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bytes bigint := greatest(0, coalesce(p_bytes, 1099511627776));
begin
  perform public._require_admin();
  insert into public.app_config (key, value, updated_at)
    values ('storage_quota_bytes', jsonb_build_object('bytes', v_bytes), now())
  on conflict (key) do update
    set value = jsonb_build_object('bytes', v_bytes), updated_at = now();
  return v_bytes;
end;
$function$;

-- ── 3. Free files of any size ───────────────────────────────────────────────
create or replace function public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
 returns table(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_owner uuid;
  v_quota bigint;
  v_used bigint;
  v_bytes bigint := greatest(0, coalesce(p_bytes, 0));
begin
  select created_by into v_owner from public.workspaces where id = p_workspace_id;
  if v_owner is null then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'no_workspace'::text; return;
  end if;

  if not public.can_write_workspace(p_workspace_id) then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;

  -- The drive is the only byte limit, on every plan (0413). Uploads presigned
  -- but not yet filed count too (0387).
  v_quota := public._storage_quota_bytes(v_owner);
  v_used := public._storage_used_bytes(v_owner) + public._storage_pending_bytes(v_owner);

  if v_used + v_bytes > v_quota then
    return query select false, v_used, v_quota, greatest(0, v_quota - v_used), 'over_quota'::text; return;
  end if;

  return query select true, v_used, v_quota, greatest(0, v_quota - v_used), 'ok'::text;
end $function$;

-- ── 4. Proofs ───────────────────────────────────────────────────────────────
do $$
begin
  if public._storage_quota_bytes() <> 1099511627776 then
    raise exception '0413: the Creator drive is not 1 TiB';
  end if;
  if has_function_privilege('anon', 'public._storage_quota_trial_bytes()', 'execute')
     or has_function_privilege('authenticated', 'public._storage_quota_trial_bytes()', 'execute')
     or has_function_privilege('authenticated', 'public._storage_quota_bytes(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._storage_quota_bytes()', 'execute') then
    raise exception '0413: a storage helper is callable by a client';
  end if;
  if not has_function_privilege('authenticated', 'public.authorize_upload(uuid, bigint)', 'execute')
     or not has_function_privilege('authenticated', 'public.admin_set_storage_quota_bytes(bigint)', 'execute') then
    raise exception '0413: a re-emitted RPC lost its grant';
  end if;
  -- A trialing owner already over the trial drive would be stranded by it.
  if exists (
    select 1 from public.subscriptions s
     where s.status = 'trialing'
       and public._storage_used_bytes(s.user_id) > public._storage_quota_trial_bytes()
  ) then
    raise exception '0413: a trialing account already holds more than the trial drive';
  end if;
end $$;
