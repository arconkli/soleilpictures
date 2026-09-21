-- A published sample pack rendered nothing crawlable but filenames.
--
-- get_public_board_page already admitted 'audio' to its kind allowlist (0181),
-- but its per-kind projection had no audio branch — so an audio card reached
-- publicPageModel with a title and nothing else, and itemHtml had no audio case
-- either, so it fell through to the note default and emitted an empty string.
-- A published loop pack was, to a crawler and to an AI agent, a page of nothing.
--
-- The tempo/key/format the projection now reads were added to card_index.meta
-- by the same change (lib/cardIndexRow.js buildCardMeta). Cards written before
-- that carry nulls and render as just a title, which is what they did before.
--
-- Recreated in full rather than patched: `create or replace` is the only way to
-- change a function body, and the whole text has to be present for that. ACL is
-- preserved by create-or-replace, but restated and PROVEN below rather than
-- assumed (the 0311 habit — a grant reporting success proves nothing).

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

revoke all on function public.get_public_board_page(text) from public;
grant execute on function public.get_public_board_page(text) to anon, authenticated;

-- Prove the grants this migration depends on, rather than trusting that the
-- statements above reported success.
do $$
begin
  if not has_function_privilege('anon', 'public.get_public_board_page(text)', 'execute') then
    raise exception 'get_public_board_page must be executable by anon - it is the public /c/<slug> page';
  end if;
  if not has_function_privilege('authenticated', 'public.get_public_board_page(text)', 'execute') then
    raise exception 'get_public_board_page must be executable by authenticated';
  end if;
  if has_function_privilege('public', 'public.get_public_board_page(text)', 'execute') then
    raise exception 'get_public_board_page must not be granted to PUBLIC';
  end if;
end $$;
