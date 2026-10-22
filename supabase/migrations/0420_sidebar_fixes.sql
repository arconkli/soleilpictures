-- 0420 — Fixes to the files sidebar (0419), from its review before release
--
-- The sidebar is still held to the preview build. Review found two things the
-- database side got wrong:
--
--   1. A star lost its card whenever the card moved by any route but the
--      sidebar's own. Stars point at (board_id, card_id), and only
--      /api/clusters/move rewrote them; the canvas drag, /api/v1 and Scout left
--      them on the old cluster, where sidebar_starred hid them as "gone".
--        - Card ids survive a move on every server path, so sidebar_starred now
--          finds a starred card by (workspace_id, card_id) when its stored
--          cluster no longer holds it. card_index_ws_card_idx serves that.
--        - The client's own cross-cluster move gives every card a NEW id
--          (App.jsx, lib/moveFromCluster.js), which no lookup can follow, so it
--          now calls repoint_card_refs(from, to, pairs) next to the comment
--          repoint it already does. Single-file sharing (0421) extends the same
--          function rather than adding a second call.
--   2. "Not on board" fetched whole shelves, 200 a shelf, and filtered in the
--      browser, so stored files past the 200th of a shelf never showed while
--      the counts said they existed. sidebar_cluster_items takes p_unplaced
--      and filters in the query.

-- ── Find a card by its id within the workspace ──────────────────────────────
create index if not exists card_index_ws_card_idx on public.card_index (workspace_id, card_id);

-- ── Stars follow their card ─────────────────────────────────────────────────
-- Same columns as 0419. board_id is where the card is NOW, which is what the
-- sidebar opens and stars against; a star still filed under the old cluster is
-- found through its card id. The cluster the star was made in is preferred
-- when it still holds the card (a duplicated cluster can hold the same id).
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
  select b.id,
         s.card_id,
         case when s.card_id = '' then 'cluster' else ci.kind end,
         case when s.card_id = '' then null else public.sidebar_shelf_of(ci.kind) end,
         case when s.card_id = '' then b.name else ci.title end,
         left(ci.body, 160),
         ci.meta,
         coalesce(ci.created_at, b.created_at),
         s.created_at
    from public.starred_items s
    left join lateral (
      select c.board_id, c.kind, c.title, c.body, c.meta, c.created_at
        from public.card_index c
       where s.card_id <> ''
         and c.workspace_id = s.workspace_id
         and c.card_id = s.card_id
       order by (c.board_id = s.board_id) desc, c.updated_at desc
       limit 1
    ) ci on true
    join public.boards b
      on b.id = case when s.card_id = '' then s.board_id else ci.board_id end
     and b.deleted_at is null
   where s.user_id = (select auth.uid())
     and (s.workspace_id = p_workspace_id
          or not (array[s.workspace_id] && (select public.my_workspace_ids())))
   order by s.created_at desc
$$;

-- ── Stored-off-the-board filter ─────────────────────────────────────────────
-- 0419's body, plus p_unplaced. A new argument changes the signature, so the
-- old one is dropped (which takes its grants with it; they are re-made below).
drop function if exists public.sidebar_cluster_items(uuid, text, text, integer, integer);

create function public.sidebar_cluster_items(
  p_board_id uuid,
  p_shelf    text    default null,
  p_sort     text    default 'newest',
  p_offset   integer default 0,
  p_limit    integer default 12,
  p_unplaced boolean default false
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
       and (not coalesce(p_unplaced, false) or ci.meta @> '{"unplaced": true}'::jsonb)
  )
  select i.card_id, i.kind, i.shelf, i.title, i.snippet, i.meta, i.created_at, i.updated_at, i.rn
    from items i
   where i.rn > greatest(coalesce(p_offset, 0), 0)
     and i.rn <= greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 12), 1), 200)
   order by i.shelf, i.rn
$$;

