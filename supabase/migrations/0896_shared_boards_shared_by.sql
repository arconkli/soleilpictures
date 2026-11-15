-- 0896: list_shared_boards says who shared each cluster.
--
-- Nearly every workspace keeps its default name, so the sidebar's Shared with
-- me groups all read "From Personal Workspace" and can't be told apart. The
-- person who shared a cluster is what tells them apart, and the recipient
-- can't read that person's profile: member_profiles covers workspace mates
-- only (0382), and a cluster shared on its own doesn't make you one. So the
-- read that lists the clusters names the sharer itself.
--
--   shared_by        the root share's invited_by, carried down to every
--                    descendant the way role and created_at already are
--   shared_by_name   that person's display name, null when unset or blank
--   shared_by_color  their colour, only when it is a #rrggbb hex: the app
--                    paints it as a background, so nothing else gets through
--
-- invited_by is set on every share today; when it isn't, all three are null
-- and the app falls back to the workspace's name, as before. Nothing else
-- changes: same rows, same order, same security definer, same grants.
--
-- Either deploy order is safe. The old app's normalizer drops columns it
-- doesn't name (0244), and the new app reads missing columns as unknown.

begin;

drop function if exists public.list_shared_boards();

create function public.list_shared_boards()
returns table (
  board_id              uuid,
  board_name            text,
  role                  text,
  source_workspace_id   uuid,
  source_workspace_name text,
  parent_board_id       uuid,
  board_view            text,
  board_cover           text,
  created_at            timestamptz,
  scheduled_date        date,
  scheduled_end         date,
  day_label             text,
  sched_status          text,
  sched_version         int,
  sched_published_at    timestamptz,
  day_type              text,
  day_start             time,
  day_end               time,
  day_place             text,
  day_types             jsonb,
  updated_at            timestamptz,
  is_shared_root        boolean,
  shared_by             uuid,
  shared_by_name        text,
  shared_by_color       text
)
language sql
stable
security definer
set search_path = public
as $$
  with recursive roots as (
    select b.id, s.role, s.created_at, s.invited_by
    from board_shares s
    join boards b on b.id = s.board_id
    where s.user_id = auth.uid()
      and b.deleted_at is null
      and not is_workspace_member(b.workspace_id)
  ),
  tree as (
    select r.id, r.role, r.created_at as share_created_at, r.invited_by,
           true as is_root, 0 as depth
    from roots r
    union all
    select c.id, t.role, t.share_created_at, t.invited_by, false, t.depth + 1
    from boards c
    join tree t on c.parent_board_id = t.id
    where c.deleted_at is null and t.depth < 20
  ),
  dedup as (
    select distinct on (t.id) t.id, t.role, t.share_created_at, t.invited_by, t.is_root
    from tree t
    order by t.id, (t.role = 'editor') desc, t.is_root desc, t.depth asc
  )
  select b.id, b.name, d.role,
         w.id, w.name, b.parent_board_id,
         coalesce(b.view, 'canvas')::text,
         coalesce(b.cover, 'neutral')::text,
         d.share_created_at,
         b.scheduled_date, b.scheduled_end, b.day_label,
         b.sched_status, b.sched_version, b.sched_published_at,
         b.day_type, b.day_start, b.day_end, b.day_place, b.day_types,
         b.updated_at, d.is_root,
         d.invited_by,
         nullif(btrim(p.display_name), ''),
         case when p.color ~ '^#[0-9A-Fa-f]{6}$' then p.color end
  from dedup d
  join boards b     on b.id = d.id
  join workspaces w on w.id = b.workspace_id
  left join profiles p on p.user_id = d.invited_by
  order by w.name asc, b.name asc;
$$;

revoke all on function public.list_shared_boards() from public, anon;
grant execute on function public.list_shared_boards() to authenticated;

-- Proofs (the 0311 habit: a REVOKE reporting success proves nothing)

do $$
begin
  if has_function_privilege('anon', 'public.list_shared_boards()', 'execute') then
    raise exception '0896: list_shared_boards is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.list_shared_boards()', 'execute') then
    raise exception '0896: list_shared_boards is not callable signed in';
  end if;
end $$;

commit;
