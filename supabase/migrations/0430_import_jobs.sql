-- 0430 — bulk import's ledger: one row per import, the clusters it made, and
-- what became of each file, so an import that outlives its tab picks up where
-- it was instead of starting again.
--
-- Bulk import (boards/src/lib/importJob.js) moves a whole folder tree or zip
-- export into clusters. Three tables, each owned by the person importing and
-- readable by nobody else:
--   import_jobs     one row per import: where it goes, what it is, how far.
--   import_folders  each folder (or part of one) → the cluster made for it, so
--                   a resumed import never makes a second one.
--   import_items    a file's fate, keyed by its path in the source: waiting
--                   (its card is on the cluster, its bytes not yet in), landed
--                   or failed. Dropping the same folder again skips what
--                   landed. Nothing is written for a file still queued.
--
-- import_create_clusters makes up to 500 clusters a call, parents first. It
-- is a loop on purpose: one statement per cluster, so the boards insert policy
-- and boards_parent_must_be_live see the parent made a moment earlier, which a
-- single multi-row insert could not. It runs as the caller (security invoker),
-- so every insert passes the same policies createBoard's do. Each cluster's
-- first board_state is written with it: the client encodes the doc holding its
-- subfolders' cluster cards, so a cluster opened mid-import already shows them
-- and the drift reconcile finds nothing to add.
--
-- No tokens or provider secrets ever go in here: source_ref holds zip part
-- names or a provider's folder id. Rows of finished imports are kept for now;
-- the sweep that purges them comes with the Dropbox connector.

create table if not exists public.import_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_board_id uuid not null references public.boards(id) on delete cascade,
  source          text not null check (source in ('folder', 'zip', 'dropbox', 'gdrive')),
  source_ref      jsonb not null default '{}'::jsonb,
  status          text not null default 'running'
                  check (status in ('running', 'paused', 'waiting', 'done', 'cancelled', 'failed')),
  waiting_reason  text check (waiting_reason in ('cards', 'storage')),
  totals          jsonb not null default '{}'::jsonb,
  done            jsonb not null default '{}'::jsonb,
  root_board_ids  uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists import_jobs_owner_status on public.import_jobs (owner_id, status);
-- Deleting a cluster or a workspace cascades here: index the keys it follows.
create index if not exists import_jobs_target on public.import_jobs (target_board_id);
create index if not exists import_jobs_workspace on public.import_jobs (workspace_id);

create table if not exists public.import_folders (
  job_id          uuid not null references public.import_jobs(id) on delete cascade,
  rel_path        text not null,
  owner_id        uuid not null default auth.uid(),
  board_id        uuid not null references public.boards(id) on delete cascade,
  parent_rel_path text,
  file_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  primary key (job_id, rel_path)
);
create index if not exists import_folders_board on public.import_folders (board_id);

create table if not exists public.import_items (
  job_id        uuid not null references public.import_jobs(id) on delete cascade,
  rel_path      text not null,
  owner_id      uuid not null default auth.uid(),
  status        text not null check (status in ('waiting', 'landed', 'failed', 'skipped')),
  size_bytes    bigint not null default 0,
  last_modified bigint,
  provider_rev  text,
  board_id      uuid,
  card_id       text,
  error         text,
  updated_at    timestamptz not null default now(),
  primary key (job_id, rel_path)
);
create index if not exists import_items_job_status on public.import_items (job_id, status);

-- ── Who can see and touch them ───────────────────────────────────────────────
alter table public.import_jobs enable row level security;
alter table public.import_folders enable row level security;
alter table public.import_items enable row level security;

create policy "import_jobs read own" on public.import_jobs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "import_jobs insert own" on public.import_jobs for insert to authenticated
  with check (owner_id = (select auth.uid())
              and public.can_write_board(target_board_id)
              and public._board_in_workspace(target_board_id, workspace_id));
