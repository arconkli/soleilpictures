-- Soleil Scout — opt-out, crash-safe ingest, a daily ceiling, search, heartbeat.
--
-- Everything here was found by reading the service end to end before its first
-- real message. Scout has never run in production — every scout_* table is
-- empty — so none of this is a migration of live data; it is the set of
-- promises the code makes and the schema could not keep.
--
--   1. STOP actually stops.        The bot answers "stop" with sympathetic copy
--                                  and then carries on exactly as before. There
--                                  is nowhere to record that someone asked.
--   2. A crash stops eating photos. The ingest log marks a message consumed
--                                  BEFORE the work happens, so a crash mid-burst
--                                  turns provider redelivery into a silent drop.
--   3. A daily ceiling exists.     SCOUT_DAILY_INGEST_MAX has been loaded from
--                                  the environment and enforced nowhere. The
--                                  card cap bounds a free account and does not
--                                  bound a paid one at all.
--   4. Search.                     Scout can find a board by name and cannot
--                                  find anything else — including the photos it
--                                  put there itself.
--   5. A heartbeat.                A wedged gRPC stream is indistinguishable
--                                  from a quiet Tuesday.

-----------------------------------------------------------------------
-- 1. OPT-OUT
--
--    `stop`, `unsubscribe`, `remove me` — answers.js has recognised these
--    since the beginning and replies "Understood — I won't send anything
--    unless you text me first", which is a promise about the invite queue that
--    nothing enforces, next to a claim about inbound that is simply not true:
--    the next photo was ingested exactly as before.
--
--    Recorded on the IDENTITY rather than in a list of its own, because the
--    identity is what every inbound message already resolves through — so the
--    check costs nothing and cannot be forgotten by a new call site.
--
--    scout_signups.status = 'blocked' has existed since 0210 and has never been
--    set by anything. This is what sets it: opting out must also mean the
--    invite drain never texts that number again, or the queue re-contacts
--    somebody who explicitly asked it not to.
-----------------------------------------------------------------------
alter table public.scout_identities
  add column if not exists opted_out_at timestamptz;

create or replace function public.scout_set_opt_out(
  p_platform text,
  p_handle   text,
  p_opt_out  boolean default true
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_hit boolean := false;
begin
  update public.scout_identities
     set opted_out_at = case when p_opt_out then now() else null end
   where platform = p_platform and handle = p_handle;
  v_hit := found;

  -- The signup queue keys on the phone number, not on the identity, and a
  -- STOP has to reach it even for someone who never had an identity row —
  -- which is exactly the person the queue is about to text.
  if p_opt_out then
    update public.scout_signups
       set status = 'blocked', updated_at = now()
     where phone_e164 = p_handle and status in ('pending', 'failed');
  else
    update public.scout_signups
       set status = 'pending', updated_at = now()
     where phone_e164 = p_handle and status = 'blocked';
  end if;

  return v_hit;
end;
$$;
revoke all on function public.scout_set_opt_out(text, text, boolean) from public;
revoke all on function public.scout_set_opt_out(text, text, boolean) from authenticated, anon;

comment on function public.scout_set_opt_out(text, text, boolean) is
  'STOP/START. Sets scout_identities.opted_out_at and blocks/unblocks the '
  'matching scout_signups row so the invite drain honours it too.';

-- Surface it on the hot path. Adding a column to the return type means the
-- signature changes, so the old function has to go first.
drop function if exists public.scout_resolve_identity(text, text, text);

create or replace function public.scout_resolve_identity(
  p_platform   text,
  p_handle     text,
  p_thread_key text default null
)
returns table(
  user_id         uuid,
  target_board_id uuid,
  bin_board_id    uuid,
  is_shell        boolean,
  cap_warned_at   timestamptz,
  pending_move    jsonb,
  pending_move_at timestamptz,
  last_move       jsonb,
  last_move_at    timestamptz,
  opted_out_at    timestamptz
)
language sql security definer
set search_path = public, auth as $$
  select i.user_id,
         t.target_board_id,
         a.bin_board_id,
         coalesce(a.is_shell, false),
         a.cap_warned_at,
         t.pending_move,
         t.pending_move_at,
         t.last_move,
         t.last_move_at,
         i.opted_out_at
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

-- The invite drain must not claim a blocked row. 0210's claim already filters
-- on status = 'pending', and scout_set_opt_out moves the row out of 'pending',
-- so this is already correct — asserted here rather than assumed, because the
-- cost of being wrong is texting somebody who said stop.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'scout_claim_invites'
      and pg_get_functiondef(p.oid) not like '%pending%'
  ) then
    raise exception 'scout_claim_invites no longer filters on pending — opt-out would not be honoured';
  end if;
