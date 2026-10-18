-- 0419 — The sidebar lists every file
--
-- The left sidebar becomes the home of everything stored in a workspace: each
-- cluster unfolds into its sub-clusters and then SHELVES of its contents
-- (Photos, Video, Audio, Files, Writing, Links, More). A cluster that is open
-- reads its own live Y.Doc; every other cluster is read from card_index, which
-- is already workspace-readable under RLS ("card_index read", 0295/0308) and
-- already in the realtime publication. This migration adds the read side the
-- sidebar needs and one table for Starred.
--
--   sidebar_shelf_of(kind)        the shelf a card kind sits on. The client twin
--                                 is SHELF_OF_KIND in boards/src/lib/sidebarShelves.js;
--                                 sidebarShelves.test.mjs reads THIS file and fails
--                                 when the two disagree.
--   sidebar_shelf_counts(ids)     per cluster and shelf: how many, and how many
--                                 are stored off the board. One call per workspace.
--   sidebar_cluster_items(...)    one cluster's items: the first N of every shelf
--                                 (the peek when a cluster unfolds), or one shelf a
--                                 page at a time ("+N more").
--   sidebar_recent(ws)            the last things added anywhere in a workspace.
--   sidebar_starred(ws)           the caller's stars, resolved to what they point at.
--   starred_items                 personal stars: a whole cluster (card_id = '') or
--                                 one card. Rows are the caller's own and nobody
--                                 else's, which RLS enforces on every command.
--
-- Every function is SECURITY INVOKER, so card_index's own read policy scopes
-- them: a cluster the caller cannot read contributes nothing, and shared
-- clusters work with no extra code. None of them is for signed-out callers.
--
-- No new indexes. card_index holds ~7k rows in total (largest workspace ~600,
-- largest cluster ~100); every query below is a board_id lookup on the primary
-- key or a workspace_id lookup on card_index_workspace_idx. Add
-- (workspace_id, created_at desc) when one workspace passes ~20k rows.
--
-- Sort keys are cast only when jsonb_typeof says the value is a number: card
-- meta is client-written, and one bad value must not fail a whole cluster.

