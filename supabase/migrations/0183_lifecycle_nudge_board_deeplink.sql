-- 0183: activation nudges deep-link into the user's own cluster.
--
-- Data (2026-07-10 activation deep-dive): nudge opens run ~28% but clicks are
-- 2/89 — the copy asked users to "start a board" and linked the workspace,
-- while most stallers had ALREADY made a cluster and stalled with it empty.
-- Give the nudge RPCs the user's most recent cluster (nullable) so the email
-- can say "your cluster is one photo away" and land them inside it.
--
-- Same shape as lifecycle_due_reengage_1's board lateral, minus the ≥3-cards
-- bar (nudge targets are pre-populated by definition). Root/studio boards are
-- excluded (parent_board_id is null) — "you made 'Studio'" reads wrong; the
-- template falls back to workspace copy when board_id is null.

drop function if exists public.lifecycle_due_activate_nudge_1(int,int,int,boolean,int);
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
                    where l.user_id = u.id and l.email_type = 'activate_nudge_1');
$$;
revoke all on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_activate_nudge_1(int,int,int,boolean,int) to service_role;

drop function if exists public.lifecycle_due_activate_nudge_2(int,int,int,boolean,int);
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
                    where l.user_id = u.id and l.email_type = 'activate_nudge_2');
$$;
revoke all on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean,int) from public;
grant execute on function public.lifecycle_due_activate_nudge_2(int,int,int,boolean,int) to service_role;
