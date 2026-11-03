-- 0854: a sign-in that doesn't count as you is told so on the way in.
--
-- Since 0600 a session counts as the person only when it proves the inbox
-- (_session_proves_inbox; 0850 also counts a passkey whose saving was noted
-- from one). A session that doesn't sees none of its clusters, so the app's
-- workspace load found no root, asked ensure_workspace_root to repair it, got
-- back a root it still couldn't read, and showed "your workspace has no
-- clusters and could not be repaired" with nothing that could help.
--
-- ensure_workspace_root now refuses such a session first, with 42501 and the
-- hint 'sign_in_again', using _actor_active's own test of the session. The app
-- reads the hint (App.jsx signInAgain) and shows "Sign in again to open your
-- clusters", whose one button signs out to the email-code sign-in. A call
-- with no session (the service role), an inbox session, a suspended account
-- and a non-member go on exactly as before: the rest is 0275's body.

create or replace function public.ensure_workspace_root(p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and jsonb_typeof(auth.jwt() -> 'amr') = 'array' and not public._session_proves_inbox() then
    raise exception 'this sign-in does not count as you: sign in with the code we email you' using errcode = '42501', hint = 'sign_in_again';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'you are not a member of this workspace' using errcode = '42501';
  end if;
  return public._ensure_workspace_root(p_workspace_id, auth.uid());
end;
$function$;

-- 0275's grants, unchanged by the replace, said again.
revoke all on function public.ensure_workspace_root(uuid) from public;
revoke all on function public.ensure_workspace_root(uuid) from anon;
grant execute on function public.ensure_workspace_root(uuid) to authenticated;

-- The 0311 habit: prove the grants, then that each kind of caller gets what
-- it should. A random workspace, so both checks refuse before any repair.
do $$
declare
  v_ws   uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_hint text;
  v_msg  text;
begin
  if has_function_privilege('anon', 'public.ensure_workspace_root(uuid)', 'execute') then
    raise exception '0854: anon can run ensure_workspace_root';
  end if;
  if not has_function_privilege('authenticated', 'public.ensure_workspace_root(uuid)', 'execute') then
    raise exception '0854: a signed-in person cannot run ensure_workspace_root';
  end if;

  -- A session that never came through the inbox: refused, with the hint.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', 1)))::text, true);
  begin
    perform public.ensure_workspace_root(v_ws);
    raise exception '0854: a session that does not count got a root';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'sign_in_again' then
      raise exception '0854: the refusal does not carry its hint (got %)', v_hint;
    end if;
  end;

  -- An inbox session goes on to the membership check, as before.
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', 1)))::text, true);
  begin
    perform public.ensure_workspace_root(v_ws);
    raise exception '0854: a non-member got a root';
  exception when insufficient_privilege then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    if v_hint = 'sign_in_again' or v_msg <> 'you are not a member of this workspace' then
      raise exception '0854: an inbox session was refused as a sign-in (%, %)', v_msg, v_hint;
    end if;
  end;

  perform set_config('request.jwt.claims', '', true);
end $$;
