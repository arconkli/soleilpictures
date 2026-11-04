-- 0859 — The daily instrumentation check watches the drafts once they open.
--
-- A draft (0705) is what ChatGPT or Claude makes through /mcp for someone
-- without an account, and its keep page (/keep/<token>) is where they keep it.
-- Drafts switch on in production in the same release as this, and their two
-- client events are the ones nothing else would notice going quiet:
--
--   keep_view  truth: drafts whose keep page a browser opened while live
--              (mcp_drafts.first_viewed_at, stamped by mcp_draft_keep_view,
--              0708); record: keep_page_view events with state live. Every
--              draft session that reaches its link sends one, once per page
--              load, so it is the one every draft has.
--   keep_kept  truth: drafts kept (mcp_drafts.claimed_at, by keep_mcp_draft);
--              record: keep_kept, the keep page's own event after the keep.
--
-- Left out on purpose: keep_code_sent and keep_failed (not every session sends
-- one, and a failure has no row to set it against), mcp_draft_kept (written by
-- keep_mcp_draft in the same transaction as claimed_at, so it cannot go quiet
-- on its own), and make_kept (the /make link, not a draft: it has been open
-- since before this, and its board is an ordinary API board with no row that
-- says /make made it).
--
-- WHEN THEY START. 0472's rules already wait for history before paging: a pair
-- pages only when its events arrived in the fortnight before (base_ev_n > 0),
-- and thinning needs 20 rows of base. But "never measured" (an alert, not
-- paged) fires on rows with no events at all, and drafts already have rows
-- without production events: the preview Worker opens drafts against this
-- database (lib/mcpDrafts.js draftsOpen), and its events divert to
-- analytics_events_synthetic. So the drafts' pairs count nothing, truth or
-- events, until production's keep pages are arriving: from dr_start, the
-- first live keep_page_view of the third browser session to send one (the
-- live table, so diverted rows never start it), or 16 days back, whichever is
-- later. Until then both pairs read 0 and cannot alarm; from then the paging
-- rule still needs a baseline, so nothing pages before the release has been
-- live for 48 hours with keep pages opening. What remains after release: a
-- preview draft opened then still counts as truth with no event, so three of
-- them in 48 hours with no production keep page at all would page; at that
-- point production's keep pages have stopped anyway.
--
-- The team is left out where it can be: a draft the team kept, and the team's
-- signed-in events. A keep page's visitor has no account, so its events carry
-- no user and are not required to.
--
-- _instrumentation_pairs is 0497's live body (md5-checked against pg_proc
-- before writing) with only the drafts' lines added; check_instrumentation is
-- unchanged, and its generic words fit both pairs. create or replace keeps the
-- ACL, which the proof checks.

begin;

set local lock_timeout = '3s';

