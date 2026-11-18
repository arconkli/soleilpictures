-- A removed public cluster answers "not found" (404), not a server error (500).
--
-- get_public_board_meta, get_public_board_content and get_public_board_page
-- raise P0002 when the slug names no published cluster. PostgREST answers
-- every P0 code except P0001 with HTTP 500, so each visit to a page that was
-- taken down (crawlers keep coming back to them) logged up to three server
-- errors. They now raise PostgREST's own PGRST error with status 404. The body
-- still carries "code":"P0002", which is what every caller reads: worker.js
-- fetchPublicBoardMeta, publicBoardsApi.js getPublicBoardMeta, and
-- bundleRefusal.js (any status under 500 is already a refusal there).
-- The DETAIL needs both "status" and "headers" (PostgREST 14.5), or it answers
-- 500 PGRST121. get_public_board_bundle (0898) keeps errcode P0002 for now: the
-- party reads its code (lib/bundleRefusal.js) so viewers already get a 404, and
-- its body is over the 5,000-character apply limit.
--
-- Each body is the live one, checked byte for byte against pg_proc.prosrc on
-- 2026-11-17 (0890's meta, 0597's content, 0860's page), with only that raise
-- changed. get_public_board_page's own comments sit just above it here and its
-- indentation is halved, so its statement fits one apply_migration call (under
-- 5,000 characters); what it does is unchanged. CREATE OR REPLACE keeps every
-- grant (anon, authenticated, service_role); the proof at the end checks them.

begin;

create or replace function public.get_public_board_meta(p_slug text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_out    json;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"no such public board"}',
      detail = '{"status":404,"headers":{}}';
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
           'og_cover',         (select json_build_object(
                                   'w', i.width,
                                   'h', i.height,
                                   'preview_key', pv.key,
                                   'preview_w',   case when pv.key is not null then i.preview_w end,
                                   'preview_h',   case when pv.key is not null then i.preview_h end)
                                  from images i
                                  left join lateral (
                                    select i.preview_path as key
                                     where i.preview_path like i.workspace_id::text || '/previews/%.webp'
                                       and position('..' in i.preview_path) = 0
                                  ) pv on true
                                 where i.storage_path = regexp_replace(pb.og_image_key, '^r2:', '')
                                   and i.deleted_at is null
                                 limit 1),
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
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"no such public board"}',
      detail = '{"status":404,"headers":{}}';
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

-- get_public_board_page, as 0860 left it. Its comments, moved out of the body:
--   0597: a person's alt, the card's, the picture's description, then
--   the older model's alt; only the description of an image filed on,
--   or referenced by, this card's own board (0366's rule for keys).
--   Audio: the line a producer actually reads. Without it a published
--   sample pack rendered nothing crawlable but a filename, because
--   publicPageModel's itemHtml had no audio case to render either.
--   No storage key is exposed here, same rule the grid cells follow.
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
  raise sqlstate 'PGRST' using
   message = '{"code":"P0002","message":"no such public board"}',
   detail = '{"status":404,"headers":{}}';
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

-- 0311 proof: the grants survived, and no not-found path answers 500 any more.
do $$
begin
  if not has_function_privilege('anon', 'public.get_public_board_meta(text)', 'execute')
     or not has_function_privilege('anon', 'public.get_public_board_content(text, integer)', 'execute')
     or not has_function_privilege('anon', 'public.get_public_board_page(text)', 'execute') then
    raise exception 'a public-board function lost its anon grant';
  end if;
  if not has_function_privilege('authenticated', 'public.get_public_board_meta(text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_public_board_content(text, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_public_board_page(text)', 'execute') then
    raise exception 'a public-board function lost its authenticated grant';
  end if;
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('get_public_board_meta', 'get_public_board_content', 'get_public_board_page')
       and prosrc not like '%"headers"%'
  ) then
    raise exception 'a public-board function raises PGRST without a headers key in its detail';
  end if;
  if exists (
    select 1 from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('get_public_board_meta', 'get_public_board_content', 'get_public_board_page')
       and (prosrc not like '%sqlstate ''PGRST''%' or prosrc like '%errcode = ''P0002''%')
  ) then
    raise exception 'a public-board function still answers not-found with a 500';
  end if;
end $$;

commit;
