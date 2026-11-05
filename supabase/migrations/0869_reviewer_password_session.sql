-- 0869_reviewer_password_session.sql
--
-- Directory reviewers (Claude's connector directory and the others) test the
-- MCP server with a demo login they are handed, and they can't read its
-- mailbox, so that one account signs in with a password: lib/passwordSignIn.js
-- shows the password box for its address alone. Since 0600 a password session
-- counts as nobody, so the demo login signed in and then found its clusters,
-- the connect screen and API keys all refused as if the account were
-- suspended ("this account is suspended", 42501).
--
-- 1. _password_sign_in_allowed(user) is true only for the address in
--    lib/passwordSignIn.js (passwordSignIn.test.mjs holds the two lists equal),
--    and only while that account has an internal_accounts row, which only the
--    service role writes. Deleting the row, or banning the profile, switches
--    the demo login off at once.
-- 2. _actor_active() lets that account's own password session count as the
--    account, still subject to banned_at. Every other password session is
--    refused exactly as before: 0600's test stays word for word below the new
--    branch.
-- 3. _session_proves_inbox() is NOT touched. A password still never proves an
--    inbox, so the demo login can never claim an invite, a team offer, a domain
--    join, a file share or a passkey by its address. The same holds for
--    ensure_workspace_root's guard (0854): the account's root is live, and
--    were it ever lost it would be repaired by hand.
-- 4. auth_refuse_password(event), still NOT enabled, lets the same account
--    through, so switching the hook on later doesn't end the demo login. Its
--    sign-ins write 'password' rows to auth.mfa_amr_claims: the check 0600
--    asks for before enabling the hook now means no password rows from any
--    other account.

create or replace function public._password_sign_in_allowed(p_user uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select p_user is not null and exists (
    select 1
      from auth.users u
      join public.internal_accounts i on i.user_id = u.id
     where u.id = p_user
       and lower(u.email) = any (array['review@soleilpictures.com'])
  );
$function$;
revoke execute on function public._password_sign_in_allowed(uuid) from public, anon, authenticated;
grant execute on function public._password_sign_in_allowed(uuid) to supabase_auth_admin;

create or replace function public._actor_active()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when auth.uid() is null then true
    when auth.jwt() -> 'amr' @> '[{"method": "password"}]'::jsonb
         and public._password_sign_in_allowed(auth.uid())
      then coalesce((select p.banned_at is null from public.profiles p
                      where p.user_id = auth.uid()), false)
    when jsonb_typeof(auth.jwt() -> 'amr') = 'array' and not public._session_proves_inbox() then false
    else coalesce((select p.banned_at is null from public.profiles p
                    where p.user_id = auth.uid()), false)
  end;
$function$;
revoke execute on function public._actor_active() from public, anon, authenticated;

create or replace function public.auth_refuse_password(event jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
begin
  if event ->> 'authentication_method' = 'password'
     and not public._password_sign_in_allowed((event ->> 'user_id')::uuid) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign in with the code we email you.'));
  end if;
  return event;
end;
$function$;

grant execute on function public.auth_refuse_password(jsonb) to supabase_auth_admin;
revoke execute on function public.auth_refuse_password(jsonb) from public, anon, authenticated;

-- The 0311 habit: prove the grants, don't trust the REVOKEs.
do $$
begin
  if has_function_privilege('anon', 'public._password_sign_in_allowed(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._password_sign_in_allowed(uuid)', 'execute')
     or has_function_privilege('anon', 'public._actor_active()', 'execute')
     or has_function_privilege('authenticated', 'public._actor_active()', 'execute')
     or has_function_privilege('anon', 'public.auth_refuse_password(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.auth_refuse_password(jsonb)', 'execute') then
    raise exception '0869: an internal helper is callable by a client role';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'public._password_sign_in_allowed(uuid)', 'execute')
     or not has_function_privilege('supabase_auth_admin', 'public.auth_refuse_password(jsonb)', 'execute') then
    raise exception '0869: the auth server cannot reach the password hook';
  end if;
end $$;
