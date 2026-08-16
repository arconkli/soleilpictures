-- Don't keep mailing addresses that bounce.
--
-- Found while pre-flighting the whats_new switch-on. Nothing in the lifecycle
-- eligibility layer looks at delivery history, so a dead address stays in every
-- audience forever. Six of the ~199 accounts eligible for whats_new have
-- already bounced, and the 30-day bounce rate is 2.29% — above the ~2% line
-- Gmail and Yahoo watch for bulk senders. Opening a 199-recipient campaign that
-- knowingly re-mails known-bad addresses is how a sending domain gets throttled,
-- and it would have been the first thing this edition did.
--
-- "Ever bounced" is the WRONG rule: of 30 addresses that have bounced, 3 later
-- delivered successfully. A full mailbox or a transient MX failure is not a dead
-- address, and permanently silencing those three would be a self-inflicted loss.
-- The rule that fits the data is "has bounced and has not delivered SINCE" — 27
-- addresses, each with a real failure and no evidence of recovery.
--
-- Scoped to whats_new deliberately. It is the only bulk sender (25/day against
-- roughly one/day for every other type), so it carries essentially all of the
-- reputation risk, and a narrow change needs no re-verification of six other
-- eligibility RPCs tonight. The same guard belongs on the rest — see the note at
-- the bottom.

-- ───────────────────────────────────────────────────────────────────────────
-- Deliverability, judged per ADDRESS rather than per user: email_sends is keyed
-- by recipient_email, and the same address can appear under more than one send
-- with different casing.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public._email_deliverable(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth as $$
  select not exists (
    select 1
    from (
      select max(es.bounced_at)   as last_bounce,
             max(es.delivered_at) as last_delivery
      from public.email_sends es
      join auth.users u on lower(u.email) = lower(es.recipient_email)
      where u.id = p_user_id
    ) s
    where s.last_bounce is not null
      and (s.last_delivery is null or s.last_delivery < s.last_bounce)
  );
$$;
revoke all on function public._email_deliverable(uuid) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- whats_new eligibility, unchanged except for the new predicate. Kept as a
-- verbatim copy of the 0211 body so a future diff shows exactly one added line.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_due_whats_new(
  p_dormant_days integer default 21,
  p_exclude_internal boolean default true,
  p_hour integer default null
)
returns table(user_id uuid, email text, display_name text, workspace_id uuid,
              board_id uuid, board_name text, thumb_key text,
              thumb_updated_at timestamp with time zone, unsub_token text,
              content_version text)
language sql stable security definer
set search_path to 'public'
as $function$
  with news as (
    select value->>'version' as version,
           coalesce((value->>'enabled')::boolean, false) as enabled,
           coalesce((value->>'daily_cap')::int, 25) as daily_cap
    from public.app_config where key = 'lifecycle_whats_new'
  ),
  budget as (
    select greatest(0, (select daily_cap from news)
                     - (select count(*)::int from public.lifecycle_email_log
                        where email_type = 'whats_new'
                          and sent_on = (now() at time zone 'utc')::date)) as slots
  )
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, bd.board_id, bd.board_name, bd.thumb_key,
         bd.thumb_updated_at, t.token, news.version
  from auth.users u
  cross join news
  cross join budget
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  left join lateral (
    select b.id as board_id, b.name as board_name, b.thumb_key, b.thumb_updated_at
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
    order by (b.thumb_key is not null and coalesce(b.card_count,0) > 0) desc,
             (b.parent_board_id is not null) desc, b.updated_at desc
    limit 1
  ) bd on true
  where news.enabled and news.version is not null and news.version <> ''
    and u.email_confirmed_at is not null and u.email is not null
    and p.tier in ('demo','paid')
    and coalesce(pr.last_seen_at, u.created_at) < now() - make_interval(days => p_dormant_days)
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    -- Consent says they are willing to hear from us; this says the mailbox is
    -- still there to hear it.
    and public._email_deliverable(u.id)
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'whats_new'
                      and l.content_version is not distinct from news.version)
    and not exists (select 1 from public.lifecycle_email_log l2
                    where l2.user_id = u.id
                      and l2.sent_at > now() - interval '4 days')
  order by coalesce(pr.last_seen_at, u.created_at) desc
  limit (select slots from budget);
$function$;

revoke all on function public.lifecycle_due_whats_new(integer, boolean, integer) from public, anon, authenticated;
grant execute on function public.lifecycle_due_whats_new(integer, boolean, integer) to service_role;

-- FOLLOW-UP: the other six lifecycle_due_* RPCs still lack this predicate. They
-- send roughly one a day between them, so the exposure is small, but the guard
-- belongs on all of them — one added line each, same shape as above.
