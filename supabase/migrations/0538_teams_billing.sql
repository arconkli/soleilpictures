-- 0538: Teams, part 10 — billing (S3).
--
-- STATUS: written 2026-10-24. NOT APPLIED until the owner says go.
--
-- A team pays for itself through Stripe (plan
-- docs/superpowers/plans/2026-10-24-team-s3-billing.md). The edge functions
-- team-billing and team-billing-cron talk to Stripe; this file keeps what they
-- learn and decides what it means:
--   * org_subscriptions mirrors each team's subscription, one row a team,
--     server-only, behind the observation guard subscriptions has (0417);
--   * team_checkouts holds a checkout until Stripe says it is done, and
--     _team_checkout_complete then makes the team (or lets a lapsed one edit
--     again), whichever of the webhook and the success page gets there first;
--   * _org_billing_apply turns the mirror into the team's status: active and
--     trialing edit, past_due edits for _team_grace_days(), anything else is
--     view-only until paid (0530 _org_ws_role_for reads that); the first
--     payment ends the trial drive (first_paid_at, 0537);
--   * a team starts at checkout: create_team refuses (hint team_checkout), and
--     its body is now _create_team_for, which only the paid path calls;
--   * a seat change that no checkout or admin add bills itself pokes
--     team-billing-cron at once (pg_net, through _cron_edge_post, 0386), and a
--     10-minute sweep, scheduled to run only while a team exists, catches what
--     a poke missed and trims unused seats before a renewal (reason 'renewal').
-- Nothing here runs for anyone while teams stay closed: no team exists, and
-- start_team_checkout refuses unless teams are open for the caller.
--
-- create_team is re-emitted (0532's body moves to _create_team_for, the lines
-- marked 0538). Rebased on (the md5 of the live prosrc, checked again before
-- applying):
--   create_team  26336cea699fdc1b4aed15883770292f

begin;

-- New triggers on two empty team tables: don't queue behind production
-- traffic for their locks.
set local lock_timeout = '3s';

-- ── 1. Tables ───────────────────────────────────────────────────────────────

-- When a team went view-only: the 12-month keep (design) counts from here.
alter table public.organizations add column if not exists view_only_since timestamptz;

-- 'renewal': unused seats trimmed before a renewal. 'checkout': a lapsed team
-- paying again for the seats it has.
alter table public.org_seat_changes drop constraint if exists org_seat_changes_reason_check;
alter table public.org_seat_changes add constraint org_seat_changes_reason_check
  check (reason in ('create', 'admin_add', 'admin_remove', 'auto', 'approve', 'move_in', 'renewal', 'checkout'));

create table if not exists public.org_subscriptions (
  org_id                 uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id     text not null,
  stripe_subscription_id text,
  plan                   text check (plan in ('monthly', 'annual')),
  status                 text,
  seats_billed           integer not null default 0 check (seats_billed >= 0),
  storage_blocks         integer not null default 0 check (storage_blocks between 0 and 1000),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  trial_end              timestamptz,
  past_due_since         timestamptz,
  observed_at            timestamptz,
  updated_at             timestamptz not null default now()
);
create unique index if not exists org_subscriptions_subscription_key
  on public.org_subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;
create index if not exists org_subscriptions_customer_idx on public.org_subscriptions (stripe_customer_id);
alter table public.org_subscriptions enable row level security;
revoke all on public.org_subscriptions from public, anon, authenticated;

create table if not exists public.team_checkouts (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references auth.users(id) on delete cascade,
  kind               text not null default 'new' check (kind in ('new', 'renew')),
  -- A renewal's team from the start; a new team's once it is made.
  org_id             uuid references public.organizations(id) on delete set null,
  name               text not null check (char_length(btrim(name)) between 1 and 60),
  color              text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  seats              integer not null check (seats >= 3),
  plan               text not null check (plan in ('monthly', 'annual')),
  workspace_ids      uuid[] not null default '{}',
  end_creator        boolean not null default false,
  trial              boolean not null default false,
  stripe_customer_id text,
  stripe_session_id  text unique,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  result             jsonb
);
create index if not exists team_checkouts_owner_idx on public.team_checkouts (owner_id, created_at desc);
alter table public.team_checkouts enable row level security;
revoke all on public.team_checkouts from public, anon, authenticated;

