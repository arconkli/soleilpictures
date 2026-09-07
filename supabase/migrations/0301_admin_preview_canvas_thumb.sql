-- 0301 — the Approvals preview shows the REAL board, not a grid of its parts.
--
-- admin_public_board_preview (0171) returns a flat card list, which the modal
-- renders as an image grid + text blocks. That answers "what is on this board"
-- but not "what does this board look like" — and for a moodboard the
-- arrangement IS the artifact. An admin judging a submission was seeing the
-- ingredients, never the dish.
--
-- Every board already carries a faithful canvas render: boards.thumb_key, a
-- 1200x675 (2x supersampled) screenshot painted by renderThumbnail.js with the
-- live UI's own tokens and geometry — real positions, real sizes, the board
-- background, the dot grid, note text, palettes, arrows, strokes. It is what
-- /api/public-thumb/<slug> already serves as the og:image for PUBLISHED boards.
-- A pending board has no published slug, so that route cannot reach it.
--
-- So: expose the key here. The worker's admin-gated /api/admin/preview-thumb/
-- <board_id> calls THIS function (exactly as /api/admin/preview-img already
-- does), re-verifies admin at the edge, and streams the object from R2. No new
-- rendering, no new auth surface — the same is_admin() gate, one more field.
--
-- thumb_updated_at rides along so the modal can date the render. The backfill
-- that re-renders stale thumbs (useThumbnailBackfill) only fires for a client
-- that opens the board, and an admin is not a member of the submitter's
-- workspace, so a preview CAN legitimately be older than the board. Showing
-- the date is the honest fix; silently implying "live" is not.
--
-- cards/subboards/truncated are unchanged — /api/admin/preview-img reads .cards
-- from this same payload and must keep working.

create or replace function public.admin_public_board_preview(
  p_board_id uuid,
  p_limit    integer default 200
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cards json; v_subs json; v_total int; v_lim int; v_board record;
begin
  if not is_admin() then raise exception 'admin only' using errcode = '42501'; end if;

  select b.name, b.thumb_key, b.thumb_updated_at, b.bg_color, b.view, b.card_count
    into v_board
  from boards b
  where b.id = p_board_id and b.deleted_at is null;
  if not found then
    raise exception 'no such board' using errcode = 'P0002';
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 200), 400));

  with recursive sub as (
    select id from boards where id = p_board_id and deleted_at is null
    union all
    select b.id from boards b join sub s on b.parent_board_id = s.id where b.deleted_at is null
  ),
  picked as (
    select ci.card_id, ci.kind, ci.title, ci.body, ci.meta, ci.updated_at
    from card_index ci
    where ci.board_id in (select id from sub) and ci.kind in ('image','note','doc','link')
    order by ci.updated_at desc, ci.card_id limit v_lim
  )
  select coalesce(json_agg(json_build_object(
           'card_id', p.card_id, 'kind', p.kind,
           'title', nullif(p.title, ''), 'body', nullif(p.body, ''),
           'href', case when p.kind = 'link' then p.meta->>'url' else null end,
           'media', case when p.kind = 'image' and (p.meta->>'src') like 'r2:%'
             then json_build_object('alt', p.meta->>'alt', 'src_key', p.meta->>'src',
                    'preview_key', img.preview_path, 'blur', img.blur_hash)
             else null end
         ) order by p.updated_at desc, p.card_id), '[]'::json)
    into v_cards
  from picked p
  left join images img
    on img.storage_path = regexp_replace(p.meta->>'src', '^r2:', '') and img.deleted_at is null;

  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.name), '[]'::json)
    into v_subs
  from boards b
  where b.parent_board_id = p_board_id and b.deleted_at is null;

  select count(*) into v_total
  from card_index ci
  where ci.board_id = p_board_id and ci.kind in ('image','note','doc','link');

  return json_build_object(
    'board_id',  p_board_id,
    'cards',     v_cards,
    'subboards', v_subs,
    'truncated', (v_total > v_lim),
    -- new: the faithful canvas render, plus what it takes to frame it honestly
    'board_name',       v_board.name,
    'thumb_key',        v_board.thumb_key,
    'thumb_updated_at', v_board.thumb_updated_at,
    'bg_color',         v_board.bg_color,
    'view',             v_board.view,
    'card_count',       v_board.card_count
  );
end; $function$;
