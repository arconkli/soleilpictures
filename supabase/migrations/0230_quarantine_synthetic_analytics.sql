-- 0230_quarantine_synthetic_analytics.sql — keep QA-harness traffic out of the
-- numbers.
--
-- The e2e suite drives the REAL app with the REAL analytics client. Its rows
-- were reaching production: playwright.config.js supplied fake Supabase
-- credentials only as a `process.env.X || fake` FALLBACK and set
-- reuseExistingServer on port 5173, so whenever a dev server was already up
-- (loading the real .env.local) the suite reused it and wrote its fixtures
-- straight into this table.
--
-- The damage was concentrated exactly where it hurts: roughly half of recent
-- upsell-funnel rows were a robot replaying `?local=1&tier=demo&cards=60`,
-- including checkout_success rows for a checkout nobody completed. Anyone
-- reading the pricing funnel was reading a test run.
--
-- WHY QUARANTINE INSTEAD OF FILTERING READS: 33 admin RPCs select from
-- analytics_events. Teaching every one of them a new predicate is a large,
-- sprawling change with 33 chances to miss one — and a reader that forgets the
-- filter goes back to reporting robots as demand. Keeping the rows out of the
-- table fixes every reader at once, including ones written later.
--
-- WHY MOVE INSTEAD OF DELETE: nothing here is worth analysing, but "we deleted
-- production analytics" should always be recoverable. The rows are copied whole
-- into analytics_events_synthetic first, so the operation is reversible with an
-- INSERT ... SELECT back.

-----------------------------------------------------------------------
-- 1. The archive. Same shape as the live table, plus when it was diverted.
-----------------------------------------------------------------------
create table if not exists public.analytics_events_synthetic (
  id          uuid,
  session_id  uuid,
  user_id     uuid,
  event       text,
  props       jsonb,
  path        text,
  occurred_at timestamptz,
  country     text,
  archived_at timestamptz not null default now(),
  reason      text
);

create index if not exists analytics_events_synthetic_occurred_idx
  on public.analytics_events_synthetic (occurred_at desc);

-- Not a public surface. PostgREST exposes every table in `public`, so this is
-- locked to the service role explicitly: RLS on with NO policies denies all
-- ordinary access even if a grant is added later by mistake.
alter table public.analytics_events_synthetic enable row level security;
revoke all on public.analytics_events_synthetic from anon, authenticated;

comment on table public.analytics_events_synthetic is
  'Quarantined QA-harness analytics rows (migration 0230). Written by the '
  'BEFORE INSERT divert trigger on analytics_events. Never read by product '
  'analytics; kept only so the quarantine is reversible.';

-----------------------------------------------------------------------
-- 2. Backfill the rows that already got in.
--
-- The signature is ROW-LOCAL and impossible for a real user: an event whose
-- props carry a signed-in tier (demo/paid/admin) while user_id is NULL, or an
-- anonymous checkout success. Only the DEV-guarded qaTierOverride seam can
-- produce a resolved tier with no session behind it.
--
-- Session-level matching was considered and REJECTED: session ids live in
-- localStorage and survive sign-in, so the suspect sessions also contain 911
-- rows belonging to genuine signed-in users. Tagging by session would have
-- thrown those away.
--
-- Verified before running: 0 rows where a signed-in user has a 'paid' tier
-- pricing_view, so the predicate cannot be catching real paid activity.
-----------------------------------------------------------------------
with syn as (
  select * from public.analytics_events
   where user_id is null
     and ( props->>'tier' in ('demo','paid','admin')
        or event in ('checkout_success','checkout_activated_seen') )
), moved as (
  insert into public.analytics_events_synthetic
    (id, session_id, user_id, event, props, path, occurred_at, country, reason)
  select id, session_id, user_id, event, props, path, occurred_at, country,
         'backfill_0230_anon_with_resolved_tier'
    from syn
  returning id
)
delete from public.analytics_events a
 using moved m
 where a.id = m.id;

-----------------------------------------------------------------------
-- 3. Keep them out from now on.
--
-- The client stamps props.synthetic = true whenever a dev-only QA harness is
-- driving the page (lib/localMode.js isAnyQaMode — every predicate behind it is
-- import.meta.env.DEV-guarded, so a production build can never set it). This
-- trigger diverts those rows instead of storing them.
--
-- Named ..._divert_synthetic so it sorts BEFORE analytics_events_stamp_country:
-- triggers fire in name order, and a diverted row has no need of a country.
--
-- Fail-open on the archive write. Analytics ingestion is fire-and-forget from
-- the client and must never start erroring; if the archive insert fails we
-- still drop the row, because storing it is the thing we are trying to stop.
-----------------------------------------------------------------------
create or replace function public._tg_divert_synthetic_events()
returns trigger
language plpgsql security definer
set search_path = public as $$
begin
  if coalesce(new.props->>'synthetic', '') <> 'true' then
    return new;
  end if;
  begin
    insert into public.analytics_events_synthetic
      (id, session_id, user_id, event, props, path, occurred_at, country, reason)
    values
      (new.id, new.session_id, new.user_id, new.event, new.props, new.path,
       new.occurred_at, new.country, 'qa_harness');
  exception when others then
    null;
  end;
  return null;   -- skip the live insert
end $$;

drop trigger if exists analytics_events_divert_synthetic on public.analytics_events;
create trigger analytics_events_divert_synthetic
  before insert on public.analytics_events
  for each row execute function public._tg_divert_synthetic_events();