-- 0417's rules for the personal mirror, for a team's: an observation older
-- than the stored one of the same subscription is dropped; a different
-- subscription takes the row only when the stored one no longer bills (a
-- stale event of an ended plan never overwrites the plan that replaced it);
-- past_due_since is when it went past due, the grace clock.
create or replace function public._tg_org_subscriptions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.storage_blocks := least(greatest(coalesce(new.storage_blocks, 0), 0), 1000);
  new.seats_billed := greatest(coalesce(new.seats_billed, 0), 0);
  if tg_op = 'UPDATE' then
    if new.stripe_subscription_id is not distinct from old.stripe_subscription_id then
      if old.observed_at is not null and new.observed_at is not null and new.observed_at < old.observed_at then
        return null;
      end if;
    elsif old.stripe_subscription_id is not null
          and old.status in ('active', 'trialing', 'past_due') then
      return null;
    end if;
    new.past_due_since := case
      when new.status <> 'past_due' or new.status is null then null
      when old.status = 'past_due' and new.stripe_subscription_id is not distinct from old.stripe_subscription_id
        then coalesce(old.past_due_since, now())
      else now() end;
  else
    new.past_due_since := case when new.status = 'past_due' then coalesce(new.past_due_since, now()) end;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace trigger org_subscriptions_guard
  before insert or update on public.org_subscriptions
  for each row execute function public._tg_org_subscriptions_guard();

-- ── 2. Who edits while a payment fails ──────────────────────────────────────

create or replace function public._team_grace_days()
returns integer
language sql
immutable
set search_path = public
as $$
  select 14;
$$;

