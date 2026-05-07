-- Universal linking, Phase 4: tags become first-class entities.
--
-- Until now the tagging system has lived parallel to the linking
-- system (separate tables, separate picker, separate everything).
-- This migration unifies them by extending the entity_search view
-- to include tags. After this, every linking surface that already
-- knows how to render boards / docs / cards / groups also knows
-- how to render tags — for free:
--   • EntityPicker shows tags in @-mention search
--   • The auto-detect trie underlines tag names in prose
--   • get_entity_mentions returns tags as candidate entities
--   • get_entity_backlinks works with target_kind='tag'
--
-- The tag's canonical id stays as its UUID (tags.id::text). Meta
-- carries color + the tag-creation kind ('user'/'auto'/'ai') so the
-- picker can render the kind badge it already supports.

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
join auth.users u on u.id = wm.user_id
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
