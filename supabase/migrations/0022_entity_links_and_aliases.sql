-- Universal linking system — Phase 2.
--
-- entity_links generalizes doc_backlinks: any source (doc, message,
-- card, note, card title) can link to any target (board, doc card,
-- doc anchor, card, message, user, url). doc_backlinks stays in
-- place for now as a parallel index used by existing graph code; a
-- later cleanup migration will drop it once every reader has moved
-- onto entity_links.
--
-- entity_aliases: additional names that resolve to an entity (so
-- "NOT ORG" auto-links to the "Not Organization" board even though
-- the primary name doesn't match exactly).
--
-- entity_ignore_terms: per-doc and workspace-wide suppression lists
-- so a noisy term ("page", "design") doesn't auto-link.
--
-- doc_page_index: per-page projected text used for "Appears in" doc
-- lookups. Maintained client-side on doc save.
--
-- pg_trgm indexes on messages.body / card_index / doc_page_index
-- power get_entity_mentions's term-substring search.

create extension if not exists pg_trgm;

-- ── entity_links ────────────────────────────────────────────────────────

create table if not exists entity_links (
  id uuid primary key default gen_random_uuid(),

  source_kind        text not null,      -- 'doc' | 'card' | 'note' | 'message' | 'card_title'
  source_id          text not null,      -- card_id, message_id, doc_card_id (text so we can hold either form)
  source_workspace   uuid not null references workspaces on delete cascade,
  source_board_id    uuid references boards on delete cascade,
  source_page_id     text,
  source_link_id     text,
  context_text       text,

  target_kind        text not null,      -- 'board' | 'card' | 'doc' | 'docPos' | 'message' | 'user' | 'url'
  target_id          uuid,
  target_board_id    uuid,
  target_card_id     text,
  target_doc_card_id uuid,
  target_page_id     text,
  target_anchor      jsonb,
  target_url         text,

  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users on delete set null
);

create index if not exists entity_links_target_kind_id  on entity_links (target_kind, target_id) where target_id is not null;
create index if not exists entity_links_target_board    on entity_links (target_board_id) where target_board_id is not null;
create index if not exists entity_links_target_card     on entity_links (target_board_id, target_card_id) where target_card_id is not null;
create index if not exists entity_links_target_doc      on entity_links (target_doc_card_id) where target_doc_card_id is not null;
create index if not exists entity_links_target_url      on entity_links (target_url) where target_url is not null;
create index if not exists entity_links_source          on entity_links (source_kind, source_id);
create index if not exists entity_links_source_workspace on entity_links (source_workspace);

-- Idempotence: same (source pointer, target pointer) only inserts once.
-- coalesce nulls into sentinels so the unique index can compare them.
create unique index if not exists entity_links_unique on entity_links (
  source_kind,
  source_id,
  coalesce(source_page_id, ''),
  coalesce(source_link_id, ''),
  target_kind,
  coalesce(target_id::text,        ''),
  coalesce(target_board_id::text,  ''),
  coalesce(target_card_id,         ''),
  coalesce(target_doc_card_id::text, ''),
  coalesce(target_page_id,         ''),
  coalesce(target_url,             '')
);

alter table entity_links enable row level security;
drop policy if exists "entity_links read" on entity_links;
create policy "entity_links read" on entity_links for select
  using (is_workspace_member(source_workspace));
drop policy if exists "entity_links write" on entity_links;
create policy "entity_links write" on entity_links for all
  using (is_workspace_member(source_workspace))
  with check (is_workspace_member(source_workspace));

-- ── entity_aliases ──────────────────────────────────────────────────────

create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  entity_kind  text not null,
  entity_id    text not null,        -- 'boardId' / 'boardId:cardId' / 'docCardId' / userId
  alias        text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users on delete set null
);

create unique index if not exists entity_aliases_unique on entity_aliases (workspace_id, entity_kind, entity_id, lower(alias));
create index if not exists entity_aliases_workspace_idx on entity_aliases (workspace_id);
create index if not exists entity_aliases_entity_idx on entity_aliases (entity_kind, entity_id);

alter table entity_aliases enable row level security;
drop policy if exists "entity_aliases read" on entity_aliases;
create policy "entity_aliases read" on entity_aliases for select
  using (is_workspace_member(workspace_id));
drop policy if exists "entity_aliases write" on entity_aliases;
create policy "entity_aliases write" on entity_aliases for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- ── entity_ignore_terms ─────────────────────────────────────────────────

create table if not exists entity_ignore_terms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  scope        text not null check (scope in ('doc','workspace')),
  scope_id     text,                  -- doc_card_id when scope='doc', null when 'workspace'
  term         text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users on delete set null
);

