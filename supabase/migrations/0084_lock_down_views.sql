-- 0084_lock_down_views.sql — fix four critical security advisor lints on
-- entity_search / board_tags / card_tags.
--
-- The advisor flagged:
--   • security_definer_view on all three views (default reloptions, owned
--     by postgres → underlying RLS bypassed and replaced with the owner's
--     view-of-the-world for every caller).
--   • auth_users_exposed on entity_search (direct join to auth.users in
--     the user-kind UNION arm leaks email + raw_user_meta_data shape).
--
-- Fix:
--   1. New SECURITY DEFINER helper workspace_user_directory() pulls the
--      auth.users join behind a function that internally enforces
--      is_workspace_member(), so the view body no longer references
--      auth.users and the static auth_users_exposed check passes.
--   2. Recreate all three views with (security_invoker = on) so RLS on
--      the underlying tables (boards / card_index / group_index / tags /
--      entity_links / workspace_members) is enforced for the caller, not
--      the postgres owner.
--   3. Revoke the inherited anon/authenticated grants on these views and
--      re-grant only SELECT to authenticated + service_role. The views
--      are read-only projections; INSERT/UPDATE/DELETE grants were dead
--      surface area anyway.

-- 1. SECURITY DEFINER directory function.
--    Inside the function the caller is `postgres`, so RLS on
--    workspace_members and auth.users doesn't apply. We re-impose the
--    "co-workspace-member only" rule with an explicit
--    is_workspace_member() predicate keyed off auth.uid().
create or replace function public.workspace_user_directory()
returns table(
  user_id      uuid,
  workspace_id uuid,
  title        text,
  email        text,
  created_at   timestamptz
)
language sql
security definer
stable
set search_path = public, auth
as $$
  select
    wm.user_id,
    wm.workspace_id,
    coalesce(u.raw_user_meta_data->>'full_name', u.email) as title,
    u.email,
    u.created_at
  from public.workspace_members wm
  join auth.users u on u.id = wm.user_id
  where public.is_workspace_member(wm.workspace_id);
$$;

revoke all on function public.workspace_user_directory() from public;
revoke all on function public.workspace_user_directory() from anon;
grant execute on function public.workspace_user_directory() to authenticated;
grant execute on function public.workspace_user_directory() to service_role;

-- 2. entity_search: same five-arm UNION as 0036_entity_search_add_tags,
--    but the user-kind arm now reads from workspace_user_directory()
--    instead of auth.users, and the view is created with
--    security_invoker=on so RLS on boards/card_index/group_index/tags
--    runs against the caller's auth.uid().
drop view if exists public.entity_search;

create view public.entity_search
with (security_invoker = on) as
select
  b.id::text                       as id,
  'board'::text                    as kind,
  b.workspace_id                   as workspace_id,
  b.id                             as board_id,
  null::text                       as card_id,
  b.name                           as title,
  b.meta                           as body,
  null::jsonb                      as meta,
  b.updated_at                     as updated_at
from boards b
union all
select
  ci.board_id::text || ':' || ci.card_id   as id,
  ci.kind                                  as kind,
  ci.workspace_id                          as workspace_id,
  ci.board_id                              as board_id,
  ci.card_id                               as card_id,
  ci.title                                 as title,
  ci.body                                  as body,
  ci.meta                                  as meta,
  ci.updated_at                            as updated_at
from card_index ci
union all
select
  gi.board_id::text || ':g:' || gi.group_id as id,
  'group'::text                              as kind,
  gi.workspace_id                            as workspace_id,
  gi.board_id                                as board_id,
  gi.group_id                                as card_id,
  gi.name                                    as title,
  null::text                                 as body,
  jsonb_build_object('memberCount', gi.member_count, 'outline', gi.outline, 'color', gi.color) as meta,
  gi.updated_at                              as updated_at
from group_index gi
union all
select
  d.user_id::text                          as id,
  'user'::text                             as kind,
  d.workspace_id                           as workspace_id,
  null::uuid                               as board_id,
  null::text                               as card_id,
  d.title                                  as title,
  d.email                                  as body,
  null::jsonb                              as meta,
  greatest(d.created_at, now())            as updated_at
from public.workspace_user_directory() d
union all
select
  t.id::text                               as id,
  'tag'::text                              as kind,
  t.workspace_id                           as workspace_id,
  null::uuid                               as board_id,
  null::text                               as card_id,
  t.name                                   as title,
  null::text                               as body,
  jsonb_build_object('color', t.color, 'createdKind', t.kind) as meta,
  t.created_at                             as updated_at
from tags t;

revoke all on public.entity_search from anon;
revoke all on public.entity_search from authenticated;
grant select on public.entity_search to authenticated;
grant select on public.entity_search to service_role;

-- 3. board_tags / card_tags: backwards-compat shims over entity_links
--    (see 0036c). Body unchanged; just adds security_invoker so RLS on
--    entity_links applies for the caller.
drop view if exists public.card_tags;

create view public.card_tags
with (security_invoker = on) as
select
  el.source_workspace               as workspace_id,
  el.source_board_id                as board_id,
  el.source_id                      as card_id,
  el.target_id                      as tag_id,
  el.source                         as source,
  el.created_at                     as created_at
from entity_links el
where el.source_kind = 'card'
  and el.target_kind = 'tag'
  and el.link_kind   = 'applied';

revoke all on public.card_tags from anon;
revoke all on public.card_tags from authenticated;
grant select on public.card_tags to authenticated;
grant select on public.card_tags to service_role;

drop view if exists public.board_tags;

create view public.board_tags
with (security_invoker = on) as
select
  el.source_workspace               as workspace_id,
  el.source_board_id                as board_id,
  el.target_id                      as tag_id,
  el.source                         as source,
  el.created_at                     as created_at
from entity_links el
where el.source_kind = 'board'
  and el.target_kind = 'tag'
  and el.link_kind   = 'applied';

revoke all on public.board_tags from anon;
revoke all on public.board_tags from authenticated;
grant select on public.board_tags to authenticated;
grant select on public.board_tags to service_role;
