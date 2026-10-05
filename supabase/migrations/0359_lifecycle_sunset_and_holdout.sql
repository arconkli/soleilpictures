-- 0359 — lifecycle mail goes only to people who read it, and the picture of
--        your own cluster comes back, measured against a holdout.
--
-- After the 2026-09-20 invite abuse (0358) our mail started landing in spam.
-- Two things keep a sender there: mailing people who never open, and volume
-- the readers don't want. And the one automated win-back that ever pulled
-- anyone back — board_waiting, a picture of the cluster you built — has been
-- off since 08-30, because it fired well after people's natural return point.
--
--   1. _email_engaged(p_user_id): false only when a person's last three
--      delivered lifecycle emails were all unopened. Fewer than three sends
--      (every new user) passes. Opens are an imperfect signal — a client that
--      blocks images never reports one — but three in a row is the standard
--      sunset line, and it errs toward not mailing.
--   2. lifecycle_claim_send gains that gate and a per-type holdout. A type
--      whose app_config.lifecycle_email_experiments entry has holdout_pct
--      holds back that share of eligible people, drawn deterministically from
--      the user id and the type. A held-out person gets a 'held_out' log row
--      and no email: the claim returns null, which lifecycle-email-cron
--      already counts as skipped. The row starts the type's cooldown like a
--      send, so nobody is redrawn the next day, and every stats function reads
--      status = 'sent' only, so it is never counted as a send.
--      lifecycle_email_optimize rewrites weights/stats/phase inside each type's
--      object and keeps the rest, so holdout_pct survives the nightly run.
--   3. lifecycle_due_board_waiting: idle 10 to 30 days (was 14 days and up,
--      with no ceiling, so a long-gone account was mailed every 45 days for
--      ever). The cron passes only p_hour, so the window is the defaults; the
--      ceiling is in the body so the signature, and with it the ACL, stays.
--   4. Config: board_waiting back on with a 20% holdout; activate_nudge_2
--      paused while the sending domain recovers (re-enable by flipping its
--      `enabled` back to true).
--
-- No counts in this file: the repo is public.

begin;

-- ── 1. The sunset gate ──────────────────────────────────────────────────────

create or replace function public._email_engaged(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select count(*) < 3 or bool_or(x.opened_at is not null)
       from (select es.opened_at
               from public.email_sends es
              where es.user_id = p_user_id
                and es.category = 'lifecycle'
                and es.delivered_at is not null
              order by es.sent_at desc
              limit 3) x),
    true);
$$;

comment on function public._email_engaged(uuid) is
  'False only when the user''s last three delivered lifecycle emails were all unopened (the sunset rule). Fewer than three sends passes. Internal: called by lifecycle_claim_send.';

revoke execute on function public._email_engaged(uuid) from public, anon, authenticated;

-- ── 2. The claim: sunset gate + holdout ─────────────────────────────────────

alter table public.lifecycle_email_log
  drop constraint if exists lifecycle_email_log_status_check;
alter table public.lifecycle_email_log
  add constraint lifecycle_email_log_status_check
  check (status in ('claimed','sent','failed','held_out'));