create unique index if not exists entity_ignore_terms_unique on entity_ignore_terms (
  workspace_id, scope, coalesce(scope_id, ''), lower(term)
);
create index if not exists entity_ignore_terms_workspace_idx on entity_ignore_terms (workspace_id, scope);

alter table entity_ignore_terms enable row level security;
drop policy if exists "entity_ignore_terms read" on entity_ignore_terms;
create policy "entity_ignore_terms read" on entity_ignore_terms for select
  using (is_workspace_member(workspace_id));
drop policy if exists "entity_ignore_terms write" on entity_ignore_terms;
create policy "entity_ignore_terms write" on entity_ignore_terms for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- ── doc_page_index ──────────────────────────────────────────────────────

create table if not exists doc_page_index (
  doc_card_id  uuid not null,
  page_id      text not null,
  workspace_id uuid not null references workspaces on delete cascade,
  page_title   text,
  page_text    text,
  updated_at   timestamptz not null default now(),
  primary key (doc_card_id, page_id)
);

create index if not exists doc_page_index_workspace_idx on doc_page_index (workspace_id);
create index if not exists doc_page_index_text_trgm on doc_page_index using gin (page_text gin_trgm_ops);
create index if not exists doc_page_index_title_trgm on doc_page_index using gin (page_title gin_trgm_ops);

alter table doc_page_index enable row level security;
drop policy if exists "doc_page_index read" on doc_page_index;
create policy "doc_page_index read" on doc_page_index for select
  using (is_workspace_member(workspace_id));
drop policy if exists "doc_page_index write" on doc_page_index;
create policy "doc_page_index write" on doc_page_index for all
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- ── trgm indexes on existing tables ─────────────────────────────────────

-- Be tolerant of the body column already being indexed; pg_trgm GIN
-- creation on a populated column can be slow but it's a one-time cost.
do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'messages_body_trgm') then
    create index messages_body_trgm on messages using gin (body gin_trgm_ops);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'card_index_title_trgm') then
    create index card_index_title_trgm on card_index using gin (title gin_trgm_ops);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_indexes where indexname = 'card_index_body_trgm') then
    create index card_index_body_trgm on card_index using gin (body gin_trgm_ops);
  end if;
end $$;

-- ── Backfill from doc_backlinks ─────────────────────────────────────────

insert into entity_links (
  source_kind, source_id, source_workspace, source_page_id, source_link_id,
  context_text,
  target_kind, target_board_id, target_card_id, target_doc_card_id, target_page_id, target_url,
  created_at
)
select
  'doc',
  db.source_doc_card_id::text,
  db.source_workspace_id,
  db.source_page_id::text,
  db.source_link_id::text,
  db.source_text,
  db.target_kind,
  db.target_board_id,
  db.target_card_id,
  db.target_doc_card_id,
  db.target_page_id::text,
  db.target_url,
  db.updated_at
from doc_backlinks db
on conflict do nothing;

-- ── Trigger: messages → entity_links ────────────────────────────────────
-- Walks new.attachments[] for entity refs and inserts one row per ref.
-- Mentions in new.mentions[] are recorded as user-target rows so a
-- person can see "messages where I was @-mentioned" via the standard
-- backlinks API.

create or replace function messages_record_entity_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  att   jsonb;
  uid   uuid;
  ws    uuid;
  bid   uuid;
begin
  ws := new.workspace_id;
  bid := new.board_id;

  -- Wipe prior rows for this message so updates re-stamp cleanly.
  delete from entity_links
  where source_kind = 'message' and source_id = new.id::text;

  if new.attachments is not null then
    for att in select * from jsonb_array_elements(new.attachments)
    loop
      if att->>'kind' = 'board' then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_board_id, target_id, created_by, context_text)
        values ('message', new.id::text, ws, bid,
                'board',
                nullif(att->>'boardId','')::uuid,
                nullif(att->>'boardId','')::uuid,
                new.sender_id, new.body)
        on conflict do nothing;
      elsif att->>'kind' = 'card' then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_board_id, target_card_id, created_by, context_text)
        values ('message', new.id::text, ws, bid,
                'card',
                nullif(att->>'boardId','')::uuid,
                att->>'cardId',
                new.sender_id, new.body)
        on conflict do nothing;
      elsif att->>'kind' in ('doc','docPos') then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_doc_card_id, target_page_id, target_anchor,
                                  created_by, context_text)
        values ('message', new.id::text, ws, bid,
                att->>'kind',
                nullif(att->>'docCardId','')::uuid,
                att->>'pageId',
                att->'anchor',
                new.sender_id, new.body)
        on conflict do nothing;
      elsif att->>'kind' = 'url' then
        insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                  target_kind, target_url, created_by, context_text)
        values ('message', new.id::text, ws, bid,
                'url', att->>'href',
                new.sender_id, new.body)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if new.mentions is not null then
    for uid in select unnest(new.mentions)
    loop
      insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                                target_kind, target_id, created_by, context_text)
      values ('message', new.id::text, ws, bid,
              'user', uid, new.sender_id, new.body)
      on conflict do nothing;
    end loop;
  end if;

  return new;
