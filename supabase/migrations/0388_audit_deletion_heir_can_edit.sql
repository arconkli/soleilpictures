-- 0388 — when an account is deleted, its workspace goes to someone who can edit
-- it (audit AC-15).
--
-- prepare_account_deletion handed each shared workspace to its longest-standing
-- other member, whoever that was. A viewer — someone the owner let look —
-- became the owner of everything in it, and only workspaces.created_by moved:
-- their membership still said viewer. my_deletion_impact chose ties
-- differently, so the confirmation screen could name someone else, or list
-- the same workspace twice.
--
-- Now one rule, _deletion_heir, serves both: the longest-standing member who
-- can edit (owner, admin or editor), never a viewer, a service account or a
-- banned account. They become the owner in workspace_members too. A workspace
-- with no such member is deleted with the account, as one nobody else was in
-- always was, and the confirmation screen lists it as deleted.

begin;

create or replace function public._deletion_heir(p_workspace uuid, p_leaver uuid)
returns uuid
language sql stable security definer
set search_path = public as $$
  select m.user_id
    from public.workspace_members m
   where m.workspace_id = p_workspace
     and m.user_id <> p_leaver
     and m.role in ('owner', 'admin', 'editor')
     and not public._user_banned(m.user_id)
   order by m.created_at asc, m.user_id asc
   limit 1;
$$;
revoke execute on function public._deletion_heir(uuid, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_xfer int := 0;
  v_del  int := 0;
  r record;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;
  -- 0371: a banned account cannot delete itself: that would take the record
  -- of what it did with it and free the address to sign up again. An admin
  -- can still delete it (admin-account-action does not come through here).
  if public._user_banned(p_user_id) then
    raise exception 'this account is suspended; contact support to close it' using errcode = '42501';
  end if;

  -- 0388: the heir is the longest-standing member who can EDIT — owner, admin
  -- or editor; never a viewer, a service account or a banned account — and
  -- becomes the owner in workspace_members as well as created_by. A workspace
  -- with no such member goes with the account, like one nobody else is in.
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

  delete from workspaces w where w.created_by = p_user_id;
  get diagnostics v_del = row_count;

  return jsonb_build_object('workspaces_transferred', v_xfer,
                            'workspaces_deleted', v_del);
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_deletion_impact()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The same heir rule prepare_account_deletion applies (_deletion_heir,
  -- 0388), so the confirmation screen names the person who will own it.
  with me as (select auth.uid() as uid),
  mine as (
    select w.id, w.name, public._deletion_heir(w.id, (select uid from me)) as heir_id
      from workspaces w
     where w.created_by = (select uid from me)
  )
  select jsonb_build_object(
    'workspaces_deleted', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from mine where heir_id is null), '[]'::jsonb),
    'workspaces_transferred', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name,
                                          'to_name', coalesce(nullif(p.display_name, ''), 'a collaborator')) order by m.name)
      from mine m left join profiles p on p.user_id = m.heir_id
      where m.heir_id is not null), '[]'::jsonb),
    'clusters_deleted', coalesce((
      select count(*) from boards b
      where b.workspace_id in (select id from mine where heir_id is null)
        and b.deleted_at is null), 0),
    'memberships_dropped', coalesce((
      select count(*) from workspace_members m
      join workspaces w on w.id = m.workspace_id
      where m.user_id = (select uid from me)
        and w.created_by is distinct from (select uid from me)), 0),
    'subscription_active', exists (
      select 1 from subscriptions s
      where s.user_id = (select uid from me)
        and s.status in ('active', 'trialing'))
  );
$function$;

do $$
begin
  if has_function_privilege('authenticated', 'public._deletion_heir(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.prepare_account_deletion(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.my_deletion_impact()', 'execute') then
    raise exception '0388: grants are wrong';
  end if;
end $$;

commit;
