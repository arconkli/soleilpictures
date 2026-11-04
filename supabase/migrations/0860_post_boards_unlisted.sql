-- 0860_post_boards_unlisted.sql — post boards: public by address, listed nowhere.
--
-- The TikTok slideshow machine's boards get a short address, /c/<word>, that a
-- post can name. They are UNLISTED: the page answers anyone who has the word,
-- but the Worker marks it noindex, and nothing that lists public clusters
-- (/explore, sitemap.xml, the image sitemap, related clusters, IndexNow, which
-- takes its URLs from the sitemap) ever names one.
--
--   1. public_boards.unlisted (default false). Post boards are written by the
--      service role only (engine/showcaseWrite.mjs), with published_by = 'post'
--      (free text, no check) and created_by = the showcase account. No new
--      write RPC; RLS on public_boards stays admin-only.
--      An unlisted row must name its maker (check below): the sharing ledger
--      (0744) credits a /c/ page's views and first-touch signups to
--      coalesce(submitted_by, created_by), and drops rows whose sharer is an
--      internal account. The showcase account is internal, so naming it keeps
--      the machine's own traffic out of the user-sharing numbers. A row with
--      no maker would be counted as a sharer-less Explore share instead.
--   2. list_public_boards, list_public_board_images, get_related_public_boards
--      (all from 0371): `and not pb.unlisted`; related also answers [] when
--      the cluster being read is itself unlisted.
--   3. get_public_board_meta (0182) and get_public_board_page (0597) return
--      'unlisted', so the Worker can add noindex and React can see it.
--      _resolve_published_board stays as it is: the page must resolve.
--   4. get_share_meta (0830): a /share/<token> page never canonicalises onto
--      an unlisted cluster's noindex address.
--   5. social_board_visits(key, slugs, since): per-word human visits for the
--      machine, behind 0780's key check and granted like social_tiktok_feed.
--      Counts share_view rows (fired once per page load after the cluster
--      loads) by props->>'public_slug'; never `props ? 'public_slug'`, which
--      is a sticky first-touch prop carried by every later event. A partial
--      index keeps it to a few index pages.
--   6. social_tiktok_feed gets statement_timeout 30s. Under PostgREST this
--      does apply: PostgREST sets the function's own settings before the call
--      (Supabase docs, Database > Timeouts > Function level). It does not
--      when the function is called from SQL, where the caller's timer is
--      already running (tested on a local Postgres 17). The machine's short
--      incremental fetch is still the better fix for a slow feed.
--   7. The 0311 proof block.

begin;

-- ── 1. The flag ─────────────────────────────────────────────────────────────
alter table public.public_boards
  add column if not exists unlisted boolean not null default false;

alter table public.public_boards
  drop constraint if exists public_boards_unlisted_has_maker;
alter table public.public_boards
  add constraint public_boards_unlisted_has_maker
  check (not unlisted or created_by is not null);

-- ── 2. Listings leave unlisted clusters out ─────────────────────────────────
-- list_public_boards: 0371 definition + `and not pb.unlisted`.
CREATE OR REPLACE FUNCTION public.list_public_boards()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object(
    'slug',             pb.slug,
    'seo_title',        coalesce(pb.seo_title, b.name),
    'seo_description',  pb.seo_description,
    'target_keyword',   pb.target_keyword,
    'priority',         pb.priority,
    'published_at',     pb.published_at,
    'thumb_key',        b.thumb_key,
    'thumb_updated_at', b.thumb_updated_at,
    'thumb_version',    b.thumb_version,
    'card_count',       b.card_count,
    'updated_at',       greatest(pb.updated_at, b.updated_at)
  ) order by pb.priority desc, pb.published_at desc), '[]'::json)
  from public_boards pb
  join boards b on b.id = pb.board_id
  join workspaces w on w.id = b.workspace_id
  where pb.published_at is not null and b.deleted_at is null
    -- 0371: nothing a banned account owns or submitted stays published.
    and not public._user_banned(w.created_by)
    and not public._user_banned(pb.submitted_by)
    -- 0860: an unlisted (post) cluster is listed nowhere.
    and not pb.unlisted;
$function$;