-- ── What hangs off a card follows it to a new id ────────────────────────────
-- For the client's cross-cluster move, which re-ids every card it moves:
-- p_pairs is [{from, to}], old card id → new. Everyone's stars on those cards
-- move with them (a star is personal, but the move is the writer's, and
-- nobody's star should silently vanish). Comments are repointed by the client
-- under their own policy, as before.
--
-- SECURITY DEFINER because starred_items has no client UPDATE (0419) and the
-- rows are other people's. So it checks for itself: the caller must be able to
-- write BOTH clusters, as auth.uid(), and they must share a workspace — a
-- different workspace has a different owner and a different meter, and is a
-- no-op here. 0421 (single-file sharing) re-creates this function to remap its
-- file_shares as well; keep both checks word for word if you change the body.
create or replace function public.repoint_card_refs(p_from uuid, p_to uuid, p_pairs jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws_from uuid;
  v_ws_to   uuid;
  v_n       integer := 0;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return 0;
  end if;
  if jsonb_typeof(p_pairs) is distinct from 'array' then
    raise exception 'p_pairs must be an array of {from, to}' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pairs) > 500 then
    raise exception 'at most 500 pairs at a time' using errcode = '22023';
  end if;
  if not coalesce(public.can_write_board(p_from), false)
     or not coalesce(public.can_write_board(p_to), false) then
    raise exception 'you cannot edit both clusters' using errcode = '42501';
  end if;

  select b.workspace_id into v_ws_from from public.boards b where b.id = p_from;
  select b.workspace_id into v_ws_to   from public.boards b where b.id = p_to;
  if v_ws_from is null or v_ws_from is distinct from v_ws_to then
    return 0;
  end if;

  -- A star filed under the source, or under an older cluster that no longer
  -- holds the card (sidebar_starred found it by id after a server-side move,
  -- which leaves the row where it was). Never one on a cluster that still
  -- holds a card with that id: a duplicated cluster can.
  with pairs as (
    select p->>'from' as old_id, p->>'to' as new_id
      from jsonb_array_elements(p_pairs) p
     where coalesce(p->>'from', '') <> '' and coalesce(p->>'to', '') <> ''
  )
  update public.starred_items s
     set board_id = p_to, card_id = pairs.new_id
    from pairs
   where s.workspace_id = v_ws_from
     and s.card_id = pairs.old_id
     and (s.board_id = p_from
          or not exists (select 1 from public.card_index c
                          where c.board_id = s.board_id and c.card_id = s.card_id))
     and not exists (
       select 1 from public.starred_items t
        where t.user_id = s.user_id and t.board_id = p_to and t.card_id = pairs.new_id
     );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Signed-in only, revoked from PUBLIC as well as anon (a revoke from anon is a
-- no-op while PUBLIC still holds the grant).
revoke all on function public.sidebar_starred(uuid) from public, anon;
revoke all on function public.sidebar_cluster_items(uuid, text, text, integer, integer, boolean) from public, anon;
revoke all on function public.repoint_card_refs(uuid, uuid, jsonb) from public, anon;
grant execute on function public.sidebar_starred(uuid) to authenticated, service_role;
grant execute on function public.sidebar_cluster_items(uuid, text, text, integer, integer, boolean) to authenticated, service_role;
grant execute on function public.repoint_card_refs(uuid, uuid, jsonb) to authenticated, service_role;

-- ── Prove it ─────────────────────────────────────────────────────────────────
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.sidebar_starred(uuid)',
    'public.sidebar_cluster_items(uuid, text, text, integer, integer, boolean)',
    'public.repoint_card_refs(uuid, uuid, jsonb)'
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '0420: % is callable signed out', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '0420: % is not callable by a signed-in user', v_sig;
    end if;
  end loop;

  if to_regprocedure('public.sidebar_cluster_items(uuid, text, text, integer, integer)') is not null then
    raise exception '0420: the old sidebar_cluster_items is still there';
  end if;

  -- RLS on card_index is the sidebar's whole permission model.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'sidebar\_%' and p.prosecdef
  ) then
    raise exception '0420: a sidebar_ function is security definer';
  end if;

  -- The one definer here must pin its search_path.
  if not exists (
    select 1 from pg_proc p
     where p.oid = 'public.repoint_card_refs(uuid, uuid, jsonb)'::regprocedure
       and p.prosecdef
       and p.proconfig @> array['search_path=""']
  ) then
    raise exception '0420: repoint_card_refs must be security definer with an empty search_path';
  end if;
end $$;
