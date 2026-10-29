-- 0820_showcase_library.sql — the boards engine's library (the owner, 2026-10-29:
-- "automatically build BEAUTIFUL boards to use for all of our SEO pages and for
-- marketing where its super easy for us to go in and find boards for marketing
-- screenshots and stuff").
--
-- The engine (boards/scripts/engine/, run on the owner's Mac with the service
-- role) makes a board in the Clusters Showcase workspace, shoots it, uploads the
-- shots to R2 under showcase/<board id>/, and writes one showcase_boards row. The
-- admin's Boards tab reads them all through showcase_library() and OKs or skips
-- the new ones through showcase_decide().
--
-- Shots are served by the Worker at /api/showcase-shot/<board id>/<file>?s=<sig>
-- (boards/src/worker-showcase.js). The signature is the email-card one's HMAC
-- (app_config 'email_thumb_hmac', key = sha256(secret || ':email-thumb-v1'))
-- over a message of its own, 'showcase-shot:<board id>/<file>', so a showcase
-- signature can never pass as an email one or the reverse. The Worker computes
-- the same thing; keep the two in lockstep.
--
-- Nothing here is public: both tables have RLS on and no policies, and are
-- closed to anon and authenticated outright. New: showcase_library and
-- showcase_decide, admin only (_require_admin), EXECUTE for authenticated and
-- service_role only (0311). _showcase_shot_sig is revoked from public, anon and
-- authenticated.

begin;

set local lock_timeout = '3s';

-- ── One row per engine run ───────────────────────────────────────────────────
create table if not exists public.showcase_runs (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  kind        text not null default 'daily'
              check (kind in ('daily', 'batch', 'page', 'subject')),
  ok          boolean,
  made        integer not null default 0 check (made >= 0),
  dropped     integer not null default 0 check (dropped >= 0),
  note        text
);

-- ── One row per board the engine made ────────────────────────────────────────
-- shots: [{ kind, file, thumb?, w, h, bytes, theme? }], each file stored at
-- showcase/<board_id>/<file> in the images bucket. phash: the board's photos'
-- perceptual hashes, so no photo is used twice across boards.
create table if not exists public.showcase_boards (
  board_id    uuid primary key references public.boards(id) on delete cascade,
  slug        text not null unique
              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 80),
  title       text not null check (length(title) between 1 and 160),
  story       text,
  subject     text not null check (subject ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  page_path   text check (page_path is null or page_path ~ '^/[a-z0-9/-]*$'),
  status      text not null default 'new' check (status in ('new', 'ok', 'skipped')),
  placed_on   text[] not null default '{}',
  score       jsonb not null default '{}'::jsonb,
  shots       jsonb not null default '[]'::jsonb check (jsonb_typeof(shots) = 'array'),
  credits     jsonb not null default '[]'::jsonb check (jsonb_typeof(credits) = 'array'),
  phash       text[] not null default '{}',
  run_id      bigint references public.showcase_runs(id) on delete set null,
  made_at     timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references auth.users(id) on delete set null
);

create index if not exists showcase_boards_made_at_idx on public.showcase_boards (made_at desc);

alter table public.showcase_boards enable row level security;
alter table public.showcase_runs enable row level security;
revoke all on table public.showcase_boards from public, anon, authenticated;
revoke all on table public.showcase_runs from public, anon, authenticated;

-- ── The shot signature (mirror: boards/src/worker-showcase.js) ───────────────
-- Null when the secret is missing: the page then shows the board without shots
-- rather than links that can't load.
create or replace function public._showcase_shot_sig(p_message text)
returns text
language plpgsql stable security definer
set search_path = 'public'
as $fn$
declare
  v_secret text;
begin
  select value->>'secret' into v_secret from public.app_config where key = 'email_thumb_hmac';
  if coalesce(v_secret, '') = '' then
    return null;
  end if;
  return left(encode(extensions.hmac(
    convert_to('showcase-shot:' || p_message, 'UTF8'),
    extensions.digest(convert_to(v_secret || ':email-thumb-v1', 'UTF8'), 'sha256'),
    'sha256'), 'hex'), 32);
end;
$fn$;

revoke execute on function public._showcase_shot_sig(text) from public, anon, authenticated;

-- ── The library: every board, newest first, with signed shot links ──────────
create or replace function public.showcase_library()
returns jsonb
language plpgsql stable security definer
set search_path = 'public'
as $fn$
declare
  v_boards jsonb;
  v_run jsonb;
