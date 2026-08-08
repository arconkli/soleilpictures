-- Scout — a capacity check the bot can actually call.
--
-- Found by the first real dry run against live Supabase: every ingest died at
-- step 2 of the pipeline with
--
--   rpc get_board_capacity 403: 42501 "you do not have access to this board"
--
-- get_board_capacity (0187 §4) opens with `if not public.can_read_board(...)`,
-- and can_read_board resolves the caller through auth.uid(). The bot calls
-- through the SERVICE ROLE, where auth.uid() is NULL — so the check has never
-- passed for Scout, and could not have. The capacity PRE-FLIGHT is what stops
-- bytes being spent on R2 for a card that will be rejected, so this was not a
-- degraded path: it was the ingest crashing before the first photo uploaded.
--
-- Exactly the same shape of bug as the one 0213 §1 fixed for can_write_board,
-- and the same remedy: an explicit-user mirror, because a service-role caller
-- has no auth.uid() to resolve. If a THIRD of these turns up, the lesson is
-- that every SECURITY DEFINER function gating on auth.uid() needs a documented
-- service-role story, not that each one needs its own patch.
--
-- The numbers themselves are owner-keyed and identical to 0187 — the cap
-- belongs to whoever owns the workspace, not to whoever is asking. Only the
-- access check differs.

create or replace function public.scout_board_capacity(
  p_board_id uuid,
  p_user_id  uuid
)
returns table(is_capped boolean, used integer, cap integer)
language plpgsql stable security definer
set search_path = public, auth as $$
declare
  v_owner uuid;
  v_tier  text;
  v_cap   integer;
  v_used  integer;
begin
  -- Same predicate the rest of Scout authorizes with, so "may I write here"
  -- and "how much room is left here" can never disagree.
  if not public.scout_can_write_board(p_board_id, p_user_id) then
    raise exception 'you do not have access to this board' using errcode = '42501';
  end if;

  v_owner := public.board_workspace_owner(p_board_id);
  if v_owner is null then
    return query select false, 0, 0; return;
  end if;

  select p.tier, 100 + coalesce(p.bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles p where p.user_id = v_owner;

  -- A paid owner is uncapped; mirrors 0187, which reports (false, 0, 0) rather
  -- than a number so no caller can accidentally treat "no cap" as "zero room".
  if v_tier is distinct from 'demo' then
    return query select false, 0, 0; return;
  end if;

  select coalesce(sum(ci.weight), 0)::integer into v_used
    from public.card_index ci
    join public.boards b     on b.id = ci.board_id
    join public.workspaces w on w.id = b.workspace_id
   where w.created_by = v_owner;

  return query select true, v_used, coalesce(v_cap, 100);
end $$;
revoke all on function public.scout_board_capacity(uuid, uuid) from public;
revoke all on function public.scout_board_capacity(uuid, uuid) from authenticated, anon;

comment on function public.scout_board_capacity(uuid, uuid) is
  'Explicit-user mirror of get_board_capacity(uuid), for service-role callers '
  'where auth.uid() is null. Keep the two in lockstep.';
