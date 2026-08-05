-- Soleil Scout — zero-UI ingest bot: identity, thread state, link codes, idempotency.
--
-- Scout lets someone text photos/links/notes to a bot and have them land on a
-- Clusters canvas, with the account materializing behind them. That means two
-- things this schema has to support that nothing else in the product does:
--
--   1. A user who exists BEFORE they have a real email. The Worker mints a
--      shell auth.users row with a synthetic address; `scout_accounts.is_shell`
--      marks it so the app knows to ask for a real email once they're hooked.
--   2. A SERVER writing cards on a user's behalf. The headless Yjs peer needs a
--      genuine Supabase user JWT (party/auth.ts validates via PostgREST + RLS,
--      so the service key is useless there) — hence the cached refresh token.
--
-- Security posture: everything an end user must never read — refresh tokens,
-- link codes, the ingest log — lives in tables with RLS ENABLED and NO POLICIES.
-- That denies authenticated/anon outright while service_role bypasses RLS. The
-- two tables users legitimately read (their own identities and threads) get a
-- narrow self-select policy and nothing else; all writes go through RPCs.

-----------------------------------------------------------------------
-- 1. scout_accounts — per-user Scout state. Service-role only.
--    Holds the cached session used by the headless Yjs peer, so it must
--    never be readable by an end user.
-----------------------------------------------------------------------
create table if not exists public.scout_accounts (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  -- true until the user attaches a real email. Every website account must end
  -- up with a real address (sharing/invites depend on it), so this is a debt
  -- marker, not a permanent state.
  is_shell          boolean not null default true,
  -- One-time 75%-of-cap nudge. Per USER, not per thread, so someone connected
  -- on two channels still only gets warned once.
  cap_warned_at     timestamptz,
  -- Supabase session for the headless PartyKit peer. Refresh tokens rotate;
  -- the Worker rewrites this row on every refresh.
  refresh_token     text,
  access_token_exp  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.scout_accounts enable row level security;
-- Deliberately NO policies: service_role bypasses RLS, everyone else is denied.

-----------------------------------------------------------------------
-- 2. scout_identities — (platform, handle) → user. The routing table.
--    `handle` is normalized by the Worker before it gets here: E.164 for
--    phone numbers, lowercased for Apple ID / email handles.
-----------------------------------------------------------------------
create table if not exists public.scout_identities (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null check (platform in ('imessage','sms','rcs','telegram','whatsapp','discord')),
  handle        text not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- What Photon reported for this handle: iMessage | SMS | RCS | unknown.
  -- Drives fidelity expectations, not routing.
  service       text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (platform, handle)
);
create index if not exists scout_identities_user_idx on public.scout_identities(user_id);
alter table public.scout_identities enable row level security;

drop policy if exists scout_identities_self_read on public.scout_identities;
create policy scout_identities_self_read on public.scout_identities
  for select using (user_id = auth.uid());

-----------------------------------------------------------------------
-- 3. scout_threads — per-conversation state. The sticky board target is
--    what makes "ok put these in the diner board" persist across messages
--    instead of needing to be repeated.
-----------------------------------------------------------------------
create table if not exists public.scout_threads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  platform        text not null,
  thread_key      text not null,
  -- null = the user's Scout Inbox (resolved at ingest time, so a deleted
  -- board falls back gracefully instead of dead-ending).
  target_board_id uuid references public.boards(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (platform, thread_key)
);
create index if not exists scout_threads_user_idx on public.scout_threads(user_id);
alter table public.scout_threads enable row level security;

drop policy if exists scout_threads_self_read on public.scout_threads;
create policy scout_threads_self_read on public.scout_threads
  for select using (user_id = auth.uid());

