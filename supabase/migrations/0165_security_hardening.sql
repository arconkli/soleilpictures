-- 0165_security_hardening.sql — close two pre-existing live-prod security holes
-- surfaced by the 2026-06-22 production-readiness audit, plus the search_path
-- companion hardening. Applied to prod via the Supabase MCP (apply_migration);
-- this file is the repo record (local CLI is the wrong account — see memory).
--
-- A. STORAGE LIST DE-ENUMERATION (cross-tenant file leak)
--    Buckets board-images and message-attachments are public=true with blanket
--    SELECT policies granted to PUBLIC (anon+authenticated) and no path/owner
--    predicate, so ANY logged-out user could LIST + download every file across
--    all workspaces (message-attachments = private chat files). The buckets
--    stay public (object GET-by-key bypasses RLS and the app depends on it for
--    <img>/PDF rendering — verified the client only does GET-by-key, 0 .list()/
--    createSignedUrl). We replace the blanket SELECT (LIST) policies with
--    membership-scoped, authenticated-only ones: anon can no longer LIST at all,
--    and an authenticated user can only LIST files in workspaces they belong to.
--    Key shape is `${workspaceId}/...` for both buckets, so folder[1]=workspaceId.
--    The uuid-regex CASE guard avoids a cast error on any malformed legacy key
--    (a non-uuid prefix yields NULL -> is_workspace_member(NULL)=false -> not
--    listable, still GET-able).
--
-- B. IDOR AUTHZ GUARDS on the directly-client-called soft-delete/restore RPCs.
--    These SECURITY DEFINER fns had a bare `UPDATE ... WHERE id=p_id` with NO
--    ownership check while being EXECUTE-granted to anon/authenticated, so any
--    logged-in user could delete/restore ANY board or comment by UUID, bypassing
--    the boards/comments RLS. We add a guard that mirrors the table RLS (the
--    helpers already exist and are tier-aware). The client calls these as the
--    user (auth.uid() is the caller) with an RLS-enforced UPDATE fallback, and
--    no service-role/edge/cron caller exists — verified — so the guard is safe.
--
-- C. IDOR LOCKDOWN on the edge-fn-only restore RPCs. perform_board_restore /
--    perform_workspace_rewind / workspace_rewind_preview / *_from_legacy are
--    reached ONLY via the ownership-gated workspace-rewind edge function using
--    the service role (or are dead) — the client never rpc()s them. We REVOKE
--    direct anon/authenticated EXECUTE so the edge fn's owner check can't be
--    bypassed by calling the RPC directly. The internal
--    perform_workspace_rewind -> perform_board_restore call runs as the definer
--    (postgres), which keeps EXECUTE, so it is unaffected.
--
-- D. search_path COMPANION: pin SET search_path on every SECURITY DEFINER fn in
--    public that lacked it (function_search_path_mutable). Uses `public,
--    extensions` because perform_board_restore/_rewind call digest()/
--    uuid_generate_v5() which live in the extensions schema (bare `public`
--    would break them).

-- ============================================================================
-- A. Storage LIST de-enumeration
-- ============================================================================
drop policy if exists "msg-att read" on storage.objects;
create policy "msg-att read" on storage.objects for select to authenticated
using (
  bucket_id = 'message-attachments'
  and public.is_workspace_member(
    case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
         then ((storage.foldername(name))[1])::uuid end
  )
);

