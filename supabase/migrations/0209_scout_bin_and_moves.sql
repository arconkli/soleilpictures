-- Soleil Scout — the Bin as a staging collection, and confirmed card moves.
--
-- 0206 shipped a "Scout Inbox": photos landed there and "put these in X" only
-- redirected FUTURE photos. This migration supports the corrected model:
--
--   * The Bin is a staging area. Filing MOVES what's already collected.
--   * "put these in X" moves the CURRENT RUN, not the whole Bin, so photos the
--     user forgot about three days ago don't ride along.
--   * Every move is confirmed before it happens, and reversible after.
--
-- Three concrete changes:
--
--   1. scout_accounts.bin_board_id — the Bin is now found BY ID.
--      ensureScoutInbox() looked it up by name (`name = 'Scout Inbox'`), which
--      meant renaming the board in the app silently created a SECOND one on the
--      next photo, stranding the first. The name is a label; the id is the
--      identity.
--   2. scout_threads.pending_move — the move awaiting a YES. Held server-side
--      rather than in process memory so a Fly machine recycling mid-conversation
--      doesn't lose the user's half-finished instruction.
--   3. scout_threads.last_move — what UNDO reverses, for 24h.
--
-- Both new thread columns are jsonb because their shape is the ingest service's
-- business, not the database's, and neither is ever queried by content.
--
-- NOTE on card moves: they are deliberately NOT implemented here. A move is
-- `update card_index set board_id = ...`, and every trigger on that table fires
-- on INSERT or DELETE only (card_index_demo_cap_ins 0091:485,
-- card_index_demo_count_* 0065:291, card_index_counter_* 0074:140,
-- profiles_first_card 0080:77). An UPDATE therefore moves a card without
-- consuming cap, without double-counting, and without emitting a false
-- "first card" activation signal. Nothing needs to change server-side for that
-- to be true — but it's true by accident of trigger definitions, so if any of
-- those are ever widened to `or update`, the move path must be revisited.

-----------------------------------------------------------------------
-- 1. Bin identity.
-----------------------------------------------------------------------
alter table public.scout_accounts
  add column if not exists bin_board_id uuid references public.boards(id) on delete set null;

comment on column public.scout_accounts.bin_board_id is
  'The user''s Scout Bin (staging board). Keyed by id, not name, so renaming '
  'the board in the app does not orphan it.';

-----------------------------------------------------------------------
-- 2. Pending / last move, per conversation.
-----------------------------------------------------------------------
alter table public.scout_threads
  add column if not exists pending_move jsonb,
  add column if not exists pending_move_at timestamptz,
  add column if not exists last_move jsonb,
  add column if not exists last_move_at timestamptz;

comment on column public.scout_threads.pending_move is
  'Move awaiting user confirmation: { board_id, board_name, card_ids[], scope }. '
  'Server-side so a service restart cannot lose a half-finished instruction.';
comment on column public.scout_threads.last_move is
  'Most recent completed move, for UNDO: { from_board_id, to_board_id, card_ids[] }.';

-----------------------------------------------------------------------
-- 3. scout_resolve_identity — now also returns the Bin and the move state,
--    so the hot path stays ONE round trip per inbound message.
--
--    DROP FIRST. This widens the RETURNS TABLE from 5 columns to 9, and
--    `create or replace` cannot change a function's return type — Postgres
--    raises 42P13 "cannot change return type of existing function" and the
--    whole migration aborts. The grants are re-applied immediately below, and
--    only the Scout service calls this (never a browser), so the momentary
--    absence inside the transaction is not reachable by anyone.
-----------------------------------------------------------------------
drop function if exists public.scout_resolve_identity(text, text, text);

create or replace function public.scout_resolve_identity(
  p_platform   text,
  p_handle     text,
  p_thread_key text default null
)
returns table(
  user_id         uuid,
  target_board_id uuid,
  bin_board_id    uuid,
  is_shell        boolean,
  cap_warned_at   timestamptz,
  pending_move    jsonb,
  pending_move_at timestamptz,
  last_move       jsonb,
  last_move_at    timestamptz
)
language sql security definer
set search_path = public, auth as $$
  select i.user_id,
         t.target_board_id,
         a.bin_board_id,
         coalesce(a.is_shell, false),
         a.cap_warned_at,
         t.pending_move,
         t.pending_move_at,
         t.last_move,
         t.last_move_at
  from public.scout_identities i
  left join public.scout_accounts a on a.user_id = i.user_id
  -- Match the exact thread: a user can hold several conversations on one
  -- platform, and joining on platform alone would pick an arbitrary board.
  left join public.scout_threads  t on t.user_id = i.user_id
                                   and t.platform = p_platform
                                   and t.thread_key is not distinct from p_thread_key
  where i.platform = p_platform and i.handle = p_handle
  limit 1;
