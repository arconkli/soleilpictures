-- 0172 — Fix submit_board_to_explore auto-slug: strip a trailing hyphen that
-- left(.,70) can RE-INTRODUCE after the leading/trailing-hyphen strip.
--
-- In 0169 the slug is derived as:
--   v_base := regexp_replace(... , '(^-+|-+$)', '', 'g');   -- strip edge hyphens
--   v_base := left(v_base, 70);                              -- THEN truncate
-- so when char 70 of the collapsed string is a '-', the truncation puts a hyphen
-- back on the end. public_boards_slug_format ( ^[a-z0-9]+(?:-[a-z0-9]+)*$ )
-- forbids a trailing hyphen, so the INSERT throws 23514 and the board can never
-- be published (the submit UI never supplies an explicit slug). The collision
-- path ( left(v_base,70) || '-' || n ) likewise produces a '--' double hyphen.
--
-- Fix: re-strip a trailing hyphen AFTER the truncation (and re-floor to 'board'
-- if that empties it). Only the slug-derive block changes vs 0169; everything
-- else — the >=3-image gate, the never-clobber-published guard, the upsert, and
-- the grants — is preserved verbatim.
--
-- Applied to PROD via Supabase MCP. Idempotent CREATE OR REPLACE.

create or replace function public.submit_board_to_explore(
  p_board_id uuid, p_slug text default null, p_title text default null,
  p_description text default null, p_body text default null, p_keyword text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_board record;
  v_img int;
  v_slug text;
  v_base text;
  v_n int := 0;
  v_existing record;
begin
  if v_uid is null then raise exception 'sign in required' using errcode='42501'; end if;
  if not can_write_board(p_board_id) then
    raise exception 'you do not have access to this board' using errcode='42501';
  end if;
  select b.id, b.name into v_board from boards b where b.id = p_board_id and b.deleted_at is null;
  if v_board.id is null then raise exception 'no such board' using errcode='P0002'; end if;

  select board_id, published_at into v_existing from public_boards where board_id = p_board_id;
  if v_existing.board_id is not null and v_existing.published_at is not null then
    return jsonb_build_object('status','already_published',
      'slug', (select slug from public_boards where board_id = p_board_id));
  end if;

  select count(*) into v_img from card_index where board_id = p_board_id and kind = 'image';
  if v_img < 3 then
    raise exception 'A board needs at least 3 images to be published to Explore' using errcode='22023';
  end if;

  v_base := nullif(trim(coalesce(p_slug, '')), '');
  if v_base is null then
    v_base := lower(regexp_replace(regexp_replace(coalesce(v_board.name,'board'), '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'));
    v_base := nullif(v_base, ''); if v_base is null then v_base := 'board'; end if;
    v_base := left(v_base, 70);
    -- left(.,70) can put a hyphen back on the end; strip it (and any '-N'
    -- collision suffix would otherwise become '--N'). Re-floor if emptied.
    v_base := regexp_replace(v_base, '-+$', '', 'g');
    if v_base = '' then v_base := 'board'; end if;
  end if;
  v_slug := v_base;
  while exists (select 1 from public_boards pb where pb.slug = v_slug and pb.board_id <> p_board_id) loop
    v_n := v_n + 1; v_slug := left(v_base, 70) || '-' || v_n::text;
  end loop;

  insert into public_boards as pb
    (board_id, slug, seo_title, seo_description, seo_body, target_keyword,
     created_by, published_at, review_status, submitted_by, submitted_at, published_by, review_reason)
  values
    (p_board_id, v_slug,
     nullif(trim(coalesce(p_title,'')),''), nullif(trim(coalesce(p_description,'')),''),
     nullif(trim(coalesce(p_body,'')),''), nullif(trim(coalesce(p_keyword,'')),''),
     v_uid, null, 'pending', v_uid, now(), 'user', null)
  on conflict (board_id) do update set
    slug=coalesce(excluded.slug, pb.slug),
    seo_title=coalesce(excluded.seo_title, pb.seo_title),
    seo_description=coalesce(excluded.seo_description, pb.seo_description),
    seo_body=coalesce(excluded.seo_body, pb.seo_body),
    target_keyword=coalesce(excluded.target_keyword, pb.target_keyword),
    review_status='pending', submitted_by=v_uid, submitted_at=now(),
    published_by='user', review_reason=null, updated_at=now()
  where pb.published_at is null;

  return jsonb_build_object('status','pending','slug',v_slug);
end $$;
revoke all on function public.submit_board_to_explore(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.submit_board_to_explore(uuid,text,text,text,text,text) to authenticated;
