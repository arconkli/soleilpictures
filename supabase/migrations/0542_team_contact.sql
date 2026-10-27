-- 0542: Teams, part 13 — "Talk to us" (S5).
--
-- STATUS: APPLIED 2026-10-27 on the owner's go, as two parts
-- (team_contact_0542_part1: the table and request_team_contact;
-- team_contact_0542_part2: the admin functions and the proof), then probed
-- in a rolled-back transaction: sent, already, invalid, busy, one paged alert.
--
-- The pricing page's "Need SSO, invoices or more than 100 seats? Talk to us"
-- (the owner's decision of 2026-10-21: a short form that lands in /admin with
-- an alert email). Anyone may send one, signed in or not:
--   * request_team_contact keeps the request and pages the owner through
--     ops_alerts (ops_alert_dispatch, 0369, sends the plain-text ops_alert
--     email; nothing new to deploy);
--   * admin_team_contacts and admin_set_team_contact are the admin page's.
-- So the form can't flood the owner's inbox: one request per address a day
-- (a repeat answers 'already' and changes nothing), at most 20 requests an
-- hour from everyone together (past that it refuses, team_contact_busy), and
-- at most 10 emails a day (past that a request is still kept, just not
-- emailed). Nobody reads or writes the table but these functions.
-- Everything here is new; nothing live is re-emitted.

begin;
set local lock_timeout = '3s';

-- ── 1. The requests ─────────────────────────────────────────────────────────

create table if not exists public.team_contact_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid references auth.users (id) on delete set null,
  name        text not null check (char_length(name) between 1 and 120),
  email       text not null check (char_length(email) between 3 and 254),
  company     text not null check (char_length(company) between 1 and 160),
  editors     integer check (editors between 1 and 1000000),
  needs       text[] not null default '{}'
              check (needs <@ array['sso', 'invoices', 'seats', 'other']::text[]),
  message     text check (char_length(message) <= 2000),
  status      text not null default 'new' check (status in ('new', 'handled', 'spam')),
  handled_at  timestamptz,
  handled_by  uuid references auth.users (id) on delete set null
);
create index if not exists team_contact_requests_created_idx
  on public.team_contact_requests (created_at desc);
create index if not exists team_contact_requests_email_idx
  on public.team_contact_requests (email, created_at desc);
alter table public.team_contact_requests enable row level security;
revoke all on public.team_contact_requests from public, anon, authenticated;

-- ── 2. Sending one ──────────────────────────────────────────────────────────

-- 'sent', or 'already' when this address sent one in the last day. A request
-- that is missing something refuses with team_contact_invalid (22023); a
-- busy hour with team_contact_busy.
create or replace function public.request_team_contact(
  p_name    text,
  p_email   text,
  p_company text,
  p_editors integer default null,
  p_needs   text[]  default '{}',
  p_message text    default null
)
returns text
language plpgsql security definer
set search_path = public as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_company text := btrim(coalesce(p_company, ''));
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_needs   text[];
  v_id      uuid;
  v_page    boolean;
  v_body    text;
