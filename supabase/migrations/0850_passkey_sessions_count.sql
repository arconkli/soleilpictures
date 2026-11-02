-- 0850_passkey_sessions_count.sql
--
-- Signing in with a passkey opened an empty account. 0600 lets a session act
-- as a person only when its token's `amr` carries an inbox method (a code, a
-- link, a recovery or an invite), and a passkey sign-in records 'passkey'
-- (Supabase Auth: models.PasskeyLogin). _actor_active() said no, every access
-- check granted nothing, my_workspace_ids() came back empty, and the app took
-- the person for a brand-new account. Nothing was lost; signing in with the
-- code still opened everything.
--
-- 'passkey' can't simply join the inbox list. While the project auto-confirms
-- new addresses, a sign-up's own password session can save a passkey, and that
-- passkey would then open the account without the inbox ever being proven,
-- even after the address's real owner proves it (pre-registration takeover:
-- the reason 0600 trusts the session, not the account).
--
-- So a passkey session counts only when every passkey on the account was saved
-- by a session that came in through the inbox:
--
-- 1. passkeys_from_inbox: one row per passkey (auth.webauthn_credentials.id)
--    saved that way. RLS on, no grants: only the definer functions touch it.
-- 2. note_passkey_saved(p_passkey): the app calls it right after saving a
--    passkey (lib/passkeys.js savePasskey). It notes the passkey when it is
--    the caller's, was saved in the last 15 minutes, and the calling session
--    came in through the inbox, or is a passkey session on a proven address
--    whose other passkeys are all noted (adding one more from Settings). The
--    app takes a passkey back off the account when this says no.
-- 3. _session_from_inbox(): 0600's strict test, unchanged. _stamp_inbox_proof()
--    now uses it, so a passkey never proves an address afresh.
-- 4. _session_proves_inbox(): the strict test, or a 'passkey' session on an
--    account whose current address is proven (_user_proved_inbox) and whose
--    every passkey is noted. The token doesn't say which passkey opened it, so
--    one passkey saved any other way switches passkey sign-in off for the
--    whole account; the emailed code still works. Inbox sessions answer from
--    the token alone as before; only passkey sessions read the two tables.
--
-- Passkeys saved before this file are noted by hand, each only after the auth
-- log shows it was saved from a code sign-in.

create table if not exists public.passkeys_from_inbox (
  passkey_id uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  noted_at   timestamptz not null default now()
);
create index if not exists passkeys_from_inbox_user_idx on public.passkeys_from_inbox (user_id);
alter table public.passkeys_from_inbox enable row level security;
revoke all on table public.passkeys_from_inbox from public, anon, authenticated;

create or replace function public._session_from_inbox()
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

revoke execute on function public._session_from_inbox() from public, anon, authenticated;

-- True when the account holds at least one passkey (other than p_except) and
-- every one of them was noted as saved from the inbox.
create or replace function public._passkeys_all_noted(p_user uuid, p_except uuid default null)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select p_user is not null
     and exists (select 1 from auth.webauthn_credentials c
                  where c.user_id = p_user and c.id is distinct from p_except)
     and not exists (
       select 1 from auth.webauthn_credentials c
        where c.user_id = p_user
          and c.id is distinct from p_except
          and not exists (select 1 from public.passkeys_from_inbox f
                           where f.passkey_id = c.id and f.user_id = p_user));
$function$;

revoke execute on function public._passkeys_all_noted(uuid, uuid) from public, anon, authenticated;

create or replace function public._session_proves_inbox()
 returns boolean
 language sql
 stable
 set search_path to ''
as $function$
  select case
    when jsonb_typeof(auth.jwt() -> 'amr') is distinct from 'array' then false
    when public._session_from_inbox() then true
    when exists (select 1 from jsonb_array_elements(auth.jwt() -> 'amr') a
                  where a ->> 'method' = 'passkey')
      then public._user_proved_inbox(auth.uid()) and public._passkeys_all_noted(auth.uid())
    else false
  end;
$function$;

revoke execute on function public._session_proves_inbox() from public, anon, authenticated;

create or replace function public._stamp_inbox_proof()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- 0850: only a session that came in through the inbox proves the address;
  -- a passkey session counts as the person but never re-proves an address.
  if auth.uid() is null or not public._session_from_inbox() then
    return;
  end if;
  update public.profiles p
     set inbox_proven_at = now(),
         inbox_proven_hash = encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex')
    from auth.users u
   where u.id = auth.uid()
     and p.user_id = u.id
     and u.email is not null
     and p.inbox_proven_hash is distinct from encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex');
end;
$function$;

revoke execute on function public._stamp_inbox_proof() from public, anon, authenticated;

create or replace function public.note_passkey_saved(p_passkey uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_amr jsonb := auth.jwt() -> 'amr';
begin
  if v_uid is null or p_passkey is null then
    return false;
  end if;
  if not exists (select 1 from auth.webauthn_credentials c
                  where c.id = p_passkey
                    and c.user_id = v_uid
                    and c.created_at > now() - interval '15 minutes') then
    return false;
  end if;
  if not (
    public._session_from_inbox()
    or (jsonb_typeof(v_amr) = 'array'
        and exists (select 1 from jsonb_array_elements(v_amr) a where a ->> 'method' = 'passkey')
        and public._user_proved_inbox(v_uid)
        and public._passkeys_all_noted(v_uid, p_passkey))
  ) then
    return false;
  end if;
  insert into public.passkeys_from_inbox (passkey_id, user_id)
  values (p_passkey, v_uid)
  on conflict (passkey_id) do nothing;
  -- Passkeys taken off the account leave nothing behind.
  delete from public.passkeys_from_inbox f
   where f.user_id = v_uid
     and not exists (select 1 from auth.webauthn_credentials c where c.id = f.passkey_id);
  return true;
end;
$function$;

revoke execute on function public.note_passkey_saved(uuid) from public, anon;
grant execute on function public.note_passkey_saved(uuid) to authenticated;

-- The 0311 habit: prove the grants, don't trust the REVOKEs.
do $$
begin
  if has_function_privilege('anon', 'public.note_passkey_saved(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.note_passkey_saved(uuid)', 'execute') then
    raise exception '0850: note_passkey_saved must be callable by authenticated only';
  end if;
  if has_function_privilege('anon', 'public._session_from_inbox()', 'execute')
     or has_function_privilege('authenticated', 'public._session_from_inbox()', 'execute')
     or has_function_privilege('anon', 'public._passkeys_all_noted(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._passkeys_all_noted(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public._session_proves_inbox()', 'execute')
     or has_function_privilege('authenticated', 'public._session_proves_inbox()', 'execute')
     or has_function_privilege('anon', 'public._stamp_inbox_proof()', 'execute')
     or has_function_privilege('authenticated', 'public._stamp_inbox_proof()', 'execute') then
    raise exception '0850: an internal helper is callable by a client role';
  end if;
  if has_table_privilege('anon', 'public.passkeys_from_inbox', 'select, insert, update, delete')
     or has_table_privilege('authenticated', 'public.passkeys_from_inbox', 'select, insert, update, delete') then
    raise exception '0850: passkeys_from_inbox is open to a client role';
  end if;
end $$;
