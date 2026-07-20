-- 0194_lifecycle_return_engine.sql — broaden the win-back into a laddered
-- dormancy sequence.
--
-- Two new lifecycle reasons, both on the existing 0173/0174 spine (claim-first
-- (user_id, sent_on) cap, per-user preferred_send_hour, A/B bandit, consent /
-- one-click unsub). Neither adds a once-ever index — both re-fire on a cooldown
-- like reengage_1, and the global one-per-day unique index still guarantees a
-- user never gets two lifecycle emails on the same UTC day.
--
--   • board_waiting        — the picture-powered win-back. An ACTIVATED user
--       (populated board with a stored thumbnail) who went quiet ~14d. Reuses
--       welcome_board's own-thumbnail pull, framed "it's still here". Runs above
--       reengage_1 in the cron priority; reengage_1 stays the text fallback for
--       dormant users whose board has no stored thumbnail.
--   • nudge_dormant_early  — the gap-filler. Internal analysis showed the win-
--       back (reengage_1) gates on first_populated_board_at, and the activation
--       nudges stop at day 14 (336h) — so a NEVER-activated user who falls quiet
--       after that window gets no further outreach ever. This catches exactly
--       that cohort: not activated, quiet >=7d, account 14-90d old. Gentle,
--       low-pressure, activation-agnostic. By construction it never overlaps
--       board_waiting / reengage_1 (they require activation; this requires the
--       absence of it).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Admit the new types. The CHECK was created inline in 0173 (default name);
--    0184 already re-added it once — extend the same way.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.lifecycle_email_log
  drop constraint if exists lifecycle_email_log_email_type_check;
alter table public.lifecycle_email_log
  add constraint lifecycle_email_log_email_type_check
  check (email_type in ('activate_nudge_1','activate_nudge_2','reengage_1',
                        'welcome_board','board_waiting','nudge_dormant_early'));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. board_waiting eligibility. Same skeleton as lifecycle_due_welcome_board
--    (0184) for the board/thumb lateral, plus reengage_1's dormancy + cooldown.
--    Dormancy anchors on coalesce(last_seen, created_at) so a user with no
--    presence row is measured from signup, never mislabelled dormant on day 2.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_due_board_waiting(
  p_dormant_days int default 14, p_cooldown_days int default 45,
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
  left join public.user_presence pr on pr.user_id = u.id
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
    and p.tier in ('demo','paid')
    and bd.board_id is not null
    and p.first_populated_board_at is not null
    and coalesce(pr.last_seen_at, u.created_at) < now() - make_interval(days => p_dormant_days)
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'board_waiting'
                      and l.sent_at > now() - make_interval(days => p_cooldown_days));
$$;
revoke all on function public.lifecycle_due_board_waiting(int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_board_waiting(int,int,boolean,int) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. nudge_dormant_early eligibility. NOT activated (first_populated_board_at
--    IS NULL) — which is what makes it disjoint from board_waiting/reengage_1.
--    Account 14-90d old: past the activation-nudge window (activate_nudge_2 max
--    is 336h≈14d) so it can't cannibalise those, and not so old the account is
--    effectively abandoned. 4-day spacing off ANY lifecycle email so it can't
--    land the day after activate_nudge_2; 30d re-fire cooldown bounds volume.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_due_nudge_dormant_early(
  p_quiet_days int default 7, p_min_account_days int default 14,
  p_max_account_days int default 90, p_cooldown_days int default 30,
  p_exclude_internal boolean default true, p_hour int default null)
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
    and p.tier in ('demo','paid')
    and p.first_populated_board_at is null
    and coalesce(p.activated_access_at, u.created_at) <= now() - make_interval(days => p_min_account_days)
    and coalesce(p.activated_access_at, u.created_at) >  now() - make_interval(days => p_max_account_days)
    and coalesce(pr.last_seen_at, coalesce(p.activated_access_at, u.created_at))
          < now() - make_interval(days => p_quiet_days)
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'nudge_dormant_early'
                      and l.sent_at > now() - make_interval(days => p_cooldown_days))
    and not exists (select 1 from public.lifecycle_email_log l2
                    where l2.user_id = u.id
                      and l2.sent_at > now() - interval '4 days');
$$;
revoke all on function public.lifecycle_due_nudge_dormant_early(int,int,int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_nudge_dormant_early(int,int,int,int,boolean,int) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. A/B copy bandit entries (0174 shape). Both are non-activate types, so the
--    nightly optimizer (lifecycle_email_optimize) scores them by return-visit
--    within the window — the right success metric for a re-engagement email.
-- ───────────────────────────────────────────────────────────────────────────
update public.app_config
   set value = value || jsonb_build_object(
     'board_waiting', jsonb_build_object(
       'enabled', true, 'arms', jsonb_build_array('A','B'),
       'weights', jsonb_build_object('A',50,'B',50),
       'reward_window_days', 14, 'min_trials_per_arm', 30, 'floor', 5,
       'phase', 'warmup', 'stats', '{}'::jsonb))
 where key = 'lifecycle_email_experiments'
   and not (value ? 'board_waiting');

update public.app_config
   set value = value || jsonb_build_object(
     'nudge_dormant_early', jsonb_build_object(
       'enabled', true, 'arms', jsonb_build_array('A','B'),
       'weights', jsonb_build_object('A',50,'B',50),
       'reward_window_days', 14, 'min_trials_per_arm', 30, 'floor', 5,
       'phase', 'warmup', 'stats', '{}'::jsonb))
 where key = 'lifecycle_email_experiments'
   and not (value ? 'nudge_dormant_early');
