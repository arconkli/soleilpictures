-- 0367 — file TYPES open on the free plan; SIZE stays Creator's (owner's
-- decision, product-education pass 2026-10-06).
--
-- Until now a free owner's .psd, .zip or .docx bounced off the canvas with a
-- storage pitch: fileIngest.js routed every non-media type to 'blocked' and
-- authorize_upload() below refused any multipart upload from a demo-tier
-- owner, whatever its size. The gate had fired a handful of times in the
-- product's life, and it made "keep all your files here" untrue for everyone
-- on free. So the type is opened and the size kept: a demo owner may upload
-- any file up to FREE_FILE_CAP (boards/src/lib/fileIngest.js — 50 MB, the
-- same ceiling as a free PDF), and past it the refusal stays owner_not_paid,
-- which is what the client already maps to the Creator offer.
--
-- One number, pinned in two places: fileGateMigration.test.mjs asserts that
-- the byte count below equals FREE_FILE_CAP, so the client's classifier and
-- the server's gate cannot drift apart.
--
-- Same signature, create or replace: the ACL stays what 0318 left (the party
-- upload server calls this as the user). 0318's own property — no
-- is_workspace_member OR — is kept; roleCheck.test.mjs still reads the latest
-- definition for it.

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

  v_used := public._storage_used_bytes(v_owner);

  return query select (v_used + v_bytes <= v_quota), v_used, v_quota,
                      greatest(0, v_quota - v_used),
                      (case when (v_used + v_bytes <= v_quota) then 'ok' else 'over_quota' end)::text;
end $$;

comment on function public.authorize_upload(uuid, bigint) is
  'May this writer upload p_bytes to this workspace? A demo-tier OWNER is allowed '
  'up to the free file cap (52428800 = fileIngest.js FREE_FILE_CAP, 0367); past it '
  'owner_not_paid, which the client maps to the Creator offer. Then the storage quota.';

-- Proof (0311 habit): the grants are exactly what 0318 left — unchanged.
do $proof$
begin
  if not has_function_privilege('authenticated', 'public.authorize_upload(uuid, bigint)', 'execute') then
    raise exception 'authorize_upload is not executable by authenticated';
  end if;
  if pg_get_functiondef('public.authorize_upload(uuid, bigint)'::regprocedure) ilike '%is_workspace_member%' then
    raise exception 'authorize_upload must not OR is_workspace_member back in (0318)';
  end if;
end $proof$;
