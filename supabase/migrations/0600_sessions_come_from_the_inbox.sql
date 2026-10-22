-- 0600_sessions_come_from_the_inbox.sql
--
-- Clusters signs people in with a code sent to their inbox; nothing in the app
-- signs in with a password. A session counts as a person only when it was
-- opened by the inbox (a code, a link, a recovery or an invite), which the
-- access token records in its `amr` claim. Today every session a client holds
-- is an 'otp' one: our own API sessions (generate_link) and resume links
-- record 'otp' too.
--
-- 1. _session_proves_inbox(): true when the caller's JWT carries an inbox
--    method. For SECURITY DEFINER RPCs that act on an email address (team
--    invites, offers, domain joins). False without a JWT.
-- 2. _actor_active() also says no to a signed-in session whose token carries
--    `amr` but no inbox method, so every access check that calls it
--    (can_read_board, can_write_board, can_write_workspace,
--    can_manage_workspace, my_readable_board_ids, my_workspace_ids …) grants
--    such a session nothing. A token without `amr` is left to the old rule.
-- 3. auth_refuse_password(event): a custom access token hook that refuses to
--    issue a token for a password sign-in. This file does NOT enable it: while
--    the project auto-confirms new addresses, every sign-up mints a password
--    session of its own, and refusing it would stop sign-ups. Enable it in the
--    dashboard (Authentication › Hooks › Customize Access Token) only after
--    "Confirm email" is on and no new 'password' rows appear in
--    auth.mfa_amr_claims.

create or replace function public._session_proves_inbox()
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select case
    when jsonb_typeof(auth.jwt() -> 'amr') is distinct from 'array' then false
    else exists (
      select 1 from jsonb_array_elements(auth.jwt() -> 'amr') a
      where a ->> 'method' in ('otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change'))
  end;
$function$;

revoke execute on function public._session_proves_inbox() from public, anon, authenticated;

create or replace function public._actor_active()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when auth.uid() is null then true
    when jsonb_typeof(auth.jwt() -> 'amr') = 'array' and not public._session_proves_inbox() then false
    else coalesce((select p.banned_at is null from public.profiles p
                    where p.user_id = auth.uid()), false)
  end;
$function$;

create or replace function public.auth_refuse_password(event jsonb)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
begin
  if event ->> 'authentication_method' = 'password' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign in with the code we email you.'));
  end if;
  return event;
end;
$function$;

grant execute on function public.auth_refuse_password(jsonb) to supabase_auth_admin;
revoke execute on function public.auth_refuse_password(jsonb) from public, anon, authenticated;

-- The 0311 habit: prove the grants, don't trust the REVOKE.
do $$
begin
  if has_function_privilege('anon', 'public._session_proves_inbox()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._session_proves_inbox()', 'EXECUTE') then
    raise exception '0600: _session_proves_inbox() is client-callable';
  end if;
  if has_function_privilege('anon', 'public._actor_active()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._actor_active()', 'EXECUTE') then
    raise exception '0600: _actor_active() is client-callable';
  end if;
  if has_function_privilege('anon', 'public.auth_refuse_password(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.auth_refuse_password(jsonb)', 'EXECUTE') then
    raise exception '0600: auth_refuse_password(jsonb) is client-callable';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'public.auth_refuse_password(jsonb)', 'EXECUTE')
     or not has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') then
    raise exception '0600: the auth server cannot reach auth_refuse_password(jsonb)';
  end if;
end $$;
