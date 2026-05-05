-- Helper that wraps the boards-row → workspace-membership check in a
-- SECURITY DEFINER function so the realtime authorization context can
-- evaluate it without tripping over nested RLS on the boards table.
--
-- Then drop + recreate the per-board realtime policy to use the helper
-- instead of an inline subquery.

create or replace function is_board_member(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from boards b
    join workspace_members m on m.workspace_id = b.workspace_id
    where b.id = p_board_id and m.user_id = auth.uid()
  );
$$;

revoke all on function is_board_member(uuid) from public;
grant execute on function is_board_member(uuid) to authenticated;

drop policy if exists "realtime board: workspace members"        on realtime.messages;
drop policy if exists "realtime board: workspace members write"  on realtime.messages;

create policy "realtime board: workspace members"
on realtime.messages
for select to authenticated
using (
  realtime.topic() like 'board:%'
  and is_board_member((substring(realtime.topic() from 7))::uuid)
);
create policy "realtime board: workspace members write"
on realtime.messages
for insert to authenticated
with check (
  realtime.topic() like 'board:%'
  and is_board_member((substring(realtime.topic() from 7))::uuid)
);
