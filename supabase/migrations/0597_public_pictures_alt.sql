-- 0597 — A published cluster's pictures carry their descriptions as alt text
-- (photo vision, 2026-10-28; the owner's "go for alt").
--
-- get_public_board_page (the article the Worker serves and PublicArticle.jsx
-- mirrors) and get_public_board_content (the legacy crawlable list) restated
-- from the live bodies with one change, the order a picture's alt is taken in:
--   1. alt a person wrote (card_alts source 'user'),
--   2. the card's own alt (meta.alt: the showcase clusters' curated alts),
--   3. the picture's description (0593, finished rows only),
--   4. alt the admin's /api/seo/alt wrote with an older model (card_alts
--      source 'ai' or 'auto': 8–16 words from LLaVA 1.5, which the
--      description supersedes when there is one).
-- The client's last resort, the title, follows as before.
--
-- The description is only ever the one of an image FILED ON, or referenced
-- by, the card's own board: card_index is client-written, so a card whose
-- meta.src names another workspace's file must not publish that file's
-- description (0366's rule for keys, applied to text).
--
-- Never visible on the page except as alt: a browser prints alt beside a
-- picture that fails to load, which the owner accepted. A workspace with AI
-- suggestions off has no descriptions (0593's cleanup), so nothing changes
-- there. Both stay SECURITY DEFINER for anon, as before; image_descriptions
-- itself stays closed to anon, and the proof says so.
--
-- Applied live 2026-10-28 as 0597_public_pictures_alt_part1 (content),
-- part2 (page) and part3_proof.

begin;
set local lock_timeout = '3s';

create or replace function public.get_public_board_content(p_slug text, p_limit integer default 60)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_cards  json;
  v_subs   json;
  v_total  int;
  v_lim    int;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;
  v_lim := greatest(1, least(coalesce(p_limit, 60), 200));

  with recursive sub as (
    select id from boards where id = v_target and deleted_at is null
    union all
    select b.id from boards b join sub s on b.parent_board_id = s.id
    where b.deleted_at is null
  ),
  picked as (
    select ci.board_id, ci.card_id, ci.kind, ci.title, ci.body, ci.meta, ci.updated_at
    from card_index ci
    where ci.board_id in (select id from sub)
      and ci.kind in ('image','note','doc','link')
    order by ci.updated_at desc, ci.card_id
    limit v_lim
  )
  select coalesce(json_agg(json_build_object(
           'card_id', p.card_id,
           'kind',    p.kind,
           'title',   nullif(p.title, ''),
           'body',    nullif(p.body, ''),
           'href',    case when p.kind = 'link' then p.meta->>'url' else null end,
           -- 0366: a key is served only when it is an image filed on, or
           -- referenced by, this card's own board — never whatever meta.src says.
           -- 0597: a person's alt, the card's, the picture's description, then
           -- the older model's alt.
           'media',   case
             when p.kind = 'image' and (p.meta->>'src') like 'r2:%' and img.storage_path is not null
             then json_build_object(
                    'alt',         coalesce(case when ca.source = 'user' then nullif(ca.alt, '') end,
                                            nullif(p.meta->>'alt', ''), nullif(d.description, ''), nullif(ca.alt, '')),
                    'src_key',     p.meta->>'src',
                    'preview_key', img.preview_path,
                    'blur',        img.blur_hash
                  )
             else null end
         ) order by p.updated_at desc, p.card_id), '[]'::json)
    into v_cards
  from picked p
  left join card_alts ca on ca.board_id = p.board_id and ca.card_id = p.card_id
  left join images img
    on img.storage_path = regexp_replace(p.meta->>'src', '^r2:', '')
   and img.deleted_at is null
   and (img.board_id = p.board_id or img.referenced_in_board_ids @> array[p.board_id])
  left join image_descriptions d on d.image_id = img.id and d.status = 'done';

  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name)
           order by b.name), '[]'::json)
    into v_subs
  from boards b where b.parent_board_id = v_target and b.deleted_at is null;

  select count(*) into v_total
  from card_index ci
  where ci.board_id = v_target and ci.kind in ('image','note','doc','link');

  return json_build_object(
    'board_id',  v_target,
    'cards',     v_cards,
    'subboards', v_subs,
    'truncated', (v_total > v_lim)
  );
end;
$$;

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

do $proof$
begin
  if not has_function_privilege('anon', 'public.get_public_board_page(text)', 'execute')
     or not has_function_privilege('anon', 'public.get_public_board_content(text,integer)', 'execute') then
    raise exception '0597: a signed-out visitor can no longer read a published cluster';
  end if;
  if exists (select 1 from pg_proc
              where oid in ('public.get_public_board_page(text)'::regprocedure,
                            'public.get_public_board_content(text,integer)'::regprocedure)
                and (not prosecdef or not ('search_path=public' = any(proconfig)))) then
    raise exception '0597: a public read lost its definer rights or its search_path';
  end if;
  if has_table_privilege('anon', 'public.image_descriptions', 'select') then
    raise exception '0597: anon can read every picture description directly';
  end if;
  if position('image_descriptions' in pg_get_functiondef('public.get_public_board_page(text)'::regprocedure)) = 0
     or position('image_descriptions' in pg_get_functiondef('public.get_public_board_content(text,integer)'::regprocedure)) = 0 then
    raise exception '0597: a public read does not reach the descriptions';
  end if;
end $proof$;

commit;
