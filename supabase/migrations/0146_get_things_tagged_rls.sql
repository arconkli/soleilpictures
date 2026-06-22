-- 0146: Close the get_things_tagged RLS leak.
--
-- get_things_tagged is SECURITY DEFINER and, as shipped (0042), did NO
-- authorization at all — it returned every item tagged with a given tag_id,
-- workspace-wide, to ANY authenticated caller that knew the tag_id (e.g. a
-- board-share editor who saw a tag chip on a board shared with them could then
-- enumerate every other board in that workspace carrying the tag). This defeats
-- the security_invoker hardening (0084) that entity_search relies on.
--
-- Fix: filter each applied row by can_read_board(<its board>), short-circuited
-- by is_workspace_member so legitimate members (the common case) pay no per-row
-- cost and see exactly what they did before. auth.uid() resolves to the real
-- caller even inside a SECURITY DEFINER function, so can_read_board is correct
-- here. Dry-run verified: member sees all rows, arbitrary non-member sees none.
-- Purely additive (CREATE OR REPLACE) — the resolved/return shape is unchanged.

create or replace function public.get_things_tagged(p_tag_id uuid, p_limit integer default 200)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  ws_id uuid;
  is_member boolean;
  rows jsonb;
begin
  select t.workspace_id into ws_id from tags t where t.id = p_tag_id;
  if ws_id is null then
    return '[]'::jsonb;
  end if;

  -- Workspace members can read every board in their workspace, so short-circuit
  -- the per-row board check for them. Non-members (e.g. a board-share editor)
  -- only see tagged items on boards they can actually read.
  is_member := is_workspace_member(ws_id);

  with applied as (
    select el.source_kind, el.source_id, el.source_board_id,
           el.source_workspace, el.source, el.created_at
      from entity_links el
     where el.target_kind = 'tag'
       and el.target_id   = p_tag_id
       and el.link_kind   = 'applied'
       and (
         is_member
         or can_read_board(
              case when el.source_kind = 'board'
                   then el.source_id::uuid
                   else el.source_board_id
              end)
       )
     order by el.created_at desc
     limit p_limit
  ),
  resolved as (
    -- Card-shaped sources.
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           b.name as board_name,
           coalesce(ci.meta->>'groupName', '') as group_name,
           coalesce(ci.meta->>'groupId', '') as group_id,
           ci.body as card_body,
           null::int as member_count
      from applied a
      join entity_search es
        on es.id = a.source_board_id::text || ':' || a.source_id
       and es.kind <> 'board'
       and es.kind <> 'group'
      left join card_index ci
        on ci.board_id = a.source_board_id and ci.card_id = a.source_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'card'

    union all

    -- Boards.
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           es.title as board_name,
           '' as group_name,
           '' as group_id,
           null as card_body,
           null::int as member_count
      from applied a
      join entity_search es
        on es.kind = 'board'
       and es.id = a.source_id
     where a.source_kind = 'board'

    union all

    -- Groups. entity_search id = "{board_uuid}:g:{group_id}".
    select a.created_at as applied_at, a.source as applied_source,
           es.id, es.kind, es.title, es.body, es.meta,
           es.board_id, es.card_id, es.updated_at,
           b.name as board_name,
           '' as group_name,
           a.source_id as group_id,
           null as card_body,
           gi.member_count
      from applied a
      join entity_search es
        on es.kind = 'group'
       and es.id = a.source_board_id::text || ':g:' || a.source_id
      left join group_index gi
        on gi.board_id = a.source_board_id and gi.group_id = a.source_id
      left join boards b on b.id = a.source_board_id
     where a.source_kind = 'group'
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.applied_at desc), '[]'::jsonb)
    into rows
    from resolved r;

  return rows;
end $function$;