-- ── The shelf a kind sits on ─────────────────────────────────────────────────
-- board / boardlink are clusters, not contents: the sidebar draws sub-clusters
-- from the boards table. Every kind not named lands on 'more'.
create or replace function public.sidebar_shelf_of(p_kind text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_kind = 'image' then 'photos'
    when p_kind = 'video' then 'video'
    when p_kind = 'audio' then 'audio'
    when p_kind in ('pdf', 'file') then 'files'
    when p_kind in ('note', 'doc') then 'writing'
    when p_kind = 'link' then 'links'
    when p_kind in ('board', 'boardlink') then null
    else 'more'
  end
$$;

-- ── Counts per cluster and shelf ─────────────────────────────────────────────
create or replace function public.sidebar_shelf_counts(p_board_ids uuid[])
returns table (board_id uuid, shelf text, n integer, n_unplaced integer)
language sql
stable
security invoker
set search_path = public
as $$
  select ci.board_id,
         public.sidebar_shelf_of(ci.kind) as shelf,
         count(*)::integer as n,
         (count(*) filter (where ci.meta->>'unplaced' = 'true'))::integer as n_unplaced
    from public.card_index ci
   where ci.board_id = any(coalesce(p_board_ids, '{}'::uuid[]))
     and public.sidebar_shelf_of(ci.kind) is not null
   group by ci.board_id, public.sidebar_shelf_of(ci.kind)
$$;

-- ── One cluster's items ──────────────────────────────────────────────────────
-- p_shelf null → the first p_limit of EVERY shelf; otherwise that shelf only,
-- from p_offset. p_sort: 'newest' (default) | 'name' | 'size' | 'canvas'.
-- Ties always break on created_at desc, card_id, so pages never overlap.
-- The name key is the one the sidebar shows: title, else the file's name, else
-- the start of the text (a note has no title).
create or replace function public.sidebar_cluster_items(
  p_board_id uuid,
  p_shelf    text    default null,
  p_sort     text    default 'newest',
  p_offset   integer default 0,
  p_limit    integer default 12
)
returns table (
  card_id text, kind text, shelf text, title text, snippet text,
  meta jsonb, created_at timestamptz, updated_at timestamptz, seq integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with items as (
    select ci.card_id, ci.kind, public.sidebar_shelf_of(ci.kind) as shelf,
           ci.title, left(ci.body, 160) as snippet, ci.meta, ci.created_at, ci.updated_at,
           row_number() over (
             partition by public.sidebar_shelf_of(ci.kind)
             order by
               case when p_sort = 'name' then lower(btrim(coalesce(
                 nullif(btrim(ci.title), ''),
                 nullif(btrim(ci.meta->>'fileName'), ''),
                 nullif(btrim(ci.meta->>'name'), ''),
                 left(ci.body, 120),
                 ''))) end asc nulls last,
               case when p_sort = 'size' and jsonb_typeof(ci.meta->'sizeBytes') = 'number'
                    then (ci.meta->>'sizeBytes')::numeric end desc nulls last,
               case when p_sort = 'canvas' and jsonb_typeof(ci.meta->'pos'->'y') = 'number'
                    then (ci.meta->'pos'->>'y')::numeric end asc nulls last,
               case when p_sort = 'canvas' and jsonb_typeof(ci.meta->'pos'->'x') = 'number'
                    then (ci.meta->'pos'->>'x')::numeric end asc nulls last,
               ci.created_at desc,
               ci.card_id asc
           )::integer as rn
      from public.card_index ci
     where ci.board_id = p_board_id
       and public.sidebar_shelf_of(ci.kind) is not null
       and (p_shelf is null or public.sidebar_shelf_of(ci.kind) = p_shelf)
  )
  select i.card_id, i.kind, i.shelf, i.title, i.snippet, i.meta, i.created_at, i.updated_at, i.rn
    from items i
   where i.rn > greatest(coalesce(p_offset, 0), 0)
     and i.rn <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 12), 1), 200)
   order by i.shelf, i.rn
$$;

