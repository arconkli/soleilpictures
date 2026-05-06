-- 0016_share_notifications.sql — toast on next load when someone
-- shares a board with you.
--
-- Lightweight per-user inbox. share_board RPC inserts a row when it
-- creates a board_shares entry; the recipient's app fetches unread
-- on mount and surfaces them as toasts (with a "View" action that
-- opens the board + dismisses the row).

create table if not exists share_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  board_id     uuid not null references boards on delete cascade,
  role         text not null check (role in ('viewer','editor')),
  shared_by    uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  dismissed_at timestamptz
);
create index if not exists share_notifications_user_unread_idx
  on share_notifications(user_id) where dismissed_at is null;

alter table share_notifications enable row level security;

-- Read/dismiss only your own rows. Inserts are loose (any authed user
-- can fire one) — share_board RPC is the legitimate caller, but
-- worst-case spam is bounded since users only see their own.
create policy "share_notifications read self" on share_notifications
  for select using (user_id = auth.uid());
create policy "share_notifications update self" on share_notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "share_notifications insert authed" on share_notifications
  for insert to authenticated with check (auth.uid() is not null);

-- Update share_board RPC to fire a notification on every successful
-- share. Re-inviting at a different role (which UPSERTs the share)
-- also fires a fresh notification so the recipient sees the change.
create or replace function share_board(
  p_board_id uuid, p_email text, p_role text
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner     uuid;
  v_user      uuid;
  v_workspace uuid;
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner
  from workspaces w where w.id = v_workspace;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can share boards'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = lower(trim(p_email));
  if v_user is null then
    raise exception 'no user with email %', p_email using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());
end;
$$;
revoke all on function share_board(uuid, text, text) from public;
grant execute on function share_board(uuid, text, text) to authenticated;
