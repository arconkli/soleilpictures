-- 0259_share_activity_notifications.sql — tell an owner their work is being looked at.
--
-- 0242 built a notification that survives the tab being closed, and 0243/0247
-- gave it exactly one producer: the schedule RPCs. The calendar UI that calls
-- those has not been promoted to production, so in production the table has
-- never held a row and the bell can never show anything.
--
-- Meanwhile the app has been logging a real signal and throwing it away. Shared
-- clusters get outside traffic every week, and the owner is told nothing about
-- it — including the owners who go quiet while people are still opening their
-- work. That is a reason to come back that fires on its own and has simply
-- never been delivered.
--
-- This reads that traffic out of analytics_events and hands it to the fanout
-- 0242 already provides. No new table, no new delivery surface, no client work
-- beyond styling a kind the panel already renders generically.
--
-- FOUR THINGS HERE ARE DELIBERATE.
--
--   1. VIEWERS ARE NEVER IDENTIFIED. A share link is public; the people who
--      open it did not sign in and did not agree to be named. The notification
--      carries a count and nothing else. Do not "improve" this later without
--      deciding, explicitly, that it is a different product.
--
--   2. FIRST-TIME DEVICES ONLY. Counting every view would let one device that
--      revisits a link daily — a person with a bookmark, a crawler, a corporate
--      link scanner — ping the owner every day forever. Counting only devices
--      that had not opened this cluster before the window removes that failure
--      mode, and the message it produces ("someone new looked") is the more
--      interesting one anyway. In practice almost every viewer is a first-time
--      viewer, so this costs very little reach.
--
--   3. THE OWNER'S OWN VIEWS DO NOT COUNT. _notify_users already refuses to
--      self-notify via p_actor_id, but the actor here is an anonymous viewer,
--      so the exclusion has to happen in the scan instead.
--
--   4. UNTRUSTED TEXT IS NEVER CAST TO uuid. props->>'board_id' is written by
--      the client. Casting it and filtering it in the same WHERE is not safe —
--      Postgres does not promise to evaluate the regex before the cast, so a
--      single malformed row could abort the whole run. Joining on b.id::text
--      compares in the other direction and cannot raise.

-- ── The scan ─────────────────────────────────────────────────────────────────
-- One notification per cluster per window, addressed to the workspace owner.
-- Returns the number of notifications created, so the cron log says something.
create or replace function public.notify_share_activity(p_hours integer default 24)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := now() - make_interval(hours => greatest(coalesce(p_hours, 24), 1));
  v_made  integer := 0;
  v_sent  integer;
  v_name  text;
  r       record;
begin
  for r in
    with raw as (
      -- Join on text, never cast the client-supplied value. Board must still
      -- exist; a deleted cluster is not news.
      select b.id as board_id, b.workspace_id, b.name as board_name,
             w.created_by as owner_id, e.session_id, e.user_id
      from public.analytics_events e
      join public.boards b     on b.id::text = e.props->>'board_id'
      join public.workspaces w on w.id = b.workspace_id
      where e.event = 'share_view'
        and e.occurred_at >= v_since
        and coalesce(e.props->>'valid', 'true') <> 'false'
        and e.session_id is not null
        and b.deleted_at is null
        and w.created_by is not null
    ),
    fresh as (
      select distinct raw.board_id, raw.workspace_id, raw.board_name,
             raw.owner_id, raw.session_id
      from raw
      where raw.user_id is distinct from raw.owner_id       -- see (3)
        and not exists (                                     -- see (2)
          select 1
          from public.analytics_events p
          where p.event = 'share_view'
            and p.occurred_at < v_since
            and p.session_id = raw.session_id
            and p.props->>'board_id' = raw.board_id::text
        )
    )
    select f.board_id, f.workspace_id, f.owner_id,
           nullif(btrim(coalesce(f.board_name, '')), '') as board_name,
           count(*)::int as viewers
    from fresh f
    group by 1, 2, 3, 4
    -- Already told them about this cluster inside the window. Uses
    -- notifications_board_kind_idx, which 0242 added for exactly this lookup.
    having not exists (
      select 1 from public.notifications n
      where n.board_id = f.board_id
        and n.kind = 'share.viewed'
        and n.created_at >= v_since
    )
  loop
    -- People name clusters things like "muchas muchas MUCHAS imagenes asi bien
    -- super wao...". This title becomes an email subject line, so cut it to
    -- something a subject line can hold, and rtrim before the ellipsis or the
    -- cut lands mid-word with a dangling space in front of the closing quote.
    v_name := case
      when r.board_name is null then null
      when length(r.board_name) > 60 then rtrim(left(r.board_name, 60)) || '…'
      else r.board_name
    end;

    -- The interface word is "cluster", not "board" — this string is read by a
    -- person, in the bell and in mail.
    v_sent := public._notify_users(
      array[r.owner_id],
      'share.viewed',
      r.board_id,
      null,
      r.workspace_id,
      null,
      case
        when r.viewers = 1 and v_name is not null
          then 'Someone opened "' || v_name || '"'
        when r.viewers = 1
          then 'Someone opened one of your clusters'
        when v_name is not null
          then r.viewers || ' people opened "' || v_name || '"'
        else r.viewers || ' people opened one of your clusters'
      end,
      'Through your share link. Viewers are not identified.',
      jsonb_build_object('viewers', r.viewers, 'window_hours', p_hours, 'first_time', true)
    );
    v_made := v_made + coalesce(v_sent, 0);
  end loop;

  return v_made;
end $$;

revoke all on function public.notify_share_activity(integer) from public, anon, authenticated;
grant execute on function public.notify_share_activity(integer) to service_role;

comment on function public.notify_share_activity(integer) is
  'Turns share-link traffic into one notifications row per cluster per window, addressed to the workspace owner. Counts first-time viewing devices only, never the owner''s own views, and never identifies a viewer.';

-- ── The schedule ─────────────────────────────────────────────────────────────
-- Once a day, not per view: this is a digest, and an owner who is being read by
-- several people should hear about it once. Mid-morning US eastern, off the
-- crowded 03:xx maintenance hour and off the hourly lifecycle tick.
--
-- ARMED, THEN IMMEDIATELY PARKED (`cron.alter_job(active := false)`), and it
-- must stay parked until the WORKER ships to production.
--
-- The unsubscribe key is checked in two places: email_unsubscribe() in the
-- database, widened by 0260, and UNSUB_KEYS in boards/src/worker.js, which
-- rides the SPA. Pushing main deploys a PREVIEW, so production's worker still
-- rejects `email_share_activity` and answers the link in the email with
-- "That unsubscribe link is not one we recognise." Verified by curl against
-- the live domain, not assumed.
--
-- Mail with a dead opt-out is not a cosmetic problem, so the producer stays off
-- rather than the feature going out half-wired. RE-ARM AFTER THE PROMOTE:
--   select cron.alter_job((select jobid from cron.job
--                           where jobname='share-activity-daily'), active := true);
-- and re-check the curl first.
select cron.schedule(
  'share-activity-daily',
  '20 13 * * *',
  $cron$ select public.notify_share_activity(24); $cron$
);
