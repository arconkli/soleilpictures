-- 0211_lifecycle_whats_new.sql — give the win-back something new to say, and
-- stop the copy bandit amplifying noise.
--
-- Analysis of the first 5 weeks of lifecycle mail (553 sends, 2026-06-29 →
-- 2026-08-06) found the failure is NOT deliverability, coverage or opens:
--   • 40.2% open rate, 0 spam complaints, 6 unsubscribes ever, 268/281
--     confirmed non-internal users reached.
--   • 3.1% click rate (16 clicks on 522 delivered), and of 476 mature sends
--     only 8 users came back within 6h of the send — the rest of the "returns"
--     inside the 7-day window are background behaviour, not email-caused.
-- Every win-back says a version of "your stuff is still here". That is a status
-- report, not news — and for the 172 never-activated dormant users (the bulk of
-- send volume) there is no "stuff" and no value ever received, so it is empty.
--
-- Two changes here:
--   1. whats_new — a win-back that carries real new information (what shipped
--      since they left), re-firing once per published news version, with the
--      user's own board thumbnail attached when they have one. Broad gate: any
--      activation state, no 90-day account-age ceiling.
--   2. lifecycle_email_optimize — non-activate types scored on return-within-24h
--      OR click instead of "any active day in 7-14 days", plus an explicit
--      rotate mode. The old reward pushed activate_nudge_1 to 95/5 weights on
--      3 total reward events (A: 3/73, B: 0/42); at ~14 sends/day and ~2%
--      conversion no arm can ever reach significance, so the honest use of this
--      machinery is copy rotation + measurement, not optimization.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Admit the new type. The CHECK was created inline in 0173 (default name);
--    0184 and 0194 already re-added it — extend the same way.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.lifecycle_email_log
  drop constraint if exists lifecycle_email_log_email_type_check;
alter table public.lifecycle_email_log
  add constraint lifecycle_email_log_email_type_check
  check (email_type in ('activate_nudge_1','activate_nudge_2','reengage_1',
                        'welcome_board','board_waiting','nudge_dormant_early',
                        'whats_new'));

-- ───────────────────────────────────────────────────────────────────────────
-- 2. content_version — which edition of the news a row represents. NULL for
--    every other type. The unique partial index is what makes whats_new
--    "re-fires once per published version": publishing a new version opens
--    exactly one more send per user, forever, with no cooldown bookkeeping.
-- ───────────────────────────────────────────────────────────────────────────
alter table public.lifecycle_email_log
  add column if not exists content_version text;

create unique index if not exists lifecycle_email_log_whats_new_version_idx
  on public.lifecycle_email_log (user_id, email_type, content_version)
  where email_type = 'whats_new';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. The news itself, in app_config so publishing an edition is one row update
