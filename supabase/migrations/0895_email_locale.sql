-- 0895: which language an email is written in.
--
-- send-transactional-email asks this once per send. The reader's own saved
-- language (auth.users.raw_user_meta_data->>'locale', written by the app's
-- language picker) wins. When the address has no account yet (an invitation to
-- someone new) the sender's language is the best guess, so a Spanish-speaking
-- person who invites a colleague writes to them in Spanish.
--
-- An account found by address answers for itself even when it has no saved
-- language: that person has not chosen one, and the sender's language is not
-- theirs. null means "no preference"; the caller sends English.
--
-- Internal: only the service role (the edge function) may call it. It reads
-- auth.users, and answering "is this address an account" to a signed-in or
-- signed-out caller would be an account-enumeration oracle.

begin;

create or replace function public._email_locale(p_email text, p_actor uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_locale text;
begin
  select u.raw_user_meta_data->>'locale' into v_locale
    from auth.users u
   where lower(u.email) = lower(p_email)
   limit 1;
  if found then
    return v_locale;
  end if;

  if p_actor is null then
    return null;
  end if;

  select u.raw_user_meta_data->>'locale' into v_locale
    from auth.users u
   where u.id = p_actor;
  return v_locale;
end;
$$;

revoke execute on function public._email_locale(text, uuid) from public, anon, authenticated;
grant execute on function public._email_locale(text, uuid) to service_role;

-- Proofs (the 0311 habit: a REVOKE reporting success proves nothing)

do $$
begin
  if has_function_privilege('anon', 'public._email_locale(text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._email_locale(text,uuid)', 'execute') then
    raise exception '0895: _email_locale is client-executable';
  end if;
  if not has_function_privilege('service_role', 'public._email_locale(text,uuid)', 'execute') then
    raise exception '0895: _email_locale is not callable by the service role';
  end if;
end $$;

commit;