-- list_public_board_images: 0371 definition + `and not pb.unlisted`.
CREATE OR REPLACE FUNCTION public.list_public_board_images(p_board_limit integer DEFAULT 150, p_per_board integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out json;
begin
  with pubs as (
    select pb.board_id, pb.slug
    from public_boards pb
    join boards b on b.id = pb.board_id and b.deleted_at is null
    join workspaces w on w.id = b.workspace_id
    where pb.published_at is not null
      -- 0371: nothing a banned account owns or submitted stays published.
      and not public._user_banned(w.created_by)
      and not public._user_banned(pb.submitted_by)
      -- 0860: an unlisted (post) cluster is listed nowhere.
      and not pb.unlisted
    order by pb.priority desc nulls last, pb.published_at desc
    limit greatest(1, least(coalesce(p_board_limit, 150), 500))
  ),
  picked as (
    select p.slug, ci.kind, ci.title, ci.meta, ci.board_id, ci.card_id, ci.updated_at,
           row_number() over (
             partition by p.board_id
             order by ci.updated_at desc, ci.card_id
           ) - 1 as i
    from pubs p
    join lateral (
      with recursive sub as (
        select id from boards where id = p.board_id and deleted_at is null
        union all
        select b.id from boards b join sub s on b.parent_board_id = s.id
        where b.deleted_at is null
      )
      select c.board_id, c.card_id, c.kind, c.title, c.meta, c.updated_at
      from card_index c
      where c.board_id in (select id from sub)
        and c.kind in ('image','note','doc','link')
      order by c.updated_at desc, c.card_id
      limit 60
    ) ci on true
  ),
  imgs as (
    select pk.slug, pk.i,
           coalesce(nullif(ca.alt, ''), pk.meta->>'alt', nullif(pk.title, '')) as title,
           row_number() over (partition by pk.slug order by pk.i) as rn
    from picked pk
    left join card_alts ca on ca.board_id = pk.board_id and ca.card_id = pk.card_id
    where pk.kind = 'image' and (pk.meta->>'src') like 'r2:%'
  )
  select coalesce(
           json_agg(json_build_object('slug', slug, 'i', i, 'title', title)
                    order by slug, i),
           '[]'::json)
    into v_out
  from imgs
  where rn <= greatest(1, least(coalesce(p_per_board, 30), 100));
  return v_out;
end;
$function$;

-- get_related_public_boards: 0371 definition; an unlisted cluster gets no
-- related list and is never offered as one.
CREATE OR REPLACE FUNCTION public.get_related_public_boards(p_slug text, p_limit integer DEFAULT 6)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_target uuid;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then return '[]'::json; end if;
  -- 0860: an unlisted (post) cluster links to nothing.
  if exists (select 1 from public_boards pb where pb.board_id = v_target and pb.unlisted) then return '[]'::json; end if;
  return (
    select coalesce(json_agg(json_build_object('slug', t.slug, 'seo_title', t.seo_title)
             order by t.overlap desc, t.published_at desc), '[]'::json)
    from (
      select pb.slug, coalesce(pb.seo_title, b.name) as seo_title, x.overlap, pb.published_at
      from (
        select bt2.board_id, count(*) as overlap
        from board_tags bt1
        join board_tags bt2 on bt2.tag_id = bt1.tag_id and bt2.board_id <> bt1.board_id
        where bt1.board_id = v_target
        group by bt2.board_id
      ) x
      join public_boards pb on pb.board_id = x.board_id and pb.published_at is not null
      join boards b on b.id = pb.board_id and b.deleted_at is null
      join workspaces w on w.id = b.workspace_id
      -- 0371: nothing a banned account owns or submitted is recommended.
      where not public._user_banned(w.created_by)
        and not public._user_banned(pb.submitted_by)
        -- 0860: nor is an unlisted (post) cluster.
        and not pb.unlisted
      order by x.overlap desc, pb.published_at desc
      limit greatest(1, least(coalesce(p_limit, 6), 24))
    ) t
  );
end;
$function$;

-- ── 3. The page knows it is unlisted ────────────────────────────────────────
-- get_public_board_meta: 0182 definition + 'unlisted'.
create or replace function public.get_public_board_meta(p_slug text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_out    json;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;

  select json_build_object(
           'board_id',         pb.board_id,
           'slug',             pb.slug,
           'name',             b.name,
           'seo_title',        pb.seo_title,
           'seo_description',  pb.seo_description,
           'seo_body',         pb.seo_body,
           'target_keyword',   pb.target_keyword,
           'og_image_key',     pb.og_image_key,
           'is_template',      pb.is_template,
           'unlisted',         pb.unlisted,
           'published_at',     pb.published_at,
           'updated_at',       greatest(pb.updated_at, b.updated_at),
           'thumb_key',        b.thumb_key,
           'thumb_updated_at', b.thumb_updated_at,
           'thumb_version',    b.thumb_version,
           'card_count',       (select count(*) from card_index ci where ci.board_id = pb.board_id and b.deleted_at is null)
         )
    into v_out
  from public_boards pb join boards b on b.id = pb.board_id
  where pb.board_id = v_target;

  return v_out;
end;
$$;

-- get_public_board_page: 0597 definition + 'unlisted' in meta.
create or replace function public.get_public_board_page(p_slug text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_meta   json;
  v_cards  json;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;

  select json_build_object(
           'board_id',         pb.board_id,
           'slug',             pb.slug,
           'name',             b.name,
           'seo_title',        pb.seo_title,
           'seo_description',  pb.seo_description,
           'seo_body',         pb.seo_body,
           'answer',           pb.answer,
           'faq',              pb.faq,
           'is_template',      pb.is_template,
           'unlisted',         pb.unlisted,
           'target_keyword',   pb.target_keyword,
           'published_at',     pb.published_at,
           'updated_at',       greatest(pb.updated_at, b.updated_at)
         )
    into v_meta
  from public_boards pb join boards b on b.id = pb.board_id
  where pb.board_id = v_target;

  with recursive sub as (
    select id from boards where id = v_target and deleted_at is null
    union all
    select b.id from boards b join sub s on b.parent_board_id = s.id
    where b.deleted_at is null
  ),
  legacy as (
    select ci.card_id,
           row_number() over (order by ci.updated_at desc, ci.card_id) - 1 as legacy_i
    from card_index ci
    where ci.board_id in (select id from sub)
      and ci.kind in ('image','note','doc','link')
    order by ci.updated_at desc, ci.card_id
    limit 60
  ),
  page as (
    select ci.board_id, ci.card_id, ci.kind, ci.title, ci.body, ci.meta
    from card_index ci
    where ci.board_id in (select id from sub)
      and ci.kind in ('image','note','doc','link','palette','schedule','grid',
                      'shape','video','audio','pdf','file','art','board','boardlink')
    order by (ci.meta->'pos'->>'y')::numeric nulls last,
             (ci.meta->'pos'->>'x')::numeric nulls last,
             ci.card_id
    limit 150
  )
  select coalesce(json_agg(json_build_object(
           'card_id',       p.card_id,
           'kind',          p.kind,
           'title',         nullif(p.title, ''),
           'body',          nullif(p.body, ''),
           'href',          case when p.kind = 'link' then p.meta->>'url' else null end,
           'legacy_i',      case when p.kind = 'image' then l.legacy_i else null end,
           -- 0597: a person's alt, the card's, the picture's description, then
           -- the older model's alt; only the description of an image filed on,
           -- or referenced by, this card's own board (0366's rule for keys).
           'media',         case
             when p.kind = 'image' and (p.meta->>'src') like 'r2:%'
             then json_build_object(
                    'alt', coalesce(case when ca.source = 'user' then nullif(ca.alt, '') end,
                                    nullif(p.meta->>'alt', ''), (
                             select nullif(d.description, '')
                               from images img
                               join image_descriptions d on d.image_id = img.id and d.status = 'done'
                              where img.storage_path = regexp_replace(p.meta->>'src', '^r2:', '')
                                and img.deleted_at is null
                                and (img.board_id = p.board_id or img.referenced_in_board_ids @> array[p.board_id])
                              limit 1), nullif(ca.alt, '')))
             else null end,
           'swatches',      case when p.kind = 'palette'  then p.meta->'swatches' else null end,
           'rows',          case when p.kind = 'schedule' then p.meta->'rows'     else null end,
           'cells',         case when p.kind = 'grid' then (
                              select json_agg(json_build_object(
                                'type', c->>'type', 'text', c->>'text', 'alt', c->>'alt'))
                              from jsonb_array_elements(p.meta->'cells') c
                            ) else null end,
           'grid_dims',     case when p.kind = 'grid'
                              then json_build_object('rows', p.meta->'rows', 'cols', p.meta->'cols')
                              else null end,
           'shape',         case when p.kind = 'shape'    then p.meta->>'shape'   else null end,
           'label',         case when p.kind = 'shape'    then p.meta->>'label'   else null end,
           -- Audio: the line a producer actually reads. Without it a published
           -- sample pack rendered nothing crawlable but a filename, because
           -- publicPageModel's itemHtml had no audio case to render either.
           -- No storage key is exposed here, same rule the grid cells follow.
           'audio',         case when p.kind = 'audio'
                              then json_build_object(
                                     'duration', p.meta->'duration',
                                     'bpm',      p.meta->'bpm',
                                     'key',      p.meta->>'musicalKey',
                                     'format',   upper(coalesce(p.meta->>'ext', '')))
                              else null end,
           'section_header', coalesce((p.meta->>'sectionHeader')::boolean, false),
           'sub',           p.meta->>'sub'
         ) order by (p.meta->'pos'->>'y')::numeric nulls last,
                    (p.meta->'pos'->>'x')::numeric nulls last,
                    p.card_id), '[]'::json)
    into v_cards
  from page p
  left join legacy l on l.card_id = p.card_id
  left join card_alts ca on ca.board_id = p.board_id and ca.card_id = p.card_id;

  return json_build_object('meta', v_meta, 'cards', v_cards);
end;
$$;

-- ── 4. A share link never canonicalises onto an unlisted address ────────────
-- get_share_meta: 0830 definition + `and not pb.unlisted` on the slug lookup.
create or replace function public.get_share_meta(p_token uuid, p_board_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_root_id   uuid;
  v_target    uuid;
  v_allow     boolean;
  v_include   boolean;
  v_board     record;
  v_slug      text;
  v_kind      text;
  v_role      text;
  v_maker     uuid;
  v_name      text;
  v_cards     int;
  v_clusters  int;
  v_has_kids  boolean;
begin
  select t.root_id, t.target_id, t.allow_indexing, t.include_subboards
    into v_root_id, v_target, v_allow, v_include
  from public._resolve_share_target(p_token, p_board_id) t;

  select b.id, b.workspace_id, b.name, b.thumb_key, b.thumb_updated_at, b.thumb_version into v_board
  from boards b where b.id = v_target;

  select pb.slug into v_slug
  from public_boards pb
  where pb.board_id = v_target and pb.published_at is not null
    -- 0860: an unlisted (post) address is noindex; never canonicalise onto it.
    and not pb.unlisted;

  select l.kind, l.role, l.created_by into v_kind, v_role, v_maker
  from public_share_links l where l.token = p_token;

  -- First word of the display name only. An address-looking name is no name.
  select nullif(split_part(btrim(p.display_name), ' ', 1), '') into v_name
  from public.profiles p where p.user_id = v_maker;
  if v_name is not null and (position('@' in v_name) > 0 or length(v_name) > 40) then
    v_name := null;
  end if;

  select count(*) filter (where ci.kind not in ('board', 'boardlink', 'shape')),
         count(*) filter (where ci.kind = 'board')
    into v_cards, v_clusters
  from public.card_index ci where ci.board_id = v_target;

  select exists (select 1 from boards c where c.parent_board_id = v_root_id and c.deleted_at is null)
    into v_has_kids;

  return json_build_object(
    'board_id', v_board.id,
    'workspace_id', v_board.workspace_id,
    'root_id', v_root_id,
    'name', v_board.name,
    'thumb_key', v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at,
    'thumb_version', v_board.thumb_version,
    'allow_indexing', coalesce(v_allow, false),
    'public_slug', v_slug,
    'link_kind', coalesce(v_kind, 'view'),
    'link_role', coalesce(v_role, 'viewer'),
    'can_join', coalesce(v_kind, 'view') = 'invite'
                or coalesce(v_include, false)
                or not coalesce(v_has_kids, false),
    'sharer_name', v_name,
    'card_count', coalesce(v_cards, 0),
    'cluster_count', coalesce(v_clusters, 0)
  );
end;
$function$;

-- ── 5. Per-word visits for the machine ──────────────────────────────────────
-- One row per word asked for (zeros included). sessions = distinct devices
-- (a refresh is one), views = page loads. Aggregates only; the window is
-- held to the last 60 days and the list to 200 words.
create or replace function public.social_board_visits(p_key text, p_slugs text[], p_since timestamptz)
returns table (slug text, sessions bigint, views bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
set statement_timeout = '30s'
as $$
declare
  v_since timestamptz;
begin
  if p_key is null or length(p_key) < 32 or not exists (
    select 1 from social_feed_keys k where k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_slugs), 0) > 200 then
    raise exception 'too many words' using errcode = '22023';
  end if;
  v_since := greatest(coalesce(p_since, now() - interval '14 days'), now() - interval '60 days');

  return query
  with want as (
    select distinct w.s from unnest(coalesce(p_slugs, '{}'::text[])) as w(s) where w.s is not null
  ),
  hits as (
    select e.props->>'public_slug' as s,
           count(distinct e.session_id) as sessions,
           count(*) as views
      from analytics_events e
     where e.event = 'share_view'
       -- /c/ page loads only: a /share/ page's share_view carries the visitor's sticky first-touch slug.
       and e.props->>'link_kind' = 'public'
       and e.props->>'public_slug' = any (array(select want.s from want))
       and e.occurred_at >= v_since
       and coalesce(e.props->>'valid', 'true') <> 'false'
     group by 1
  )
  select want.s, coalesce(hits.sessions, 0)::bigint, coalesce(hits.views, 0)::bigint
    from want left join hits on hits.s = want.s
   order by want.s;
end;
$$;

revoke execute on function public.social_board_visits(text, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.social_board_visits(text, text[], timestamptz) to anon, service_role;

-- ── 6. The site feed gets the time it needs ─────────────────────────────────
alter function public.social_tiktok_feed(text, integer) set statement_timeout = '30s';

-- ── 7. Proof (the 0311 habit) ───────────────────────────────────────────────
do $proof$
declare
  v_fn   text;
  v_role text;
begin
  -- Redefined public reads: anyone may still run them (create or replace
  -- keeps the ACL; this proves it), and they keep their definer rights.
  foreach v_fn in array array[
    'public.list_public_boards()',
    'public.list_public_board_images(integer, integer)',
    'public.get_related_public_boards(text, integer)',
    'public.get_public_board_meta(text)',
    'public.get_public_board_page(text)',
    'public.get_share_meta(uuid, uuid)'] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if not has_function_privilege(v_role, v_fn, 'execute') then
        raise exception '0860: % cannot run %', v_role, v_fn;
      end if;
    end loop;
    if not (select p.prosecdef and 'search_path=public' = any (p.proconfig)
              from pg_proc p where p.oid = v_fn::regprocedure) then
      raise exception '0860: % lost its definer rights or its search_path', v_fn;
    end if;
    if position('unlisted' in pg_get_functiondef(v_fn::regprocedure)) = 0 then
      raise exception '0860: % does not read unlisted', v_fn;
    end if;
  end loop;

  -- The machine's two reads: the key holder (anon + key) and the service
  -- role only.
  foreach v_fn in array array[
    'public.social_board_visits(text, text[], timestamptz)',
    'public.social_tiktok_feed(text, integer)'] loop
    if not has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0860: anon or service_role cannot run %', v_fn;
    end if;
    if has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0860: authenticated can run %', v_fn;
    end if;
    if has_function_privilege('public', v_fn, 'execute') then
      raise exception '0860: PUBLIC can run %', v_fn;
    end if;
    if not (select 'statement_timeout=30s' = any (p.proconfig)
              and p.prosecdef
              and 'search_path=public, pg_temp' = any (p.proconfig)
              from pg_proc p where p.oid = v_fn::regprocedure) then
      raise exception '0860: % lacks its 30s timeout, definer rights or search_path', v_fn;
    end if;
  end loop;

  -- The resolver the page uses stays closed to clients.
  if has_function_privilege('anon', 'public._resolve_published_board(text)', 'execute')
     or has_function_privilege('authenticated', 'public._resolve_published_board(text)', 'execute') then
    raise exception '0860: _resolve_published_board is callable by a client';
  end if;

  if has_table_privilege('anon', 'public.social_feed_keys', 'select')
     or has_table_privilege('authenticated', 'public.social_feed_keys', 'select') then
    raise exception '0860: social_feed_keys is readable by a client';
  end if;
end $proof$;

notify pgrst, 'reload schema';

commit;
