-- 0292 — prune_board_versions() is granted to `authenticated` and takes an
-- arbitrary board_id with no ownership check.
--
-- That grant is deliberate (0049): boardsApi.js calls it right after saving a
-- version, and scoutBoard.js calls it for the scout board. The missing authz
-- check has been latent-but-harmless because the function's only delete arm was
-- `rn > 200` per board, which no real board ever reached — it deleted nothing,
-- for anyone, ever.
--
-- 0288 added an age arm, which turns it into a working delete. That converts a
-- dormant hole into a live one: any authenticated user could pass any board id
-- and prune that board's version history.
--
-- Guard on the caller rather than the grant, because three very different
-- callers share this function:
--   • the nightly cron, running as postgres via prune_all_board_versions()
--   • scout, on the service key
--   • a signed-in user, from boardsApi.js
-- The first two carry no JWT, so auth.uid() is null and they pass through. A
-- real user has to be able to write the board — the same predicate the
-- board_state write policies already use.

create or replace function public.prune_board_versions(p_board_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_deleted integer := 0;
begin
  if auth.uid() is not null and not public.can_write_board(p_board_id) then
    raise exception 'not authorized to prune this board''s history'
      using errcode = '42501';
  end if;

  with ranked as (
    select id, snapshot_at, label, trigger_kind,
           row_number() over (order by snapshot_at desc) as rn
    from board_versions
    where board_id = p_board_id
  )
  delete from board_versions bv
  using ranked r
  where bv.id = r.id
    and coalesce(r.label, '') <> 'manual'
    and coalesce(r.trigger_kind, '') <> 'manual'
    and (
      (r.rn > 200 and r.snapshot_at < (now() - interval '24 hours'))
      or (r.rn > 20 and r.snapshot_at < (now() - interval '30 days'))
    );

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

revoke all on function public.prune_board_versions(uuid) from anon;
grant execute on function public.prune_board_versions(uuid) to authenticated, service_role;