create or replace function public.lifecycle_claim_send(
  p_user_id         uuid,
  p_email_type      text,
  p_recipient_email text,
  p_variant         text default null,
  p_content_version text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id      bigint;
  v_raw     text;
  v_pct     integer := 0;
  v_held    boolean := false;
begin
  if not (public._email_pref_enabled(p_user_id, 'email_lifecycle')
          and public.lifecycle_type_enabled(p_email_type)
          and public._email_deliverable(p_user_id)
          and public._email_engaged(p_user_id)) then
    return null;
  end if;

  -- holdout_pct: an integer 0-100 under the type's experiment entry. Anything
  -- else (absent, malformed) means no holdout.
  select c.value -> p_email_type ->> 'holdout_pct' into v_raw
    from public.app_config c where c.key = 'lifecycle_email_experiments';
  if v_raw ~ '^\d{1,3}$' then
    v_pct := least(v_raw::integer, 100);
  end if;
  -- Deterministic per (user, type), and safe for every int4: hashtext can
  -- return -2^31, which abs() cannot represent, so shift into 0..99 instead.
  if v_pct > 0 then
    v_held := (((hashtext(p_user_id::text || ':' || p_email_type)::bigint % 100) + 100) % 100) < v_pct;
  end if;

  insert into public.lifecycle_email_log
    (user_id, email_type, recipient_email, status, variant, content_version)
  values
    (p_user_id, p_email_type, p_recipient_email,
     case when v_held then 'held_out' else 'claimed' end,
     p_variant, p_content_version)
  on conflict do nothing
  returning id into v_id;

  if v_held then
    return null;   -- logged, not sent: the cron counts it as skipped
  end if;
  return v_id;
end $$;

comment on function public.lifecycle_claim_send(uuid, text, text, text, text) is
  'Claim-before-send for lifecycle mail. Re-checks consent, the per-type switch, deliverability and engagement (0359), applies the per-type holdout, then takes the once-ever / once-per-day unique indexes. Returns the log id, or null when the send must not happen (including a held-out person, who gets a held_out row).';

-- ── 3. board_waiting: idle 10 to 30 days ────────────────────────────────────
-- Body is 0194's, with the default moved to 10 and a 30-day ceiling added.

create or replace function public.lifecycle_due_board_waiting(
  p_dormant_days int default 10, p_cooldown_days int default 45,
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
    -- 0359: the re-read point, not for ever. Past 30 idle days this email has
    -- nothing to offer a reader who has already moved on.
    and coalesce(pr.last_seen_at, u.created_at) > now() - interval '30 days'
    and p.banned_at is null
    and (not p_exclude_internal or u.id not in (select iu.user_id from public._internal_user_ids() iu))
    and public._email_pref_enabled(u.id, 'email_lifecycle')
    and (p_hour is null or coalesce(p.preferred_send_hour,
          extract(hour from coalesce(p.activated_access_at, u.created_at))::int) = p_hour)
    and not exists (select 1 from public.lifecycle_email_log l
                    where l.user_id = u.id and l.email_type = 'board_waiting'
                      and l.sent_at > now() - make_interval(days => p_cooldown_days));
$$;

-- ── 4. Config ───────────────────────────────────────────────────────────────

update public.app_config
   set value = jsonb_set(
                 jsonb_set(value, '{board_waiting,enabled}', 'true'::jsonb),
                 '{board_waiting,holdout_pct}', '20'::jsonb),
       updated_at = now()
 where key = 'lifecycle_email_experiments'
   and value ? 'board_waiting';

update public.app_config
   set value = jsonb_set(value, '{activate_nudge_2,enabled}', 'false'::jsonb),
       updated_at = now()
 where key = 'lifecycle_email_experiments'
   and value ? 'activate_nudge_2';

-- ── Proof ───────────────────────────────────────────────────────────────────
do $$
declare
  v_held integer;
begin
  -- Grants (the 0311 habit). _email_engaged is internal; the replaced
  -- functions keep their ACLs (same signatures).
  if has_function_privilege('anon', 'public._email_engaged(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._email_engaged(uuid)', 'execute') then
    raise exception '0359: _email_engaged is callable by a client';
  end if;
  if has_function_privilege('anon', 'public.lifecycle_claim_send(uuid,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.lifecycle_claim_send(uuid,text,text,text,text)', 'execute') then
    raise exception '0359: lifecycle_claim_send is callable by a client';
  end if;
  if has_function_privilege('anon', 'public.lifecycle_due_board_waiting(integer,integer,boolean,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.lifecycle_due_board_waiting(integer,integer,boolean,integer)', 'execute') then
    raise exception '0359: lifecycle_due_board_waiting is callable by a client';
  end if;

  -- The claim carries both new behaviours.
  if position('_email_engaged' in pg_get_functiondef('public.lifecycle_claim_send(uuid,text,text,text,text)'::regprocedure)) = 0
     or position('held_out' in pg_get_functiondef('public.lifecycle_claim_send(uuid,text,text,text,text)'::regprocedure)) = 0 then
    raise exception '0359: lifecycle_claim_send is missing the sunset gate or the holdout';
  end if;

  -- The draw holds back about the configured share: over a fixed set of ids,
  -- 20% must land between 15% and 25%.
  select count(*) into v_held
    from generate_series(1, 2000) g
   where (((hashtext(md5(g::text)::uuid::text || ':board_waiting')::bigint % 100) + 100) % 100) < 20;
  if v_held < 300 or v_held > 500 then
    raise exception '0359: the holdout draw is skewed (% of 2000 at 20%%)', v_held;
  end if;

  -- Config landed (where the experiment entries exist at all; a bare
  -- database without the 0174 seed has nothing to flip).
  if exists (select 1 from public.app_config
              where key = 'lifecycle_email_experiments'
                and value ? 'board_waiting' and value ? 'activate_nudge_2'
                and not (value -> 'board_waiting' ->> 'enabled' = 'true'
                         and value -> 'board_waiting' ->> 'holdout_pct' = '20'
                         and value -> 'activate_nudge_2' ->> 'enabled' = 'false')) then
    raise exception '0359: lifecycle config did not take';
  end if;
end $$;

commit;
