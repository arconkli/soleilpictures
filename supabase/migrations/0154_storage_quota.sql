-- 0154_storage_quota.sql
-- Account-level storage quota for the "upload any file type" feature.
--
-- Paid accounts (profiles.tier in ('paid','admin')) get a config-tunable quota
-- (default 100 GiB) of total LIVE R2 bytes, summed across every workspace they
-- OWN (workspaces.created_by). Enforced at upload time by the PartyKit upload
-- party via authorize_upload(); surfaced to the client by my_storage_usage().
-- "Buy more storage" is a later phase — this ships a single fixed quota.
--
-- Why owner-keyed: storage belongs to the workspace owner, so the gate keys on
-- the owner's plan + the owner's aggregate, not the (possibly free) collaborator
-- who clicks upload in a shared workspace.

-- 1. Covering index so the cross-workspace SUM(size_bytes) is an index-only scan.
--    Partial on the alive set (matches the WHERE in both RPCs below).
create index if not exists images_ws_size_alive_idx
  on public.images (workspace_id) include (size_bytes)
  where deleted_at is null;

-- 2. Config row: default quota = 100 GiB. Tunable with no redeploy
--    (mirrors app_config.waitlist_enabled / ad_instant_demo).
insert into public.app_config (key, value, updated_at)
  values ('storage_quota_bytes', jsonb_build_object('bytes', 107374182400::bigint), now())
  on conflict (key) do nothing;

-- Read the configured quota in bytes, defaulting to 100 GiB. SECURITY DEFINER so
-- ordinary users can read it (app_config RLS is admin-only).
create or replace function public._storage_quota_bytes()
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (value->>'bytes')::bigint from public.app_config where key = 'storage_quota_bytes'),
    107374182400
  );
$$;
revoke all on function public._storage_quota_bytes() from public;
grant execute on function public._storage_quota_bytes() to authenticated;

-- 3. authorize_upload — the server-side gate the upload party calls before
--    minting a multipart session. The party forwards the user's JWT, so
--    auth.uid() is the uploader and can_write_workspace/is_workspace_member work
--    normally even under SECURITY DEFINER. Gates on the OWNER's tier and the
--    OWNER's aggregate live bytes across all workspaces they own.
create or replace function public.authorize_upload(p_workspace_id uuid, p_bytes bigint)
returns table(allow boolean, used bigint, quota bigint, remaining bigint, reason text)
language plpgsql stable security definer set search_path = public as $$
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

  -- Caller must be a writer of this workspace (defense in depth; the party also
  -- checks can_write_board for the specific board).
  if not (public.can_write_workspace(p_workspace_id) or public.is_workspace_member(p_workspace_id)) then
    return query select false, 0::bigint, 0::bigint, 0::bigint, 'not_writer'::text; return;
  end if;

  v_quota := public._storage_quota_bytes();

  select coalesce(tier, 'demo') into v_owner_tier from public.profiles where user_id = v_owner;
  if coalesce(v_owner_tier, 'demo') not in ('paid', 'admin') then
    return query select false, 0::bigint, v_quota, 0::bigint, 'owner_not_paid'::text; return;
  end if;

  select coalesce(sum(i.size_bytes), 0) into v_used
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
   where w.created_by = v_owner and i.deleted_at is null;

  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      greatest(0, v_quota - v_used),
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end;
$$;
revoke all on function public.authorize_upload(uuid, bigint) from public;
grant execute on function public.authorize_upload(uuid, bigint) to authenticated;

-- 4. my_storage_usage — caller-facing meter. Sums live bytes across the caller's
--    OWNED workspaces; returns the quota + whether the caller is on a paid plan.
create or replace function public.my_storage_usage()
returns table(used bigint, quota bigint, remaining bigint, is_paid boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_used bigint;
  v_quota bigint := public._storage_quota_bytes();
  v_tier text;
begin
  select coalesce(sum(i.size_bytes), 0) into v_used
    from public.images i
    join public.workspaces w on w.id = i.workspace_id
   where w.created_by = auth.uid() and i.deleted_at is null;
  select coalesce(tier, 'demo') into v_tier from public.profiles where user_id = auth.uid();
  return query select coalesce(v_used, 0), v_quota, greatest(0, v_quota - coalesce(v_used, 0)),
                      coalesce(v_tier, 'demo') in ('paid', 'admin');
end;
$$;
revoke all on function public.my_storage_usage() from public;
grant execute on function public.my_storage_usage() to authenticated;

-- 5. admin setter — tune the quota without a redeploy (mirrors
--    admin_set_waitlist_enabled). Admin-only via _require_admin().
create or replace function public.admin_set_storage_quota_bytes(p_bytes bigint)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_bytes bigint := greatest(0, coalesce(p_bytes, 107374182400));
begin
  perform public._require_admin();
  insert into public.app_config (key, value, updated_at)
    values ('storage_quota_bytes', jsonb_build_object('bytes', v_bytes), now())
  on conflict (key) do update
    set value = jsonb_build_object('bytes', v_bytes), updated_at = now();
  return v_bytes;
end;
$$;
revoke all on function public.admin_set_storage_quota_bytes(bigint) from public;
grant execute on function public.admin_set_storage_quota_bytes(bigint) to authenticated;
