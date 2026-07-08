-- 0179: SEO — expose dates on get_public_board_meta + single-call image-sitemap feed.
--
-- 1) get_public_board_meta gains published_at/updated_at so /c/<slug> JSON-LD
--    can carry datePublished/dateModified (worker buildPublicJsonLd reads them
--    optionally — older callers are unaffected by extra keys).
-- 2) list_public_board_images returns every published board's sitemap-image
--    rows [{slug, i, title}] in ONE call. The old worker shape (one
--    get_public_board_content subrequest per board) capped coverage at 40
--    boards because raising it would blow the 50-subrequest Workers limit.
--    LOCKSTEP INVARIANT: `i` must equal the card's position in
--    get_public_board_content's picked list (board SUBTREE, kinds
--    image/note/doc/link, ORDER BY updated_at DESC, card_id, LIMIT 60) because
--    /api/public-img/<slug>?i=N indexes into that list. Any change to that
--    ordering must change BOTH functions.

-- ── 1) get_public_board_meta + dates ─────────────────────────────────────────
create or replace function public.get_public_board_meta(p_slug text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target uuid;
  v_board  record;
  v_pb     record;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then
    raise exception 'no such public board' using errcode = 'P0002';
  end if;
  select b.name, b.thumb_key, b.thumb_updated_at, b.thumb_version, b.card_count
    into v_board from boards b where b.id = v_target;
  select pb.slug, pb.seo_title, pb.seo_description, pb.seo_body,
         pb.target_keyword, pb.og_image_key, pb.published_at, pb.updated_at
    into v_pb from public_boards pb where pb.board_id = v_target;
  return json_build_object(
    'board_id',        v_target,
    'slug',            v_pb.slug,
    'name',            v_board.name,
    'seo_title',       v_pb.seo_title,
    'seo_description', v_pb.seo_description,
    'seo_body',        v_pb.seo_body,
    'target_keyword',  v_pb.target_keyword,
    'og_image_key',    v_pb.og_image_key,
    'published_at',    v_pb.published_at,
    'updated_at',      v_pb.updated_at,
    'thumb_key',       v_board.thumb_key,
    'thumb_updated_at',v_board.thumb_updated_at,
    'thumb_version',   v_board.thumb_version,
    'card_count',      v_board.card_count
  );
end;
$$;

-- ── 2) list_public_board_images ──────────────────────────────────────────────
create or replace function public.list_public_board_images(
  p_board_limit int default 150,
  p_per_board   int default 30
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_out json;
begin
  with pubs as (
    select pb.board_id, pb.slug
    from public_boards pb
    join boards b on b.id = pb.board_id and b.deleted_at is null
    where pb.published_at is not null
    order by pb.priority desc nulls last, pb.published_at desc
    limit greatest(1, least(coalesce(p_board_limit, 150), 500))
  ),
  -- Per board: the SAME picked set as get_public_board_content (see invariant
  -- above), with each card's 0-based position in that list.
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
$$;

revoke all on function public.list_public_board_images(int, int) from public;
grant execute on function public.list_public_board_images(int, int) to anon, authenticated;
