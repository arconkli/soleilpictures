-- 0892 — where admin_report (0893) keeps the heavy admin reports.
--
-- The retention, heatmap, sharing and tests reads take seconds each, and the
-- phone and the computer both ask for them on every open. admin_report keeps
-- each answer here for ten minutes, keyed by report name and arguments, so
-- the first admin read computes and the ones after reuse it.
--
-- admin_report(p_fn, p_args, p_fresh) returns {data, at}: data is exactly what
-- PostgREST returns for the report called directly with p_args (an array of
-- row objects for a table report, the value for a jsonb one), at is when it
-- was computed. A key left out of p_args takes the report's own default and
-- an explicit null passes null. p_fresh computes again: the manual refresh.
-- A row nobody has read for two days is removed on the next compute.
--
-- No cron fills this: _require_admin() keys on auth.uid(), so a job would
-- have to pose as an admin.
--
-- Only admin_report (security definer) reads or writes it. Row level security
-- is on with NO policies on purpose, and the grants Supabase gives every new
-- public table to anon and authenticated are taken back, so no client can
-- reach a row through the API.

begin;

create table if not exists public.admin_report_cache (
  fn          text        not null,
  args        jsonb       not null default '{}'::jsonb,
  result      jsonb,
  computed_at timestamptz not null default now(),
  read_at     timestamptz not null default now(),
  primary key (fn, args)
);

comment on table public.admin_report_cache is
  'Heavy admin reports kept for ten minutes by admin_report(). RLS on with no policies: clients never read it directly.';

alter table public.admin_report_cache enable row level security;

revoke all on table public.admin_report_cache from public, anon, authenticated;

-- admin_report (0893) stores each answer through this, then purges rows
-- nobody has read for two days. A tests read where a test failed to read
-- (admin_tests_read puts {error: sqlstate} in its place) is not kept, so the
-- next open reads it again. The purge skips rows another compute holds, so
-- two reports computed at once never deadlock.
create or replace function public._admin_report_keep(
  p_fn text, p_args jsonb, p_result jsonb, p_at timestamptz
) returns void
language plpgsql volatile set search_path = public as $fn$
begin
  if p_fn <> 'admin_tests_read' or not jsonb_path_exists(p_result, '$.tests.*.error') then
    insert into public.admin_report_cache (fn, args, result, computed_at, read_at)
    values (p_fn, p_args, p_result, p_at, p_at)
    on conflict (fn, args) do update
      set (result, computed_at, read_at) = (excluded.result, p_at, p_at);
  end if;

  delete from public.admin_report_cache where (fn, args) in (
    select fn, args from public.admin_report_cache
     where read_at < now() - interval '2 days' for update skip locked);
end
$fn$;

revoke execute on function public._admin_report_keep(text, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;

-- Proof (0311 habit): a REVOKE reporting success proves nothing.
do $proof$
declare
  r text;
  p text;
begin
  if not (select c.relrowsecurity from pg_class c
           where c.oid = 'public.admin_report_cache'::regclass) then
    raise exception '0892: admin_report_cache has row level security off';
  end if;
  if exists (select 1 from pg_policy pol
              where pol.polrelid = 'public.admin_report_cache'::regclass) then
    raise exception '0892: admin_report_cache has a policy; it must have none';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege(r, 'public.admin_report_cache', p) then
        raise exception '0892: % can % admin_report_cache', r, p;
      end if;
    end loop;
    if has_function_privilege(r, 'public._admin_report_keep(text, jsonb, jsonb, timestamptz)', 'execute') then
      raise exception '0892: % can run _admin_report_keep', r;
    end if;
  end loop;
end $proof$;

commit;