begin
  perform public._require_admin();

  select coalesce(jsonb_agg(t.item order by t.made_at desc), '[]'::jsonb)
    into v_boards
  from (
    select jsonb_build_object(
      'board_id', s.board_id,
      'workspace_id', b.workspace_id,
      'slug', s.slug,
      'title', s.title,
      'story', s.story,
      'subject', s.subject,
      'page_path', s.page_path,
      'status', s.status,
      'placed_on', to_jsonb(s.placed_on),
      'score', s.score,
      'credits', s.credits,
      'made_at', s.made_at,
      'decided_at', s.decided_at,
      'decided_by_person', s.decided_by is not null,
      'trashed', b.deleted_at is not null,
      'live', exists (
        select 1 from public.public_boards p
         where p.board_id = s.board_id and p.published_at is not null
      ),
      'shots', coalesce((
        select jsonb_agg(
          shot
          || jsonb_build_object(
               'url', '/api/showcase-shot/' || s.board_id || '/' || (shot->>'file')
                      || '?s=' || public._showcase_shot_sig(s.board_id || '/' || (shot->>'file')))
          || case when shot ? 'thumb' then jsonb_build_object(
               'thumb_url', '/api/showcase-shot/' || s.board_id || '/' || (shot->>'thumb')
                            || '?s=' || public._showcase_shot_sig(s.board_id || '/' || (shot->>'thumb')))
             else '{}'::jsonb end
          order by ord)
          from jsonb_array_elements(s.shots) with ordinality as e(shot, ord)
         where shot->>'file' ~ '^[a-z0-9][a-z0-9._-]{0,80}$'
           and (not shot ? 'thumb' or shot->>'thumb' ~ '^[a-z0-9][a-z0-9._-]{0,80}$')
      ), '[]'::jsonb)
    ) as item,
    s.made_at
    from public.showcase_boards s
    join public.boards b on b.id = s.board_id
  ) t;

  select to_jsonb(r) into v_run
  from (
    select id, started_at, finished_at, kind, ok, made, dropped, note
      from public.showcase_runs
     order by started_at desc
     limit 1
  ) r;

  return jsonb_build_object(
    'boards', v_boards,
    'ok_by_person', (select count(*) from public.showcase_boards
                      where status = 'ok' and decided_by is not null),
    'last_run', v_run
  );
end;
$fn$;

revoke execute on function public.showcase_library() from public, anon;
grant execute on function public.showcase_library() to authenticated, service_role;

-- ── OK, skip, or put back (the undo) ─────────────────────────────────────────
create or replace function public.showcase_decide(p_board_id uuid, p_status text)
returns jsonb
language plpgsql volatile security definer
set search_path = 'public'
as $fn$
declare
  v_row public.showcase_boards;
begin
  perform public._require_admin();
  if p_status is null or p_status not in ('ok', 'skipped', 'new') then
    raise exception 'status must be ok, skipped or new' using errcode = '22023';
  end if;

  update public.showcase_boards
     set status = p_status,
         decided_at = case when p_status = 'new' then null else now() end,
         decided_by = case when p_status = 'new' then null else auth.uid() end
   where board_id = p_board_id
  returning * into v_row;

  if v_row.board_id is null then
    raise exception 'no such showcase board' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'board_id', v_row.board_id,
    'status', v_row.status,
    'decided_at', v_row.decided_at
  );
end;
$fn$;

revoke execute on function public.showcase_decide(uuid, text) from public, anon;
grant execute on function public.showcase_decide(uuid, text) to authenticated, service_role;

do $$
declare
  f text;
  t text;
begin
  foreach f in array array[
    'public.showcase_library()',
    'public.showcase_decide(uuid, text)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '0820: anon can execute %', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '0820: authenticated cannot execute %', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0820: service_role cannot execute %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public._showcase_shot_sig(text)', 'execute') then
    raise exception '0820: anon can execute public._showcase_shot_sig(text)';
  end if;
  if has_function_privilege('authenticated', 'public._showcase_shot_sig(text)', 'execute') then
    raise exception '0820: authenticated can execute public._showcase_shot_sig(text)';
  end if;
  foreach t in array array['public.showcase_boards', 'public.showcase_runs'] loop
    if has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select')
       or has_table_privilege('authenticated', t, 'insert') or has_table_privilege('authenticated', t, 'update') then
      raise exception '0820: % is open to signed-in or signed-out callers', t;
    end if;
    if not (has_table_privilege('service_role', t, 'select') and has_table_privilege('service_role', t, 'insert')
            and has_table_privilege('service_role', t, 'update')) then
      raise exception '0820: the engine (service_role) cannot write %', t;
    end if;
    if not (select relrowsecurity from pg_class where oid = t::regclass) then
      raise exception '0820: % has row level security off', t;
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