end $$;

drop trigger if exists messages_record_entity_links_ins on messages;
create trigger messages_record_entity_links_ins
  after insert on messages
  for each row execute function messages_record_entity_links();

drop trigger if exists messages_record_entity_links_upd on messages;
create trigger messages_record_entity_links_upd
  after update on messages
  for each row when (old.attachments is distinct from new.attachments
                  or old.mentions    is distinct from new.mentions)
  execute function messages_record_entity_links();

-- Backfill existing messages → entity_links so the backlinks panel
-- isn't empty for messages sent before this migration. Idempotent
-- via on conflict; safe to re-run.

insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                          target_kind, target_board_id, target_id, created_by, context_text)
select 'message', m.id::text, m.workspace_id, m.board_id,
       'board', nullif(att->>'boardId','')::uuid, nullif(att->>'boardId','')::uuid,
       m.sender_id, m.body
  from messages m, jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) att
 where m.deleted_at is null
   and att->>'kind' = 'board'
   and att->>'boardId' is not null
   and att->>'boardId' <> ''
on conflict do nothing;

insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                          target_kind, target_board_id, target_card_id, created_by, context_text)
select 'message', m.id::text, m.workspace_id, m.board_id,
       'card', nullif(att->>'boardId','')::uuid, att->>'cardId',
       m.sender_id, m.body
  from messages m, jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) att
 where m.deleted_at is null
   and att->>'kind' = 'card'
   and att->>'boardId' is not null
   and att->>'cardId' is not null
on conflict do nothing;

insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                          target_kind, target_doc_card_id, target_page_id, target_anchor,
                          created_by, context_text)
select 'message', m.id::text, m.workspace_id, m.board_id,
       att->>'kind', nullif(att->>'docCardId','')::uuid, att->>'pageId', att->'anchor',
       m.sender_id, m.body
  from messages m, jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) att
 where m.deleted_at is null
   and att->>'kind' in ('doc','docPos')
   and att->>'docCardId' is not null
   and att->>'docCardId' <> ''
on conflict do nothing;

insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                          target_kind, target_url, created_by, context_text)
select 'message', m.id::text, m.workspace_id, m.board_id,
       'url', att->>'href',
       m.sender_id, m.body
  from messages m, jsonb_array_elements(coalesce(m.attachments, '[]'::jsonb)) att
 where m.deleted_at is null
   and att->>'kind' = 'url'
   and att->>'href' is not null
   and att->>'href' <> ''
on conflict do nothing;

insert into entity_links (source_kind, source_id, source_workspace, source_board_id,
                          target_kind, target_id, created_by, context_text)
select 'message', m.id::text, m.workspace_id, m.board_id,
       'user', uid, m.sender_id, m.body
  from messages m, unnest(coalesce(m.mentions, '{}'::uuid[])) uid
 where m.deleted_at is null
on conflict do nothing;

-- ── RPC: get_entity_mentions(term, ws, limit) ───────────────────────────
-- One round trip for the popover. Returns:
--   { entities: [...], appears_in: [...], total_appears }
-- entities = entity_search rows whose title (or alias) matches the
-- term case-insensitively.
-- appears_in = doc_page_index / messages / card_index rows whose
-- text contains the term (pg_trgm-accelerated).

create or replace function get_entity_mentions(p_term text, p_workspace uuid, p_limit int default 6)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pat   text := lower(trim(p_term));
  ents  jsonb;
  apps  jsonb;
  total int;
