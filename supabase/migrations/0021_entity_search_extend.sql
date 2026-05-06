-- Extend entity_search + card_index for the universal linking system.
--
-- card_index gains a `meta jsonb` column so per-kind preview data
-- (image src, palette swatches, doc page count, etc.) is queryable
-- alongside the title/body — drives the visual previews in the
-- universal hover popover.
--
-- entity_search view is rebuilt to expose the new meta column for
-- card rows. Boards / users get null meta (no per-kind extras yet).

alter table card_index add column if not exists meta jsonb;

-- Postgres can't change column shape via CREATE OR REPLACE VIEW —
-- column count + names must stay identical. Drop and recreate so we
-- can insert the new `meta` column in the middle.
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
