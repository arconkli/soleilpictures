-- 0133_client_error_mutes.sql
--
-- Admin "mute" for client_errors: mark an error message as not-a-problem so it
-- stays out of the admin Errors tab FOREVER (including future occurrences),
-- behind an Active/All filter with an unmute action. Motivation: stale-deploy
-- lazy-chunk stragglers (old tabs running pre-fix builds) keep re-reporting the
-- same already-fixed errors indefinitely — see the Jun 2026 stale-chunk saga
-- (919d16a / 274fe0d). Per-row dismissal would need re-dismissing every day.
--
-- Mutes are keyed on a NORMALIZED message, not the raw one: chunk-load errors
-- embed per-build asset URLs ("Failed to fetch dynamically imported module:
-- https://…/assets/AppShell-<hash>.js") that change every deploy, so an
-- exact-match mute would un-hide itself on the next deploy.
--
-- Conventions: RLS/policy naming per 0108 (client_errors); admin write-RPC
-- shape per 0099 (admin_set_tier): security definer + _require_admin() (0070),
-- revoke all from public / grant execute to authenticated.

-- ── Normalized mute key ───────────────────────────────────────────────────────
-- lower/trim first (so https?:// matches), then URLs → <url>, then collapse
-- whitespace, then bound the length so the PK index stays sane. Genuinely
-- immutable (regexp_replace/lower/trim/left all are), which keeps the door
-- open for a functional index on client_errors(message) if volume ever grows.
create or replace function public._error_message_key(p_message text)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
           regexp_replace(
             regexp_replace(
               lower(trim(coalesce(p_message, ''))),
               'https?://[^\s'')]+', '<url>', 'g'),
             '\s+', ' ', 'g'),
           1000)
$$;
revoke all on function public._error_message_key(text) from public;

-- ── Mutes table ───────────────────────────────────────────────────────────────
create table if not exists public.client_error_mutes (
  message_key    text primary key,
  sample_message text,
  muted_by       uuid references auth.users on delete set null,
  muted_at       timestamptz not null default now()
);

alter table public.client_error_mutes enable row level security;

drop policy if exists "admin read client_error_mutes" on public.client_error_mutes;
create policy "admin read client_error_mutes" on public.client_error_mutes
  for select using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.tier = 'admin')
  );
-- No insert/update/delete policies: all writes go through the definer RPCs below.

-- ── Mute / unmute RPCs ────────────────────────────────────────────────────────
create or replace function public.admin_mute_error(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  if p_message is null or trim(p_message) = '' then
    raise exception 'message required' using errcode = '22023';
  end if;
  insert into public.client_error_mutes (message_key, sample_message, muted_by)
  values (public._error_message_key(p_message), left(p_message, 2000), auth.uid())
  on conflict (message_key) do nothing;
end;
$$;
revoke all on function public.admin_mute_error(text) from public;
grant execute on function public.admin_mute_error(text) to authenticated;

-- Accepts any raw message from the muted group — the stored key was computed
-- by the same normalizer, so every message in the group resolves to it.
create or replace function public.admin_unmute_error(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  delete from public.client_error_mutes
   where message_key = public._error_message_key(p_message);
end;
$$;
revoke all on function public.admin_unmute_error(text) from public;
grant execute on function public.admin_unmute_error(text) to authenticated;

-- ── admin_error_summary: + muted flag (return shape changes → drop first) ─────
-- Always returns ALL groups, muted included — the client filters, so the UI
-- can show "N muted hidden" without a second query.
drop function if exists public.admin_error_summary(integer);

create function public.admin_error_summary(p_days int default 7)
returns table(message text, kind text, occurrences bigint, sessions bigint, users bigint,
              first_seen timestamptz, last_seen timestamptz, sample_stack text, muted boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  p_days := greatest(1, least(p_days, 365));
  return query
    select e.message,
           min(e.kind)                                              as kind,
           count(*)::bigint                                         as occurrences,
           count(distinct e.session_id)::bigint                     as sessions,
           count(distinct e.user_id)::bigint                        as users,
           min(e.occurred_at)                                       as first_seen,
           max(e.occurred_at)                                       as last_seen,
           (array_agg(e.stack order by e.occurred_at desc))[1]      as sample_stack,
           (public._error_message_key(e.message)
              in (select m.message_key from public.client_error_mutes m)) as muted
      from public.client_errors e
     where e.occurred_at >= now() - make_interval(days => p_days)
     group by e.message
     order by occurrences desc, last_seen desc
     limit 200;
end;
$$;
revoke all on function public.admin_error_summary(int) from public;
grant execute on function public.admin_error_summary(int) to authenticated;

-- ── admin_recent_errors: + p_include_muted, user_agent, muted ─────────────────
-- Muted rows are filtered SERVER-side (default) so they don't eat the row
-- limit; `not in` over an empty mutes table is true, so behavior is unchanged
-- until something is muted. user_agent joins the output for the admin-tab
-- "copy entire error" button. Drop the exact old 2-arg signature — leaving it
-- alongside the 3-arg one would make PostgREST named-arg resolution ambiguous.
drop function if exists public.admin_recent_errors(integer, integer);

create function public.admin_recent_errors(p_days int default 7, p_limit int default 100,
                                           p_include_muted boolean default false)
returns table(id uuid, occurred_at timestamptz, kind text, name text, message text, path text,
              release text, user_id uuid, session_id uuid, stack text, component_stack text,
              user_agent text, muted boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_admin();
  p_days  := greatest(1, least(p_days, 365));
  p_limit := greatest(1, least(p_limit, 500));
  return query
    select e.id, e.occurred_at, e.kind, e.name, e.message, e.path, e.release,
           e.user_id, e.session_id, e.stack, e.component_stack, e.user_agent,
           (public._error_message_key(e.message)
              in (select m.message_key from public.client_error_mutes m)) as muted
      from public.client_errors e
     where e.occurred_at >= now() - make_interval(days => p_days)
       and (p_include_muted
            or public._error_message_key(e.message)
               not in (select m.message_key from public.client_error_mutes m))
     order by e.occurred_at desc
     limit p_limit;
end;
$$;
revoke all on function public.admin_recent_errors(int, int, boolean) from public;
grant execute on function public.admin_recent_errors(int, int, boolean) to authenticated;

-- Schema-cache insurance after the drop/recreate (Supabase auto-reloads on DDL,
-- but the explicit notify removes the stale-cache window entirely).
notify pgrst, 'reload schema';
