-- 0321_ancillary_write_policies.sql
--
-- 0318 made workspace_members.role real: can_write_workspace / can_write_board
-- route membership through _workspace_member_can_write, so a workspace viewer
-- reads and never writes. Five write policies never reached those predicates.
-- They gate directly on is_workspace_member(), which 0318 deliberately left
-- role-blind because the READ side depends on it. Permissive policies OR
-- together, so through these five a viewer could still write:
--
--   doc_backlinks        "doc backlinks write"        FOR ALL    (source_workspace_id)
--   doc_page_index       "doc_page_index write"       FOR ALL    (workspace_id)
--   entity_aliases       "entity_aliases write"       FOR ALL    (workspace_id)
--   entity_ignore_terms  "entity_ignore_terms write"  FOR ALL    (workspace_id)
--   grid_layouts         "grid_layouts insert"        FOR INSERT (workspace arm)
--
-- Verified against pg_policies on the live project (2026-09-11): these are the
-- only non-SELECT policies whose expression names is_workspace_member. The
-- `boards` INSERT policy already gates on can_write_workspace(workspace_id) or
-- can_write_board(parent_board_id), and inbox_items / board_templates carry no
-- policy that names the helper at all, so none of those are touched here.
--
-- Each policy is re-created with the same name, the same command and the same
-- roles as the live row, with is_workspace_member(col) → can_write_workspace(col)
-- and nothing else. The separate READ policies ("doc backlinks read",
-- "doc_page_index read", "entity_aliases read", "entity_ignore_terms read",
-- "grid_layouts select") are untouched: they are what keeps a viewer reading
-- once the FOR ALL policies narrow (a FOR ALL policy's USING also applies to
-- SELECT, and the read policies OR in beside it). "grid_layouts update" already
-- gates its USING and its first WITH CHECK arm on can_write_workspace
-- (0265:119-135); its second WITH CHECK arm keeps an is_workspace_member AND-arm
-- that only narrows, and stays as it is.
--
-- Behaviour-neutral for the live population: workspace_members holds only
-- editor and owner rows, and for an active editor/owner/service member
-- can_write_workspace is a superset of is_workspace_member (it adds the
-- workspaces.created_by owner arm). The waitlist and _actor_active() gates the
-- predicate carries now apply to these five tables as they do everywhere else;
-- no live member is waitlist-tier or banned, so no existing user's writes move.
--
-- No function changes; no writes to parent_board_id or deleted_at.

-- ── doc_backlinks (0004:42-45) ──────────────────────────────────────────────
drop policy if exists "doc backlinks write" on public.doc_backlinks;
create policy "doc backlinks write" on public.doc_backlinks for all
  using (public.can_write_workspace(source_workspace_id))
  with check (public.can_write_workspace(source_workspace_id));

-- ── doc_page_index (0022:155-158) ───────────────────────────────────────────
drop policy if exists "doc_page_index write" on public.doc_page_index;
create policy "doc_page_index write" on public.doc_page_index for all
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));

-- ── entity_aliases (0022:104-107) ───────────────────────────────────────────
drop policy if exists "entity_aliases write" on public.entity_aliases;
create policy "entity_aliases write" on public.entity_aliases for all
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));

-- ── entity_ignore_terms (0022:130-133) ──────────────────────────────────────
drop policy if exists "entity_ignore_terms write" on public.entity_ignore_terms;
create policy "entity_ignore_terms write" on public.entity_ignore_terms for all
  using (public.can_write_workspace(workspace_id))
  with check (public.can_write_workspace(workspace_id));

-- ── grid_layouts insert (0265:102-111), identical but for the helper ────────
drop policy if exists "grid_layouts insert" on public.grid_layouts;
create policy "grid_layouts insert"
  on public.grid_layouts for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      scope = 'user'
      or (workspace_id is not null and public.can_write_workspace(workspace_id))
    )
  );

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  -- (1) no write policy on the five tables still gates on is_workspace_member,
  --     except the narrowing AND-arm inside "grid_layouts update"
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('doc_backlinks', 'doc_page_index', 'entity_aliases', 'entity_ignore_terms', 'grid_layouts')
     and cmd <> 'SELECT'
     and not (tablename = 'grid_layouts' and policyname = 'grid_layouts update')
     and (coalesce(qual, '') ilike '%is_workspace_member%'
          or coalesce(with_check, '') ilike '%is_workspace_member%');
  if v_n > 0 then
    raise exception '0321: % write policies still gate on the role-blind is_workspace_member', v_n;
  end if;

  -- (2) the read policies that keep viewers reading survived
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and cmd = 'SELECT'
     and tablename in ('doc_backlinks', 'doc_page_index', 'entity_aliases', 'entity_ignore_terms', 'grid_layouts')
     and policyname in ('doc backlinks read', 'doc_page_index read', 'entity_aliases read',
                        'entity_ignore_terms read', 'grid_layouts select');
  if v_n <> 5 then
    raise exception '0321: expected the 5 read policies to survive, found %', v_n;
  end if;

  -- (3) the five rewritten policies exist and check can_write_workspace
  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('doc_backlinks', 'doc_page_index', 'entity_aliases', 'entity_ignore_terms', 'grid_layouts')
     and policyname in ('doc backlinks write', 'doc_page_index write', 'entity_aliases write',
                        'entity_ignore_terms write', 'grid_layouts insert')
     and coalesce(with_check, '') ilike '%can_write_workspace%';
  if v_n <> 5 then
    raise exception '0321: expected 5 write policies on can_write_workspace, found %', v_n;
  end if;
end $$;
