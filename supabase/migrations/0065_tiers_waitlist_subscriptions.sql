-- 0065_tiers_waitlist_subscriptions.sql — public launch foundation.
--
-- Adds the tier system, waitlist + Stripe subscription tables, and
-- updates can_write_board / share_board to honor the demo tier rules:
--
--   • admin / paid → unchanged behavior (full access)
--   • demo  → can write own boards only (workspace they created); on
--             invited boards they're forced to viewer regardless of
--             their board_shares.role. Can only invite at role='viewer'.
--   • waitlist → can't write anything (defensive — they shouldn't be
--             able to sign in until their entry is accepted, but if a
--             stale session leaks through, no harm done).
--
-- Card cap (100 for demo) is enforced client-side; demo_card_count is
-- a cached counter maintained by triggers on card_index so the UI can
-- read it in one query.

------------------------------------------------------------------
-- 1. PROFILES: tier + card-count cache
------------------------------------------------------------------
alter table public.profiles
  add column if not exists tier text not null default 'demo'
  check (tier in ('admin','paid','demo','waitlist'));

alter table public.profiles
  add column if not exists demo_card_count integer not null default 0;

create index if not exists profiles_tier_idx on public.profiles(tier);

-- Auto-create a profile row on first auth.users insert so tier always
-- has a value when a new account materializes. Existing users without
-- a profile row keep falling back to default 'demo' once a row is
-- created (by getOwnProfile upsert or by this trigger on next signup).
create or replace function public.ensure_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, tier)
  values (new.id, 'demo')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists ensure_profile_for_new_user on auth.users;
create trigger ensure_profile_for_new_user
  after insert on auth.users
  for each row execute function public.ensure_profile_for_new_user();

-- Backfill: every existing auth.users row gets a profile so tier
-- queries don't return null. Pre-existing profiles are untouched.
insert into public.profiles (user_id, tier)
  select id, 'demo' from auth.users
  on conflict (user_id) do nothing;

------------------------------------------------------------------
-- 2. WAITLIST ENTRIES
------------------------------------------------------------------
create table if not exists public.waitlist_entries (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null unique,
  links                jsonb not null default '[]'::jsonb,
  timezone             text,
  status               text not null default 'pending'
                       check (status in ('pending','accepted','rejected','canceled')),
  scheduled_accept_at  timestamptz not null,
  accepted_at          timestamptz,
  rejected_at          timestamptz,
  reviewed_by          uuid references auth.users on delete set null,
  created_at           timestamptz not null default now()
);
create index if not exists waitlist_due_idx
  on public.waitlist_entries(scheduled_accept_at)
  where status = 'pending';

alter table public.waitlist_entries enable row level security;

-- Self can read their own row (matched by email on JWT). Admins read all.
drop policy if exists "waitlist read self" on public.waitlist_entries;
create policy "waitlist read self" on public.waitlist_entries
  for select using (
    lower(coalesce(auth.jwt() ->> 'email', '')) = lower(email)
  );
drop policy if exists "waitlist read admin" on public.waitlist_entries;
create policy "waitlist read admin" on public.waitlist_entries
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.tier = 'admin')
  );
-- No public INSERT policy — inserts go through the submit-waitlist Edge
-- Function using the service role key.

------------------------------------------------------------------
-- 3. SUBSCRIPTIONS (Stripe mirror)
------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                  uuid primary key references auth.users on delete cascade,
  stripe_customer_id       text not null,
  stripe_subscription_id   text,
  plan                     text check (plan in ('monthly','annual')),
  status                   text,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean default false,
  updated_at               timestamptz not null default now()
);
create index if not exists subscriptions_status_idx on public.subscriptions(status);
create index if not exists subscriptions_customer_idx on public.subscriptions(stripe_customer_id);

alter table public.subscriptions enable row level security;
drop policy if exists "subs read self" on public.subscriptions;
create policy "subs read self" on public.subscriptions
  for select using (user_id = auth.uid());
drop policy if exists "subs read admin" on public.subscriptions;
create policy "subs read admin" on public.subscriptions
  for select using (
    exists (select 1 from public.profiles p
            where p.user_id = auth.uid() and p.tier = 'admin')
  );
-- No direct writes; webhook function uses service role.