drop policy if exists "board-images public read" on storage.objects;
create policy "board-images read" on storage.objects for select to authenticated
using (
  bucket_id = 'board-images'
  and public.is_workspace_member(
    case when (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'
         then ((storage.foldername(name))[1])::uuid end
  )
);

-- ============================================================================
-- B. IDOR authz guards on directly-client-called RPCs
-- ============================================================================
create or replace function public.soft_delete_board(p_board_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $function$
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to delete board %', p_board_id using errcode = '42501';
  end if;
  update boards set deleted_at = now(), updated_at = now()
    where id = p_board_id and deleted_at is null;
end;
$function$;

create or replace function public.restore_board(p_board_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $function$
begin
  if not public.can_write_board(p_board_id) then
    raise exception 'not authorized to restore board %', p_board_id using errcode = '42501';
  end if;
  update boards set deleted_at = null, updated_at = now()
    where id = p_board_id and deleted_at is not null;
end;
$function$;

create or replace function public.soft_delete_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $function$
declare v_board_id uuid; v_author uuid;
begin
  select board_id, author into v_board_id, v_author from comments where id = p_comment_id;
  if v_board_id is null then return; end if;  -- not found: no-op (matches old WHERE-miss)
  if not (v_author = auth.uid() or public.can_write_board(v_board_id)) then
    raise exception 'not authorized to delete comment %', p_comment_id using errcode = '42501';
  end if;
  update comments set deleted_at = now(), updated_at = now()
    where id = p_comment_id and deleted_at is null;
end;
$function$;

create or replace function public.restore_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $function$
declare v_board_id uuid; v_author uuid;
begin
  select board_id, author into v_board_id, v_author from comments where id = p_comment_id;
  if v_board_id is null then return; end if;
  if not (v_author = auth.uid() or public.can_write_board(v_board_id)) then
    raise exception 'not authorized to restore comment %', p_comment_id using errcode = '42501';
  end if;
  update comments set deleted_at = null, updated_at = now()
    where id = p_comment_id and deleted_at is not null;
end;
$function$;

-- ============================================================================
-- C. IDOR lockdown on edge-fn-only restore RPCs (revoke direct client EXECUTE)
-- ============================================================================
revoke execute on function public.perform_board_restore(uuid, bigint, uuid, text, uuid) from anon, authenticated, public;
revoke execute on function public.perform_workspace_rewind(uuid, jsonb, uuid, text, uuid) from anon, authenticated, public;
revoke execute on function public.workspace_rewind_preview(uuid, timestamptz) from anon, authenticated, public;
revoke execute on function public.perform_board_restore_from_legacy(uuid, uuid, uuid, text, uuid) from anon, authenticated, public;

alter function public.perform_board_restore(uuid, bigint, uuid, text, uuid) set search_path = public, extensions;
alter function public.perform_workspace_rewind(uuid, jsonb, uuid, text, uuid) set search_path = public, extensions;
alter function public.workspace_rewind_preview(uuid, timestamptz) set search_path = public, extensions;
alter function public.perform_board_restore_from_legacy(uuid, uuid, uuid, text, uuid) set search_path = public, extensions;

-- ============================================================================
-- D. search_path companion on the remaining definer fns that lacked it
-- ============================================================================
alter function public.advance_board_latest_seq(uuid, bigint) set search_path = public, extensions;
alter function public.append_board_op(uuid, uuid, text, uuid, text, text, text[], text[], text, text) set search_path = public, extensions;
alter function public.board_op_density(uuid, timestamptz, timestamptz, integer) set search_path = public, extensions;
alter function public.bump_board_state_version(uuid, bigint, bigint) set search_path = public, extensions;
alter function public.commit_op_batch(uuid, text, text, bigint, bigint, timestamptz, timestamptz, integer, uuid[], text[], text) set search_path = public, extensions;
alter function public.compaction_job1_candidates() set search_path = public, extensions;
alter function public.compaction_job1_dryrun() set search_path = public, extensions;
alter function public.delete_image_rows(uuid[]) set search_path = public, extensions;
alter function public.ensure_board_state_version_row() set search_path = public, extensions;
alter function public.fetch_ops_for_compaction(uuid, timestamptz, timestamptz, integer) set search_path = public, extensions;
alter function public.find_history_safe_orphan_images(integer, boolean) set search_path = public, extensions;
alter function public.find_orphan_images(integer) set search_path = public, extensions;
alter function public.mark_image_rows_swept(uuid[]) set search_path = public, extensions;
alter function public.prune_all_board_versions() set search_path = public, extensions;
alter function public.prune_board_versions(uuid) set search_path = public, extensions;
alter function public.purge_old_deleted_boards() set search_path = public, extensions;
alter function public.purge_old_deleted_comments() set search_path = public, extensions;
alter function public.record_r2_sweep_audit(uuid, jsonb) set search_path = public, extensions;
