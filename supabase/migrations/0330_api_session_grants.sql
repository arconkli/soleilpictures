-- 0330_api_session_grants.sql
--
-- api_session_begin / api_session_store / api_session_release (0221) are
-- SECURITY DEFINER and were left executable by anon and authenticated: 0221
-- revoked them from PUBLIC only, and the explicit anon/authenticated grants
-- stamped by the pre-0311 schema default privileges survived that revoke.
-- api_session_begin(p_user_id) returns that user's cached access and refresh
-- token, so a caller holding only the publishable key could mint the session of
-- any account that has used /api/v1.
--
-- The Worker is the only caller and uses the service role for all three
-- (lib/apiAuth.js -> scoutRpc -> scoutDb.svcHeaders), so this removes no
-- legitimate path.

revoke execute on function public.api_session_begin(uuid, integer)             from public, anon, authenticated;
revoke execute on function public.api_session_store(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public.api_session_release(uuid)                    from public, anon, authenticated;
grant  execute on function public.api_session_begin(uuid, integer)             to service_role;
grant  execute on function public.api_session_store(uuid, text, text, integer) to service_role;
grant  execute on function public.api_session_release(uuid)                    to service_role;

-- Prove it: a REVOKE that reports success proves nothing (the 0311 habit).
do $$
begin
  if has_function_privilege('anon',          'public.api_session_begin(uuid, integer)', 'execute')
  or has_function_privilege('authenticated', 'public.api_session_begin(uuid, integer)', 'execute')
  or has_function_privilege('anon',          'public.api_session_store(uuid, text, text, integer)', 'execute')
  or has_function_privilege('authenticated', 'public.api_session_store(uuid, text, text, integer)', 'execute')
  or has_function_privilege('anon',          'public.api_session_release(uuid)', 'execute')
  or has_function_privilege('authenticated', 'public.api_session_release(uuid)', 'execute')
  then
    raise exception '0330: api_session_* still executable by anon or authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.api_session_begin(uuid, integer)', 'execute')
  or not has_function_privilege('service_role', 'public.api_session_store(uuid, text, text, integer)', 'execute')
  or not has_function_privilege('service_role', 'public.api_session_release(uuid)', 'execute')
  then
    raise exception '0330: service_role lost an api_session_* function';
  end if;
end $$;
