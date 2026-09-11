-- 0319_read_suspend_gate.sql
--
-- The only account-level kill switch (a Supabase ban, surfaced as
-- profiles.banned_at and TierRouter's Suspended screen) stopped WRITES in
-- can_write_board / can_write_workspace and left READS untouched: can_read_board
-- (0013) never had a tier or ban clause, and the InitPlan helpers the boards /
-- card_index / board_state policies use since 0294/0295 test membership and
-- shares only. So a suspended person kept read access to every board they
-- were a member of until their token expired, and PartyKit — which admits a
-- socket on the boards SELECT policy — kept admitting them.
--
-- 0318 added _actor_active() to the write side. This adds it to all three read
-- bodies, verbatim otherwise, so the read and write paths stay symmetric (the
-- 0294 equivalence between can_read_board and my_readable_board_ids holds only
-- if both carry the same gate). For anon, auth.uid() is null, _actor_active()
-- is true, and the membership tests still return nothing — unchanged.

-- ── can_read_board — 0013:46-64 ─────────────────────────────────────────────
create or replace function public.can_read_board(p_board_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  with recursive chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select public._actor_active() and exists (
    select 1 from chain
    where is_workspace_member(chain.workspace_id)
       or exists (
         select 1 from board_shares s
         where s.board_id = chain.id and s.user_id = auth.uid()
       )
  );
$$;
revoke all on function public.can_read_board(uuid) from public;
grant execute on function public.can_read_board(uuid) to anon, authenticated, service_role;

-- ── my_readable_board_ids — 0272:52-73 ──────────────────────────────────────
create or replace function public.my_readable_board_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive roots as (
    select b.id, b.parent_board_id
    from boards b
    where b.workspace_id in (
            select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
          )
       or exists (
            select 1 from board_shares s where s.board_id = b.id and s.user_id = auth.uid()
          )
    union
    select c.id, c.parent_board_id
    from boards c join roots r on c.parent_board_id = r.id
  )
  select case when public._actor_active()
              then coalesce(array_agg(id), '{}'::uuid[])
              else '{}'::uuid[] end
  from roots;
$$;
revoke all on function public.my_readable_board_ids() from public;
grant execute on function public.my_readable_board_ids() to anon, authenticated, service_role;

-- ── my_workspace_ids — 0272:80-90 ───────────────────────────────────────────
create or replace function public.my_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when public._actor_active()
              then coalesce(array_agg(wm.workspace_id), '{}'::uuid[])
              else '{}'::uuid[] end
  from workspace_members wm
  where wm.user_id = auth.uid();
$$;
revoke all on function public.my_workspace_ids() from public;
grant execute on function public.my_workspace_ids() to anon, authenticated, service_role;

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
begin
  if not has_function_privilege('anon', 'public.can_read_board(uuid)', 'execute')
     or not has_function_privilege('anon', 'public.my_readable_board_ids()', 'execute')
     or not has_function_privilege('anon', 'public.my_workspace_ids()', 'execute') then
    raise exception 'a read predicate lost its anon EXECUTE; anon SELECTs would error instead of returning zero rows';
  end if;
end $$;
