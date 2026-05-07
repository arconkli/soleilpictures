-- Card groups → first-class entities for the universal linking system.
--
-- A group is a named cluster of canvas cards. The Y.Doc owns the
-- per-card groupId field + the groups Y.Map; this Postgres mirror
-- exists so groups appear in entity_search and can be searched / @-
-- mentioned / hover-previewed alongside boards / docs / cards.
--
-- Maintained client-side: syncGroupIndex projects the live Y.Doc
-- state into this table on every board save (alongside syncCardIndex).

create table if not exists group_index (
  workspace_id uuid not null references workspaces on delete cascade,
  board_id     uuid not null references boards on delete cascade,
  group_id     text not null,
  name         text,
  member_count int not null default 0,
  outline      boolean not null default false,
  color        text,
  updated_at   timestamptz not null default now(),
  primary key (board_id, group_id)
);

create index if not exists group_index_workspace_idx on group_index (workspace_id);
create index if not exists group_index_name_trgm on group_index using gin (name gin_trgm_ops);

alter table group_index enable row level security;
drop policy if exists "group_index member read" on group_index;
create policy "group_index member read" on group_index for select
  using (is_workspace_member(workspace_id));
drop policy if exists "group_index member write" on group_index;
create policy "group_index member write" on group_index for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- Extend entity_search to UNION groups so the picker, the auto-detect
-- trie, the hover popover, and get_entity_mentions all see them.
-- Drop + recreate is required because the column shape doesn't change.
drop view if exists entity_search;
create view entity_search as
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
  ci.board_id::text || ':' || ci.card_id  as id,
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
  u.id::text                               as id,
  'user'::text                             as kind,
  wm.workspace_id                          as workspace_id,
  null::uuid                               as board_id,
  null::text                               as card_id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as title,
  u.email                                  as body,
  null::jsonb                              as meta,
  greatest(u.created_at, now())            as updated_at
from workspace_members wm
join auth.users u on u.id = wm.user_id;
