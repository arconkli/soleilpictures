-- 0477 — the heartbeat is signed-in only on the server as well
-- (the data-collection pass, 2026-10-21).
--
-- 0470 made bump_seconds_in_app credit only the account calling it, so a
-- signed-out call has credited no one since. A signed-out caller could still
-- run it, though, and each call wrote a heartbeat_session row for whatever
-- session id it sent: a write into the database open to anyone with the public
-- key. Only signed-in callers (and the service role) can run it now.
--
-- Nothing is lost, which is why this doesn't wait for the next promote. The
-- client on main stopped sending signed-out heartbeats (e4e4276e). The build in
-- production still sends them but never reads the answer: flush() awaits
-- supabase.rpc, which resolves its error rather than throwing, and the
-- tab-close keepalive fetch catches its own. Nothing reads heartbeat_session
-- but this function and its hourly purge, so no number moves.
--
-- The grant is the only change. The function's ACL carries no PUBLIC entry, so
-- revoking anon takes. The proof also calls it as each role with zero seconds,
-- which returns before anything is written.

revoke execute on function public.bump_seconds_in_app(integer, uuid, uuid, boolean) from anon;

do $proof$
declare
  v_refused boolean := false;
begin
  -- The 0311 habit: effective privileges, PUBLIC included.
  if has_function_privilege('anon', 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)', 'execute') then
    raise exception '0477: a signed-out caller can still run bump_seconds_in_app';
  end if;
  if not has_function_privilege('authenticated', 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.bump_seconds_in_app(integer,uuid,uuid,boolean)', 'execute') then
    raise exception '0477: the signed-in heartbeat lost its grant';
  end if;

  -- And as the roles themselves.
  set local role authenticated;
  perform public.bump_seconds_in_app(0, null, null, false);
  reset role;
  begin
    set local role anon;
    perform public.bump_seconds_in_app(0, null, null, false);
  exception when insufficient_privilege then
    v_refused := true;
  end;
  reset role;
  if not v_refused then
    raise exception '0477: a signed-out call still runs';
  end if;
end $proof$;