$$;
revoke all on function public.scout_resolve_identity(text, text, text) from public;
revoke all on function public.scout_resolve_identity(text, text, text) from authenticated, anon;

-----------------------------------------------------------------------
-- 4. scout_set_bin_board — record the Bin once, at account mint time (or on
--    the first ingest for an account that predates this column).
--    Verifies ownership so a thread can never be pointed at someone else's
--    canvas, mirroring scout_set_target_board.
-----------------------------------------------------------------------
create or replace function public.scout_set_bin_board(
  p_user_id  uuid,
  p_board_id uuid
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_ok boolean := false;
begin
  if p_user_id is null or p_board_id is null then
    return false;
  end if;

  select exists (
    select 1
    from public.boards b
    join public.workspaces w on w.id = b.workspace_id
    where b.id = p_board_id
      and b.deleted_at is null
      and w.created_by = p_user_id
  ) into v_ok;

  if not v_ok then
    return false;
  end if;

  insert into public.scout_accounts (user_id, bin_board_id)
  values (p_user_id, p_board_id)
  on conflict (user_id) do update
    set bin_board_id = excluded.bin_board_id,
        updated_at   = now();

  return true;
end;
$$;
revoke all on function public.scout_set_bin_board(uuid, uuid) from public;
revoke all on function public.scout_set_bin_board(uuid, uuid) from authenticated, anon;

-----------------------------------------------------------------------
-- 5. scout_set_pending_move — stash (or clear, with null) the move awaiting
--    confirmation. Upserts the thread row so a conversation that has never
--    retargeted still has somewhere to hold state.
-----------------------------------------------------------------------
create or replace function public.scout_set_pending_move(
  p_user_id    uuid,
  p_platform   text,
  p_thread_key text,
  p_payload    jsonb default null
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
begin
  if p_user_id is null or p_platform is null or p_thread_key is null then
    return false;
  end if;

  insert into public.scout_threads (user_id, platform, thread_key, pending_move, pending_move_at)
  values (p_user_id, p_platform, p_thread_key, p_payload,
          case when p_payload is null then null else now() end)
  on conflict (platform, thread_key) do update
    set pending_move    = excluded.pending_move,
        pending_move_at = excluded.pending_move_at,
        updated_at      = now();

  return true;
end;
$$;
revoke all on function public.scout_set_pending_move(uuid, text, text, jsonb) from public;
revoke all on function public.scout_set_pending_move(uuid, text, text, jsonb) from authenticated, anon;

-----------------------------------------------------------------------
-- 6. scout_record_move — a move completed; remember it for UNDO and clear
--    whatever was pending. One call so the two can never disagree.
-----------------------------------------------------------------------
create or replace function public.scout_record_move(
  p_user_id    uuid,
  p_platform   text,
  p_thread_key text,
  p_payload    jsonb default null
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
begin
  if p_user_id is null or p_platform is null or p_thread_key is null then
    return false;
  end if;

  insert into public.scout_threads (
    user_id, platform, thread_key, pending_move, pending_move_at, last_move, last_move_at
  )
  values (
    p_user_id, p_platform, p_thread_key, null, null, p_payload,
    case when p_payload is null then null else now() end
  )
  on conflict (platform, thread_key) do update
    set pending_move    = null,
        pending_move_at = null,
        last_move       = excluded.last_move,
        last_move_at    = excluded.last_move_at,
        updated_at      = now();

  return true;
end;
$$;
revoke all on function public.scout_record_move(uuid, text, text, jsonb) from public;
revoke all on function public.scout_record_move(uuid, text, text, jsonb) from authenticated, anon;

-----------------------------------------------------------------------
-- 7. Backfill: adopt any Bin that already exists by its old name, so an
--    account minted under 0206 keeps the board it has instead of being handed
--    a fresh empty one on its next photo.
--    Matches both names because the board was renamed in the same release.
-----------------------------------------------------------------------
update public.scout_accounts a
   set bin_board_id = b.id
  from public.boards b
  join public.workspaces w on w.id = b.workspace_id
 where a.bin_board_id is null
   and w.created_by = a.user_id
   and b.deleted_at is null
   and b.name in ('Scout Bin', 'Scout Inbox');
