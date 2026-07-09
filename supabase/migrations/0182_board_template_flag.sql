-- 0182: public_boards.is_template — drives the contextual CTA on /c/<slug>.
-- Template boards (beat sheet, shot list, wedding palette, japandi) keep the
-- remix CTA as "Use this template"; reference boards (world cup, look books)
-- drop the copy CTA entirely. Returned by both public meta RPCs.

alter table public.public_boards
  add column if not exists is_template boolean not null default false;

-- get_public_board_meta: 0179 definition + is_template.
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
           'published_at',     pb.published_at,
           'updated_at',       greatest(pb.updated_at, b.updated_at),
           'thumb_key',        b.thumb_key,
           'thumb_updated_at', b.thumb_updated_at,
           'thumb_version',    b.thumb_version,
           'card_count',       (select count(*) from card_index ci where ci.board_id = pb.board_id)
         )
    into v_out
  from public_boards pb join boards b on b.id = pb.board_id
  where pb.board_id = v_target;

  return v_out;
end;
$$;

-- get_public_board_page: 0181 definition with is_template in meta.
-- (Body otherwise identical to 0181 — see that file for the invariants,
-- especially the FROZEN legacy_i picked-set window.)
create or replace function public.get_public_board_page(p_slug text)
returns json language plpgsql security definer set search_path = public as $$
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
           'media',         case
             when p.kind = 'image' and (p.meta->>'src') like 'r2:%'
             then json_build_object(
                    'alt', coalesce(nullif(ca.alt, ''), p.meta->>'alt'))
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
