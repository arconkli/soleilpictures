-- 0320_api_request_log_durability.sql
--
-- api_request_log is the customer-facing audit log behind GET /api/v1/audit.
-- Its two foreign keys were NOT NULL ... ON DELETE CASCADE (0220:221-222), so
-- revoking a token or deleting a user erased that actor's entire history — an
-- audit trail the person being audited could partly delete. It also recorded
-- no IP and no user agent, which is the first thing a security review asks
-- for after "who".
--
-- Shape after this migration: both FKs nullable with ON DELETE SET NULL, an
-- actor_label snapshot taken at write time (service account name, display
-- name, or email) so a row still reads sensibly after its actor is gone, and
-- ip / user_agent columns filled by the Worker from cf-connecting-ip.
--
-- Locking: the table is written on every API write on the shared production
-- project. DROP CONSTRAINT is metadata-only; the expensive step is ADD, which
-- is deferred with NOT VALID and then VALIDATE (a SHARE UPDATE EXCLUSIVE lock
-- that does not block writes). Run this in the 03:xx window regardless.
--
-- api_log_request gains p_ip and p_ua. The 8-argument version is DROPPED, not
-- overloaded: PostgREST resolves overloads by argument name, and the Worker
-- posts named arguments, so two candidates would be an ambiguity error at call
-- time (the 0247 lesson). The Worker sends the new arguments from the same
-- deploy; until it is promoted, production's Worker calls with 8 names and
-- the defaults fill the rest.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.api_request_log add column if not exists actor_label text;
alter table public.api_request_log add column if not exists ip inet;
alter table public.api_request_log add column if not exists user_agent text;

-- ── FKs: nullable, set null on delete ───────────────────────────────────────
alter table public.api_request_log alter column token_id drop not null;
alter table public.api_request_log alter column user_id drop not null;

alter table public.api_request_log drop constraint if exists api_request_log_token_id_fkey;
alter table public.api_request_log drop constraint if exists api_request_log_user_id_fkey;

alter table public.api_request_log
  add constraint api_request_log_token_id_fkey
  foreign key (token_id) references public.api_tokens(id) on delete set null not valid;
alter table public.api_request_log
  add constraint api_request_log_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null not valid;

alter table public.api_request_log validate constraint api_request_log_token_id_fkey;
alter table public.api_request_log validate constraint api_request_log_user_id_fkey;

-- ── Backfill the label for rows that still have an actor ────────────────────
update public.api_request_log l
   set actor_label = coalesce(s.name, p.display_name, u.email::text)
  from auth.users u
  left join public.service_accounts s on s.user_id = u.id
  left join public.profiles p on p.user_id = u.id
 where l.user_id = u.id
   and l.actor_label is null;

-- ── The writer: snapshot the label, record where from ───────────────────────
drop function if exists public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text);

create function public.api_log_request(
  p_token_id uuid,
  p_user_id  uuid,
  p_method   text,
  p_route    text,
  p_status   integer,
  p_ms       integer,
  p_target   uuid,
  p_tool     text default null,
  p_ip       inet default null,
  p_ua       text default null
) returns void
language sql
security definer
set search_path = public, auth as $$
  insert into public.api_request_log
    (token_id, user_id, method, route, target_id, status, ms, tool, actor_label, ip, user_agent)
  values (
    p_token_id, p_user_id, left(p_method, 10), left(p_route, 120), p_target, p_status, p_ms,
    nullif(left(p_tool, 80), ''),
    (select coalesce(s.name, p.display_name, u.email::text)
       from auth.users u
       left join public.service_accounts s on s.user_id = u.id
       left join public.profiles p on p.user_id = u.id
      where u.id = p_user_id),
    p_ip,
    nullif(left(p_ua, 200), '')
  );
$$;
revoke all on function public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text)
  from public, anon, authenticated;

-- ── Post-conditions ─────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_log_request';
  if v_n <> 1 then
    raise exception 'expected exactly one api_log_request overload, found %', v_n;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'api_request_log'
                and column_name in ('token_id', 'user_id') and is_nullable = 'NO') then
    raise exception 'api_request_log.token_id/user_id are still NOT NULL';
  end if;
  if has_function_privilege('authenticated', 'public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text)', 'execute') then
    raise exception 'api_log_request is client-callable';
  end if;
end $$;
