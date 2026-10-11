-- 0408 — An account deleted by an admin hands its shared workspaces to an
-- heir, as a self-deleted one does (audit DB-05).
--
-- admin-account-action's delete went straight to auth.admin.deleteUser.
-- workspaces_created_by_fkey is ON DELETE SET NULL, so every workspace the
-- account owned was left with no owner: co-owners could no longer manage or
-- delete it (can_manage_workspace needs an owner), authorize_upload answered
-- no_workspace so large uploads failed for everyone in it, and the card cap
-- trigger returned early on a null owner. prepare_account_deletion does the
-- hand-over for self-deletion, but it refuses a suspended account (0371), and
-- the accounts an admin deletes are usually suspended ones.
--
-- prepare_admin_account_deletion runs the same hand-over loop, to the same
-- heir (_deletion_heir: co-owner first, then the longest-standing editor;
-- never a viewer, a service account or a banned account), without that
-- refusal. It reports how many workspaces are left with nobody to inherit
-- them; the edge function removes those before deleting the user, as
-- prepare_account_deletion does for self-deletion. Service role only.

begin;

create or replace function public.prepare_admin_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_xfer int := 0;
  v_left int := 0;
  r record;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;

  for r in
    select w.id, public._deletion_heir(w.id, p_user_id) as to_user
      from workspaces w
     where w.created_by = p_user_id
  loop
    if r.to_user is not null then
      update workspaces set created_by = r.to_user where id = r.id;
      update workspace_members set role = 'owner' where workspace_id = r.id and user_id = r.to_user;
      v_xfer := v_xfer + 1;
    end if;
  end loop;

  select count(*) into v_left from workspaces w where w.created_by = p_user_id;

  return jsonb_build_object('workspaces_transferred', v_xfer,
                            'workspaces_left', v_left);
end;
$function$;

revoke execute on function public.prepare_admin_account_deletion(uuid) from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.prepare_admin_account_deletion(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.prepare_admin_account_deletion(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.prepare_admin_account_deletion(uuid)', 'execute') then
    raise exception '0408: grants are wrong on prepare_admin_account_deletion';
  end if;
end $$;

commit;
