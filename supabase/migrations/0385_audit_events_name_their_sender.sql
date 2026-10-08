-- 0385 — an analytics row a client writes is about the client (audit DB-3).
--
-- analytics_events takes inserts from anyone, and a client chose its own
-- user_id and occurred_at. A script could write events as any user — or as
-- every user — and date them anywhere in time, and every retention read, the
-- admin dashboards and the lifecycle email engine would believe it.
--
-- _tg_event_caller_guard runs first, as the caller (security invoker): on a
-- client's OWN insert it clamps a future time to now, and marks a row naming
-- someone other than the caller, or dated more than 30 days back. The divert
-- trigger then moves marked rows to analytics_events_synthetic — quarantined,
-- not deleted, like the QA-harness and bot rows before them.
--
-- Server-fired events are untouched: inside a security-definer function
-- current_user is the function's owner, and those events legitimately name
-- someone else (a referral reward is the referrer's event, fired during the
-- referee's request).

begin;

create or replace function public._tg_event_caller_guard()
returns trigger
language plpgsql
set search_path = public as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.occurred_at > now() + interval '5 minutes' then
    new.occurred_at := now();
  end if;
  if new.user_id is not null and new.user_id is distinct from auth.uid() then
    new.props := coalesce(new.props, '{}'::jsonb) || jsonb_build_object('synthetic_reason', 'uid_mismatch');
  elsif new.occurred_at < now() - interval '30 days' then
    new.props := coalesce(new.props, '{}'::jsonb) || jsonb_build_object('synthetic_reason', 'stale');
  end if;
  return new;
end;
$$;
revoke execute on function public._tg_event_caller_guard() from public, anon, authenticated;

-- BEFORE triggers fire in name order: this one has to run before the divert.
create trigger analytics_events_a_caller_guard
  before insert on public.analytics_events
  for each row execute function public._tg_event_caller_guard();

CREATE OR REPLACE FUNCTION public._tg_divert_synthetic_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reason text;
begin
  if coalesce(new.props->>'synthetic', '') = 'true' then
    v_reason := 'qa_harness';
  elsif coalesce(new.props->>'is_bot', '') = 'true' then
    v_reason := 'bot_ua';
  elsif new.props->>'synthetic_reason' in ('uid_mismatch', 'stale') then
    -- Marked by _tg_event_caller_guard (0385).
    v_reason := new.props->>'synthetic_reason';
  else
    return new;
  end if;

  begin
    insert into public.analytics_events_synthetic
      (id, session_id, user_id, event, props, path, occurred_at, country, reason)
    values
      (new.id, new.session_id, new.user_id, new.event, new.props, new.path,
       new.occurred_at, new.country, v_reason);
  exception when others then
    null;
  end;
  return null;
end $function$;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.analytics_events'::regclass and tgname = 'analytics_events_a_caller_guard') then
    raise exception '0385: the caller guard is missing';
  end if;
  if (select prosecdef from pg_proc where oid = 'public._tg_event_caller_guard()'::regprocedure) then
    raise exception '0385: the caller guard must run as the caller';
  end if;
  if 'analytics_events_a_caller_guard' > 'analytics_events_divert_synthetic' then
    raise exception '0385: the guard would fire after the divert';
  end if;
end $$;

commit;
