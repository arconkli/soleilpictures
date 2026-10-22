-- 0622_party_workspace_rooms_recheck_access.sql
--
-- The workspace presence room's twin of 0620/0621. Its door (party/index.ts)
-- admits a member of the workspace (a workspace_members row the caller can
-- read) who is not suspended; once a minute the room re-asks the same for each
-- open socket, so a removed member or a suspended account loses presence and
-- the workspace broadcasts within a minute.
--
-- Service role only: the Party Worker calls it with its service key.

create or replace function public.party_workspace_access(p_workspace uuid, p_users uuid[])
 returns table(user_id uuid, can_open boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user   uuid;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  v_role   text := current_setting('request.jwt.claim.role', true);
begin
  if p_workspace is null or coalesce(cardinality(p_users), 0) = 0 or cardinality(p_users) > 200 then
    return;
  end if;
  foreach v_user in array p_users loop
    continue when v_user is null;
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_user::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    user_id  := v_user;
    can_open := coalesce(public._actor_active() and public.is_workspace_member(p_workspace), false);
    return next;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
end;
$function$;

revoke execute on function public.party_workspace_access(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.party_workspace_access(uuid, uuid[]) to service_role;

-- The 0311 habit: prove it.
do $$
begin
  if has_function_privilege('anon', 'public.party_workspace_access(uuid,uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.party_workspace_access(uuid,uuid[])', 'EXECUTE') then
    raise exception '0622: party_workspace_access is client-callable';
  end if;
  if not has_function_privilege('service_role', 'public.party_workspace_access(uuid,uuid[])', 'EXECUTE') then
    raise exception '0622: the Party Worker cannot call party_workspace_access';
  end if;
end $$;