--    rather than a deploy. image_path is optional — the template degrades to a
--    text note (plus the user's own thumbnail, if any) when it is empty, so an
--    edition can ship before its screenshot exists.
--    NOTE: image_path must be a path under the app origin that is served
--    directly and does NOT redirect — email clients will not follow one.
-- ───────────────────────────────────────────────────────────────────────────
--
--    Seeded DISABLED on purpose: 164 users are eligible the instant this lands,
--    and the first edition ships without its screenshot. Nothing should reach a
--    real inbox before a human has previewed the render — the cron's testTo hook
--    renders a DISABLED edition precisely so it can be reviewed first. Flipping
--    enabled to true is what starts the batch.
--
--    daily_cap then throttles that first burst. 164 sends in one day against a
--    ~14/day baseline is a ~10x volume spike on a list already bouncing at 2.5%
--    — exactly the shape that trips bulk-sender filtering. At 25/day the first
--    edition drains over about a week, and the cap is one row-edit away from
--    being raised once the domain has carried the higher volume cleanly.
insert into public.app_config (key, value)
values ('lifecycle_whats_new', jsonb_build_object(
  'enabled',    false,
  'version',    '2026-08',
  'image_path', '',
  'cta_label',  'take a look',
  'daily_cap',  25,
  'items', jsonb_build_array(
    'schedule — your cards on real dates, drag to move them',
    'grids — snap cards into a template instead of freehand',
    'comments on any word in a doc, not just the whole card'
  )))
on conflict (key) do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Claim RPC gains p_content_version. The 4-arg form is DROPPED first: adding
--    a defaulted 5th parameter alongside it would make every existing 4-arg
--    call ambiguous ("function is not unique") rather than resolving to the new
--    one. Callers passing 4 args keep working against the 5-arg form.
-- ───────────────────────────────────────────────────────────────────────────
drop function if exists public.lifecycle_claim_send(uuid, text, text, text);
create or replace function public.lifecycle_claim_send(
  p_user_id uuid, p_email_type text, p_recipient_email text,
  p_variant text default null, p_content_version text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.lifecycle_email_log
    (user_id, email_type, recipient_email, status, variant, content_version)
  select p_user_id, p_email_type, p_recipient_email, 'claimed', p_variant, p_content_version
  where public._email_pref_enabled(p_user_id, 'email_lifecycle')
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.lifecycle_claim_send(uuid, text, text, text, text) from public;
grant execute on function public.lifecycle_claim_send(uuid, text, text, text, text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. whats_new eligibility. Deliberately the broadest dormant gate we have:
--      • ANY activation state (unlike board_waiting / reengage_1, which require
--        first_populated_board_at, and nudge_dormant_early, which requires its
--        absence) — the news is worth reading either way.
--      • NO account-age ceiling — nudge_dormant_early stops at 90 days, which
--        left long-lapsed accounts permanently uncontactable.
--      • Board + thumb are OPTIONAL, pulled only to personalise. A user with no
--        board still gets the news.
--    Skips anyone already sent the CURRENT version (the unique index is the
--    real guarantee; this just keeps them out of the batch). The 4-day spacing
--    off any lifecycle email and the global one-per-UTC-day index still hold.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_due_whats_new(
  p_dormant_days int default 21, p_exclude_internal boolean default true,
  p_hour int default null)
returns table(user_id uuid, email text, display_name text, workspace_id uuid,
              board_id uuid, board_name text, thumb_key text,
              thumb_updated_at timestamptz, unsub_token text, content_version text)
language sql stable security definer set search_path = public as $$
  with news as (
    select value->>'version' as version,
           coalesce((value->>'enabled')::boolean, false) as enabled,
           coalesce((value->>'daily_cap')::int, 25) as daily_cap
    from public.app_config where key = 'lifecycle_whats_new'
  ),
  -- Remaining headroom for today. The cron runs hourly and only picks users
  -- whose preferred_send_hour matches, so this is re-evaluated every hour and
  -- the batch drains across the day rather than in one burst.
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
  -- best board to picture: prefer a real sub-board with a stored thumbnail,
  -- newest first. Entirely optional — no row here still yields the user.
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
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'whats_new'
                      and l.content_version is not distinct from news.version)
    and not exists (select 1 from public.lifecycle_email_log l2
                    where l2.user_id = u.id
                      and l2.sent_at > now() - interval '4 days')
  -- Warmest first: the most recently dormant are the likeliest to still care,
  -- so if the daily cap bites they are the ones who get today's slots.
  order by coalesce(pr.last_seen_at, u.created_at) desc
  limit (select slots from budget);
$$;
revoke all on function public.lifecycle_due_whats_new(int,boolean,int) from public;
grant execute on function public.lifecycle_due_whats_new(int,boolean,int) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. Bandit: honest reward + explicit rotate mode.
--
--    Reward, non-activate types: returned within 24h of the send, OR clicked.
--    The old test ("any active day within reward_window_days") counted anyone
--    who happened to open the app up to two weeks later, which the data shows
--    is overwhelmingly background return behaviour — only 8 of 46 in-window
--    returns landed within 6h of a send.
--
--    mode='rotate' holds weights at even and skips weight computation entirely
--    while still recording stats. This is the correct state for every type at
--    current volume; it replaces the previous de-facto mechanism (set
--    min_trials_per_arm impossibly high), which was doing the same thing by
--    accident and would have silently started optimizing if volume grew.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_email_optimize()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb; etype text; econf jsonb; arms text[]; arm text;
  reward_window int; min_trials int; v_floor numeric; mode text;
  n_arm int; r_arm int; mean numeric;
  means jsonb; stats jsonb; sum_means numeric; warmup boolean; nfloors int;
  new_weights jsonb; w int; acc int; result jsonb := '{}'::jsonb;
begin
  select value into cfg from public.app_config where key = 'lifecycle_email_experiments';
  if cfg is null then return '{}'::jsonb; end if;

  for etype in select jsonb_object_keys(cfg) loop
    econf := cfg->etype;
    if coalesce((econf->>'enabled')::boolean, false) = false then continue; end if;
    arms := array(select jsonb_array_elements_text(econf->'arms'));
    reward_window := coalesce((econf->>'reward_window_days')::int, 7);
    min_trials := coalesce((econf->>'min_trials_per_arm')::int, 30);
    v_floor := coalesce((econf->>'floor')::numeric, 5);
    mode := coalesce(econf->>'mode', 'optimize');
    means := '{}'::jsonb; stats := '{}'::jsonb; sum_means := 0; warmup := false;

    foreach arm in array arms loop
      select count(*)::int, count(*) filter (where converted)::int
        into n_arm, r_arm
      from (
        select
          case when etype like 'activate%' then
            -- activation types keep their real outcome: did they populate a
            -- board inside the window?
            (p.first_populated_board_at is not null
             and p.first_populated_board_at >  l.sent_at
             and p.first_populated_board_at <= l.sent_at + make_interval(days => reward_window))
          else
            -- re-engagement types: came back promptly, or clicked. Both are
            -- attributable to the send in a way a 7-14 day window is not.
            exists (select 1 from public.analytics_events a
                    where a.user_id = l.user_id
                      and a.occurred_at >  l.sent_at
                      and a.occurred_at <= l.sent_at + interval '24 hours')
            or exists (select 1 from public.email_sends es
                       where es.resend_id = l.resend_id
                         and es.clicked_at is not null)
          end as converted
        from public.lifecycle_email_log l
        join public.profiles p on p.user_id = l.user_id
        where l.email_type = etype and l.variant = arm and l.status = 'sent'
          and l.sent_at <= now() - make_interval(days => reward_window)
      ) s;

      if n_arm < min_trials then warmup := true; end if;
      mean := case when n_arm > 0 then r_arm::numeric / n_arm else 0 end;
      means := means || jsonb_build_object(arm, mean);
      sum_means := sum_means + mean;
      stats := stats || jsonb_build_object(arm, jsonb_build_object('n', n_arm, 'reward', r_arm, 'mean', round(mean, 4)));
    end loop;

    new_weights := '{}'::jsonb;
    if mode = 'rotate' or warmup or sum_means <= 0 then
      foreach arm in array arms loop
        new_weights := new_weights || jsonb_build_object(arm, (100 / array_length(arms,1)));
      end loop;
      econf := jsonb_set(econf, '{phase}',
                 to_jsonb(case when mode = 'rotate' then 'rotate' else 'warmup' end));
    else
      nfloors := array_length(arms,1);
      acc := 0;
      foreach arm in array arms loop
        w := round( v_floor + ((means->>arm)::numeric / sum_means) * (100 - v_floor*nfloors) )::int;
        new_weights := new_weights || jsonb_build_object(arm, w);
        acc := acc + w;
      end loop;
      -- absorb rounding drift into the first arm so weights sum to 100
      new_weights := jsonb_set(new_weights, array[arms[1]], to_jsonb(((new_weights->>arms[1])::int + (100 - acc))));
      econf := jsonb_set(econf, '{phase}', to_jsonb('running'::text));
    end if;

    econf := jsonb_set(econf, '{weights}', new_weights);
    econf := jsonb_set(econf, '{stats}', stats);
    cfg := jsonb_set(cfg, array[etype], econf);
    result := result || jsonb_build_object(etype, jsonb_build_object('weights', new_weights, 'phase', econf->>'phase', 'stats', stats));
  end loop;

  update public.app_config set value = cfg, updated_at = now() where key = 'lifecycle_email_experiments';
  return result;
end $$;
revoke all on function public.lifecycle_email_optimize() from public;
grant execute on function public.lifecycle_email_optimize() to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. Put every existing type into rotate mode and reset the overfit weights
--    (activate_nudge_1 was at 95/5 off 3 rewards, activate_nudge_2 at 5/95 off
--    1). Non-activate types drop to a 1-day reward window to match the new 24h
--    outcome — no reason to wait 14 days to score a 24-hour question.
-- ───────────────────────────────────────────────────────────────────────────
update public.app_config
   set value = (
     select jsonb_object_agg(k,
       (value->k)
         || jsonb_build_object('mode', 'rotate', 'phase', 'rotate')
         || jsonb_build_object('weights', jsonb_build_object('A', 50, 'B', 50))
         || case when k like 'activate%' then '{}'::jsonb
                 else jsonb_build_object('reward_window_days', 1) end)
     from jsonb_object_keys(value) k),
       updated_at = now()
 where key = 'lifecycle_email_experiments';

-- whats_new joins the same spine: two copy arms, rotated not optimized.
update public.app_config
   set value = value || jsonb_build_object(
     'whats_new', jsonb_build_object(
       'enabled', true, 'arms', jsonb_build_array('A','B'),
       'weights', jsonb_build_object('A',50,'B',50),
       'reward_window_days', 1, 'min_trials_per_arm', 30, 'floor', 5,
       'mode', 'rotate', 'phase', 'rotate', 'stats', '{}'::jsonb))
 where key = 'lifecycle_email_experiments'
   and not (value ? 'whats_new');
