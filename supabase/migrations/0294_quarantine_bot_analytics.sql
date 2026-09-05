-- 0294_quarantine_bot_analytics.sql — keep crawler traffic out of the numbers,
-- the same way 0230 keeps QA-harness traffic out.
--
-- THE PROBLEM. Crawlers that execute JavaScript reach the analytics client and
-- emit ordinary rows. Once lib/device.js has classified them they are
-- indistinguishable from people: Googlebot-Smartphone's user-agent is a real
-- Android Chrome string with "compatible; Googlebot/2.1" appended, so it lands
-- in analytics_events as device_type=mobile, os=Android, browser=Chrome. On the
-- SEO landing pages this fleet came to outnumber the humans — an audit of the
-- mobile split there found roughly three quarters of "mobile" sessions were
-- this pool. Every device cut, every channel cut and every landing-page
-- conversion rate that touched those pages was reading robots as demand.
--
-- WHY QUARANTINE INSTEAD OF FILTERING READS. This is 0230's argument and it has
-- not changed: dozens of admin RPCs select from analytics_events, and teaching
-- each one a new predicate is a sprawling change with a chance to miss one in
-- every RPC — and any reader that forgets goes back to reporting robots as
-- demand. Diverting fixes every reader at once, including ones written later.
--
-- WHY EXTEND THE EXISTING TRIGGER. 0230 already put a BEFORE INSERT divert on
-- this table with a `reason` column sized for exactly this. A second trigger
-- would have to be name-ordered against the first and against
-- analytics_events_stamp_country; one function with two reasons has no ordering
-- question at all. `qa_harness` and `bot_ua` stay distinguishable in the
-- archive.
--
-- ⚠ THERE IS NO BACKFILL, AND THIS CREATES A STEP CHANGE.
-- The client stamps props.is_bot from the user-agent, and we deliberately never
-- store the raw user-agent (privacy — see the header of lib/device.js). So for
-- rows already in the table there is no signal left to identify a crawler by:
-- the classification that would have caught them is precisely the one that was
-- missing. Historical rows CANNOT be cleaned, and no heuristic here would be
-- honest.
--
-- The consequence is that session and event counts on the public/SEO pages will
-- DROP when this ships, and the drop is a correction, not a regression. Any
-- before/after comparison that straddles the deploy date is invalid. Treat the
-- deploy date the way `lp_view` starting 2026-07-22 is treated: as the start of
-- a new, trustworthy series. To reconstruct a consistent long series, UNION the
-- archive back in — the rows are copied whole, so it is lossless.
--
-- WATCH THE VOLUME AFTER DEPLOY. A user-agent regex can only be approximately
-- right, and a false positive silently removes a real person from the numbers.
-- If the diverted share looks implausible, widen or narrow BOT_RE in
-- boards/src/lib/device.js — do not paper over it here:
--
--   select date_trunc('day', archived_at)::date d, reason, count(*)
--     from public.analytics_events_synthetic
--    where reason = 'bot_ua' group by 1, 2 order by 1 desc;
--
--   -- diverted vs kept, same window
--   select (select count(*) from public.analytics_events_synthetic
--            where reason = 'bot_ua' and occurred_at > now() - interval '7 days') diverted,
--          (select count(*) from public.analytics_events
--            where occurred_at > now() - interval '7 days') kept;

-----------------------------------------------------------------------
-- The divert. Same function and trigger as 0230, now with two reasons.
--
-- Fail-open on the archive write, exactly as before: analytics ingestion is
-- fire-and-forget from the client and must never start erroring. If the archive
-- insert fails we still drop the row, because storing it is the thing we are
-- trying to stop.
-----------------------------------------------------------------------
create or replace function public._tg_divert_synthetic_events()
returns trigger
language plpgsql security definer
set search_path = public as $$
declare
  v_reason text;
begin
  if coalesce(new.props->>'synthetic', '') = 'true' then
    v_reason := 'qa_harness';
  elsif coalesce(new.props->>'is_bot', '') = 'true' then
    v_reason := 'bot_ua';
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
  return null;   -- skip the live insert
end $$;

-- The trigger itself is unchanged (0230 created it, name-ordered before
-- analytics_events_stamp_country); recreated here only so this migration is
-- self-sufficient if replayed against a database that somehow lacks it.
drop trigger if exists analytics_events_divert_synthetic on public.analytics_events;
create trigger analytics_events_divert_synthetic
  before insert on public.analytics_events
  for each row execute function public._tg_divert_synthetic_events();

comment on function public._tg_divert_synthetic_events() is
  'Diverts non-human analytics rows into analytics_events_synthetic instead of '
  'storing them: props.synthetic=true (QA harness, 0230) as reason=qa_harness, '
  'props.is_bot=true (crawler user-agent, 0294) as reason=bot_ua. Keeping them '
  'out of analytics_events fixes every reader at once.';

comment on table public.analytics_events_synthetic is
  'Quarantined non-human analytics rows. Written by the BEFORE INSERT divert '
  'trigger on analytics_events. reason=qa_harness (0230) or bot_ua (0294). '
  'Never read by product analytics; kept so the quarantine is reversible and so '
  'crawler behaviour can still be inspected on purpose.';