-----------------------------------------------------------------------
-- 4. scout_link_codes — short-lived codes for the in-app "Connect" button.
--    Signed-in user mints one, texts it to the bot, bot binds the handle.
--    Mirrors pending_invites (0086). Service-role only: minting and claiming
--    both go through RPCs, so nothing needs direct table access.
-----------------------------------------------------------------------
create table if not exists public.scout_link_codes (
  code        text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  claimed_at  timestamptz,
  claimed_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists scout_link_codes_user_idx on public.scout_link_codes(user_id);
alter table public.scout_link_codes enable row level security;
-- Deliberately NO policies.

-----------------------------------------------------------------------
-- 5. scout_ingest_log — idempotency. Providers retry webhooks; without this
--    a retry double-posts someone's photos onto their canvas.
-----------------------------------------------------------------------
create table if not exists public.scout_ingest_log (
  platform             text not null,
  provider_message_id  text not null,
  user_id              uuid references auth.users(id) on delete set null,
  received_at          timestamptz not null default now(),
  primary key (platform, provider_message_id)
);
create index if not exists scout_ingest_log_received_idx on public.scout_ingest_log(received_at desc);
alter table public.scout_ingest_log enable row level security;
-- Deliberately NO policies.

-----------------------------------------------------------------------
-- 6. scout_resolve_identity — the hot path, called on every inbound message.
--    Pure lookup: account creation needs auth.admin.createUser, which only the
--    Worker can do. Returns an empty set for an unknown handle, which is the
--    Worker's signal to mint a shell account and call scout_bind_identity.
-----------------------------------------------------------------------
create or replace function public.scout_resolve_identity(
  p_platform   text,
  p_handle     text,
  p_thread_key text default null
)
returns table(
  user_id         uuid,
  target_board_id uuid,
  is_shell        boolean,
  cap_warned_at   timestamptz
)
language sql security definer
set search_path = public, auth as $$
  select i.user_id,
         t.target_board_id,
         coalesce(a.is_shell, false),
         a.cap_warned_at
  from public.scout_identities i
  left join public.scout_accounts a on a.user_id = i.user_id
  -- Match the exact thread: a user can hold several conversations on one
  -- platform, and joining on platform alone would pick an arbitrary board.
  left join public.scout_threads  t on t.user_id = i.user_id
                                   and t.platform = p_platform
                                   and t.thread_key is not distinct from p_thread_key
  where i.platform = p_platform and i.handle = p_handle
  limit 1;
$$;
revoke all on function public.scout_resolve_identity(text, text, text) from public;
revoke all on function public.scout_resolve_identity(text, text, text) from authenticated, anon;

-----------------------------------------------------------------------
-- 7. scout_bind_identity — attach a chat handle to a Soleil user. Used for
--    a freshly minted shell account AND for linking an existing account.
--    Idempotent: re-binding the same handle just refreshes last_seen_at.
-----------------------------------------------------------------------
create or replace function public.scout_bind_identity(
  p_platform text,
  p_handle   text,
  p_user_id  uuid,
  p_service  text default null,
  p_is_shell boolean default false
)
returns void
language plpgsql security definer
set search_path = public, auth as $$
begin
  insert into public.scout_accounts (user_id, is_shell)
  values (p_user_id, p_is_shell)
  on conflict (user_id) do update
    -- Never re-flag a real account as a shell; is_shell only ever clears.
    set is_shell = scout_accounts.is_shell and excluded.is_shell,
        updated_at = now();

  insert into public.scout_identities (platform, handle, user_id, service)
  values (p_platform, p_handle, p_user_id, p_service)
  on conflict (platform, handle) do update
    set last_seen_at = now(),
        service = coalesce(excluded.service, scout_identities.service);

  begin
    insert into public.analytics_events (user_id, event, props)
    values (p_user_id, 'scout_identity_bound',
            jsonb_build_object('platform', p_platform, 'is_shell', p_is_shell, 'service', p_service));
  exception when others then null;
  end;
end;
$$;
revoke all on function public.scout_bind_identity(text, text, uuid, text, boolean) from public;
revoke all on function public.scout_bind_identity(text, text, uuid, text, boolean) from authenticated, anon;

-----------------------------------------------------------------------
-- 8. scout_set_target_board — "put these in the diner board". Sticky until
--    changed. Verifies the board is actually writable by that user so a
--    thread can never be pointed at someone else's canvas.
-----------------------------------------------------------------------
create or replace function public.scout_set_target_board(
  p_user_id    uuid,
  p_platform   text,
  p_thread_key text,
  p_board_id   uuid
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_ok boolean := false;
begin
  if p_board_id is not null then
    select exists (
      select 1
      from public.boards b
      join public.workspaces w on w.id = b.workspace_id
      left join public.board_shares bs on bs.board_id = b.id and bs.user_id = p_user_id
      where b.id = p_board_id
        and b.deleted_at is null
        and (w.created_by = p_user_id or bs.role in ('editor','owner'))
    ) into v_ok;
    if not v_ok then
      return false;
    end if;
  end if;

  insert into public.scout_threads (user_id, platform, thread_key, target_board_id)
  values (p_user_id, p_platform, p_thread_key, p_board_id)
  on conflict (platform, thread_key) do update
    set target_board_id = excluded.target_board_id,
        updated_at = now();

  begin
    insert into public.analytics_events (user_id, event, props)
    values (p_user_id, 'scout_target_board_set',
            jsonb_build_object('platform', p_platform, 'board_id', p_board_id));
  exception when others then null;
  end;

  return true;
end;
$$;
revoke all on function public.scout_set_target_board(uuid, text, text, uuid) from public;
revoke all on function public.scout_set_target_board(uuid, text, text, uuid) from authenticated, anon;

-----------------------------------------------------------------------
-- 9. scout_create_link_code — the in-app "Connect" button. Called BY the
--    signed-in user, so this is the one RPC granted to authenticated.
--    Reuse-before-mint (same idea as create_collab_link, 0189) so hammering
--    the button doesn't litter the table.
-----------------------------------------------------------------------
create or replace function public.scout_create_link_code(p_ttl_minutes int default 15)
returns text
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  select code into v_code
  from public.scout_link_codes
  where user_id = auth.uid() and claimed_at is null and expires_at > now() + interval '2 minutes'
  order by created_at desc
  limit 1;
  if found then
    return v_code;
  end if;

  -- 8 chars, unambiguous alphabet (no O/0/I/1) — this gets read off a screen
  -- and typed into a text message.
  loop
    v_code := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                               (floor(random() * 32) + 1)::int, 1), '')
      from generate_series(1, 8)
    );
    exit when not exists (select 1 from public.scout_link_codes where code = v_code);
  end loop;

  insert into public.scout_link_codes (code, user_id, expires_at)
  values (v_code, auth.uid(), now() + make_interval(mins => greatest(1, least(p_ttl_minutes, 60))));

  return v_code;
