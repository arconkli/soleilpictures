-- 0593 — Pictures, described and classified (the owner's photo vision, 2026-10-27).
--
-- Every picture brought in gets a short description, keywords and a few
-- labels (medium, shot, light, palette, era, location, text in it) from a
-- Workers AI vision model, so tags can suggest, search can find and AI chats
-- can see what is in it. The Worker's cron (worker-vision.js) claims pictures
-- here, takes the budget, sends a small copy to the model and writes the
-- answer back; lib/vision.js holds the prompt and reads the answer.
--
-- Rules this file keeps:
--   * descriptions never go into card_index title/body: the word-match autotag
--     trigger would apply tags from vision words, and vision only suggests;
--   * a description is readable only by someone who can read its picture, and
--     only once it is done; nothing for anon; no client writes;
--   * the budget (ai_usage) is taken before every model call, per workspace
--     owner and in total, and pages the operator when the total runs out;
--   * a workspace whose AI switch is off (ai_tagger_enabled = false, 0591) is
--     never described, and turning the switch off deletes what was.
--
-- A picture is described once per prompt version (lib/vision.js
-- PROMPT_VERSION; c_version below must match it, which visionMigration.test
-- checks). Its cards are embedded per card (lib/serverEmbed.js): 327 image
-- cards sit in another workspace than their picture's row, so describing and
-- the budget follow the picture's workspace and embedding follows the card's.
--
-- Applied live 2026-10-27 in parts (records 0593_image_vision_part1 to part4,
-- part5a, part5b and part6_proof). The MCP refused `drop trigger if exists`,
-- so part 5 went in as two without it. Every function body md5-matches this file.

begin;
set local lock_timeout = '3s';

-- ── The descriptions ────────────────────────────────────────────────────────

create table if not exists public.image_descriptions (
  image_id        uuid primary key references public.images(id) on delete cascade,
  workspace_id    uuid not null,
  status          text not null default 'queued' check (status in ('queued', 'done', 'failed', 'skipped')),
  description     text,
  keywords        text[] not null default '{}',
  attrs           jsonb not null default '{}'::jsonb,
  model           text,
  prompt_version  integer,
  attempts        integer not null default 0,
  error_code      text,
  -- Who is working on it now: claim sets both, finish and release clear them.
  -- A re-description (a new prompt version) keeps the old one readable
  -- meanwhile, since status stays 'done' until the new answer lands.
  lease_token     uuid,
  lease_until     timestamptz,
  next_attempt_at timestamptz,
  tokens_in       integer,
  tokens_out      integer,
  described_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists image_descriptions_due on public.image_descriptions (status, next_attempt_at);
create index if not exists image_descriptions_workspace on public.image_descriptions (workspace_id);

alter table public.image_descriptions enable row level security;
revoke all on public.image_descriptions from public, anon, authenticated;
grant select (image_id, description, keywords, attrs, described_at) on public.image_descriptions to authenticated;
grant all on public.image_descriptions to service_role;

-- Exactly who can read the picture: the subquery runs under images' own RLS.
drop policy if exists "image descriptions read" on public.image_descriptions;
create policy "image descriptions read" on public.image_descriptions
  for select to authenticated
  using (
    status = 'done'
    and exists (select 1 from public.images i
                 where i.id = image_descriptions.image_id and i.deleted_at is null)
  );

-- An image card holds its picture as meta.src = 'r2:' || images.storage_path.
-- Queries must repeat this predicate exactly for the index to apply.
create index if not exists card_index_image_src on public.card_index ((meta->>'src')) where kind = 'image';

-- ── The budget ──────────────────────────────────────────────────────────────

create table if not exists public.ai_usage (
  owner_id uuid not null,
  day      date not null,
  kind     text not null check (kind in ('vision', 'embed')),
  units    bigint not null default 0,
  primary key (owner_id, day, kind)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
grant all on public.ai_usage to service_role;

-- Takes p_units of today's budget for the owner (the workspace's created_by),
-- or refuses. 'vision' counts model calls, 'embed' characters embedded. One
-- call at a time, so two can't both read "just under".
create or replace function public._ai_budget_take(p_owner uuid, p_kind text, p_units integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_cap  bigint;
  v_global_cap bigint;
  v_all        bigint;
  v_mine       bigint;
begin
  if p_owner is null or p_units is null or p_units < 0 then
    return false;
  end if;
  if p_kind = 'vision' then
    v_owner_cap := 1000; v_global_cap := 5000;
  elsif p_kind = 'embed' then
    v_owner_cap := 2000000; v_global_cap := 10000000;
  else
    return false;
  end if;
  if p_units > v_owner_cap then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_budget:' || p_kind));
  select coalesce(sum(u.units), 0) into v_all
    from public.ai_usage u where u.day = current_date and u.kind = p_kind;
  if v_all + p_units > v_global_cap then
    perform public.ops_alert_raise('ai_budget',
      case p_kind when 'vision' then 'Today''s picture-description budget is used up'
                  else 'Today''s server embedding budget is used up' end,
      'New pictures wait until tomorrow (UTC). If one account used most of it, look at it in the Security tab.',
      true, 'ai_budget:' || p_kind || ':' || current_date::text, interval '24 hours');
    return false;
  end if;
  select coalesce(max(u.units), 0) into v_mine
    from public.ai_usage u where u.owner_id = p_owner and u.day = current_date and u.kind = p_kind;
  if v_mine + p_units > v_owner_cap then
    return false;
  end if;
  insert into public.ai_usage (owner_id, day, kind, units) values (p_owner, current_date, p_kind, p_units)
  on conflict (owner_id, day, kind) do update set units = public.ai_usage.units + excluded.units;
  return true;
end;
$$;

-- The same, for a signed-in caller acting in a workspace they can edit (the
-- API's describe-now): charged to that workspace's owner.
create or replace function public.ai_budget_take(p_workspace uuid, p_kind text, p_units integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null or not public._actor_active() or not public.can_write_workspace(p_workspace) then
    return false;
  end if;
  select w.created_by into v_owner
    from public.workspaces w
   where w.id = p_workspace and w.ai_tagger_enabled is not false;
  if v_owner is null then
    return false;
  end if;
  return public._ai_budget_take(v_owner, p_kind, p_units);
end;
$$;

-- ── The job: claim, finish, release ─────────────────────────────────────────

-- Hands out up to p_limit pictures to describe, newest first, at most
-- p_per_owner per owner, each with a lease the finish must show. Queues new
-- pictures first: live uploads (not previews or thumbs) of a picture type,
-- on a live card or uploaded in the last day, in workspaces with AI on.
create or replace function public._image_describe_claim(p_limit integer default 12, p_per_owner integer default 4)
returns table (image_id uuid, lease_token uuid, owner_id uuid, workspace_id uuid, storage_path text,
               preview_path text, preview_sm_path text, size_bytes bigint, width integer, height integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_version constant integer := 1;  -- lib/vision.js PROMPT_VERSION
  v_token uuid := gen_random_uuid();
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_per   integer := least(greatest(coalesce(p_per_owner, 4), 1), 50);
begin
  insert into public.image_descriptions (image_id, workspace_id, status)
  select i.id, i.workspace_id, 'queued'
    from public.images i
    join public.workspaces w on w.id = i.workspace_id and w.ai_tagger_enabled is not false
   where i.deleted_at is null
     and i.storage_path !~ '/(previews|thumbs)/'
     and lower(substring(i.storage_path from '\.([A-Za-z0-9]+)$')) in
         ('jpg', 'jpeg', 'jfif', 'jpe', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp',
          'psd', 'arw', 'cr2', 'cr3', 'nef', 'dng', 'raf', 'orf', 'rw2')
     and (i.ref_count > 0 or cardinality(coalesce(i.live_board_ids, '{}')) > 0
          or i.created_at > now() - interval '24 hours')
     and not exists (select 1 from public.image_descriptions d where d.image_id = i.id)
   order by i.created_at desc
   limit v_limit * 20
  on conflict (image_id) do nothing;

  return query
  with due as (
    select d.image_id, i.created_at,
           row_number() over (partition by coalesce(w.created_by, i.uploaded_by) order by i.created_at desc) as rn
      from public.image_descriptions d
      join public.images i on i.id = d.image_id and i.deleted_at is null
      join public.workspaces w on w.id = i.workspace_id and w.ai_tagger_enabled is not false
     where (d.status = 'queued'
            or (d.status = 'failed' and d.attempts < 3)
            or (d.status in ('done', 'skipped') and coalesce(d.prompt_version, 0) < c_version))
       and (d.lease_until is null or d.lease_until < now())
       and coalesce(d.next_attempt_at, '-infinity'::timestamptz) <= now()
  ), picked as (
    select due.image_id from due where due.rn <= v_per order by due.created_at desc limit v_limit
  ), locked as (
    select d.image_id from public.image_descriptions d
     where d.image_id in (select picked.image_id from picked)
       and (d.lease_until is null or d.lease_until < now())
     for update skip locked
  ), claimed as (
    update public.image_descriptions d
       set lease_token = v_token, lease_until = now() + interval '5 minutes', updated_at = now()
      from locked
     where d.image_id = locked.image_id
    returning d.image_id
  )
  select i.id, v_token, coalesce(w.created_by, i.uploaded_by), i.workspace_id, i.storage_path,
         i.preview_path, i.preview_sm_path, i.size_bytes, i.width, i.height
    from claimed
    join public.images i on i.id = claimed.image_id
    join public.workspaces w on w.id = i.workspace_id;
end;
$$;

-- Writes the answer, only for the lease holder. 'done' returns the live image
-- cards showing the picture whose own workspace has AI on, for the embedder;
-- 'failed' backs off (30 min × attempts) and gives up after 3; 'skipped' is
-- for a picture with nothing the model can read. If the picture's workspace
-- switched AI off meanwhile, the row is deleted instead.
create or replace function public._image_describe_finish(
  p_image uuid, p_token uuid, p_status text,
  p_description text default null, p_keywords text[] default null, p_attrs jsonb default null,
  p_model text default null, p_tokens_in integer default null, p_tokens_out integer default null,
  p_error text default null)
returns table (workspace_id uuid, board_id uuid, card_id text, title text, body text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  c_version constant integer := 1;  -- lib/vision.js PROMPT_VERSION
  v_storage text;
  v_on      boolean;
begin
  if p_status is null or p_status not in ('done', 'failed', 'skipped') then
    raise exception 'image_describe_finish: bad status %', p_status using errcode = '22023';
  end if;
  select i.storage_path, (w.ai_tagger_enabled is not false)
    into v_storage, v_on
    from public.image_descriptions d
    join public.images i on i.id = d.image_id
    join public.workspaces w on w.id = i.workspace_id
   where d.image_id = p_image and d.lease_token = p_token
     for update of d;
  if not found then
    return;  -- the lease ran out and someone else holds it, or the picture is gone
  end if;
  if not v_on then
    delete from public.image_descriptions where image_id = p_image;
    return;
  end if;
  if p_status = 'done' and coalesce(btrim(p_description), '') <> '' then
    update public.image_descriptions
       set status = 'done', description = left(btrim(p_description), 400),
           keywords = coalesce(p_keywords[1:12], '{}'), attrs = coalesce(p_attrs, '{}'::jsonb),
           model = p_model, prompt_version = c_version, error_code = null, attempts = 0,
           lease_token = null, lease_until = null, next_attempt_at = null,
           tokens_in = p_tokens_in, tokens_out = p_tokens_out, described_at = now(), updated_at = now()
     where image_id = p_image;
    return query
      select ci.workspace_id, ci.board_id, ci.card_id, ci.title, ci.body
        from public.card_index ci
        join public.workspaces cw on cw.id = ci.workspace_id and cw.ai_tagger_enabled is not false
       where ci.kind = 'image' and (ci.meta->>'src') = 'r2:' || v_storage
         and not exists (select 1 from public.boards b where b.id = ci.board_id and b.deleted_at is not null);
  elsif p_status = 'skipped' then
    update public.image_descriptions
       set status = 'skipped', prompt_version = c_version, error_code = left(p_error, 40),
           lease_token = null, lease_until = null, next_attempt_at = null, updated_at = now()
     where image_id = p_image;
  else
    update public.image_descriptions
       set status = case when status = 'done' then 'done' else 'failed' end,
           attempts = attempts + 1, error_code = left(coalesce(p_error, 'empty'), 40),
           lease_token = null, lease_until = null,
           next_attempt_at = now() + (attempts + 1) * interval '30 minutes', updated_at = now()
     where image_id = p_image;
  end if;
end;
$$;

-- A refused budget frees the lease without counting an attempt.
create or replace function public._image_describe_release(p_image uuid, p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.image_descriptions
     set lease_token = null, lease_until = null, updated_at = now()
   where image_id = p_image and lease_token = p_token;
$$;

-- Image cards whose picture is described but whose embedding is missing or
-- older than the card or the description: a copy placed later, a renamed
-- card. The embedder skips the model when the text's hash is unchanged.
create or replace function public._image_card_embed_due(p_limit integer default 40)
returns table (workspace_id uuid, board_id uuid, card_id text, title text, body text,
               description text, keywords text[], content_hash text, owner_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select ci.workspace_id, ci.board_id, ci.card_id, ci.title, ci.body,
         d.description, d.keywords, ce.content_hash, cw.created_by
    from public.image_descriptions d
    join public.images i on i.id = d.image_id and i.deleted_at is null
    join public.card_index ci on ci.kind = 'image' and (ci.meta->>'src') = 'r2:' || i.storage_path
    join public.workspaces cw on cw.id = ci.workspace_id and cw.ai_tagger_enabled is not false
    left join public.card_embeddings ce on ce.entity_kind = 'card' and ce.card_id = ci.card_id
   where d.status = 'done'
     and not exists (select 1 from public.boards b where b.id = ci.board_id and b.deleted_at is not null)
     and (ce.card_id is null or ce.embedded_at < greatest(ci.updated_at, d.described_at))
   order by d.described_at desc
   limit least(greatest(coalesce(p_limit, 40), 1), 200);
$$;

-- ── Turning the AI switch off ───────────────────────────────────────────────

-- Off means nothing of a workspace's pictures is kept from the model: its
-- descriptions go, and so do its image cards' embeddings (only the server
-- embeds image cards, and only with their descriptions). 0594 extends this.
create or replace function public._tg_workspaces_ai_off_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ai_tagger_enabled is false and old.ai_tagger_enabled is distinct from false then
    delete from public.image_descriptions where workspace_id = new.id;
    delete from public.card_embeddings ce
     using public.card_index ci
     where ci.workspace_id = new.id and ci.kind = 'image'
       and ce.entity_kind = 'card' and ce.card_id = ci.card_id;
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_ai_off_cleanup on public.workspaces;
create trigger workspaces_ai_off_cleanup
  after update of ai_tagger_enabled on public.workspaces
  for each row execute function public._tg_workspaces_ai_off_cleanup();

-- ── Grants (0311: born with authenticated + service_role) ───────────────────

revoke execute on function public._ai_budget_take(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public._image_describe_claim(integer, integer) from public, anon, authenticated;
revoke execute on function public._image_describe_finish(uuid, uuid, text, text, text[], jsonb, text, integer, integer, text) from public, anon, authenticated;
revoke execute on function public._image_describe_release(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._image_card_embed_due(integer) from public, anon, authenticated;
revoke execute on function public._tg_workspaces_ai_off_cleanup() from public, anon, authenticated;
grant execute on function public._ai_budget_take(uuid, text, integer) to service_role;
grant execute on function public._image_describe_claim(integer, integer) to service_role;
grant execute on function public._image_describe_finish(uuid, uuid, text, text, text[], jsonb, text, integer, integer, text) to service_role;
grant execute on function public._image_describe_release(uuid, uuid) to service_role;
grant execute on function public._image_card_embed_due(integer) to service_role;
revoke execute on function public.ai_budget_take(uuid, text, integer) from public, anon;
grant execute on function public.ai_budget_take(uuid, text, integer) to authenticated, service_role;

do $proof$
declare
  f text;
begin
  foreach f in array array[
    'public._ai_budget_take(uuid,text,integer)',
    'public._image_describe_claim(integer,integer)',
    'public._image_describe_finish(uuid,uuid,text,text,text[],jsonb,text,integer,integer,text)',
    'public._image_describe_release(uuid,uuid)',
    'public._image_card_embed_due(integer)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0593: clients can call %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0593: the Worker cannot call %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public._tg_workspaces_ai_off_cleanup()', 'execute')
     or has_function_privilege('authenticated', 'public._tg_workspaces_ai_off_cleanup()', 'execute') then
    raise exception '0593: clients can call the switch-off trigger function';
  end if;
  if not has_function_privilege('authenticated', 'public.ai_budget_take(uuid,text,integer)', 'execute')
     or has_function_privilege('anon', 'public.ai_budget_take(uuid,text,integer)', 'execute') then
    raise exception '0593: ai_budget_take must be signed-in only';
  end if;
  if has_table_privilege('anon', 'public.image_descriptions', 'select')
     or has_table_privilege('authenticated', 'public.image_descriptions', 'insert')
     or has_table_privilege('authenticated', 'public.image_descriptions', 'update')
     or has_table_privilege('authenticated', 'public.image_descriptions', 'delete')
     or has_column_privilege('authenticated', 'public.image_descriptions', 'status', 'select')
     or has_column_privilege('authenticated', 'public.image_descriptions', 'lease_token', 'select') then
    raise exception '0593: image_descriptions is open wider than its readers';
  end if;
  if not has_column_privilege('authenticated', 'public.image_descriptions', 'description', 'select') then
    raise exception '0593: readers cannot read a description';
  end if;
  if has_table_privilege('anon', 'public.ai_usage', 'select')
     or has_table_privilege('authenticated', 'public.ai_usage', 'select') then
    raise exception '0593: ai_usage is readable by clients';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.image_descriptions'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.ai_usage'::regclass) then
    raise exception '0593: RLS is off on a new table';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.workspaces'::regclass
                    and tgname = 'workspaces_ai_off_cleanup' and not tgisinternal) then
    raise exception '0593: the switch-off trigger is missing';
  end if;
end $proof$;

commit;
