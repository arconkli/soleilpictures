-- 0317_workspace_board_link_grants.sql
--
-- Three grant holes the organization layer (Phase 1) would inherit on day one.
--
-- 1. workspaces.created_by is the whole owner concept (0009, 0013, 0015, 0086:
--    every owner check is `created_by <> auth.uid()`), and the 0047 UPDATE policy
--    is row-scoped on membership with role in ('editor','owner') — which is every
--    member the UI can create (ShareModal hard-codes role:'editor'). There is no
--    grant or revoke on workspaces in any migration, so Supabase's table-level
--    UPDATE grant lets such a member `patch workspaces set created_by = me` via
--    PostgREST and inherit every owner-gated RPC. Same class as 0091 (profiles)
--    and 0238/0247 (boards), which replaced the table grant with a column list.
--    The only client write is boardsApi.js:100 `.update({ name })`; settings go
--    through merge_workspace_settings (SECURITY DEFINER), as do transfer_workspace_
--    ownership and prepare_account_deletion, so column grants do not touch them.
--
-- 2. boards: 0247's 18-column list still includes id, workspace_id and created_by.
--    The boards UPDATE policy (0118) never compares OLD to NEW workspace_id, so a
--    member of two workspaces can PATCH a board across the boundary, bypassing
--    move_boards_under and the same-workspace assumption list_shared_boards
--    relies on. Nothing client-side PATCHes those three columns.
--
-- 3. public_share_links: the 0018 policy is FOR ALL for the workspace owner, so an
--    owner can insert, re-point, un-revoke or flip allow_indexing on link rows
--    through PostgREST, around anything the link RPCs enforce. Phase 2 puts
--    organization sharing policy inside those RPCs; that is only a control if the
--    table is not client-writable. No client code reads or writes the table.
--
-- Also formalises workspaces.ai_tagger_enabled, which exists on the live table
-- (read by useAiTagger.js:214) with no migration file — one of the ~53 applied
-- migrations that have none. No default is stated so the live default is kept.

-- ── 0. Drift ────────────────────────────────────────────────────────────────
alter table public.workspaces
  add column if not exists ai_tagger_enabled boolean;

-- ── 1. workspaces: table grant → column list ─────────────────────────────────
revoke update on public.workspaces from anon, authenticated;
grant update (name, settings) on public.workspaces to authenticated;

-- ── 2. boards: 0247's list minus id, workspace_id, created_by ───────────────
revoke update on public.boards from authenticated, anon;
grant update (
  parent_board_id, name, view, cover, meta,
  created_at, updated_at, bg_color, deleted_at, thumb_key, thumb_updated_at,
  card_count, thumb_version, thumb_custom, day_types
) on public.boards to authenticated, anon;

-- ── 3. public_share_links: read-only to clients ─────────────────────────────
revoke insert, update, delete on public.public_share_links from anon, authenticated;
drop policy if exists "public_links manage by owner" on public.public_share_links;
create policy "public_links read by owner" on public.public_share_links
  for select using (
    exists (
      select 1 from public.boards b join public.workspaces w on w.id = b.workspace_id
      where b.id = board_id and w.created_by = auth.uid()
    )
  );

-- ── Post-conditions (the 0311 habit: a grant change that did not take is worse
--    than one that was never attempted) ───────────────────────────────────────
do $$
begin
  if has_column_privilege('authenticated', 'public.workspaces', 'created_by', 'update') then
    raise exception 'authenticated can still update workspaces.created_by';
  end if;
  if not has_column_privilege('authenticated', 'public.workspaces', 'name', 'update') then
    raise exception 'authenticated lost UPDATE on workspaces.name — renames would break';
  end if;
  if not has_column_privilege('authenticated', 'public.workspaces', 'settings', 'update') then
    raise exception 'authenticated lost UPDATE on workspaces.settings';
  end if;
  if has_column_privilege('authenticated', 'public.boards', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.boards', 'created_by', 'update')
     or has_column_privilege('authenticated', 'public.boards', 'id', 'update') then
    raise exception 'authenticated can still update boards.id/workspace_id/created_by';
  end if;
  if not has_column_privilege('authenticated', 'public.boards', 'day_types', 'update') then
    raise exception 'authenticated lost UPDATE on boards.day_types (0247 granted it)';
  end if;
  if has_table_privilege('authenticated', 'public.public_share_links', 'update')
     or has_table_privilege('authenticated', 'public.public_share_links', 'insert')
     or has_table_privilege('authenticated', 'public.public_share_links', 'delete') then
    raise exception 'authenticated can still write public_share_links';
  end if;
  -- the revokes above name anon too; prove that half as well
  if has_column_privilege('anon', 'public.workspaces', 'created_by', 'update') then
    raise exception 'anon can still update workspaces.created_by';
  end if;
  if has_table_privilege('anon', 'public.workspaces', 'update') then
    raise exception 'anon still holds a table-level UPDATE on workspaces';
  end if;
  if has_table_privilege('anon', 'public.public_share_links', 'update')
     or has_table_privilege('anon', 'public.public_share_links', 'insert')
     or has_table_privilege('anon', 'public.public_share_links', 'delete') then
    raise exception 'anon can still write public_share_links';
  end if;
end $$;
