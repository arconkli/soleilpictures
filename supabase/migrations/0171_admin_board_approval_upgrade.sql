-- 0171_admin_board_approval_upgrade.sql — make the "publish to Explore" admin
-- approve-queue a real, prominent, usable moderation surface.
--
-- Migration 0169 added the self-serve submit + a minimal admin approve/reject.
-- This adds the pieces the dedicated Approvals admin tab needs:
--   1. admin_public_board_preview — let an admin SEE a still-pending board's
--      content (images/notes/docs/links) before approving. A faithful clone of
--      get_public_board_content (0136) keyed by board_id, WITHOUT the published_at
--      gate, gated on is_admin(). The Worker's /api/admin/preview-img route calls
--      it with the admin's own bearer token (so is_admin() passes) to stream the
--      bytes; the client calls it directly for the card list.
--   2. admin_public_board_submission_counts — drives the nav pending-count badge.
--   3. share_notifications gains kind/detail so the existing app-load toast loop
--      can tell a submitter "approved → /c/<slug>" / "rejected: <reason>".
--   4. admin_review_public_board — same approve/reject behavior + emits that
--      notification to the submitter.
--   5. admin_list_public_board_submissions — now also returns review_reason +
--      published_by (for the rejected/history rows).
--
-- Apply to PROD via Supabase MCP (apply_migration). All functions are
-- create-or-replace with unchanged signatures for (4)/(5) — no client breakage.

-- ── 1. Admin board preview (pending-board content, is_admin gated) ──────────
-- Clone of get_public_board_content (0136 §4) but resolved by board_id directly
-- (no slug, no published_at gate), so an admin can preview a board that's still
-- in the queue. Same kinds, same json shape, same stable ordering (updated_at
-- desc, card_id) — so the ?i=N index used by /api/admin/preview-img lines up 1:1
-- with the card list the client rendered from.
create or replace function public.admin_public_board_preview(p_board_id uuid, p_limit int default 200)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_cards json;
  v_subs  json;
  v_total int;
  v_lim   int;
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if not exists (select 1 from boards where id = p_board_id and deleted_at is null) then
    raise exception 'no such board' using errcode = 'P0002';
  end if;
  v_lim := greatest(1, least(coalesce(p_limit, 200), 400));

  with recursive sub as (
    select id from boards where id = p_board_id and deleted_at is null
    union all
    select b.id from boards b join sub s on b.parent_board_id = s.id
    where b.deleted_at is null
  ),
  picked as (
    select ci.card_id, ci.kind, ci.title, ci.body, ci.meta, ci.updated_at
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
           'media',   case
             when p.kind = 'image' and (p.meta->>'src') like 'r2:%'
             then json_build_object(
                    'alt',         p.meta->>'alt',
                    'src_key',     p.meta->>'src',
                    'preview_key', img.preview_path,
                    'blur',        img.blur_hash
                  )
             else null end
         ) order by p.updated_at desc, p.card_id), '[]'::json)
    into v_cards
  from picked p
  left join images img
    on img.storage_path = regexp_replace(p.meta->>'src', '^r2:', '')
   and img.deleted_at is null;

  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name)
           order by b.name), '[]'::json)
    into v_subs
  from boards b where b.parent_board_id = p_board_id and b.deleted_at is null;

  select count(*) into v_total
  from card_index ci
  where ci.board_id = p_board_id and ci.kind in ('image','note','doc','link');

  return json_build_object(
    'board_id',  p_board_id,
    'cards',     v_cards,
    'subboards', v_subs,
    'truncated', (v_total > v_lim)
  );
end;
$$;
revoke all on function public.admin_public_board_preview(uuid, int) from public, anon;
grant execute on function public.admin_public_board_preview(uuid, int) to authenticated;

-- ── 2. Pending-count badge feed ────────────────────────────────────────────
create or replace function public.admin_public_board_submission_counts()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'pending',  count(*) filter (where review_status = 'pending'),
      'approved', count(*) filter (where review_status = 'approved'),
      'rejected', count(*) filter (where review_status = 'rejected')
    )
    from public_boards pb
    join boards b on b.id = pb.board_id
    where b.deleted_at is null and pb.published_by = 'user'
  );
end;
$$;
revoke all on function public.admin_public_board_submission_counts() from public, anon;
grant execute on function public.admin_public_board_submission_counts() to authenticated;

-- ── 3. share_notifications carries a decision kind + a detail payload ───────
-- kind: 'share' (legacy, the existing board-share toast) | 'explore_approved'
-- | 'explore_rejected'. detail: the /c/<slug> for approvals, the reason for
-- rejections. The role check is unchanged; decision rows use role='viewer'.
alter table public.share_notifications add column if not exists kind text not null default 'share';
alter table public.share_notifications add column if not exists detail text;

-- ── 4. Approve / reject + notify the submitter ─────────────────────────────
create or replace function public.admin_review_public_board(p_board_id uuid, p_approve boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_slug text;
  v_submitted_by uuid;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  if p_approve then
    update public_boards set published_at=coalesce(published_at, now()), review_status='approved',
      review_reason=null, updated_at=now() where board_id=p_board_id
      returning slug, submitted_by into v_slug, v_submitted_by;
  else
    update public_boards set review_status='rejected', review_reason=v_reason,
      published_at=null, updated_at=now() where board_id=p_board_id
      returning slug, submitted_by into v_slug, v_submitted_by;
  end if;

  -- Durable, one-shot toast for the submitter on their next app load (reuses
  -- the share_notifications inbox + App.jsx load loop). Skip self-reviews.
  if v_submitted_by is not null and v_submitted_by <> auth.uid() then
    insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
    values (
      v_submitted_by, p_board_id, 'viewer', auth.uid(),
      case when p_approve then 'explore_approved' else 'explore_rejected' end,
      case when p_approve then v_slug else v_reason end
    );
  end if;

  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'slug', v_slug);
end $$;
grant execute on function public.admin_review_public_board(uuid,boolean,text) to authenticated;

-- ── 5. Review queue — now returns review_reason + published_by ─────────────
create or replace function public.admin_list_public_board_submissions(p_status text default 'pending')
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_out json;
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  select coalesce(json_agg(json_build_object(
    'board_id', pb.board_id, 'slug', pb.slug, 'board_name', b.name,
    'seo_title', pb.seo_title, 'seo_description', pb.seo_description,
    'review_status', pb.review_status, 'review_reason', pb.review_reason,
    'published_by', pb.published_by, 'submitted_at', pb.submitted_at,
    'submitter_email', (select au.email::text from auth.users au where au.id = pb.submitted_by),
    'image_count', (select count(*) from card_index ci where ci.board_id = pb.board_id and ci.kind='image'),
    'card_count', b.card_count, 'published_at', pb.published_at
  ) order by pb.submitted_at desc nulls last), '[]'::json) into v_out
  from public_boards pb join boards b on b.id = pb.board_id
  where b.deleted_at is null and pb.published_by = 'user'
    and (p_status is null or pb.review_status = p_status);
  return v_out;
end $$;
grant execute on function public.admin_list_public_board_submissions(text) to authenticated;
