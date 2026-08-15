-- 0239: close the recovery gaps on vote cards (+ document the message path).
--
-- vote_cards got soft-delete in 0160 but never a restore path NOR a purge
-- cron — deleted rows were both unreachable forever and kept forever. This
-- mirrors the comments lifecycle (0051/0052): a restore RPC with the same
-- authorization as the delete, a 30-day purge, and a daily cron slot.
--
-- messages need no schema work: they soft-delete via a direct author UPDATE
-- under RLS, so restoring is the same UPDATE back to NULL. (The client copy
-- claiming a message delete "can't be undone" was simply false — fixed in
-- the same commit as this file.)

create or replace function public.restore_vote_card(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.vote_cards set deleted_at = null, updated_at = now()
  where id = p_id and deleted_at is not null
    and (author = auth.uid() or public.can_write_board(board_id));
end;
$$;
revoke all on function public.restore_vote_card(uuid) from public;
grant execute on function public.restore_vote_card(uuid) to authenticated;

create or replace function public.purge_old_deleted_vote_cards()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer := 0;
begin
  delete from public.vote_cards
   where deleted_at is not null
     and deleted_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.purge_old_deleted_vote_cards() from public;
grant execute on function public.purge_old_deleted_vote_cards() to service_role;

-- pg_cron upserts by jobname, so re-running is safe. 03:15 — the 03:00-03:10
-- slots are taken by the board/comment/version purges (0052).
select cron.schedule('purge_deleted_vote_cards', '15 3 * * *', $$select purge_old_deleted_vote_cards();$$);
