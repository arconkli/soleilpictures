-- 0249_synthetic_app_session.sql — carry app_session_id into the QA quarantine.
--
-- 0248 added analytics_events.app_session_id. 0230 diverts any row labelled
-- props.synthetic='true' (the dev-only QA harnesses driving the real app) into
-- analytics_events_synthetic via a BEFORE INSERT trigger that enumerates its
-- columns explicitly — and that list predates the new one.
--
-- Nothing breaks loudly, which is the problem: the trigger wraps its insert in
-- `exception when others then null`, so the archived row simply arrives without
-- a session id and no one is told. The quarantine exists so QA traffic stays
-- debuggable without being mistaken for demand, and a debuggable row is one you
-- can still join to the session that produced it.

alter table public.analytics_events_synthetic
  add column if not exists app_session_id uuid;

comment on column public.analytics_events_synthetic.app_session_id is
  'Mirrors analytics_events.app_session_id (0248) so quarantined QA rows keep
   the session join. Null for rows archived before 0249.';

create or replace function public._tg_divert_synthetic_events()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.props->>'synthetic', '') <> 'true' then
    return new;
  end if;
  begin
    insert into public.analytics_events_synthetic
      (id, session_id, app_session_id, user_id, event, props, path, occurred_at, country, reason)
    values
      (new.id, new.session_id, new.app_session_id, new.user_id, new.event, new.props, new.path,
       new.occurred_at, new.country, 'qa_harness');
  exception when others then
    -- Unchanged from 0230: quarantining is best-effort. Losing a synthetic row
    -- must never fail the caller's insert, because the caller is the app.
    null;
  end;
  return null;
end $$;