create policy "import_jobs update own" on public.import_jobs for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "import_folders read own" on public.import_folders for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "import_folders insert own" on public.import_folders for insert to authenticated
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.import_jobs j
                           where j.id = job_id and j.owner_id = (select auth.uid())));

create policy "import_items read own" on public.import_items for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "import_items insert own" on public.import_items for insert to authenticated
  with check (owner_id = (select auth.uid())
              and exists (select 1 from public.import_jobs j
                           where j.id = job_id and j.owner_id = (select auth.uid())));
create policy "import_items update own" on public.import_items for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Supabase's default privileges hand every new table to anon and
-- authenticated in full, and merge with PUBLIC's: take it all back, then give
-- the owner exactly what the importer does. An import's owner, place and
-- source never change once made; no client deletes a row.
revoke all on public.import_jobs, public.import_folders, public.import_items from public, anon, authenticated;
grant select, insert on public.import_jobs, public.import_folders, public.import_items to authenticated;
grant update (status, waiting_reason, totals, done, root_board_ids) on public.import_jobs to authenticated;
grant update (status, size_bytes, last_modified, provider_rev, board_id, card_id, error) on public.import_items to authenticated;
grant all on public.import_jobs, public.import_folders, public.import_items to service_role;

create or replace function public._import_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public._import_touch() from public, anon, authenticated;

create trigger import_jobs_touch before update on public.import_jobs
  for each row execute function public._import_touch();
create trigger import_items_touch before update on public.import_items
  for each row execute function public._import_touch();

