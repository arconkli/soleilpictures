-- 0015_transfer_workspace_ownership.sql — let the workspace owner
-- hand off ownership to another existing member.
--
-- Today the only way for an owner to leave a workspace is to delete
-- it. This RPC bumps a member to owner + demotes the previous owner
-- to editor in one transaction, so the old owner can then leave.

create or replace function transfer_workspace_ownership(
  p_workspace_id uuid, p_new_owner uuid
) returns void
language plpgsql security definer
set search_path = public as $$
declare v_old uuid;
begin
  if p_new_owner = auth.uid() then
    raise exception 'cannot transfer ownership to yourself'
      using errcode = '22023';
  end if;

  select created_by into v_old from workspaces where id = p_workspace_id;
  if v_old is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;
  if v_old <> auth.uid() then
    raise exception 'only the current owner can transfer ownership'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from workspace_members
    where workspace_id = p_workspace_id and user_id = p_new_owner
  ) then
    raise exception 'new owner must already be a workspace member'
      using errcode = '42704';
  end if;

  update workspaces set created_by = p_new_owner where id = p_workspace_id;
  update workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;
  update workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_old;
end;
$$;

revoke all on function transfer_workspace_ownership(uuid, uuid) from public;
grant execute on function transfer_workspace_ownership(uuid, uuid) to authenticated;
