-- 0523_security_log.sql
--
-- A security log, recording from now on. One row per security-relevant act:
-- who did it (actor_id), in which workspace (null for an account-level act),
-- what kind of act, and a small jsonb naming the target. No emails and no
-- tokens go in target.
--
-- Readable by the workspace's owner and co-owners; an account-level row
-- (workspace_id null) only by the account that did it. Clients never write it:
-- rows come from SECURITY DEFINER code through _log_security_event().
-- Not in the realtime publication.

create table if not exists public.security_events (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,
  workspace_id uuid,
  kind         text not null,
  target       jsonb not null default '{}'::jsonb
);

create index if not exists security_events_workspace_at
  on public.security_events (workspace_id, at desc);

alter table public.security_events enable row level security;

revoke all on table public.security_events from public, anon, authenticated;
grant select on table public.security_events to authenticated;

create policy "security_events read" on public.security_events
  for select to authenticated
  using (
    case when workspace_id is null then actor_id = (select auth.uid())
         else public.can_manage_workspace(workspace_id) end
  );

create or replace function public._log_security_event(p_kind text, p_workspace uuid, p_target jsonb default '{}'::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  insert into public.security_events (actor_id, workspace_id, kind, target)
  values (auth.uid(), p_workspace, p_kind, coalesce(p_target, '{}'::jsonb));
end;
$function$;

revoke execute on function public._log_security_event(text, uuid, jsonb) from public, anon, authenticated;

-- The 0311 habit: prove the grants, don't trust them.
do $$
begin
  if has_function_privilege('anon', 'public._log_security_event(text,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._log_security_event(text,uuid,jsonb)', 'EXECUTE') then
    raise exception '0523: _log_security_event is client-callable';
  end if;
  if has_table_privilege('authenticated', 'public.security_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.security_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.security_events', 'DELETE')
     or has_table_privilege('anon', 'public.security_events', 'SELECT')
     or has_table_privilege('anon', 'public.security_events', 'INSERT')
     or not has_table_privilege('authenticated', 'public.security_events', 'SELECT') then
    raise exception '0523: security_events table grants are wrong';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.security_events'::regclass) then
    raise exception '0523: security_events has RLS off';
  end if;
  if exists (select 1 from pg_publication_tables
              where schemaname = 'public' and tablename = 'security_events') then
    raise exception '0523: security_events is in a realtime publication';
  end if;
end $$;