begin
  if pat is null or pat = '' or p_workspace is null then
    return jsonb_build_object('entities', '[]'::jsonb, 'appears_in', '[]'::jsonb, 'total_appears', 0);
  end if;

  with by_alias as (
    select entity_kind, entity_id from entity_aliases
    where workspace_id = p_workspace and lower(alias) = pat
  ),
  ent_rows as (
    select es.id, es.kind, es.workspace_id, es.board_id, es.card_id,
           es.title, es.body, es.meta, es.updated_at
      from entity_search es
     where es.workspace_id = p_workspace
       and (lower(es.title) = pat
            or exists (
                 select 1 from by_alias ba
                  where ba.entity_kind = es.kind
                    and (ba.entity_id = es.id or ba.entity_id = es.board_id::text)
               ))
     limit (p_limit * 4)
  )
  select coalesce(jsonb_agg(to_jsonb(er)), '[]'::jsonb) into ents from ent_rows er;

  with apps_doc as (
    select 'doc' as source_kind, dp.doc_card_id::text as source_id,
           dp.page_id as source_page_id, dp.page_title as source_title,
           substring(dp.page_text from greatest(1, position(pat in lower(dp.page_text)) - 40) for 160) as snippet,
           dp.updated_at
      from doc_page_index dp
     where dp.workspace_id = p_workspace
       and dp.page_text ilike '%' || pat || '%'
     order by dp.updated_at desc
     limit p_limit
  ), apps_msg as (
    select 'message' as source_kind, m.id::text as source_id,
           null::text as source_page_id,
           null::text as source_title,
           substring(m.body from greatest(1, position(pat in lower(m.body)) - 40) for 160) as snippet,
           m.created_at as updated_at
      from messages m
     where m.workspace_id = p_workspace
       and m.deleted_at is null
       and m.body ilike '%' || pat || '%'
     order by m.created_at desc
     limit p_limit
  ), apps_card as (
    select case when ci.kind = 'note' then 'note'
                when ci.kind = 'doc'  then 'doc'
                else 'card' end as source_kind,
           ci.card_id::text as source_id,
           null::text as source_page_id,
           ci.title as source_title,
           coalesce(substring(ci.body from greatest(1, position(pat in lower(ci.body)) - 40) for 160), '') as snippet,
           ci.updated_at
      from card_index ci
     where ci.workspace_id = p_workspace
       and (lower(ci.title) like '%' || pat || '%' or lower(coalesce(ci.body, '')) like '%' || pat || '%')
     order by ci.updated_at desc
     limit p_limit
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into apps from (
    select * from apps_doc union all
    select * from apps_msg union all
    select * from apps_card
  ) x;

  -- Total count (uncapped) for the section header.
  select
    (select count(*) from doc_page_index dp where dp.workspace_id = p_workspace and dp.page_text ilike '%' || pat || '%')
  + (select count(*) from messages m where m.workspace_id = p_workspace and m.deleted_at is null and m.body ilike '%' || pat || '%')
  + (select count(*) from card_index ci where ci.workspace_id = p_workspace and (lower(ci.title) like '%' || pat || '%' or lower(coalesce(ci.body, '')) like '%' || pat || '%'))
  into total;

  return jsonb_build_object(
    'entities', ents,
    'appears_in', apps,
    'total_appears', coalesce(total, 0)
  );
end $$;

-- ── RPC: get_entity_backlinks(kind, id, ...) ────────────────────────────
-- Returns rows from entity_links targeting this entity, joined to
-- source metadata so the panel can render names + snippets.

create or replace function get_entity_backlinks(
  p_kind text,
  p_id uuid default null,
  p_board_id uuid default null,
  p_card_id text default null,
  p_doc_card_id uuid default null,
  p_url text default null,
  p_limit int default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rows jsonb;
begin
  with matched as (
    select el.*
      from entity_links el
     where el.target_kind = p_kind
       and (
         (p_kind = 'board'   and el.target_board_id = p_board_id)
      or (p_kind = 'card'    and el.target_board_id = p_board_id and el.target_card_id = p_card_id)
      or (p_kind in ('doc','docPos') and el.target_doc_card_id = p_doc_card_id)
      or (p_kind in ('message','user') and el.target_id = p_id)
      or (p_kind = 'url'     and el.target_url = p_url)
       )
     order by el.created_at desc
     limit p_limit
  )
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into rows from matched m;
  return rows;
end $$;

-- ── RPC: add_entity_alias(...) ──────────────────────────────────────────

create or replace function add_entity_alias(
  p_workspace uuid,
  p_entity_kind text,
  p_entity_id text,
  p_alias text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  rid uuid;
begin
  uid := auth.uid();
  if uid is null or not is_workspace_member(p_workspace) then
    raise exception 'not a member of this workspace';
  end if;
  insert into entity_aliases (workspace_id, entity_kind, entity_id, alias, created_by)
  values (p_workspace, p_entity_kind, p_entity_id, trim(p_alias), uid)
  on conflict (workspace_id, entity_kind, entity_id, lower(alias))
    do update set created_at = entity_aliases.created_at
  returning id into rid;
  return rid;
end $$;