-- teamBillingCore.mjs's rules, the one place they decide: active and trialing
-- edit; past_due edits for the grace days from when it went past due; anything
-- else (canceled, unpaid, paused, incomplete, incomplete_expired) is view-only.
create or replace function public._team_entitled(p_status text, p_past_due_since timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select case
    when p_status in ('active', 'trialing') then true
    when p_status = 'past_due' then p_past_due_since is null
                                  or p_past_due_since > now() - make_interval(days => public._team_grace_days())
    else false end;
$$;

-- The mirror, made the team's: its status, when it went view-only, its first
-- payment (the trial drive ends there, 0537 _org_storage_quota_bytes) and its
-- storage blocks. The owner and admins hear of every change.
create or replace function public._org_billing_apply(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o       public.organizations%rowtype;
  s       public.org_subscriptions%rowtype;
  v_ok    boolean;
  v_new   text;
  v_ended boolean;
  m       record;
begin
  select * into o from public.organizations where id = p_org for update;
  if not found then
    return null;
  end if;
  if o.closed_at is not null then
    return 'closed';
  end if;
  select * into s from public.org_subscriptions where org_id = p_org;
  if not found then
    return o.status;
  end if;
  v_ok := public._team_entitled(s.status, s.past_due_since);
  v_new := case when v_ok then 'active' else 'view_only' end;
  update public.organizations
     set status          = v_new,
         view_only_since = case when v_ok then null else coalesce(o.view_only_since, now()) end,
         first_paid_at   = case when o.first_paid_at is null and s.status = 'active' then now()
                                else o.first_paid_at end,
         storage_blocks  = s.storage_blocks
   where id = p_org;

  v_ended := s.status in ('canceled', 'incomplete_expired');
  for m in select om.user_id from public.org_members om
            where om.org_id = p_org and om.role in ('owner', 'admin') loop
    if v_new = 'view_only' and o.status = 'active' then
      perform public._team_notify(m.user_id, 'team.view_only', p_org, null, null,
        o.name || ' is view-only',
        case when v_ended
             then 'Its plan has ended. Everyone can still open and export everything; start the plan again to edit.'
             else 'Its payment didn''t go through. Everyone can still open and export everything; pay to edit again.' end);
    elsif v_new = 'active' and o.status = 'view_only' then
      perform public._team_notify(m.user_id, 'team.active_again', p_org, null, null,
        o.name || ' can edit again', 'Its plan is paid. Everyone can edit as before.');
    elsif v_ok and s.status = 'past_due' then
      perform public._team_notify(m.user_id, 'team.payment_failed', p_org, null, null,
        'A payment for ' || o.name || ' didn''t go through',
        'Stripe will try again. Update the card by '
          || to_char(s.past_due_since + make_interval(days => public._team_grace_days()), 'FMMonth FMDD')
          || ' to keep editing.');
    end if;
  end loop;
  return v_new;
end;
$$;

-- One observation of a team's subscription (teamBillingCore teamMirrorFields,
-- plus observed_at: when the Stripe read started), then what it means.
create or replace function public._team_mirror_upsert(p_org uuid, p_mirror jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.org_subscriptions as s
         (org_id, stripe_customer_id, stripe_subscription_id, plan, status, seats_billed,
          storage_blocks, current_period_end, cancel_at_period_end, trial_end, observed_at)
  values (p_org,
          p_mirror ->> 'stripe_customer_id',
          p_mirror ->> 'stripe_subscription_id',
          p_mirror ->> 'plan',
          p_mirror ->> 'status',
          coalesce((p_mirror ->> 'seats_billed')::integer, 0),
          coalesce((p_mirror ->> 'storage_blocks')::integer, 0),
          (p_mirror ->> 'current_period_end')::timestamptz,
          coalesce((p_mirror ->> 'cancel_at_period_end')::boolean, false),
          (p_mirror ->> 'trial_end')::timestamptz,
          coalesce((p_mirror ->> 'observed_at')::timestamptz, now()))
  on conflict (org_id) do update
     set stripe_customer_id     = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
         stripe_subscription_id = excluded.stripe_subscription_id,
         plan                   = excluded.plan,
         status                 = excluded.status,
         seats_billed           = excluded.seats_billed,
         storage_blocks         = excluded.storage_blocks,
         current_period_end     = excluded.current_period_end,
         cancel_at_period_end   = excluded.cancel_at_period_end,
         trial_end              = excluded.trial_end,
         observed_at            = excluded.observed_at;
  return public._org_billing_apply(p_org);
end;
$$;

-- ── 3. A team starts at checkout ────────────────────────────────────────────

-- 0532 create_team's body, for the paid path only: the owner is passed, not
-- auth.uid() (the webhook has none), and the workspaces move in one by one
-- in _team_checkout_complete.
create or replace function public._create_team_for(p_owner uuid, p_name text, p_color text, p_seats integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_org     uuid;
  v_ceiling integer;
begin
  if p_owner is null or public._user_banned(p_owner) then                          -- 0538
    raise exception 'that account can''t own a team' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'a team name is 1 to 60 characters' using errcode = '22023';
  end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'a team colour is #rrggbb' using errcode = '22023';
  end if;
  if p_seats is null or p_seats < 3 then
    raise exception 'a team starts with at least 3 seats' using errcode = '22023';
  end if;
  -- One open team per owner (decision 7); two checkouts can't both make one.
  perform pg_advisory_xact_lock(hashtext('team_create:' || p_owner::text));
  if exists (select 1 from public.organizations o where o.owner_id = p_owner and o.closed_at is null) then
    raise exception 'you already have a team' using errcode = '42501', hint = 'team_exists';
  end if;

  -- organizations_insert_gate (0522) refuses unless teams are open for the owner.
  insert into public.organizations (name, color, owner_id, seats)
  values (v_name, p_color, p_owner, p_seats)
  returning id, seat_ceiling into v_org, v_ceiling;
  if p_seats > v_ceiling then
    raise exception 'more than % seats is a conversation: talk to us', v_ceiling
      using errcode = '42501', hint = 'team_seats_ceiling';
  end if;
  insert into public.org_seat_changes (org_id, delta, seats_after, reason, actor)
  values (v_org, p_seats, p_seats, 'create', p_owner);
  insert into public.org_members (org_id, user_id, role, joined_via)
  values (v_org, p_owner, 'owner', 'create');
  return v_org;
end;
$$;

-- 0538: the client door stays (its grants and its shape), and answers that a
-- team is bought: team-billing's checkout makes it once it is paid for or
-- trialing.
create or replace function public.create_team(p_name text, p_color text default null,
                                              p_workspace_ids uuid[] default '{}', p_seats integer default 3)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'a team starts at checkout' using errcode = '42501', hint = 'team_checkout';
end;
$$;

-- The caller's checkout, checked here before any Stripe call: teams open for
-- them, a name, a plan, no team of theirs yet, their own personal workspaces,
-- and enough seats for everyone who can edit those workspaces, worked out by
-- making the team and moving them in, then undoing it (preview_move_into_team's
-- way, 0532): past the seat ceiling either step refuses with team_seats_ceiling.
-- One trial per owner (S3 decision 1): a trial that made a team counts. A
-- customer made for a checkout that never became a team is reused (team-billing
-- checks Stripe still says it is this owner's); a team's own stays that team's.
-- Paying again (p_org_id), a lapsed team's owner gets no trial and a seat for
-- everyone who holds one (unused seats drop, as at a renewal), on the team's
-- own customer.
create or replace function public.start_team_checkout(p_name text, p_color text, p_workspace_ids uuid[],
                                                      p_seats integer, p_plan text,
                                                      p_end_creator boolean default false,
                                                      p_org_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_ws    uuid[] := '{}';
  v_w     uuid;
  v_org   uuid;
  v_need  integer := 3;
  v_seats integer;
  v_trial boolean := false;
  v_cust  text;
  v_id    uuid;
  o       public.organizations%rowtype;
  v_live  text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._teams_open_for(v_uid) then
    raise exception 'teams are not open yet' using errcode = '42501', hint = 'teams_closed';
  end if;
  if p_plan is null or p_plan not in ('monthly', 'annual') then
    raise exception 'a plan is monthly or annual' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('team_checkout:' || v_uid::text));
  if (select count(*) from public.team_checkouts c
       where c.owner_id = v_uid and c.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many checkouts started today; try again tomorrow'
      using errcode = '42501', hint = 'team_checkout_rate';
  end if;

  if p_org_id is not null then
    select * into o from public.organizations where id = p_org_id and closed_at is null;
    if not found or o.owner_id is distinct from v_uid then
      raise exception 'only the team''s owner can do this' using errcode = '42501', hint = 'team_not_owner';
    end if;
    select s.status, s.stripe_customer_id into v_live, v_cust
      from public.org_subscriptions s where s.org_id = p_org_id;
    if v_live in ('active', 'trialing', 'past_due') then
      raise exception 'this team has a plan: manage it from billing' using errcode = '42501', hint = 'team_has_plan';
    end if;
    insert into public.team_checkouts (owner_id, kind, org_id, name, seats, plan, stripe_customer_id)
    values (v_uid, 'renew', p_org_id, o.name, greatest(3, public._team_seats_used(p_org_id)), p_plan, v_cust)
    returning id, seats into v_id, v_seats;
    return jsonb_build_object('checkout_id', v_id, 'kind', 'renew', 'org_id', p_org_id, 'name', o.name,
                              'seats', v_seats, 'plan', p_plan, 'trial', false, 'customer_id', v_cust);
  end if;

  if exists (select 1 from public.organizations x where x.owner_id = v_uid and x.closed_at is null) then
    raise exception 'you already have a team' using errcode = '42501', hint = 'team_exists';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'a team name is 1 to 60 characters' using errcode = '22023';
  end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'a team colour is #rrggbb' using errcode = '22023';
  end if;
  if p_seats is null or p_seats < 3 then
    raise exception 'a team starts with at least 3 seats' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ws
    from unnest(coalesce(p_workspace_ids, '{}'::uuid[])) x where x is not null;
  foreach v_w in array v_ws loop
    if not exists (select 1 from public.workspaces w
                    where w.id = v_w and w.created_by = v_uid and w.org_id is null) then
      raise exception 'only your own personal workspaces can move into a team'
        using errcode = '42501', hint = 'team_workspace';
    end if;
  end loop;

  begin
    v_org := public._create_team_for(v_uid, v_name, null, p_seats);
    foreach v_w in array v_ws loop
      perform public._org_move_in(v_w, v_org, v_uid, true);
    end loop;
    v_need := greatest(3, public._team_seats_used(v_org));
    raise exception 'preview only' using errcode = 'SLPV0';
  exception when sqlstate 'SLPV0' then
    null;
  end;
  if p_seats < v_need then
    raise exception 'the workspaces you chose have % people who can edit; a team needs a seat for each', v_need
      using errcode = '42501', hint = 'team_seats_needed', detail = v_need::text;
  end if;

  v_trial := not exists (select 1 from public.team_checkouts c
                          where c.owner_id = v_uid and c.trial and c.org_id is not null);
  select c.stripe_customer_id into v_cust
    from public.team_checkouts c
   where c.owner_id = v_uid and c.kind = 'new' and c.org_id is null and c.stripe_customer_id is not null
   order by c.created_at desc limit 1;
  insert into public.team_checkouts (owner_id, kind, name, color, seats, plan, workspace_ids,
                                     end_creator, trial, stripe_customer_id)
  values (v_uid, 'new', v_name, p_color, p_seats, p_plan, v_ws,
          coalesce(p_end_creator, false), v_trial, v_cust)
  returning id into v_id;
  return jsonb_build_object('checkout_id', v_id, 'kind', 'new', 'org_id', null, 'name', v_name,
                            'seats', p_seats, 'seats_needed', v_need, 'plan', p_plan, 'trial', v_trial,
                            'customer_id', v_cust);
end;
$$;

-- Stripe says the checkout is done (the webhook, or the success page through
-- team-billing's verify, whichever is first; the other finds it done and only
-- updates the mirror). The subscription must be active or trialing before a
-- team is made (an unfinished payment waits for the subscription's own event).
-- A new team is made, its workspaces move in one by one (one deleted or given
-- away since checkout stays where it is), and its seats are billed by the
-- checkout itself; a lapsed team takes the seats it paid for. A team that
-- can't be made (the owner has one already, teams closed meanwhile) is a
-- refusal the caller undoes in Stripe: it cancels and refunds. Anything else
-- (a lock wait, a deadlock) raises, so the caller retries.
create or replace function public._team_checkout_complete(p_checkout uuid, p_session text, p_mirror jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c         public.team_checkouts%rowtype;
  v_org     uuid;
  v_ws      uuid;
  v_moved   integer := 0;
  v_skipped integer := 0;
  v_seats   integer;
  v_state   text;
  v_hint    text;
  v_msg     text;
  v_status  text;
  v_sub     text;
begin
  if p_mirror is null or nullif(p_mirror ->> 'stripe_subscription_id', '') is null
     or nullif(p_mirror ->> 'stripe_customer_id', '') is null then
    raise exception 'a team checkout completes with its subscription' using errcode = '22023';
  end if;
  select * into c from public.team_checkouts where id = p_checkout for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_checkout');
  end if;
  if c.stripe_session_id is not null and p_session is not null and p_session <> c.stripe_session_id then
    return jsonb_build_object('ok', false, 'error', 'session_mismatch');
  end if;
  v_org := c.org_id;

  if c.completed_at is null then
    if coalesce(p_mirror ->> 'status', '') not in ('active', 'trialing') then
      return jsonb_build_object('ok', false, 'error', 'not_paid');
    end if;
    if c.kind = 'new' then
      begin
        v_org := public._create_team_for(c.owner_id, c.name, c.color, c.seats);
      exception when others then
        get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_msg = message_text;
        if v_state not in ('42501', '22023') then
          raise;
        end if;
        update public.team_checkouts
           set completed_at = now(), stripe_session_id = coalesce(stripe_session_id, p_session),
               result = jsonb_build_object('error', coalesce(nullif(v_hint, ''), 'create_failed'), 'message', v_msg)
         where id = p_checkout;
        return jsonb_build_object('ok', false, 'error', coalesce(nullif(v_hint, ''), 'create_failed'));
      end;
      update public.org_seat_changes set billed_at = now()
       where org_id = v_org and reason = 'create' and billed_at is null;
      foreach v_ws in array c.workspace_ids loop
        begin
          perform public._org_move_in(v_ws, v_org, c.owner_id, true);
          v_moved := v_moved + 1;
        exception when others then
          get stacked diagnostics v_state = returned_sqlstate;
          if v_state not in ('42501', '22023', 'P0002') then
            raise;
          end if;
          v_skipped := v_skipped + 1;
        end;
      end loop;
      perform public._team_event(c.owner_id, 'team_created', jsonb_build_object(
        'org_id', v_org, 'seats', c.seats, 'plan', c.plan, 'trial', c.trial,
        'workspaces', v_moved, 'skipped', v_skipped));
    else
      select o.seats into v_seats from public.organizations o
       where o.id = v_org and o.closed_at is null for update;
      if not found then
        update public.team_checkouts
           set completed_at = now(), stripe_session_id = coalesce(stripe_session_id, p_session),
               result = jsonb_build_object('error', 'team_closed')
         where id = p_checkout;
        return jsonb_build_object('ok', false, 'error', 'team_closed');
      end if;
      if c.seats <> v_seats then
        perform public._org_add_seats(v_org, c.seats - v_seats, 'checkout', c.owner_id);
      end if;
      update public.org_seat_changes set billed_at = now()
       where org_id = v_org and reason = 'checkout' and billed_at is null;
      perform public._team_event(c.owner_id, 'team_renewed', jsonb_build_object(
        'org_id', v_org, 'seats', c.seats, 'plan', c.plan));
    end if;
    update public.team_checkouts
       set org_id = v_org, completed_at = now(), stripe_session_id = coalesce(stripe_session_id, p_session),
           result = jsonb_build_object('moved', v_moved, 'skipped', v_skipped)
     where id = p_checkout;
  elsif v_org is null then
    return jsonb_build_object('ok', false, 'error', coalesce(c.result ->> 'error', 'create_failed'));
  else
    v_moved := coalesce((c.result ->> 'moved')::integer, 0);
    v_skipped := coalesce((c.result ->> 'skipped')::integer, 0);
  end if;

  v_status := public._team_mirror_upsert(v_org, p_mirror);
  -- The subscription the team's row follows now: another one (a second
  -- checkout paid in another tab) means this one is the caller's to undo.
  select s.stripe_subscription_id into v_sub from public.org_subscriptions s where s.org_id = v_org;
  return jsonb_build_object('ok', true, 'org_id', v_org, 'kind', c.kind,
                            'created', c.completed_at is null and c.kind = 'new',
                            'status', v_status, 'subscription', v_sub,
                            'moved', v_moved, 'skipped', v_skipped);
end;
$$;

-- ── 4. Seats, Stripe and renewals ───────────────────────────────────────────

-- The seat changes a sync has put on Stripe.
create or replace function public._team_mark_seats_billed(p_org uuid, p_upto bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.org_seat_changes set billed_at = now()
   where org_id = p_org and id <= p_upto and billed_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Unused seats drop before a renewal, never below 3 or below the seats in
-- use (design). The sweep calls this inside teamBillingCore's trim window.
create or replace function public._team_trim_seats(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seats  integer;
  v_target integer;
begin
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org::text));
  select o.seats into v_seats from public.organizations o where o.id = p_org and o.closed_at is null;
  if not found then
    return null;
  end if;
  v_target := greatest(3, public._team_seats_used(p_org));
  if v_seats <= v_target then
    return v_seats;
  end if;
  return public._org_add_seats(p_org, v_target - v_seats, 'renewal', null);
end;
$$;

-- An admin buying seats through team-billing's seats_add, priced first: the
-- TOTAL wanted, never a delta, so a retried or double-clicked request can't
-- buy twice. It never lowers the count (remove_team_seat does, 0533), and a
-- view-only team buys nothing until it pays again.
create or replace function public.set_team_seats(p_org_id uuid, p_seats integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_seats   integer;
  v_ceiling integer;
  v_status  text;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can do this' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  if p_seats is null then
    raise exception 'say how many seats the team should have' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('team_seats:' || p_org_id::text));
  select o.seats, o.seat_ceiling, o.status into v_seats, v_ceiling, v_status
    from public.organizations o where o.id = p_org_id and o.closed_at is null;
  if not found then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'this team is view-only until it pays again' using errcode = '42501', hint = 'team_view_only';
  end if;
  if p_seats <= v_seats then
    return v_seats;
  end if;
  if p_seats > v_ceiling then
    raise exception 'more than % seats is a conversation: talk to us', v_ceiling
      using errcode = '42501', hint = 'team_seats_ceiling';
  end if;
  return public._org_add_seats(p_org_id, p_seats - v_seats, 'admin_add', v_uid);
end;
$$;

-- Tell team-billing-cron about one team now. Never breaks the change that
-- called it: the sweep is the net.
create or replace function public._team_billing_poke(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._cron_edge_post('team-billing-cron', jsonb_build_object('org_id', p_org));
exception when others then
  raise warning '_team_billing_poke % failed: %', p_org, sqlerrm;
end;
$$;

-- Every seat change goes to Stripe at once, except the ones whose own path
-- bills them: a checkout's ('create', 'checkout') and an admin's add through
-- team-billing ('admin_add', priced first and synced at the price shown).
create or replace function public._tg_org_seat_changes_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reason not in ('create', 'checkout', 'admin_add') then
    perform public._team_billing_poke(new.org_id);
  end if;
  return null;
end;
$$;

create or replace trigger org_seat_changes_sync
  after insert on public.org_seat_changes
  for each row execute function public._tg_org_seat_changes_sync();

-- A closed team stops paying at once (S3 decision 3).
create or replace function public._tg_organizations_closed_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._team_billing_poke(new.id);
  return null;
end;
$$;

create or replace trigger organizations_closed_sync
  after update of closed_at on public.organizations
  for each row when (old.closed_at is null and new.closed_at is not null)
  execute function public._tg_organizations_closed_sync();

-- ── 5. What the team page reads ─────────────────────────────────────────────

-- The team's plan, for its owner and admins (S4 renders it). Figures only,
-- never a Stripe id.
create or replace function public.get_team_billing(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  o     public.organizations%rowtype;
  s     public.org_subscriptions%rowtype;
begin
  if v_uid is null or not public._actor_active() then
    raise exception 'sign in to do this' using errcode = '42501';
  end if;
  if not public._org_is_admin(p_org_id, v_uid) then
    raise exception 'only the team''s owner or an admin can see its plan' using errcode = '42501',
      hint = case when public._org_role(p_org_id, v_uid) is null then 'team_not_member' else 'team_not_admin' end;
  end if;
  select * into o from public.organizations where id = p_org_id and closed_at is null;
  if not found then
    raise exception 'team not found' using errcode = 'P0002';
  end if;
  select * into s from public.org_subscriptions where org_id = p_org_id;
  return jsonb_build_object(
    'status',                o.status,
    'is_owner',              o.owner_id = v_uid,
    'seats',                 o.seats,
    'seats_used',            public._team_seats_used(p_org_id),
    'seat_ceiling',          o.seat_ceiling,
    'when_full',             o.when_full,
    'auto_monthly_limit',    o.auto_monthly_limit,
    'auto_added_this_month', public._team_auto_added_this_month(p_org_id),
    'first_paid_at',         o.first_paid_at,
    'view_only_since',       o.view_only_since,
    'storage_blocks',        o.storage_blocks,
    'storage_used_bytes',    public._org_storage_used_bytes(p_org_id),
    'storage_quota_bytes',   public._org_storage_quota_bytes(p_org_id),
    'plan',                  s.plan,
    'subscription_status',   s.status,
    'seats_billed',          s.seats_billed,
    'current_period_end',    s.current_period_end,
    'cancel_at_period_end',  coalesce(s.cancel_at_period_end, false),
    'trial_end',             s.trial_end,
    'past_due_since',        s.past_due_since,
    'grace_ends_at',         s.past_due_since + make_interval(days => public._team_grace_days()));
end;
$$;

-- ── 6. The sweep: every 10 minutes, and only while a team exists ────────────

-- Grace runs out on the clock, not on a Stripe event, so the tick applies it
-- here; then, while any team or any team subscription is live, it asks
-- team-billing-cron to sweep (unbilled seat changes, closed teams still
-- billing, trims, stale mirrors, trials about to end). With no team it does
-- nothing at all.
create or replace function public._team_billing_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select s.org_id
             from public.org_subscriptions s
             join public.organizations o on o.id = s.org_id
            where o.closed_at is null
              and (o.status = 'active') <> public._team_entitled(s.status, s.past_due_since) loop
    perform public._org_billing_apply(r.org_id);
  end loop;
  if exists (select 1 from public.organizations o where o.closed_at is null)
     or exists (select 1 from public.org_subscriptions s
                 where s.status in ('active', 'trialing', 'past_due', 'unpaid', 'paused')) then
    perform public._cron_edge_post('team-billing-cron', '{}'::jsonb);
  end if;
end;
$$;

select cron.schedule('team-billing-every-10-min', '*/10 * * * *', 'select public._team_billing_tick()');

-- ── 7. Grants ───────────────────────────────────────────────────────────────

revoke execute on function public._tg_org_subscriptions_guard() from public, anon, authenticated;
revoke execute on function public._team_grace_days() from public, anon, authenticated;
revoke execute on function public._team_entitled(text, timestamptz) from public, anon, authenticated;
revoke execute on function public._org_billing_apply(uuid) from public, anon, authenticated;
revoke execute on function public._team_mirror_upsert(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public._create_team_for(uuid, text, text, integer) from public, anon, authenticated;
revoke execute on function public._team_checkout_complete(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public._team_mark_seats_billed(uuid, bigint) from public, anon, authenticated;
revoke execute on function public._team_trim_seats(uuid) from public, anon, authenticated;
revoke execute on function public._team_billing_poke(uuid) from public, anon, authenticated;
revoke execute on function public._tg_org_seat_changes_sync() from public, anon, authenticated;
revoke execute on function public._tg_organizations_closed_sync() from public, anon, authenticated;
revoke execute on function public._team_billing_tick() from public, anon, authenticated;
-- What team-billing and team-billing-cron call with the service key.
grant execute on function public._team_checkout_complete(uuid, text, jsonb) to service_role;
grant execute on function public._team_mirror_upsert(uuid, jsonb) to service_role;
grant execute on function public._org_billing_apply(uuid) to service_role;
grant execute on function public._team_mark_seats_billed(uuid, bigint) to service_role;
grant execute on function public._team_trim_seats(uuid) to service_role;
grant select, insert, update, delete on public.org_subscriptions to service_role;
grant select, insert, update, delete on public.team_checkouts to service_role;
revoke execute on function public.start_team_checkout(text, text, uuid[], integer, text, boolean, uuid) from public, anon;
grant execute on function public.start_team_checkout(text, text, uuid[], integer, text, boolean, uuid) to authenticated;
revoke execute on function public.get_team_billing(uuid) from public, anon;
grant execute on function public.get_team_billing(uuid) to authenticated;
revoke execute on function public.set_team_seats(uuid, integer) from public, anon;
grant execute on function public.set_team_seats(uuid, integer) to authenticated;

-- ── 8. Proof ────────────────────────────────────────────────────────────────

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public._tg_org_subscriptions_guard()',
    'public._team_grace_days()',
    'public._team_entitled(text,timestamptz)',
    'public._org_billing_apply(uuid)',
    'public._team_mirror_upsert(uuid,jsonb)',
    'public._create_team_for(uuid,text,text,integer)',
    'public._team_checkout_complete(uuid,text,jsonb)',
    'public._team_mark_seats_billed(uuid,bigint)',
    'public._team_trim_seats(uuid)',
    'public._team_billing_poke(uuid)',
    'public._tg_org_seat_changes_sync()',
    'public._tg_organizations_closed_sync()',
    'public._team_billing_tick()'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0538: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public._team_checkout_complete(uuid,text,jsonb)',
    'public._team_mirror_upsert(uuid,jsonb)',
    'public._org_billing_apply(uuid)',
    'public._team_mark_seats_billed(uuid,bigint)',
    'public._team_trim_seats(uuid)',
    -- S2a's, which team-billing-cron calls for the trial notice.
    'public._team_notify(uuid,text,uuid,uuid,uuid,text,text)'] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0538: the billing functions cannot call %', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.start_team_checkout(text,text,uuid[],integer,text,boolean,uuid)',
    'public.get_team_billing(uuid)',
    'public.set_team_seats(uuid,integer)',
    'public.create_team(text,text,uuid[],integer)'] loop
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0538: % is not callable signed in', v_fn;
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0538: % is callable signed out', v_fn;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.org_subscriptions', 'select')
     or has_table_privilege('authenticated', 'public.org_subscriptions', 'select')
     or has_table_privilege('authenticated', 'public.org_subscriptions', 'insert')
     or has_table_privilege('authenticated', 'public.org_subscriptions', 'update')
     or has_table_privilege('anon', 'public.team_checkouts', 'select')
     or has_table_privilege('authenticated', 'public.team_checkouts', 'select')
     or has_table_privilege('authenticated', 'public.team_checkouts', 'insert')
     or has_table_privilege('authenticated', 'public.team_checkouts', 'update') then
    raise exception '0538: a client can reach a billing table';
  end if;
  if not has_table_privilege('service_role', 'public.org_subscriptions', 'select,insert,update')
     or not has_table_privilege('service_role', 'public.team_checkouts', 'select,insert,update') then
    raise exception '0538: the billing functions cannot reach a billing table';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.org_subscriptions'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.team_checkouts'::regclass) then
    raise exception '0538: a billing table has RLS off';
  end if;
  if has_column_privilege('authenticated', 'public.organizations', 'view_only_since', 'update') then
    raise exception '0538: a client can write view_only_since';
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_tg_org_subscriptions_guard', '_team_grace_days', '_team_entitled',
                                  '_org_billing_apply', '_team_mirror_upsert', '_create_team_for',
                                  'create_team', 'start_team_checkout', '_team_checkout_complete',
                                  '_team_mark_seats_billed', '_team_trim_seats', '_team_billing_poke',
                                  '_tg_org_seat_changes_sync', '_tg_organizations_closed_sync',
                                  'get_team_billing', '_team_billing_tick', 'set_team_seats')
              group by p.proname having count(*) > 1) then
    raise exception '0538: an overload exists (PGRST203)';
  end if;

  if not exists (select 1 from cron.job where jobname = 'team-billing-every-10-min') then
    raise exception '0538: the sweep is not scheduled';
  end if;

  -- Applying this changes nothing for anyone: no team exists.
  if exists (select 1 from public.organizations) then
    raise exception '0538: an organization exists';
  end if;
end $$;

commit;
