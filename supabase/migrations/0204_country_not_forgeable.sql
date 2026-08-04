-- 0204_country_not_forgeable.sql
--
-- Corrects a wrong assumption in 0203. That migration relied on
-- analytics_events having COLUMN-scoped INSERT grants, so that a new `country`
-- column would simply not be client-writable. It doesn't: the grants are
-- Supabase's default TABLE-level ones, which extend to every column added
-- later. As applied, 0203 left `country` forgeable — a client could POST any
-- value and it would be stored as if it came from the network edge.
--
-- Column-scoping the grant would fix it, but blanket `grant all on all tables
-- in schema public` is exactly how the current grants got here, so any future
-- one would silently re-open the hole. A BEFORE INSERT trigger enforces the
-- invariant unconditionally instead: country is ALWAYS derived server-side,
-- whatever the client sends.
--
-- Rows inserted with no request context (the auth signup trigger, pg_cron)
-- get NULL, which is correct — there is no requester to attribute.
--
-- Verified end-to-end against production: a POST to /rest/v1/analytics_events
-- carrying "country":"ZZ" stored "US", the true edge-derived value.

create or replace function public._tg_stamp_event_country()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  new.country := public.request_country();
  return new;
end $function$;

drop trigger if exists analytics_events_stamp_country on public.analytics_events;
create trigger analytics_events_stamp_country
  before insert on public.analytics_events
  for each row execute function public._tg_stamp_event_country();

-- The 0203 column default is now redundant: the trigger fires on every insert
-- whether or not the column was mentioned. One mechanism, one rule.
alter table public.analytics_events alter column country drop default;