create or replace function public._instrumentation_pairs(p_at timestamptz default now())
returns table (
  pair         text,
  per_person   boolean,
  truth_label  text,
  event_label  text,
  since        timestamptz,
  truth_n      integer,
  truth_users  integer,
  ev_n         integer,
  base_truth_n integer,
  base_ev_n    integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with win as (
    select p_at - interval '48 hours' as since,
           p_at - interval '16 days'  as base_since,
           p_at - interval '108 hours' as wl_since,
           p_at - interval '36 hours'  as wl_until,
           p_at - interval '108 hours' - interval '14 days' as wl_base,
           -- 0859: the drafts' pairs count from production's third keep page.
           case when dr.dr_start is not null
                then greatest(p_at - interval '16 days', dr.dr_start) end as dr_base,
           d.d_since, d.d_base, d.d_until,
           d.d_since::timestamp at time zone 'UTC' as t_since,
           d.d_base::timestamp  at time zone 'UTC' as t_base
      from (select ((p_at - interval '48 hours') at time zone 'UTC')::date as d_since,
                   ((p_at - interval '16 days')  at time zone 'UTC')::date as d_base,
                   (p_at at time zone 'UTC')::date                         as d_until) d
      -- 0859: the first time a third browser session opened a live draft's keep
      -- page. Drafts are held in production until their release, but the
      -- preview Worker opens them against this database, and its events
      -- divert: before production's own keep pages arrive, a draft's rows are
      -- not production's, and nothing about them is counted.
      cross join (select (select s.first_at
                            from (select coalesce(e.session_id, e.id) as sid, min(e.occurred_at) as first_at
                                    from public.analytics_events e
                                   where e.event = 'keep_page_view' and e.props->>'state' = 'live'
                                     and e.occurred_at < p_at
                                   group by 1) s
                           order by s.first_at
                          offset 2 limit 1) as dr_start) dr
  ),
  internal as (select i.user_id from public._internal_user_ids() i),
  labels (pair, per_person, truth_label, event_label, ord) as (values
    ('active',          true,  'People active in the app (the heartbeat)',               'with any event',                                         1),
    ('session_context', true,  'People active in the app (the heartbeat)',               'with a session_context row',                             2),
    ('first_card',      true,  'People whose first card landed (profiles.first_card_at)', 'with onboarding_first_card within a day of it',         3),
    ('cluster_create',  false, 'Clusters made by hand (boards with a parent, none from an import)', 'cluster_create events',                    4),
    ('msg_send',        false, 'Messages sent (messages, kind user)',                    'msg_send events with ok',                                5),
    ('import_job',      false, 'Imports started (import_jobs)',                          'import_job events with phase start',                     6),
    ('link_claim',      false, 'Workspace joins through an invite link',                 'workspace_link_claim_result events with status joined', 7),
    ('welcome',         true,  'Accounts due the welcome email, signed up 36 to 108 hours before', 'sent it (lifecycle_email_log)',           8),
    ('keep_view',       false, 'Drafts whose keep page opened (mcp_drafts.first_viewed_at)', 'keep_page_view events with state live',           9),
    ('keep_kept',       false, 'Drafts kept (mcp_drafts.claimed_at)',                    'keep_kept events',                                       10)
  ),

  -- People. The heartbeat writes user_active_day for auth.uid() only (0470),
  -- by day, so these windows run from midnight UTC.
  act as (
    select d.user_id,
           bool_or(d.day >= w.d_since) as recent,
           bool_or(d.day <  w.d_since) as base
      from public.user_active_day d cross join win w
     where d.day between w.d_base and w.d_until
       and not exists (select 1 from internal i where i.user_id = d.user_id)
     group by d.user_id
  ),
  people as (
    select 'active'::text as pair, a.recent, a.base,
           a.recent and exists (select 1 from public.analytics_events e
                                 where e.user_id = a.user_id
                                   and e.occurred_at >= w.t_since and e.occurred_at < p_at) as ev_recent,
           a.base and exists (select 1 from public.analytics_events e
                               where e.user_id = a.user_id
                                 and e.occurred_at >= w.t_base and e.occurred_at < w.t_since) as ev_base
      from act a cross join win w
    union all
    select 'session_context', a.recent, a.base,
           a.recent and exists (select 1 from public.analytics_events e
                                 where e.user_id = a.user_id and e.event = 'session_context'
                                   and e.occurred_at >= w.t_since and e.occurred_at < p_at),
           a.base and exists (select 1 from public.analytics_events e
                               where e.user_id = a.user_id and e.event = 'session_context'
                                 and e.occurred_at >= w.t_base and e.occurred_at < w.t_since)
      from act a cross join win w
    union all
    -- The server's stamp against the client's event, within a day of it
    -- either way, since occurred_at is the device's clock.
    select 'first_card', f.recent, not f.recent, f.recent and f.has_ev, (not f.recent) and f.has_ev
      from (select p.first_card_at >= w.since as recent,
                   exists (select 1 from public.analytics_events e
                            where e.user_id = p.user_id and e.event = 'onboarding_first_card'
                              and e.occurred_at between p.first_card_at - interval '1 day'
                                                    and p.first_card_at + interval '1 day') as has_ev
              from public.profiles p cross join win w
             where p.first_card_at >= w.base_since and p.first_card_at < p_at
               and not exists (select 1 from internal i where i.user_id = p.user_id)) f
    union all
    -- The welcome (0497): who lifecycle_due_welcome_board would have found,
    -- against the log's sent rows. Due 12 to 72 hours after signing up, then
    -- up to a day for the send hour, so the cohort ends 36 hours back.
    select 'welcome', wl.recent, not wl.recent, wl.recent and wl.sent, (not wl.recent) and wl.sent
      from (select u.created_at >= w.wl_since as recent,
                   exists (select 1 from public.lifecycle_email_log l
                            where l.user_id = u.id and l.email_type = 'welcome_board'
                              and l.status = 'sent' and l.sent_at < p_at) as sent
              from auth.users u
              join public.profiles p on p.user_id = u.id
              cross join win w
             where u.created_at >= w.wl_base and u.created_at < w.wl_until
               and u.email_confirmed_at is not null and u.email is not null
               and p.banned_at is null
               and exists (select 1 from public.email_unsub_tokens t where t.user_id = u.id)
               and public._email_pref_enabled(u.id, 'email_lifecycle')
               and exists (select 1 from public.boards b
                            where b.created_by = u.id and b.deleted_at is null
                              and b.thumb_key is not null and coalesce(b.card_count, 0) > 0)
               and not exists (select 1 from internal i where i.user_id = u.id)) wl
  ),
  people_counts as (
    select x.pair,
           count(*) filter (where x.recent)::int    as truth_n,
           count(*) filter (where x.ev_recent)::int as ev_n,
           count(*) filter (where x.base)::int      as base_truth_n,
           count(*) filter (where x.ev_base)::int   as base_ev_n
      from people x
     group by x.pair
  ),

  -- Rows: what the activity left behind, against the events that say it happened.
  rows_truth as (
    select 'cluster_create'::text as pair, b.created_by as uid, b.created_at >= w.since as recent
      from public.boards b cross join win w
     where b.parent_board_id is not null and b.created_by is not null
       and b.created_at >= w.base_since and b.created_at < p_at
       and not exists (select 1 from internal i where i.user_id = b.created_by)
       -- An import makes its own clusters and logs import_job for them (0475).
       and not exists (select 1 from public.import_folders f where f.board_id = b.id)
    union all
    select 'msg_send', m.sender_id, m.created_at >= w.since
      from public.messages m cross join win w
     where m.kind = 'user' and m.sender_id is not null
       and m.created_at >= w.base_since and m.created_at < p_at
       and not exists (select 1 from internal i where i.user_id = m.sender_id)
    union all
    select 'import_job', j.owner_id, j.created_at >= w.since
      from public.import_jobs j cross join win w
     where j.owner_id is not null
       and j.created_at >= w.base_since and j.created_at < p_at
       and not exists (select 1 from internal i where i.user_id = j.owner_id)
    union all
    select 'link_claim', l.user_id, l.joined_at >= w.since
      from public.workspace_invite_link_joins l cross join win w
     where l.user_id is not null
       and l.joined_at >= w.base_since and l.joined_at < p_at
       and not exists (select 1 from internal i where i.user_id = l.user_id)
    union all
    -- The drafts (0859), from dr_base only. A draft is its own user until it is
    -- kept, so each opened draft counts once; one the team kept is the team's.
    select 'keep_view', coalesce(d.user_id, d.id), d.first_viewed_at >= w.since
      from public.mcp_drafts d cross join win w
     where d.first_viewed_at >= w.dr_base and d.first_viewed_at < p_at
       and not exists (select 1 from internal i where i.user_id = d.claimed_by)
    union all
    select 'keep_kept', d.claimed_by, d.claimed_at >= w.since
      from public.mcp_drafts d cross join win w
     where d.claimed_by is not null
       and d.claimed_at >= w.dr_base and d.claimed_at < p_at
       and not exists (select 1 from internal i where i.user_id = d.claimed_by)
  ),
  truth_counts as (
    select t.pair,
           count(*) filter (where t.recent)::int              as truth_n,
           count(distinct t.uid) filter (where t.recent)::int as truth_users,
           count(*) filter (where not t.recent)::int          as base_truth_n
      from rows_truth t
     group by t.pair
  ),
  event_counts as (
    select k.pair,
           count(*) filter (where k.recent)::int     as ev_n,
           count(*) filter (where not k.recent)::int as base_ev_n
      from (select case
                     when e.event = 'cluster_create' then 'cluster_create'
                     when e.event = 'msg_send' and e.props->>'ok' = 'true' then 'msg_send'
                     when e.event = 'import_job' and e.props->>'phase' = 'start' then 'import_job'
                     when e.event = 'workspace_link_claim_result' and e.props->>'status' = 'joined' then 'link_claim'
                   end as pair,
                   e.occurred_at >= w.since as recent
              from public.analytics_events e cross join win w
             where e.event in ('cluster_create', 'msg_send', 'import_job', 'workspace_link_claim_result')
               and e.occurred_at >= w.base_since and e.occurred_at < p_at
               and e.user_id is not null
               and not exists (select 1 from internal i where i.user_id = e.user_id)) k
     where k.pair is not null
     group by k.pair
  ),
  -- The drafts' events (0859), from dr_base too. A keep page's visitor has no
  -- account yet, so its events carry no user: these are not required to.
  draft_event_counts as (
    select k.pair,
           count(*) filter (where k.recent)::int     as ev_n,
           count(*) filter (where not k.recent)::int as base_ev_n
      from (select case
                     when e.event = 'keep_page_view' and e.props->>'state' = 'live' then 'keep_view'
                     when e.event = 'keep_kept' then 'keep_kept'
                   end as pair,
                   e.occurred_at >= w.since as recent
              from public.analytics_events e cross join win w
             where e.event in ('keep_page_view', 'keep_kept')
               and e.occurred_at >= w.dr_base and e.occurred_at < p_at
               and not exists (select 1 from internal i where i.user_id = e.user_id)) k
     where k.pair is not null
     group by k.pair
  )
  select l.pair, l.per_person, l.truth_label, l.event_label,
         case when l.pair in ('active', 'session_context') then w.t_since
              when l.pair = 'welcome' then w.wl_since
              else w.since end,
         coalesce(pc.truth_n, tc.truth_n, 0),
         coalesce(pc.truth_n, tc.truth_users, 0),
         coalesce(pc.ev_n, ec.ev_n, dc.ev_n, 0),
         coalesce(pc.base_truth_n, tc.base_truth_n, 0),
         coalesce(pc.base_ev_n, ec.base_ev_n, dc.base_ev_n, 0)
    from labels l
    cross join win w
    left join people_counts pc on pc.pair = l.pair
    left join truth_counts  tc on tc.pair = l.pair
    left join event_counts  ec on ec.pair = l.pair
    left join draft_event_counts dc on dc.pair = l.pair
   order by l.ord;
$$;

-- ── Proof ───────────────────────────────────────────────────────────────────
do $proof$
declare
  v_fn       text;
  v_n        integer;
  v_sessions integer;
  v_kv       record;
  v_kk       record;
begin
  -- The 0311 habit: create or replace kept each ACL; prove it, don't trust it.
  foreach v_fn in array array['public._instrumentation_pairs(timestamptz)', 'public.check_instrumentation()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0859: % is not service_role''s alone', v_fn;
    end if;
  end loop;

  -- It took: ten pairs, the drafts' two last, counted by rows.
  select count(*)::int into v_n from public._instrumentation_pairs(now());
  select * into v_kv from public._instrumentation_pairs(now()) where pair = 'keep_view';
  select * into v_kk from public._instrumentation_pairs(now()) where pair = 'keep_kept';
  if v_n <> 10 or v_kv.pair is null or v_kk.pair is null
     or v_kv.per_person or v_kk.per_person then
    raise exception '0859: _instrumentation_pairs did not take (% pairs)', v_n;
  end if;

  -- Before production's keep pages arrive, neither pair counts anything, so
  -- neither can alarm.
  select count(distinct coalesce(e.session_id, e.id))::int into v_sessions
    from public.analytics_events e
   where e.event = 'keep_page_view' and e.props->>'state' = 'live';
  if v_sessions < 3 and (v_kv.truth_n, v_kv.ev_n, v_kv.base_truth_n, v_kv.base_ev_n,
                         v_kk.truth_n, v_kk.ev_n, v_kk.base_truth_n, v_kk.base_ev_n)
                        is distinct from (0, 0, 0, 0, 0, 0, 0, 0) then
    raise exception '0859: the drafts'' pairs count before their start (% sessions so far)', v_sessions;
  end if;

  if (select p.prosrc from pg_proc p where p.oid = 'public.check_instrumentation()'::regprocedure)
       not like '%if r.truth_users >= 3 and r.ev_n = 0 and r.base_ev_n > 0 then%' then
    raise exception '0859: check_instrumentation''s paging rule moved';
  end if;
  if not exists (select 1 from cron.job where jobname = 'instrumentation-daily'
                    and command like '%public.check_instrumentation()%') then
    raise exception '0859: instrumentation-daily is not scheduled';
  end if;
end $proof$;

commit;