------------------------------------------------------------------
-- 4. TIER-AWARE can_write_board
-- Replaces the version from 0013. Same signature so existing callers
-- (party/auth.ts, board_state policies, realtime policies) keep working.
--
-- Logic:
--   admin / paid  → original behavior (workspace member OR editor share)
--   demo          → workspace member (their OWN boards) ONLY; editor
--                   shares on other people's boards are downgraded to
--                   viewer effectively
--   waitlist      → false
--   no profile    → treat as 'demo'
------------------------------------------------------------------
create or replace function can_write_board(p_board_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  with recursive t as (
    select coalesce(
      (select tier from public.profiles where user_id = auth.uid()),
      'demo'
    ) as tier
  ),
  chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select case
    when (select tier from t) = 'waitlist' then false
    when (select tier from t) in ('admin','paid') then exists (
      select 1 from chain
      where is_workspace_member(chain.workspace_id)
         or exists (
           select 1 from board_shares s
           where s.board_id = chain.id
             and s.user_id = auth.uid()
             and s.role = 'editor'
         )
    )
    -- demo: own boards only (workspace member); editor shares on other
    -- workspaces don't grant write.
    else exists (
      select 1 from chain
      where is_workspace_member(chain.workspace_id)
    )
  end;
$$;
revoke all on function can_write_board(uuid) from public;
grant execute on function can_write_board(uuid) to authenticated;

------------------------------------------------------------------
-- 5. TIER-AWARE share_board
-- Replaces the version from 0016. Adds:
--   • demo callers can only set role='viewer'
--   • waitlist callers can't share at all
-- Still fires share_notifications on success.
------------------------------------------------------------------
create or replace function share_board(
  p_board_id uuid, p_email text, p_role text
) returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_owner     uuid;
  v_user      uuid;
  v_workspace uuid;
  v_my_tier   text;
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  if v_my_tier = 'demo' and p_role = 'editor' then
    raise exception 'inviting editors is a paid feature; upgrade to invite editors'
      using errcode = '42501';
  end if;

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner
  from workspaces w where w.id = v_workspace;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'only the workspace owner can share boards'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = lower(trim(p_email));
  if v_user is null then
    raise exception 'no user with email %', p_email using errcode = 'P0002';
  end if;
  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());
end;
$$;
revoke all on function share_board(uuid, text, text) from public;
grant execute on function share_board(uuid, text, text) to authenticated;

------------------------------------------------------------------
-- 6. CARD-COUNT MAINTENANCE
-- demo_card_count tracks how many cards across all of a user's owned
-- boards exist in card_index. Triggers maintain it for demo users only
-- (admins/paid don't have a cap so we skip the bookkeeping cost).
--
-- Card_index is the projection table written by syncCardIndex on every
-- snapshot save. It's the right hook because it sees ALL cards via the
-- existing upsert/delete pipeline. The board's owner is identified by
-- boards.created_by.
------------------------------------------------------------------

-- helper: who owns this board (board creator).
create or replace function public.board_owner(p_board_id uuid)
returns uuid language sql stable security definer
set search_path = public as $$
  select created_by from boards where id = p_board_id;
$$;

create or replace function public.bump_demo_card_count_trg()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_tier  text;
begin
  if tg_op = 'INSERT' then
    v_owner := public.board_owner(new.board_id);
    if v_owner is null then return new; end if;
    select tier into v_tier from public.profiles where user_id = v_owner;
    if v_tier = 'demo' then
      update public.profiles
        set demo_card_count = demo_card_count + 1
        where user_id = v_owner;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    v_owner := public.board_owner(old.board_id);
    if v_owner is null then return old; end if;
    select tier into v_tier from public.profiles where user_id = v_owner;
    if v_tier = 'demo' then
      update public.profiles
        set demo_card_count = greatest(0, demo_card_count - 1)
        where user_id = v_owner;
    end if;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists card_index_demo_count_ins on public.card_index;
create trigger card_index_demo_count_ins
  after insert on public.card_index
  for each row execute function public.bump_demo_card_count_trg();

drop trigger if exists card_index_demo_count_del on public.card_index;
create trigger card_index_demo_count_del
  after delete on public.card_index
  for each row execute function public.bump_demo_card_count_trg();

-- One-time backfill: count the cards each user already owns and
-- write the count into their profile. Cheap — card_index is indexed
-- on (board_id) and boards on (id).
update public.profiles p
   set demo_card_count = coalesce(c.cnt, 0)
  from (
    select b.created_by as uid, count(*) as cnt
    from public.card_index ci
    join public.boards b on b.id = ci.board_id
    where b.created_by is not null
    group by b.created_by
  ) c
 where p.user_id = c.uid;

------------------------------------------------------------------
-- 7. RPC: my tier + card count, in one call
-- The client calls this on app boot (and after upgrades) to drive the
-- Upgrade chip + cap-block logic.
------------------------------------------------------------------
create or replace function public.get_my_tier()
returns table(tier text, demo_card_count integer, subscription_status text, current_period_end timestamptz)
language sql stable security definer set search_path = public as $$
  select
    coalesce(p.tier, 'demo')::text,
    coalesce(p.demo_card_count, 0)::integer,
    s.status::text,
    s.current_period_end
  from auth.users u
  left join public.profiles p     on p.user_id = u.id
  left join public.subscriptions s on s.user_id = u.id
  where u.id = auth.uid()
  limit 1;
$$;
revoke all on function public.get_my_tier() from public;
grant execute on function public.get_my_tier() to authenticated;

------------------------------------------------------------------
-- 8. RPC: email status — does this email have an account / waitlist row?
-- Returns 'has_account' | 'on_waitlist' | 'new'.
-- Called by the landing page anonymously to decide the next step.
-- This intentionally leaks account existence to anyone who can guess
-- the email — same as Supabase's built-in signInWithOtp behavior.
------------------------------------------------------------------
create or replace function public.email_status(p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return 'invalid';
  end if;
  if exists (select 1 from auth.users where email = v_email) then
    return 'has_account';
  end if;
  if exists (select 1 from public.waitlist_entries where email = v_email and status = 'pending') then
    return 'on_waitlist';
  end if;
  return 'new';
end;
$$;
revoke all on function public.email_status(text) from public;
grant execute on function public.email_status(text) to anon, authenticated;
