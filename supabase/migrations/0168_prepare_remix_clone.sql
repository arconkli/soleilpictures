-- 0168 — prepare_remix: clone a PUBLICLY shared board into a signed-in user's
-- own (fresh) board. Powers the "Make a copy / Remix this board" viral loop on
-- the /share and /c/ viewers: a viewer becomes a creator who owns a near-finished
-- board (and a new shareable artifact).
--
-- Mirrors prepare_showcase (the proven onboarding-clone), but the source is a
-- VALIDATED PUBLIC board (a live share token via _resolve_share_target, or a
-- published /c/ slug via _resolve_published_board) instead of the single
-- hard-coded showcase board. Authorizes on the DESTINATION board (the caller's
-- own, fresh board) via can_write_board, then grants that board cross-workspace
-- read on the source images (referenced_in_board_ids — same model as
-- prepare_showcase; also protects them from the R2 orphan sweep) and returns the
-- source Y.Doc snapshot. The client decodes self-contained cards (note/image/
-- palette/shape/link — sub-boards flatten away) as GENUINE cards so the first
-- edit counts as activation.
--
-- Applied to PROD via Supabase MCP (`prepare_remix_clone`). Dry-run verified:
-- valid token -> source+snapshot+name + image grant; invalid token/slug -> null.
create or replace function public.prepare_remix(p_token uuid, p_slug text, p_dest_board uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_src uuid;
  v_snapshot text;
  v_name text;
begin
  -- Caller must own/write the destination board (their own fresh board).
  if not can_write_board(p_dest_board) then
    return jsonb_build_object('snapshot', null, 'source', null, 'name', null);
  end if;

  -- Resolve + validate the PUBLIC source. Token path reuses the share-link
  -- validation (active, not expired/revoked) — which RAISES on invalid, so we
  -- catch and degrade to null. Slug path uses the published-board gate.
  if p_token is not null then
    begin
      select t.root_id into v_src from public._resolve_share_target(p_token, null) t;
    exception when others then
      v_src := null;
    end;
  elsif p_slug is not null then
    v_src := public._resolve_published_board(p_slug);
  end if;

  if v_src is null then
    return jsonb_build_object('snapshot', null, 'source', null, 'name', null);
  end if;

  -- Grant the destination board cross-workspace read on the source's images.
  -- Scoped to the validated source board only; the source is already publicly
  -- viewable, so this is no escalation.
  update public.images i
     set referenced_in_board_ids = array_append(i.referenced_in_board_ids, p_dest_board)
   where i.deleted_at is null
     and (i.board_id = v_src or v_src = any(i.referenced_in_board_ids))
     and not (p_dest_board = any(i.referenced_in_board_ids));

  select doc into v_snapshot from public.board_state where board_id = v_src;
  select name into v_name from public.boards where id = v_src;

  return jsonb_build_object('snapshot', v_snapshot, 'source', v_src, 'name', v_name);
end;
$$;
revoke all on function public.prepare_remix(uuid, text, uuid) from public;
grant execute on function public.prepare_remix(uuid, text, uuid) to authenticated;