end;
$$;
revoke all on function public.scout_create_link_code(int) from public;
grant execute on function public.scout_create_link_code(int) to authenticated;

-----------------------------------------------------------------------
-- 10. scout_claim_link_code — bot side of the same flow. Single-use, and it
--     binds the handle in the same transaction so a race can't attach one
--     code to two handles.
-----------------------------------------------------------------------
create or replace function public.scout_claim_link_code(
  p_code     text,
  p_platform text,
  p_handle   text,
  p_service  text default null
)
returns uuid
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_user uuid;
begin
  update public.scout_link_codes
     set claimed_at = now(), claimed_by = p_handle
   where code = upper(btrim(p_code))
     and claimed_at is null
     and expires_at > now()
  returning user_id into v_user;

  if v_user is null then
    return null;
  end if;

  perform public.scout_bind_identity(p_platform, p_handle, v_user, p_service, false);

  begin
    insert into public.analytics_events (user_id, event, props)
    values (v_user, 'scout_link_code_claimed', jsonb_build_object('platform', p_platform));
  exception when others then null;
  end;

  return v_user;
end;
$$;
revoke all on function public.scout_claim_link_code(text, text, text, text) from public;
revoke all on function public.scout_claim_link_code(text, text, text, text) from authenticated, anon;

-----------------------------------------------------------------------
-- 11. scout_log_ingest — idempotency gate. Returns TRUE if this is the first
--     time we've seen the provider's message id, FALSE if it's a retry.
--     Call before doing any work.
-----------------------------------------------------------------------
create or replace function public.scout_log_ingest(
  p_platform   text,
  p_message_id text,
  p_user_id    uuid default null
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
begin
  insert into public.scout_ingest_log (platform, provider_message_id, user_id)
  values (p_platform, p_message_id, p_user_id)
  on conflict (platform, provider_message_id) do nothing;
  return found;
end;
$$;
revoke all on function public.scout_log_ingest(text, text, uuid) from public;
revoke all on function public.scout_log_ingest(text, text, uuid) from authenticated, anon;

-----------------------------------------------------------------------
-- 12. scout_mark_cap_warned — makes the 75% nudge fire exactly once.
-----------------------------------------------------------------------
create or replace function public.scout_mark_cap_warned(p_user_id uuid)
returns void
language sql security definer
set search_path = public, auth as $$
  update public.scout_accounts set cap_warned_at = now(), updated_at = now()
  where user_id = p_user_id and cap_warned_at is null;
$$;
revoke all on function public.scout_mark_cap_warned(uuid) from public;
revoke all on function public.scout_mark_cap_warned(uuid) from authenticated, anon;

-----------------------------------------------------------------------
-- 13. Signing secret for instant-session deep links (/s/<token>). Same shape
--     as email_thumb_hmac (0186): a 32-byte hex secret in app_config, read by
--     the Worker with the service key and cached in module scope.
-----------------------------------------------------------------------
insert into public.app_config (key, value)
values ('scout_session_hmac', jsonb_build_object('secret', encode(gen_random_bytes(32), 'hex')))
on conflict (key) do nothing;

-----------------------------------------------------------------------
-- 14. Retention — the ingest log is pure idempotency bookkeeping. Providers
--     retry within minutes, so 30 days is generous. Wired into the existing
--     nightly purge cron alongside purge_old_analytics_events (0107).
-----------------------------------------------------------------------
create or replace function public.purge_old_scout_ingest_log(p_retention_days int default 30)
returns integer
language plpgsql security definer
set search_path = public as $$
declare
  v_deleted integer;
begin
  delete from public.scout_ingest_log
  where received_at < now() - make_interval(days => greatest(1, p_retention_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.purge_old_scout_ingest_log(int) from public;
revoke all on function public.purge_old_scout_ingest_log(int) from authenticated, anon;
