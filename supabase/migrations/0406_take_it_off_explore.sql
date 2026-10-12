-- 0406 — An owner can take their cluster off Explore, or withdraw a pending
-- submission (audit TAGS-06).
--
-- docs/publish/explore.md promises "Publishing is reversible from the same
-- place you submitted it", but the only unpublish was admin_unpublish_board,
-- and no client policy writes public_boards. Once live, an indexable public
-- page could only come down by deleting the cluster.
--
-- unpublish_my_board takes the same gate as submit_board_to_explore
-- (can_write_board, which already refuses a suspended or waitlisted account):
-- whoever may put a cluster forward may take it back. The row goes back to
-- "never submitted" (published_at and review_status null, which the
-- review_status CHECK allows) and keeps its slug, so submitting again reuses
-- the same address. _resolve_published_board stops serving it at once.

begin;

create or replace function public.unpublish_my_board(p_board_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.public_boards%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not public.can_write_board(p_board_id) then
    raise exception 'you do not have access to this board' using errcode = '42501';
  end if;

  select * into v_row from public.public_boards pb where pb.board_id = p_board_id for update;
  if not found or (v_row.published_at is null and v_row.review_status is distinct from 'pending') then
    return jsonb_build_object('status', 'not_listed');
  end if;

  update public.public_boards
     set published_at = null, review_status = null, review_reason = null, updated_at = now()
   where board_id = p_board_id;

  return jsonb_build_object(
    'status', case when v_row.published_at is not null then 'unpublished' else 'withdrawn' end,
    'slug', v_row.slug);
end $function$;

revoke execute on function public.unpublish_my_board(uuid) from public, anon;

do $$
begin
  if has_function_privilege('anon', 'public.unpublish_my_board(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.unpublish_my_board(uuid)', 'execute') then
    raise exception '0406: grants are wrong on unpublish_my_board';
  end if;
end $$;

commit;