begin
  if char_length(v_name) not between 1 and 120
     or char_length(v_company) not between 1 and 160
     or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or (p_editors is not null and p_editors not between 1 and 1000000)
     or char_length(coalesce(v_message, '')) > 2000 then
    raise exception 'that request is missing something'
      using errcode = '22023', hint = 'team_contact_invalid';
  end if;
  select coalesce(array_agg(distinct n order by n), '{}') into v_needs
    from unnest(coalesce(p_needs, '{}'::text[])) n
   where n in ('sso', 'invoices', 'seats', 'other');

  -- Two sends from one address at once would both pass the check below.
  perform pg_advisory_xact_lock(hashtext('team_contact:' || v_email));
  if exists (select 1 from public.team_contact_requests r
              where r.email = v_email and r.created_at > now() - interval '24 hours') then
    return 'already';
  end if;
  if (select count(*) from public.team_contact_requests r
       where r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'too many requests just now' using hint = 'team_contact_busy';
  end if;

  insert into public.team_contact_requests (user_id, name, email, company, editors, needs, message)
  values (auth.uid(), v_name, v_email, v_company, p_editors, v_needs, v_message)
  returning id into v_id;

  v_page := (select count(*) from public.ops_alerts a
              where a.kind = 'team_contact' and a.page
                and a.created_at > now() - interval '24 hours') < 10;
  v_body := 'Someone asked to talk about Team.' || chr(10) || chr(10)
    || 'Name: ' || v_name || chr(10)
    || 'Email: ' || v_email || chr(10)
    || 'Company: ' || v_company || chr(10)
    || 'People who would edit: ' || coalesce(p_editors::text, 'not given') || chr(10)
    || 'Needs: ' || coalesce(nullif(array_to_string(v_needs, ', '), ''), 'not given') || chr(10)
    || 'Signed in: ' || case when auth.uid() is null then 'no' else 'yes' end || chr(10) || chr(10)
    || coalesce(v_message, '(no message)') || chr(10) || chr(10)
    || 'Every request is on the admin page.';
  perform public.ops_alert_raise('team_contact', 'Talk to us: ' || left(v_company, 120), v_body,
                                 v_page, 'team_contact:' || v_id::text, interval '1 hour', auth.uid());
  return 'sent';
end;
$$;

-- ── 3. The admin page's ─────────────────────────────────────────────────────

create or replace function public.admin_team_contacts(p_limit integer default 200)
returns table (id uuid, created_at timestamptz, name text, email text, company text,
               editors integer, needs text[], message text, status text,
               handled_at timestamptz, signed_in boolean)
language plpgsql stable security definer
set search_path = public as $$
begin
  perform public._require_admin();
  return query
    select r.id, r.created_at, r.name, r.email, r.company, r.editors, r.needs, r.message,
           r.status, r.handled_at, r.user_id is not null
      from public.team_contact_requests r
     order by r.created_at desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

create or replace function public.admin_set_team_contact(p_id uuid, p_status text)
returns void
language plpgsql security definer
set search_path = public as $$
begin
  perform public._require_admin();
  if p_status is null or p_status not in ('new', 'handled', 'spam') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  update public.team_contact_requests
     set status     = p_status,
         handled_at = case when p_status = 'new' then null else now() end,
         handled_by = case when p_status = 'new' then null else auth.uid() end
   where id = p_id;
end;
$$;

revoke execute on function public.request_team_contact(text, text, text, integer, text[], text) from public;
grant execute on function public.request_team_contact(text, text, text, integer, text[], text) to anon, authenticated;
revoke execute on function public.admin_team_contacts(integer) from public, anon;
grant execute on function public.admin_team_contacts(integer) to authenticated;
revoke execute on function public.admin_set_team_contact(uuid, text) from public, anon;
grant execute on function public.admin_set_team_contact(uuid, text) to authenticated;

-- ── 4. Proof ────────────────────────────────────────────────────────────────

do $$
declare
  v_fn text;
begin
  if to_regprocedure('public.ops_alert_raise(text,text,text,boolean,text,interval,uuid)') is null
     or to_regprocedure('public._require_admin()') is null then
    raise exception '0542 needs ops_alert_raise (0369) and _require_admin live first';
  end if;

  if not has_function_privilege('anon', 'public.request_team_contact(text,text,text,integer,text[],text)', 'execute')
     or not has_function_privilege('authenticated', 'public.request_team_contact(text,text,text,integer,text[],text)', 'execute') then
    raise exception '0542: request_team_contact must be callable signed in and signed out';
  end if;
  foreach v_fn in array array['public.admin_team_contacts(integer)', 'public.admin_set_team_contact(uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0542: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0542: % is not callable signed in', v_fn;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.team_contact_requests', 'select')
     or has_table_privilege('authenticated', 'public.team_contact_requests', 'select')
     or has_table_privilege('anon', 'public.team_contact_requests', 'insert')
     or has_table_privilege('authenticated', 'public.team_contact_requests', 'insert') then
    raise exception '0542: team_contact_requests can be read or written directly';
  end if;

  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname in ('request_team_contact', 'admin_team_contacts', 'admin_set_team_contact')
              group by p.proname having count(*) > 1) then
    raise exception '0542: an overload exists (PGRST203)';
  end if;
end $$;

commit;