-- ── Making the clusters ──────────────────────────────────────────────────────
-- p_rows, parents first: [{ key, id, parent_key, name, doc, files }]
--   key         the planner's key for the folder ('Night Shift/Stills#2')
--   id          a uuid the client made, as createBoard does
--   parent_key  null for a top folder, which goes under the import's target
--   doc         base64 of the cluster's first Y.Doc update (its cluster cards)
--   files       how many files the planner gave it
-- Returns how many it made. A row whose key this import already has is
-- skipped, so a retry after a lost response is harmless.
create or replace function public.import_create_clusters(p_job uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_me     uuid := (select auth.uid());
  v_ws     uuid;
  v_target uuid;
  v_row    jsonb;
  v_id     uuid;
  v_key    text;
  v_parent uuid;
  v_doc    text;
  v_made   integer := 0;
  v_tops   uuid[] := '{}';
begin
  select j.workspace_id, j.target_board_id into v_ws, v_target
    from public.import_jobs j
   where j.id = p_job and j.owner_id = v_me;
  if v_ws is null then
    raise exception 'No such import' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Up to 500 clusters a call' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_id := (v_row->>'id')::uuid;
    v_key := v_row->>'key';
    if v_id is null or coalesce(v_key, '') = '' then
      raise exception 'Every cluster needs an id and a key' using errcode = '22023';
    end if;
    if exists (select 1 from public.import_folders f where f.job_id = p_job and f.rel_path = v_key) then
      continue;
    end if;

    if v_row->>'parent_key' is null then
      v_parent := v_target;
    else
      v_parent := null;
      select f.board_id into v_parent from public.import_folders f
       where f.job_id = p_job and f.rel_path = v_row->>'parent_key';
      if v_parent is null then
        raise exception 'A cluster''s parent has to come before it' using errcode = '22023';
      end if;
    end if;

    -- A doc the room can't decode would leave a cluster that never opens.
    v_doc := coalesce(v_row->>'doc', 'AAA=');
    perform decode(v_doc, 'base64');

    insert into public.boards (id, workspace_id, parent_board_id, name, view, created_by)
    values (v_id, v_ws, v_parent,
            left(coalesce(nullif(btrim(v_row->>'name'), ''), 'Folder'), 200), 'canvas', v_me);
    insert into public.board_state (board_id, doc) values (v_id, v_doc);
    insert into public.import_folders (job_id, rel_path, owner_id, board_id, parent_rel_path, file_count)
    values (p_job, v_key, v_me, v_id, v_row->>'parent_key',
            greatest(0, coalesce((v_row->>'files')::integer, 0)));

    if v_row->>'parent_key' is null then
      v_tops := v_tops || v_id;
    end if;
    v_made := v_made + 1;
  end loop;

  if cardinality(v_tops) > 0 then
    update public.import_jobs set root_board_ids = root_board_ids || v_tops where id = p_job;
  end if;
  return v_made;
end $$;

-- ── Recording what became of each file ───────────────────────────────────────
-- p_items: [{ rel_path, status, size_bytes, last_modified, provider_rev,
-- board_id, card_id, error }], up to 1,000. One statement: a path sent twice
-- keeps one row instead of failing the batch.
create or replace function public.import_items_put(p_job uuid, p_items jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.import_jobs j where j.id = p_job and j.owner_id = (select auth.uid())) then
    raise exception 'No such import' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 1000 then
    raise exception 'Up to 1,000 items a call' using errcode = '22023';
  end if;

  insert into public.import_items as i
         (job_id, rel_path, owner_id, status, size_bytes, last_modified, provider_rev, board_id, card_id, error)
  select distinct on (x.rel_path)
         p_job, x.rel_path, (select auth.uid()), x.status, greatest(0, coalesce(x.size_bytes, 0)),
         x.last_modified, x.provider_rev, x.board_id, x.card_id, left(x.error, 500)
    from jsonb_to_recordset(p_items) as x(rel_path text, status text, size_bytes bigint, last_modified bigint,
                                          provider_rev text, board_id uuid, card_id text, error text)
   where coalesce(x.rel_path, '') <> ''
   order by x.rel_path
  on conflict (job_id, rel_path) do update
     set status        = excluded.status,
         size_bytes    = excluded.size_bytes,
         last_modified = excluded.last_modified,
         provider_rev  = coalesce(excluded.provider_rev, i.provider_rev),
         board_id      = coalesce(excluded.board_id, i.board_id),
         card_id       = coalesce(excluded.card_id, i.card_id),
         error         = excluded.error;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.import_create_clusters(uuid, jsonb) from public, anon;
revoke execute on function public.import_items_put(uuid, jsonb) from public, anon;
grant execute on function public.import_create_clusters(uuid, jsonb) to authenticated, service_role;
grant execute on function public.import_items_put(uuid, jsonb) to authenticated, service_role;

-- ── Prove it ─────────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['import_jobs', 'import_folders', 'import_items'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '0430: % has row level security off', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'select')
       or has_table_privilege('anon', 'public.' || t, 'insert') then
      raise exception '0430: % is reachable signed out', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'delete')
       or has_table_privilege('authenticated', 'public.' || t, 'truncate') then
      raise exception '0430: a signed-in user can delete from %', t;
    end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'select')
       or not has_table_privilege('authenticated', 'public.' || t, 'insert') then
      raise exception '0430: the importer cannot read or write %', t;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.import_jobs', 'owner_id', 'update')
     or has_column_privilege('authenticated', 'public.import_jobs', 'target_board_id', 'update')
     or has_column_privilege('authenticated', 'public.import_jobs', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.import_items', 'owner_id', 'update') then
    raise exception '0430: an import''s owner or place can be rewritten';
  end if;
  if has_function_privilege('anon', 'public.import_create_clusters(uuid,jsonb)', 'execute')
     or has_function_privilege('anon', 'public.import_items_put(uuid,jsonb)', 'execute') then
    raise exception '0430: an import function is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.import_create_clusters(uuid,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.import_items_put(uuid,jsonb)', 'execute') then
    raise exception '0430: an import function is not callable signed in';
  end if;
  if has_function_privilege('authenticated', 'public._import_touch()', 'execute')
     or has_function_privilege('anon', 'public._import_touch()', 'execute') then
    raise exception '0430: _import_touch is callable by a client';
  end if;
end $$;
