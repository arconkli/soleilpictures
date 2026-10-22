-- 0620_party_rooms_recheck_access.sql
--
-- A live board room re-asks, once a minute, what each connected person may do,
-- so removing someone, unsharing a cluster or making an editor a viewer
-- reaches a socket that is already open. party_board_access answers for a
-- batch of people with the same predicates the app uses everywhere
-- (can_read_board, can_write_board), asked as each person in turn; anything a
-- Team org branch adds to those predicates is answered here too.
--
-- Service role only: the Party Worker calls it with its service key.

create or replace function public.party_board_access(p_board uuid, p_users uuid[])
 returns table(user_id uuid, can_read boolean, can_write boolean)
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
  if p_board is null or coalesce(cardinality(p_users), 0) = 0 or cardinality(p_users) > 200 then
    return;
  end if;
  foreach v_user in array p_users loop
    continue when v_user is null;
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_user::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    user_id   := v_user;
    can_read  := coalesce(public.can_read_board(p_board), false);
    can_write := coalesce(public.can_write_board(p_board), false);
    return next;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
end;
$function$;

revoke execute on function public.party_board_access(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.party_board_access(uuid, uuid[]) to service_role;

-- The 0311 habit: prove it.
do $$
begin
  if has_function_privilege('anon', 'public.party_board_access(uuid,uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.party_board_access(uuid,uuid[])', 'EXECUTE') then
    raise exception '0620: party_board_access is client-callable';
  end if;
  if not has_function_privilege('service_role', 'public.party_board_access(uuid,uuid[])', 'EXECUTE') then
    raise exception '0620: the Party Worker cannot call party_board_access';
  end if;
end $$;
