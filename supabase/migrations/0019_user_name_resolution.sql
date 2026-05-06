-- 0019_user_name_resolution.sql — give the messaging UI durable names
-- for senders + a generic "uuid → email" lookup for any other place
-- that needs to resolve a user id to a friendly label.
--
-- Today messages.sender_id is a uuid; the UI shows "Someone" whenever
-- the realtime broadcast payload (which carries sender_name) isn't
-- around — i.e. on every page refresh, for offline senders, for any
-- message the viewer didn't send. We persist sender_email on the
-- messages row so it can be rendered straight from a SELECT.
--
-- For non-message places (notifications, member dots, ShareModal)
-- that need name lookups, we add a generic users_by_ids RPC — limited
-- to users who share at least one workspace with the caller, so it
-- can't be used to enumerate the auth.users table.

----------------------------------------------------------------------
-- Persist sender_email on messages
----------------------------------------------------------------------
alter table messages add column if not exists sender_email text;

-- Backfill existing rows so the "Someone" fallback never fires for
-- pre-migration messages. auth.users is privileged but readable inside
-- this DDL transaction.
update messages m
   set sender_email = u.email
  from auth.users u
 where u.id = m.sender_id
   and m.sender_email is null;

-- Trigger: stamp sender_email at insert time from the row's sender_id
-- via auth.users. Using SECURITY DEFINER so authenticated callers
-- don't need direct read on auth.users — the trigger does the join
-- on their behalf and writes the result. RLS on messages already
-- enforces sender_id = auth.uid(), so the email can't be spoofed.
create or replace function messages_set_sender_email() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.sender_email is null then
    select email into new.sender_email from auth.users where id = new.sender_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_sender_email_trg on messages;
create trigger messages_sender_email_trg
before insert on messages
for each row execute function messages_set_sender_email();

----------------------------------------------------------------------
-- users_by_ids: bulk uuid → email resolver
----------------------------------------------------------------------
-- Returns one row per requested user_id whom the caller co-occupies a
-- workspace with. Anything outside that scope returns no row (the
-- requesting client just won't get a name back — falls back to a
-- generic placeholder like "Member"). This bounds the privacy
-- boundary: an attacker can't probe arbitrary uuids against
-- auth.users to discover emails.
create or replace function users_by_ids(p_user_ids uuid[])
returns table(user_id uuid, email text)
language sql security definer
set search_path = public, auth as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any(p_user_ids)
    and exists (
      select 1 from workspace_members m1
      join workspace_members m2 on m1.workspace_id = m2.workspace_id
      where m1.user_id = auth.uid() and m2.user_id = u.id
    );
$$;

revoke all on function users_by_ids(uuid[]) from public;
grant execute on function users_by_ids(uuid[]) to authenticated;