end $$;

-----------------------------------------------------------------------
-- 2. CRASH-SAFE INGEST
--
--    scout_log_ingest inserts the message id and returns "is this new", and
--    the service calls it the moment a message arrives — before the 20-second
--    burst debounce, before the uploads, before anything is written.
--
--    That ordering is right for idempotency and wrong for durability. The
--    service batches in memory on a 512 MB machine that runs sharp and ffmpeg.
--    If it dies mid-burst — OOM, a deploy, a Fly host event — the provider
--    redelivers, every id is already logged, every message is dropped as a
--    duplicate, and the user gets no cards and no error. Their photos are
--    simply gone, and nothing anywhere records that it happened.
--
--    Two-phase fixes it. Arrival CLAIMS; a burst that lands COMPLETES. A claim
--    that was never completed and has gone stale is offered again, so
--    redelivery does what redelivery is for.
--
--    p_stale_minutes is generously longer than the longest possible burst
--    (a 90-second debounce ceiling plus uploads and a transcode) so a SLOW
--    burst is never mistaken for a dead one and processed twice.
-----------------------------------------------------------------------
alter table public.scout_ingest_log
  add column if not exists state text not null default 'done'
    check (state in ('claimed', 'done')),
  add column if not exists claimed_at timestamptz;

-- Existing rows predate the distinction and are all long finished. (There are
-- none — Scout has never run — but a default of 'done' is the safe reading of
-- a row whose fate is unknown: it prefers not re-posting someone's photos.)

-- DROP, not just replace. The new parameter makes this an OVERLOAD rather than
-- a redefinition, and the service calls it with two named arguments — which
-- Postgres then cannot resolve ("function is not unique", 42725). PostgREST
-- returns that as an error, index.js catches it and prefers delivering over
-- dropping, and the result is that idempotency silently stops working: every
-- provider retry double-posts someone's photos. Verified against the live
-- database rather than reasoned about.
drop function if exists public.scout_log_ingest(text, text, uuid);

create or replace function public.scout_log_ingest(
  p_platform       text,
  p_message_id     text,
  p_user_id        uuid default null,
  p_stale_minutes  int default 30
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_claimed boolean;
begin
  insert into public.scout_ingest_log (platform, provider_message_id, user_id, state, claimed_at)
  values (p_platform, p_message_id, p_user_id, 'claimed', now())
  on conflict (platform, provider_message_id) do update
    -- Re-claim ONLY a stale claim that never completed. A 'done' row is a
    -- genuine duplicate delivery and stays refused.
    set claimed_at = now(),
        user_id    = coalesce(public.scout_ingest_log.user_id, excluded.user_id)
    where public.scout_ingest_log.state = 'claimed'
      and public.scout_ingest_log.claimed_at
          < now() - make_interval(mins => greatest(1, coalesce(p_stale_minutes, 30)))
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;
revoke all on function public.scout_log_ingest(text, text, uuid, int) from public;
revoke all on function public.scout_log_ingest(text, text, uuid, int) from authenticated, anon;

create or replace function public.scout_complete_ingest(
  p_platform    text,
  p_message_ids text[],
  p_user_id     uuid default null
)
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_n integer;
begin
  update public.scout_ingest_log
     set state = 'done',
         user_id = coalesce(user_id, p_user_id)
   where platform = p_platform
     and provider_message_id = any(coalesce(p_message_ids, '{}'::text[]));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.scout_complete_ingest(text, text[], uuid) from public;
revoke all on function public.scout_complete_ingest(text, text[], uuid) from authenticated, anon;

comment on function public.scout_complete_ingest(text, text[], uuid) is
  'Marks a burst''s messages durably handled. Until this runs the claim is '
  'stale-recoverable, so a crash mid-burst redelivers instead of dropping.';

-----------------------------------------------------------------------
-- 3. DAILY INGEST CEILING
--
--    Abuse protection, deliberately separate from the card cap. The card cap
--    stops a FREE account at its allowance; a paid account has no card ceiling
--    at all, so without this a texting endpoint has no upper bound on the bytes
--    it will accept and store.
--
--    Counted from the ingest log, which already records every message with a
--    timestamp — no second ledger to keep in step.
-----------------------------------------------------------------------
create or replace function public.scout_daily_ingest_count(p_user_id uuid)
returns integer
language sql stable security definer
set search_path = public, auth as $$
  select coalesce(count(*), 0)::integer
  from public.scout_ingest_log
  where user_id = p_user_id
    and received_at > now() - interval '24 hours';
$$;
revoke all on function public.scout_daily_ingest_count(uuid) from public;
revoke all on function public.scout_daily_ingest_count(uuid) from authenticated, anon;

-- The count is only meaningful if rows carry a user. They have not: the service
-- calls scout_log_ingest before it has resolved an identity, so p_user_id is
-- always null. scout_complete_ingest back-fills it once the burst knows who it
-- was — which is why that function takes a user id at all.
create index if not exists scout_ingest_log_user_recent_idx
  on public.scout_ingest_log (user_id, received_at desc)
  where user_id is not null;

-----------------------------------------------------------------------
-- 4. SEARCH
--
--    Modelled on scout_find_board (0213 §3) down to the ranking, and gated on
--    the same scout_can_write_board predicate — so what Scout will show you and
--    what Scout may write to can never disagree.
--
--    position() rather than LIKE, for the reason 0213 gives: a needle
--    containing % or _ is matched literally instead of as a wildcard. That also
--    means this needs none of the two-layer escaping /api/v1's HTTP-side search
--    requires (worker-api.js:528) — the pattern never becomes a string.
--
--    card_index is searched DIRECTLY and entity_search is not, for the reason
--    documented at worker-api.js:1334: that view unions the workspace user
--    directory, whose body column carries member EMAIL ADDRESSES. Searching it
--    from a bot anyone can text would be an email-harvesting endpoint.
-----------------------------------------------------------------------
create or replace function public.scout_search(
  p_user_id uuid,
  p_query   text,
  p_limit   int default 20
)
returns table(
  board_id   uuid,
  board_name text,
  card_id    text,
  kind       text,
  title      text,
  excerpt    text,
  card_src   text,
  updated_at timestamptz
)
language sql stable security definer
set search_path = public, auth as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as needle),
  hits as (
    select ci.board_id, b.name as board_name, ci.card_id, ci.kind,
           ci.title, ci.body, ci.meta, ci.updated_at,
           case
             when lower(coalesce(ci.title, '')) = (select needle from q) then 0
             when position((select needle from q) in lower(coalesce(ci.title, ''))) > 0 then 1
             else 2
           end as rank
    from public.card_index ci
    join public.boards b on b.id = ci.board_id and b.deleted_at is null
    where (select needle from q) <> ''
      and (position((select needle from q) in lower(coalesce(ci.title, ''))) > 0
        or position((select needle from q) in lower(coalesce(ci.body, ''))) > 0)
  )
  select h.board_id, h.board_name, h.card_id, h.kind,
         nullif(h.title, ''),
         -- Enough to recognise a hit, never the whole card. A search that
         -- returns full bodies is a search that cannot be read in a text
         -- message.
         nullif(left(coalesce(h.body, ''), 160), ''),
         h.meta ->> 'src',
         h.updated_at
  from hits h
  where public.scout_can_write_board(h.board_id, p_user_id)
  order by h.rank asc, h.updated_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
revoke all on function public.scout_search(uuid, text, int) from public;
revoke all on function public.scout_search(uuid, text, int) from authenticated, anon;

comment on function public.scout_search(uuid, text, int) is
  'Explicit-user card search for the bot. Mirrors scout_find_board''s ranking '
  'and authorization; deliberately reads card_index and NOT entity_search, '
  'which carries member email addresses.';

-----------------------------------------------------------------------
-- 5. HEARTBEAT
--
--    index.js turns the message stream ENDING into a non-zero exit, which the
--    supervisor restarts. It cannot do anything about the stream that stays
--    open and stops delivering: the process looks perfectly healthy, the logs
--    stay quiet, and every photo anyone sends is silently ignored. That is the
--    failure mode the file's own closing comment calls the worst possible one,
--    and it is the one still uncovered.
--
--    A row that says when the bot was last definitely alive is the whole fix.
--    Nothing pages on it; the admin surface reads it, and a human can see in
--    one glance whether the bot is there.
-----------------------------------------------------------------------
create table if not exists public.scout_health (
  id            boolean primary key default true check (id),
  last_seen_at  timestamptz not null default now(),
  version       text,
  detail        jsonb not null default '{}'::jsonb
);
alter table public.scout_health enable row level security;
-- Deliberately NO policies: service_role writes it, the admin RPC reads it.

create or replace function public.scout_heartbeat(
  p_version text default null,
  p_detail  jsonb default '{}'::jsonb
)
returns void
language sql security definer
set search_path = public, auth as $$
  insert into public.scout_health (id, last_seen_at, version, detail)
  values (true, now(), p_version, coalesce(p_detail, '{}'::jsonb))
  on conflict (id) do update
    set last_seen_at = now(), version = excluded.version, detail = excluded.detail;
$$;
revoke all on function public.scout_heartbeat(text, jsonb) from public;
revoke all on function public.scout_heartbeat(text, jsonb) from authenticated, anon;

-----------------------------------------------------------------------
-- 6. ADMIN READ
--
--    One RPC rather than select policies, for the reason 0213 §4 gives about
--    scout_accounts: that table holds `refresh_token` — a live user session for
--    the headless Yjs peer — and Supabase grants ALL on every public table to
--    authenticated by default, so a policy added for one column exposes every
--    column added later. RLS-with-no-policies stays the posture and a function
--    that names its columns is the only door.
--
--    Handles are NOT returned. An admin needs to know the bot is alive and how
--    many people are using it, not who they are.
-----------------------------------------------------------------------
create or replace function public.scout_admin_overview()
returns table(
  last_seen_at     timestamptz,
  version          text,
  identities       integer,
  shell_accounts   integer,
  opted_out        integer,
  signups_pending  integer,
  signups_sent     integer,
  signups_failed   integer,
  signups_blocked  integer,
  signups_replied  integer,
  ingest_24h       integer,
  ingest_claimed   integer,
  bin_cards_24h    integer
)
language plpgsql stable security definer
set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  return query
  select
    (select h.last_seen_at from public.scout_health h where h.id),
    (select h.version      from public.scout_health h where h.id),
    (select count(*)::integer from public.scout_identities),
    (select count(*)::integer from public.scout_accounts where is_shell),
    (select count(*)::integer from public.scout_identities where opted_out_at is not null),
    (select count(*)::integer from public.scout_signups where status = 'pending'),
    (select count(*)::integer from public.scout_signups where status = 'sent'),
    (select count(*)::integer from public.scout_signups where status = 'failed'),
    (select count(*)::integer from public.scout_signups where status = 'blocked'),
    (select count(*)::integer from public.scout_signups where user_id is not null),
    (select count(*)::integer from public.scout_ingest_log
      where received_at > now() - interval '24 hours'),
    -- Claims that never completed and are past any plausible burst. A number
    -- above zero here is the signature of the crash-mid-burst failure above.
    (select count(*)::integer from public.scout_ingest_log
      where state = 'claimed' and claimed_at < now() - interval '30 minutes'),
    -- Cards sitting in Scout Bins that moved in the last day. card_index has
    -- only `updated_at`, so this is "touched", not "created" — close enough to
    -- answer "is anything arriving", which is the only question being asked.
    (select count(*)::integer from public.card_index ci
      join public.scout_accounts a on a.bin_board_id = ci.board_id
      where ci.updated_at > now() - interval '24 hours');
end;
$$;
revoke all on function public.scout_admin_overview() from public, anon;
grant execute on function public.scout_admin_overview() to authenticated;
