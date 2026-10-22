-- 0621_party_recheck_matches_admission.sql
--
-- A board room admits a socket when the person can see the cluster's row
-- (party/auth.ts authBoard: the boards "boards read" policy, which is
-- my_readable_board_ids()). The once-a-minute recheck (0620) now asks that
-- same rule for read, so the two can never disagree: a recheck that said no
-- where the door said yes would close the socket every minute and the client
-- would reconnect into the next close. Write stays can_write_board, which is
-- also what the door asks. When the readable set tightens (for example,
-- shares on clusters in the trash), the door and the recheck tighten together.

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
    can_read  := coalesce(array[p_board] && public.my_readable_board_ids(), false);
    can_write := coalesce(public.can_write_board(p_board), false);
    return next;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
end;
$function$;

-- The 0311 habit: prove it.
do $$
begin
  if has_function_privilege('anon', 'public.party_board_access(uuid,uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.party_board_access(uuid,uuid[])', 'EXECUTE') then
    raise exception '0621: party_board_access is client-callable';
  end if;
  if not has_function_privilege('service_role', 'public.party_board_access(uuid,uuid[])', 'EXECUTE') then
    raise exception '0621: the Party Worker cannot call party_board_access';
  end if;
end $$;
