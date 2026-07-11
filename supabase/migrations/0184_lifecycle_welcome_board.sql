-- 0184: welcome_board — Day-1 lifecycle email showing the user their OWN board.
--
-- Return is downstream of activation (47% of populated users return vs 5% of
-- everyone else), and a picture of the thing THEY made is a stronger pull than
-- any copy. This adds a fourth lifecycle email type: ~24h after signup, users
-- whose board has real content (thumb_key + card_count > 0) get a founder note
-- embedding that board's thumbnail with a deep link back into it.
--
-- Complements the activation nudges rather than replacing them: the nudges
-- target first_populated_board_at IS NULL; welcome_board targets anyone with
-- visible content, activated or not. No tier gate (a day-1 paid signup gets
-- the same welcome) and no quiet-hours gate (it's a welcome, not a re-pull) —
-- the (user_id, sent_on) one-per-day unique index from 0173 still guarantees
-- a user never gets two lifecycle emails on the same UTC day, and the cron
-- runs welcome_board first so it wins that slot.

-- 1. Admit the new type. The CHECK was created inline in 0173, so it carries
--    the default constraint name.
alter table public.lifecycle_email_log
  drop constraint if exists lifecycle_email_log_email_type_check;
alter table public.lifecycle_email_log
  add constraint lifecycle_email_log_email_type_check
  check (email_type in ('activate_nudge_1','activate_nudge_2','reengage_1','welcome_board'));

-- 2. Once ever, like the activation nudges (0173's partial unique index).
create unique index if not exists lifecycle_email_log_welcome_once_idx
  on public.lifecycle_email_log (user_id, email_type)
  where email_type = 'welcome_board';

-- 3. Eligibility. Same skeleton as the nudge RPCs (0183); the deltas:
--    window on u.created_at (signup, 12–72h) so with the hour gate's
--    signup-hour fallback the email lands almost exactly one day after
--    signup; the board lateral requires a stored thumbnail AND content
--    (card_count > 0 — a blank-canvas screenshot is an anti-pull, so users
--    without a qualifying board simply never get this email); it prefers a
--    non-root cluster but accepts a populated root ("Studio" reads fine
--    under welcome copy, unlike the nudges' "you made 'Studio'").
create or replace function public.lifecycle_due_welcome_board(
  p_min_hours int default 12, p_max_hours int default 72,
  p_exclude_internal boolean default true, p_hour int default null)
returns table(user_id uuid, email text, display_name text, workspace_id uuid,
              board_id uuid, board_name text, thumb_key text,
              thumb_updated_at timestamptz, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, bd.board_id, bd.board_name, bd.thumb_key,
         bd.thumb_updated_at, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  left join lateral (
    select b.id as board_id, b.name as board_name, b.thumb_key, b.thumb_updated_at
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
      and b.thumb_key is not null and coalesce(b.card_count, 0) > 0
    order by (b.parent_board_id is not null) desc, b.updated_at desc
    limit 1
  ) bd on true
  where u.email_confirmed_at is not null and u.email is not null
    and bd.board_id is not null
    and u.created_at <= now() - make_interval(hours => p_min_hours)
    and u.created_at >  now() - make_interval(hours => p_max_hours)
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from u.created_at)::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'welcome_board');
$$;
revoke all on function public.lifecycle_due_welcome_board(int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_welcome_board(int,int,boolean,int) to service_role;

-- 4. Spacing guard: a user with 1–2 cards gets welcome_board on day 1 and is
--    STILL nudge-eligible from hour 24 — without this, that's two emails on
--    consecutive days. Re-create both nudge RPCs (bodies verbatim from 0183)
--    with one added clause: skip anyone welcomed in the last 48 hours.
create or replace function public.lifecycle_due_activate_nudge_1(
  p_min_hours int default 24, p_max_hours int default 120,
  p_quiet_hours int default 24, p_exclude_internal boolean default true,
  p_hour int default null)
returns table(user_id uuid, email text, display_name text, workspace_id uuid,
              board_id uuid, board_name text, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, bd.board_id, bd.board_name, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  left join lateral (
    select b.id as board_id, b.name as board_name
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
      and b.parent_board_id is not null
    order by b.updated_at desc limit 1
  ) bd on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier = 'demo'
    and coalesce(p.activated_access_at, u.created_at) <= now() - make_interval(hours => p_min_hours)
    and coalesce(p.activated_access_at, u.created_at) >  now() - make_interval(hours => p_max_hours)
    and p.first_populated_board_at is null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(hours => p_quiet_hours))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'activate_nudge_1')
    and not exists (select 1 from public.lifecycle_email_log l2
                    where l2.user_id = u.id and l2.email_type = 'welcome_board'
                      and l2.sent_at > now() - interval '48 hours');
$$;
revoke all on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean,int) to service_role;

create or replace function public.lifecycle_due_activate_nudge_2(
  p_min_hours int default 120, p_max_hours int default 336,
  p_quiet_hours int default 24, p_exclude_internal boolean default true,
  p_hour int default null)
returns table(user_id uuid, email text, display_name text, workspace_id uuid,
              board_id uuid, board_name text, unsub_token text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email::text,
         coalesce(nullif(p.display_name,''), initcap(split_part(u.email,'@',1))),
         ws.workspace_id, bd.board_id, bd.board_name, t.token
  from auth.users u
  join public.profiles p on p.user_id = u.id
  join public.email_unsub_tokens t on t.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join lateral (
    select w.id as workspace_id from public.workspaces w
    where w.created_by = u.id order by w.created_at limit 1
  ) ws on true
  left join lateral (
    select b.id as board_id, b.name as board_name
    from public.boards b
    where b.created_by = u.id and b.deleted_at is null
      and b.parent_board_id is not null
    order by b.updated_at desc limit 1
  ) bd on true
  where u.email_confirmed_at is not null and u.email is not null
    and p.tier = 'demo'
    and coalesce(p.activated_access_at, u.created_at) <= now() - make_interval(hours => p_min_hours)
    and coalesce(p.activated_access_at, u.created_at) >  now() - make_interval(hours => p_max_hours)
    and p.first_populated_board_at is null
    and (pr.last_seen_at is null or pr.last_seen_at < now() - make_interval(hours => p_quiet_hours))
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'activate_nudge_2')
    and not exists (select 1 from public.lifecycle_email_log l2
                    where l2.user_id = u.id and l2.email_type = 'welcome_board'
                      and l2.sent_at > now() - interval '48 hours');
$$;
revoke all on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean,int) to service_role;

-- 5. A/B copy bandit entry (0174 shape). The nightly optimizer scores
--    non-activate types by return-visit within the window — the right
--    success metric for a welcome note.
update public.app_config
   set value = value || jsonb_build_object(
     'welcome_board', jsonb_build_object(
       'enabled', true, 'arms', jsonb_build_array('A','B'),
       'weights', jsonb_build_object('A',50,'B',50),
       'reward_window_days', 7, 'min_trials_per_arm', 30, 'floor', 5,
       'phase', 'warmup', 'stats', '{}'::jsonb))
 where key = 'lifecycle_email_experiments'
   and not (value ? 'welcome_board');
