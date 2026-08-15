-- Lifecycle email — a resume link, because the win-back CTA has been dropping
-- everyone at a sign-in wall.
--
-- Measured over the program's first seven weeks: it opened at ~40% and clicked
-- at ~2.9%, and the number of readers who ever reached the app was single
-- digits — as was the number who did any work within 72h. Deliverability is
-- fine and the subject lines work; everything dies after the open.
--
-- The leading suspect is the sign-in wall, and it is worth being precise about
-- how well established that is, because a previous pass looked at it and
-- recorded it as ruled out.
--
-- What is certain: win-back recipients average 27 days since their last
-- sign-in, every one is more than 7 days stale, a third more than 30. The email
-- has been admitting the consequence in small grey text under the button:
-- "signed out? we'll email you a 6-digit code" — click, return to the inbox,
-- find a second email, copy a code, paste it, all asked of someone already
-- indifferent enough to go dormant.
--
-- What is NOT certain is how often that path is actually taken. An auth.sessions
-- row predating the send exists for ~96% of recipients, which is what the
-- earlier pass measured and read as "clicks land in the app". But `not_after` is
-- null on all of them, so the row's existence carries no validity information,
-- and ~94% had not been refreshed in the week before the send. Neither figure
-- answers the real question, which is whether the BROWSER opening the email
-- holds a usable session — mail is routinely read on a different device from
-- the one that signed up, where there is no local session at all.
--
-- So this is a hypothesis the data is consistent with, not a proven cause. The
-- honest position is that nobody could tell, because a signed-out arrival was
-- recorded nowhere (see section 4). lifecycle_land{signed_in} now settles it
-- either way, and the resume link is worth having under both answers: it costs
-- a signed-in reader one button press and removes the wall as a variable. `nudge_dormant_early`, the highest-volume type, produced zero
-- units of work across its entire life.
--
-- So: a single-use token in the CTA that mints a real session on arrival.
--
-- Why a token of our own rather than a bare Supabase magic link in the email:
-- Resend rewrites every CTA through its own tracking host, and inbox scanners
-- prefetch links. A magic link is consumed by whoever GETs it first, so the
-- scanner burns it and the human gets an error. Redemption here happens on an
-- explicit POST from a button on /resume — a GET is inert, and prefetch cannot
-- spend the token.
--
-- The tradeoff, stated plainly: for 7 days the email is a bearer credential for
-- one account. That is already true of every OTP mail we send, and this one is
-- narrower — one user, one use, expires, and revoked the moment it is spent.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. The tokens. Service-role only, exactly like email_unsub_tokens (0173) and
--    for the same reason: the "ws-mate read profile" policy (0030) plus the
--    table grant (0091) mean anything reachable from profiles is readable by a
--    workspace co-member, and this is a credential.
--
--    Only the SHA-256 hash is stored. The raw value exists in exactly two
--    places — the response to the mint call, and the email. A dump of this
--    table grants nothing.
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.email_resume_tokens (
  id         bigserial primary key,
  user_id    uuid not null references auth.users on delete cascade,
  token_hash text not null unique,
  email_type text not null,
  log_id     bigint references public.lifecycle_email_log(id) on delete set null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.email_resume_tokens enable row level security;
revoke all on public.email_resume_tokens from anon, authenticated;  -- no policy => service_role only
revoke all on sequence public.email_resume_tokens_id_seq from anon, authenticated;

create index if not exists email_resume_tokens_user_idx on public.email_resume_tokens (user_id, created_at desc);
-- Redemption reads by hash and must not be able to spend an expired row.
create index if not exists email_resume_tokens_live_idx on public.email_resume_tokens (token_hash)
  where used_at is null;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Mint. Called by lifecycle-email-cron AFTER lifecycle_claim_send has
--    returned a log id and BEFORE the send goes out — never the other way
--    round. A token stored for a mail that then fails to send is inert (nobody
--    ever received the raw value, and it expires); a mail sent carrying a token
--    we failed to store would be a dead link in someone's inbox.
--
--    Returns the RAW token. This is the only time it exists outside the email.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_mint_resume_token(
  p_user_id uuid, p_email_type text, p_log_id bigint default null, p_ttl_days int default 7
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_raw text;
begin
  -- 256 bits, hex. Same shape as the unsub token.
  v_raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.email_resume_tokens (user_id, token_hash, email_type, log_id, expires_at)
  values (
    p_user_id,
    encode(extensions.digest(v_raw, 'sha256'), 'hex'),
    p_email_type,
    p_log_id,
    now() + make_interval(days => greatest(1, least(p_ttl_days, 30)))
  );
  return v_raw;
end $$;
revoke all on function public.lifecycle_mint_resume_token(uuid, text, bigint, int) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Redeem. Single-use is enforced HERE, in one statement, not by a read
--    followed by a write — two clicks racing from the same inbox must not both
--    win. The `used_at is null` predicate lives inside the UPDATE, so exactly
--    one of them updates a row and the other gets nothing back.
--
--    Returns the user's email so the caller can hand it to
--    auth.admin.generateLink. Returns no rows for unknown, expired or already
--    spent tokens — the caller cannot tell those apart, and shouldn't.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.lifecycle_redeem_resume_token(p_token text)
returns table(user_id uuid, email text, email_type text)
language plpgsql security definer set search_path = public, auth as $$
begin
  return query
  with spent as (
    update public.email_resume_tokens t
       set used_at = now()
     where t.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
       and t.used_at is null
       and t.expires_at > now()
    returning t.user_id, t.email_type
  )
  select s.user_id, u.email::text, s.email_type
  from spent s join auth.users u on u.id = s.user_id;
end $$;
revoke all on function public.lifecycle_redeem_resume_token(text) from public, anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. The funnel, end to end and in one place.
--
--    admin_email_hour_stats (0212) already reports `landed`, but it joins the
--    landing to the send by user_id — and the arrivals that matter most have no
--    user_id at all. A dormant click lands SIGNED OUT; analytics_events records
--    it anonymously; the join drops it. That RPC therefore cannot see the
--    population this whole change exists to rescue, and is left alone here
--    (its per-hour question is a different one).
--
--    Signed-out landings can only be counted in aggregate, by email_type off
--    the ?lc= param — there is no user to attribute them to, by construction.
--    `resumed` does NOT have that problem: it is read from email_resume_tokens,
--    server-side truth, immune to ad-blockers and client analytics entirely.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.admin_lifecycle_funnel(p_days int default 60)
returns table(email_type text, sent bigint, delivered bigint, opened bigint,
              clicked bigint, landed_signed_in bigint, landed_signed_out bigint,
              resumed bigint, worked_72h bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_admin();
  return query
  with sends as (
    select l.email_type, l.user_id, l.sent_at, es.delivered_at, es.opened_at, es.clicked_at
    from public.lifecycle_email_log l
    left join public.email_sends es on es.resend_id = l.resend_id
    where l.status = 'sent' and l.sent_at >= now() - make_interval(days => p_days)
  ),
  per_type as (
    select s.email_type,
           count(*)                                            as sent,
           count(*) filter (where s.delivered_at is not null)  as delivered,
           count(*) filter (where s.opened_at    is not null)  as opened,
           count(*) filter (where s.clicked_at   is not null)  as clicked,
           count(*) filter (where exists (
             select 1 from public.analytics_events a
             where a.user_id = s.user_id
               and a.event in ('card_placed','card_edit','doc_edit')
               and a.occurred_at >  s.sent_at
               and a.occurred_at <= s.sent_at + interval '72 hours')) as worked_72h
    from sends s group by 1
  ),
  -- Aggregate, not per-send: a signed-out arrival carries no user id.
  --
  -- Both filters test the prop EXPLICITLY, so the handful of landings recorded
  -- before signed_in existed fall into neither bucket rather than silently
  -- inflating one. Those legacy rows could only be written while signed in
  -- (the event was gated on a user id until 2026-08-14), so counting a missing
  -- prop as signed-out would state the exact opposite of what happened.
  lands as (
    select a.props->>'email_type' as email_type,
           count(*) filter (where (a.props->>'signed_in')::boolean is true)  as landed_signed_in,
           count(*) filter (where (a.props->>'signed_in')::boolean is false) as landed_signed_out
    from public.analytics_events a
    where a.event = 'lifecycle_land'
      and a.occurred_at >= now() - make_interval(days => p_days)
    group by 1
  ),
  resumes as (
    select t.email_type, count(*) as resumed
    from public.email_resume_tokens t
    where t.used_at is not null and t.used_at >= now() - make_interval(days => p_days)
    group by 1
  )
  select p.email_type, p.sent, p.delivered, p.opened, p.clicked,
         coalesce(l.landed_signed_in, 0), coalesce(l.landed_signed_out, 0),
         coalesce(r.resumed, 0), p.worked_72h
  from per_type p
  left join lands   l on l.email_type = p.email_type
  left join resumes r on r.email_type = p.email_type
  order by p.sent desc;
end $$;
revoke all on function public.admin_lifecycle_funnel(int) from public, anon;
grant execute on function public.admin_lifecycle_funnel(int) to authenticated;
