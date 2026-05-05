-- Adds a 'user' kind to entity_search by union-ing workspace_members
-- against auth.users. Powers the @-mention picker for people in the
-- messaging composer.

create or replace view entity_search as
select
  b.id::text                       as id,
  'board'::text                    as kind,
  b.workspace_id                   as workspace_id,
  b.id                             as board_id,
  null::text                       as card_id,
  b.name                           as title,
  b.meta                           as body,
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
  ci.updated_at                            as updated_at
from card_index ci
union all
select
  u.id::text                               as id,
  'user'::text                             as kind,
  wm.workspace_id                          as workspace_id,
  null::uuid                               as board_id,
  null::text                               as card_id,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as title,
  u.email                                  as body,
  greatest(u.created_at, now())            as updated_at
from workspace_members wm
join auth.users u on u.id = wm.user_id;
