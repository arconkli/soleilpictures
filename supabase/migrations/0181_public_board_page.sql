-- 0181: Public board page v2 — structured, spatially-ordered, all-kinds content
-- for the /c/<slug> editorial article (worker crawlable HTML + React article).
--
-- INVARIANT: get_public_board_content (0137) and list_public_board_images (0179)
-- are the frozen "?i" picked-set (kinds image/note/doc/link, subtree, order
-- updated_at desc + card_id, limit 60) that /api/public-img indexes into.
-- This migration does NOT touch them. The new RPC returns each image card's
-- position in that legacy picked set as `legacy_i`, computed with the same
-- window, so article <img> tags keep pointing at already-indexed URLs.

-- 1) Answer-first block + FAQ, authored at publish time (board generator).
alter table public.public_boards
  add column if not exists answer text,
  add column if not exists faq jsonb;

-- 2) The page RPC. Flat spatial order (meta.pos stamped by the generator;
--    NULLS LAST keeps user-published boards working — they fall back to
--    card_id order). Grouping into sections happens in JS at the
--    meta.sectionHeader boundaries.
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
  -- The FROZEN legacy picked set (must stay expression-identical to
  -- get_public_board_content / list_public_board_images).
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
           -- cell src (r2 key) is deliberately NOT exposed — never reflect
           -- storage keys to the page (same reason /api/public-img is ?i-indexed).
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

revoke all on function public.get_public_board_page(text) from public;
grant execute on function public.get_public_board_page(text) to anon, authenticated;