-- ── Recently added, anywhere in the workspace ───────────────────────────────
-- Trashed clusters keep their card_index rows (restore needs them); their
-- contents must not resurface here.
create or replace function public.sidebar_recent(p_workspace_id uuid, p_limit integer default 8)
returns table (
  board_id uuid, card_id text, kind text, shelf text, title text, snippet text,
  meta jsonb, created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select ci.board_id, ci.card_id, ci.kind, public.sidebar_shelf_of(ci.kind),
         ci.title, left(ci.body, 160), ci.meta, ci.created_at
    from public.card_index ci
    join public.boards b on b.id = ci.board_id and b.deleted_at is null
   where ci.workspace_id = p_workspace_id
     and public.sidebar_shelf_of(ci.kind) is not null
   order by ci.created_at desc, ci.card_id
   limit least(greatest(coalesce(p_limit, 8), 1), 50)
$$;

-- ── Starred ──────────────────────────────────────────────────────────────────
-- card_id '' stars the cluster itself. workspace_id is the BOARD's workspace,
-- checked on insert, so a star can't claim to live somewhere it doesn't.
-- Moving a card between clusters rewrites board_id/card_id here for every user
-- (the /api/clusters move route does it with the service role).
create table if not exists public.starred_items (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  card_id      text not null default '',
  created_at   timestamptz not null default now(),
  primary key (user_id, board_id, card_id)
);
create index if not exists starred_items_user_ws_idx
  on public.starred_items (user_id, workspace_id, created_at desc);

alter table public.starred_items enable row level security;

create policy "starred_items own read" on public.starred_items
  for select
  using ( user_id = (select auth.uid()) );

create policy "starred_items own insert" on public.starred_items
  for insert
  with check (
    user_id = (select auth.uid())
    and array[starred_items.board_id] && (select public.my_readable_board_ids())
    and exists (select 1 from public.boards b
                 where b.id = starred_items.board_id
                   and b.workspace_id = starred_items.workspace_id)
  );

create policy "starred_items own remove" on public.starred_items
  for delete
  using ( user_id = (select auth.uid()) );

revoke all on table public.starred_items from public, anon, authenticated;
grant select, insert, delete on table public.starred_items to authenticated;
grant all on table public.starred_items to service_role;

-- The caller's stars in this workspace, plus stars on clusters shared with them
-- from workspaces they aren't a member of (those show in every workspace, the
-- way Shared with me does). A star whose card is gone, or whose cluster is in
-- the trash, is hidden rather than shown broken.
create or replace function public.sidebar_starred(p_workspace_id uuid)
returns table (
  board_id uuid, card_id text, kind text, shelf text, title text, snippet text,
  meta jsonb, created_at timestamptz, starred_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.board_id,
         s.card_id,
         case when s.card_id = '' then 'cluster' else ci.kind end,
         case when s.card_id = '' then null else public.sidebar_shelf_of(ci.kind) end,
         case when s.card_id = '' then b.name else ci.title end,
         left(ci.body, 160),
         ci.meta,
         coalesce(ci.created_at, b.created_at),
         s.created_at
    from public.starred_items s
    join public.boards b on b.id = s.board_id and b.deleted_at is null
    left join public.card_index ci
           on s.card_id <> '' and ci.board_id = s.board_id and ci.card_id = s.card_id
   where s.user_id = (select auth.uid())
     and (s.workspace_id = p_workspace_id
          or not (array[s.workspace_id] && (select public.my_workspace_ids())))
     and (s.card_id = '' or ci.card_id is not null)
   order by s.created_at desc
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Signed-in only. Revoked from PUBLIC as well as anon: a revoke from anon is a
-- no-op while PUBLIC still holds the grant.
revoke all on function public.sidebar_shelf_of(text) from public, anon;
revoke all on function public.sidebar_shelf_counts(uuid[]) from public, anon;
revoke all on function public.sidebar_cluster_items(uuid, text, text, integer, integer) from public, anon;
revoke all on function public.sidebar_recent(uuid, integer) from public, anon;
revoke all on function public.sidebar_starred(uuid) from public, anon;
grant execute on function public.sidebar_shelf_of(text) to authenticated, service_role;
grant execute on function public.sidebar_shelf_counts(uuid[]) to authenticated, service_role;
grant execute on function public.sidebar_cluster_items(uuid, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.sidebar_recent(uuid, integer) to authenticated, service_role;
grant execute on function public.sidebar_starred(uuid) to authenticated, service_role;

-- ── Prove it ─────────────────────────────────────────────────────────────────
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.sidebar_shelf_of(text)',
    'public.sidebar_shelf_counts(uuid[])',
    'public.sidebar_cluster_items(uuid, text, text, integer, integer)',
    'public.sidebar_recent(uuid, integer)',
    'public.sidebar_starred(uuid)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0419: % is callable signed out', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0419: % is not callable by a signed-in user', v_sig;
    end if;
  end loop;

  -- RLS on card_index is the whole permission model here, so none of these
  -- may run as their owner.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'sidebar\_%' and p.prosecdef
  ) then
    raise exception '0419: a sidebar_ function is security definer';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.starred_items'::regclass) then
    raise exception '0419: starred_items has no RLS';
  end if;
  if has_table_privilege('anon', 'public.starred_items', 'select')
     or has_table_privilege('anon', 'public.starred_items', 'insert') then
    raise exception '0419: starred_items is reachable signed out';
  end if;
  if has_table_privilege('authenticated', 'public.starred_items', 'update') then
    raise exception '0419: a star can be rewritten by a client';
  end if;

  if public.sidebar_shelf_of('image') is distinct from 'photos'
     or public.sidebar_shelf_of('pdf') is distinct from 'files'
     or public.sidebar_shelf_of('note') is distinct from 'writing'
     or public.sidebar_shelf_of('board') is not null
     or public.sidebar_shelf_of('art') is distinct from 'more' then
    raise exception '0419: sidebar_shelf_of puts a kind on the wrong shelf';
  end if;
end $$;
