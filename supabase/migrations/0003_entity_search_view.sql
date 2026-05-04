-- Unified entity search across boards + cards (docs are kind='doc' cards).
-- Powers the EntityPicker's workspace-wide name search.
--
-- Boards already live in Postgres. Cards live inside Y.Doc snapshots and
-- aren't queryable from Postgres directly, so we add a card_index table that
-- the client maintains as boards save (project the card's title + body once
-- per save).

create table if not exists card_index (
  workspace_id uuid not null references workspaces on delete cascade,
  board_id     uuid not null references boards on delete cascade,
  card_id      text not null,
  kind         text not null,
  title        text,
  body         text,
  updated_at   timestamptz not null default now(),
  primary key (board_id, card_id)
);
create index if not exists card_index_workspace_idx on card_index (workspace_id);

alter table card_index enable row level security;
drop policy if exists "card_index member read" on card_index;
create policy "card_index member read" on card_index for select
  using (is_workspace_member(workspace_id));
drop policy if exists "card_index member write" on card_index;
create policy "card_index member write" on card_index for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- entity_search view: union of boards + card_index. Doc cards are kind='doc'
-- in the card index. Returned columns are normalized so the client can drop
-- them straight into a row renderer.
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
from card_index ci;
