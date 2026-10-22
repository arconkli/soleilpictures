-- 0610_uploads_reserve_their_owners_space.sql
--
-- An upload reserves its bytes in the storage of the workspace it is filed
-- under, at the moment it is recorded.
--
-- record_upload_intent is the step every upload path takes before a key leaves
-- the upload server (a single PUT, a multipart upload, a copy into a cluster).
-- Until now it only wrote the intent; the space was checked one call earlier
-- (authorize_upload / authorize_image_upload), so:
--   * two uploads checked at the same moment could both fit into the same
--     remaining space, since neither had recorded its intent when the other
--     looked;
--   * the earlier check could ask about a different owner than the one whose
--     storage the bytes land in (a cluster's owner, while the key was filed
--     under the uploader's own workspace).
-- Now the intent is recorded only if it fits the storage of the owner of the
-- key's workspace — the owner whose drive the bytes fill — and the check and
-- the insert happen under one lock per owner, so concurrent uploads queue for
-- the space instead of all seeing it free. The formula is authorize_upload's
-- (used + pending + this upload <= quota), so an upload that passed the earlier
-- check and isn't racing anything is recorded exactly as before. A refusal is
-- the existing false answer, which the upload server already turns into "could
-- not reserve this upload".
--
-- Re-emitted from the live body (0387, prosrc md5 ad835e5bd5045b3a94c195350240ad7b)
-- with the lines marked 0610 and nothing else changed.

create or replace function public.record_upload_intent(p_key text, p_bytes bigint, p_kind text, p_board_id uuid default null::uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ws uuid;
  v_n  integer;
  v_owner uuid;   -- 0610
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
  -- 0610: the bytes fill the drive of the key's workspace's owner. Check it and
  -- record the intent under one lock per owner, so two uploads can't both
  -- claim the same free space.
  select created_by into v_owner from public.workspaces where id = v_ws;
  if v_owner is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('soleil.upload_space:' || v_owner::text, 0));
  if public._storage_used_bytes(v_owner) + public._storage_pending_bytes(v_owner) + p_bytes
       > public._storage_quota_bytes(v_owner) then
    return false;
  end if;
  insert into public.upload_intents (storage_key, workspace_id, bytes, kind, created_by)
  values (p_key, v_ws, p_bytes, p_kind, auth.uid())
  on conflict (storage_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$function$;

-- The 0311 habit: prove the grants, don't trust them. CREATE OR REPLACE keeps
-- the existing ACL; this proves it is still signed-in only.
do $$
begin
  if has_function_privilege('anon', 'public.record_upload_intent(text,bigint,text,uuid)', 'EXECUTE') then
    raise exception '0610: record_upload_intent is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.record_upload_intent(text,bigint,text,uuid)', 'EXECUTE') then
    raise exception '0610: record_upload_intent lost its signed-in grant';
  end if;
  if (select provolatile from pg_proc where oid = 'public.record_upload_intent(text,bigint,text,uuid)'::regprocedure) <> 'v' then
    raise exception '0610: record_upload_intent must be volatile, so its space check sees intents committed while it waited for the lock';
  end if;
end $$;
