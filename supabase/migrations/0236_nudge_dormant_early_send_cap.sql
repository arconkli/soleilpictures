-- nudge_dormant_early — stop re-sending into silence.
--
-- This is the highest-volume lifecycle type and the worst-performing one. Over
-- its life it has opened at a healthy ~41%, clicked at ~2.6%, and produced ZERO
-- units of work by any recipient in the 72 hours after delivery. Not a low
-- number — zero.
--
-- The segment explains it. The eligibility gate is `first_populated_board_at is
-- null`, so by construction every recipient is someone who never put anything
-- on a board — and a clear majority of all dormant accounts have never placed
-- a single card. There is no board waiting for them, and no email can make one.
--
-- The copy is NOT touched here, deliberately. It is mid-factorial (0219) with a
-- settled subject result — "your workspace is still here" beat "still here
-- whenever you want it" 51.4% to 17.7%, z ≈ 4.9 — and opens were never the
-- problem. The b3 body arm already says the right thing for this
-- audience ("select ten photos from your camera roll, drag them in"), which is
-- also the motion that correlates with coming back at all: users who place 6+
-- cards on day one return at 53-73%, against 14% at zero. Rewriting copy that
-- is currently being measured would throw away the measurement and change
-- nothing about why the sends fail.
--
-- What IS wrong is the volume. p_cooldown_days=30 inside a 14-90 day account
-- window lets the same silent inbox receive this three times.
--
-- Why two and not one. Every recipient so far has had exactly one — the type
-- only started on 2026-07-20, so the 30-day cooldown has not elapsed for
-- anybody and the repeats are about to begin. The cap is therefore preventive
-- rather than corrective, and it lands at the useful moment: every send that
-- produced nothing pointed at a sign-in wall, because /resume (0235) did not
-- exist yet. Allowing exactly one more per user makes the second send
-- the type's first honest test rather than its fourth wasted one. A cap of 1
-- would retire it on evidence gathered entirely under the broken link.

-- The parameter list changes, so the old signature has to go or PostgREST sees
-- two overloads and the cron's named-argument call (p_hour) is ambiguous.
drop function if exists public.lifecycle_due_nudge_dormant_early(integer, integer, integer, integer, boolean, integer);

create or replace function public.lifecycle_due_nudge_dormant_early(
  p_quiet_days       integer default 7,
  p_min_account_days integer default 14,
  p_max_account_days integer default 90,
  p_cooldown_days    integer default 30,
  p_exclude_internal boolean default true,
  p_hour             integer default null,
  p_max_prior_sends  integer default 2
)
returns table(user_id uuid, email text, display_name text, workspace_id uuid,
              board_id uuid, board_name text, unsub_token text)
language sql stable security definer
set search_path to 'public'
as $function$
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
                      and l2.sent_at > now() - interval '4 days')
    -- Two strikes. Only status='sent' counts: a claim that never made it out of
    -- Resend cost the recipient nothing and must not burn one of their two.
    -- Within the 90-day account ceiling above, this is effectively a lifetime
    -- cap for the type.
    and (select count(*) from public.lifecycle_email_log l3
         where l3.user_id = u.id and l3.email_type = 'nudge_dormant_early'
           and l3.status = 'sent')
        < greatest(1, p_max_prior_sends);
$function$;

revoke all on function public.lifecycle_due_nudge_dormant_early(integer, integer, integer, integer, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.lifecycle_due_nudge_dormant_early(integer, integer, integer, integer, boolean, integer, integer) to service_role;
