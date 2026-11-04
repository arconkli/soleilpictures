-- 0858 — The API log records failed calls, and which MCP client made them.
--
-- api_request_log (0220, 0320) says who called what and the HTTP status. An
-- MCP tool call that fails still answers 200 with isError in its body, so a
-- broken tool reads as a working one, and nothing says which client was
-- connected when it broke. Three columns:
--
--   is_error    the call failed, whatever its status said (default false, so
--               every row written before this reads as it did);
--   error_code  the short machine code it failed with, at most 64 characters;
--   client      the MCP client's name/version from initialize, at most 120
--               characters, on initialize rows only.
--
-- api_log_request takes three more optional arguments for them. The Worker
-- posts named arguments and PostgREST resolves overloads by name, so two
-- versions with defaults would be an ambiguity error at call time (the 0247
-- and 0320 lesson): the 10-argument version is DROPPED and recreated with 13.
-- This applies before the Worker that sends them deploys, and production's
-- Worker keeps calling with 10 names: the defaults fill the rest. The function
-- bounds its inputs (truncates, never refuses), so a long code or client name
-- can never be what loses an audit row.
--
-- Grants: 0320's, restored exactly — EXECUTE for postgres (the owner) and
-- service_role, nobody else. The table's own grants don't change.
--
-- Locking: the table is written on every API write. ADD COLUMN with a constant
-- default is metadata-only on Postgres 11+. Each CHECK is added NOT VALID and
-- then validated, which takes SHARE UPDATE EXCLUSIVE and does not block the
-- writes; the new columns are null or false on every old row, so it passes.

begin;

set local lock_timeout = '3s';

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table public.api_request_log add column if not exists is_error boolean not null default false;
alter table public.api_request_log add column if not exists error_code text;
alter table public.api_request_log add column if not exists client text;

alter table public.api_request_log drop constraint if exists api_request_log_error_code_len;
alter table public.api_request_log drop constraint if exists api_request_log_client_len;
alter table public.api_request_log
  add constraint api_request_log_error_code_len check (length(error_code) <= 64) not valid;
alter table public.api_request_log
  add constraint api_request_log_client_len check (length(client) <= 120) not valid;
alter table public.api_request_log validate constraint api_request_log_error_code_len;
alter table public.api_request_log validate constraint api_request_log_client_len;

comment on column public.api_request_log.is_error is
  'The call failed, whatever its HTTP status said: an MCP tool result with isError answers 200 (0858).';
comment on column public.api_request_log.error_code is
  'The short machine code a failed call ended with, at most 64 characters (0858).';
comment on column public.api_request_log.client is
  'The MCP client''s name/version from initialize, on initialize rows only, at most 120 characters (0858).';

-- ── The writer ──────────────────────────────────────────────────────────────
drop function if exists public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text);

create function public.api_log_request(
  p_token_id   uuid,
  p_user_id    uuid,
  p_method     text,
  p_route      text,
  p_status     integer,
  p_ms         integer,
  p_target     uuid,
  p_tool       text default null,
  p_ip         inet default null,
  p_ua         text default null,
  p_is_error   boolean default false,
  p_error_code text default null,
  p_client     text default null
) returns void
language sql
security definer
set search_path = public, auth as $$
  insert into public.api_request_log
    (token_id, user_id, method, route, target_id, status, ms, tool, actor_label, ip, user_agent,
     is_error, error_code, client)
  values (
    p_token_id, p_user_id, left(p_method, 10), left(p_route, 120), p_target, p_status, p_ms,
    nullif(left(p_tool, 80), ''),
    (select coalesce(s.name, p.display_name, u.email::text)
       from auth.users u
       left join public.service_accounts s on s.user_id = u.id
       left join public.profiles p on p.user_id = u.id
      where u.id = p_user_id),
    p_ip,
    nullif(left(p_ua, 200), ''),
    coalesce(p_is_error, false),
    nullif(left(btrim(p_error_code), 64), ''),
    nullif(left(btrim(p_client), 120), '')
  );
$$;

-- 0320's ACL: the owner and service_role only.
revoke all on function public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text, boolean, text, text)
  to service_role;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  f constant text := 'public.api_log_request(uuid, uuid, text, text, integer, integer, uuid, text, inet, text, boolean, text, text)';
  v_n int;
begin
  -- One version only, or PostgREST can't choose between them.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'api_log_request';
  if v_n <> 1 then
    raise exception '0858: expected exactly one api_log_request, found %', v_n;
  end if;
  -- The 0311 habit: 0320's grants, proven.
  if has_function_privilege('anon', f, 'execute')
     or has_function_privilege('authenticated', f, 'execute') then
    raise exception '0858: api_log_request is client-callable';
  end if;
  if not has_function_privilege('service_role', f, 'execute') then
    raise exception '0858: the Worker (service_role) can no longer run api_log_request';
  end if;
  -- The current Worker's call, 10 named arguments, still resolves: everything
  -- after p_tool has a default.
  if (select p.pronargdefaults from pg_proc p where p.oid = f::regprocedure) <> 6 then
    raise exception '0858: api_log_request''s last six arguments must all be optional';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'api_request_log'
                and column_name = 'is_error' and (is_nullable <> 'NO' or column_default is distinct from 'false')) then
    raise exception '0858: api_request_log.is_error is not "not null default false"';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.api_request_log'::regclass and convalidated
         and conname in ('api_request_log_error_code_len', 'api_request_log_client_len')) <> 2 then
    raise exception '0858: the length checks are missing or not validated';
  end if;
end;
$proof$;

commit;
