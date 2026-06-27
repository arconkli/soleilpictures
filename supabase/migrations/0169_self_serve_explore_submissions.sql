-- 0169 — Self-serve "Publish to Explore" with an admin approve-queue.
--
-- Lets any board owner SUBMIT their board to the public /c/ + /explore SEO
-- surface; it lands in a moderation queue (published_at NULL) and only goes live
-- when an admin approves. The gate is naturally enforced by published_at: both
-- list_public_boards (/explore + sitemap) and _resolve_published_board (/c/<slug>)
-- already require published_at IS NOT NULL, so a pending board is invisible
-- everywhere until approved. Approval = self-protection for domain SEO/brand
-- (keeps junk off the indexed surface), not heavy content policing.
--
-- Applied to PROD via Supabase MCP (`self_serve_explore_submissions`). Dry-run
-- verified end-to-end: submit -> pending (publicly unresolvable) -> in admin
-- queue -> approve -> published + flows into list_public_boards; already-admin-
-- published boards are NOT clobbered by a user submit.

alter table public.public_boards add column if not exists review_status text;
alter table public.public_boards add column if not exists submitted_by uuid;
alter table public.public_boards add column if not exists submitted_at timestamptz;
alter table public.public_boards add column if not exists published_by text;
alter table public.public_boards add column if not exists review_reason text;
alter table public.public_boards drop constraint if exists public_boards_review_status_chk;
alter table public.public_boards add constraint public_boards_review_status_chk
  check (review_status is null or review_status in ('pending','approved','rejected'));

-- USER: submit (or re-submit) a board they own to Explore. Quality gate = >=3
-- images. Auto-slugs from the board name (unique-suffixed) when none given.
-- Never clobbers an already-published board.
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

-- ADMIN: approve (publish) or reject a submission.
create or replace function public.admin_review_public_board(p_board_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_slug text;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  if p_approve then
    update public_boards set published_at=coalesce(published_at, now()), review_status='approved',
      review_reason=null, updated_at=now() where board_id=p_board_id returning slug into v_slug;
    return jsonb_build_object('status','approved','slug',v_slug);
  else
    update public_boards set review_status='rejected', review_reason=nullif(trim(coalesce(p_reason,'')),''),
      published_at=null, updated_at=now() where board_id=p_board_id returning slug into v_slug;
    return jsonb_build_object('status','rejected','slug',v_slug);
  end if;
end $$;
grant execute on function public.admin_review_public_board(uuid,boolean,text) to authenticated;

-- ADMIN: the review queue (user submissions, default the pending ones).
create or replace function public.admin_list_public_board_submissions(p_status text default 'pending')
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_out json;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  select coalesce(json_agg(json_build_object(
    'board_id', pb.board_id, 'slug', pb.slug, 'board_name', b.name,
    'seo_title', pb.seo_title, 'seo_description', pb.seo_description,
    'review_status', pb.review_status, 'submitted_at', pb.submitted_at,
    'submitter_email', (select au.email::text from auth.users au where au.id = pb.submitted_by),
    'image_count', (select count(*) from card_index ci where ci.board_id = pb.board_id and ci.kind='image'),
    'card_count', b.card_count, 'published_at', pb.published_at
  ) order by pb.submitted_at desc), '[]'::json) into v_out
  from public_boards pb join boards b on b.id = pb.board_id
  where b.deleted_at is null and pb.published_by = 'user'
    and (p_status is null or pb.review_status = p_status);
  return v_out;
end $$;
grant execute on function public.admin_list_public_board_submissions(text) to authenticated;

-- USER: read my board's submission status (for the "pending/live/rejected" UI).
create or replace function public.get_my_explore_submission(p_board_id uuid)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_out json;
begin
  if auth.uid() is null then return null; end if;
  if not can_write_board(p_board_id) then return null; end if;
  select json_build_object('slug', pb.slug, 'review_status', pb.review_status,
    'published_at', pb.published_at, 'published_by', pb.published_by, 'review_reason', pb.review_reason)
  into v_out from public_boards pb where pb.board_id = p_board_id;
  return v_out;
end $$;
grant execute on function public.get_my_explore_submission(uuid) to authenticated;
