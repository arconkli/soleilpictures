-- Scout — attaching a waitlist signup to the account somebody makes on the web.
--
-- THE FLOW. Scout's bot is not deployed, so /scout takes a number, queues it,
-- and says "you're on the list" — which is honest and terminal. The visitor
-- arrived warm and leaves with nothing to do, while the web app is open to them
-- today (waitlist_enabled is false, so a new signup lands on tier='demo' and
-- walks straight into the canvas). The success state now sends them there, and
-- the number they gave us follows them to the account they make, so when Scout
-- eventually reaches them their photos land in the workspace they already have
-- rather than in a fresh shell.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- A CLAIM IS NOT A BINDING, AND THIS DISTINCTION IS THE WHOLE MIGRATION.
--
-- The obvious implementation — bind scout_identities the moment they create the
-- account — is an account hijack with no authentication in front of it:
--
--     1. I open /scout and type YOUR phone number.
--     2. I create an account with MY email.
--     3. The handle now resolves to me.
--     4. You text Scout. scout_resolve_identity hands your photos to my canvas,
--        and texts you a signed link into MY board.
--
-- Nothing in that sequence requires me to possess your phone, and the person it
-- happens to has no way to notice. So signup records an UNCONFIRMED CLAIM, and
-- the binding waits for the one moment possession is proven: when that number
-- actually texts Scout. The confirmation rides on the message Scout was going
-- to send anyway, so it costs the user one word.
--
-- Everything downstream must keep treating claimed_by_user_id as a request
-- rather than a fact. The moment anything reads it as identity, the hijack is
-- back.
-- ─────────────────────────────────────────────────────────────────────────────

-----------------------------------------------------------------------
-- 1. The claim column.
--
--    DELIBERATELY SEPARATE FROM user_id. `user_id` means "this person texted
--    back and this is their account" — it is set by the ingest pipeline, it
--    requires possession of the phone, and it is what scout_admin_overview
--    counts as `signups_replied`: the only number that means the loop closed.
--    Writing a web signup into it would make the funnel claim people replied
--    who have never sent a message, which is exactly the kind of self-flattery
--    that makes a funnel useless.
-----------------------------------------------------------------------
alter table public.scout_signups
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists claimed_at timestamptz;

comment on column public.scout_signups.claimed_by_user_id is
  'An account that ASKED to be connected to this number, unconfirmed. Proof of '
  'possession happens when the number texts Scout; until then this is a request, '
  'never an identity. Distinct from user_id, which means they actually replied.';

-- The bot looks this up by phone on every first contact.
create index if not exists scout_signups_claimed_idx
  on public.scout_signups (claimed_by_user_id)
  where claimed_by_user_id is not null;

-----------------------------------------------------------------------
-- 2. scout_claim_signup — called by the browser, once, after sign-in.
--
--    UPDATE-ONLY, and that is a security property rather than an optimisation.
--    A row in scout_signups is QUEUE-ELIGIBLE: scout_claim_invites picks up
--    anything with status 'pending' and the bot texts it. If this function
--    could insert, any signed-in user could enqueue an arbitrary stranger's
--    number for us to cold-text — precisely the abuse the queue's per-IP limit
--    and daily cap (0210) exist to prevent, reached by a different door.
--
--    UNIFORM RETURN. It answers the same thing whether or not a row matched,
--    so it cannot be used to ask "is this number on the waitlist?" one number
--    at a time. The caller does not need to know, and the caller is a browser.
--
--    FIRST CLAIM WINS. A number already claimed by someone else is left alone:
--    re-pointing it would let a later signup silently take a pending claim off
--    an earlier one.
-----------------------------------------------------------------------
create or replace function public.scout_claim_signup(p_phone text)
returns void
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return;                       -- unauthenticated: nothing to claim it for
  end if;

  update public.scout_signups
     set claimed_by_user_id = v_user,
         claimed_at         = now(),
         updated_at         = now()
   where phone_e164 = p_phone
     and (claimed_by_user_id is null or claimed_by_user_id = v_user)
     -- A number that has already texted in belongs to whoever proved they hold
     -- it. A web claim must not be able to reach past that.
     and user_id is null;

  -- Recorded whether or not anything matched, because a claim that quietly does
  -- nothing is indistinguishable from one that worked, and the funnel needs to
  -- tell those apart.
  begin
    insert into public.analytics_events (user_id, event, props)
    values (v_user, 'scout_signup_claimed', jsonb_build_object('matched', found));
  exception when others then null;
  end;
end;
$$;
revoke all on function public.scout_claim_signup(text) from public, anon;
grant execute on function public.scout_claim_signup(text) to authenticated;

comment on function public.scout_claim_signup(text) is
  'Attach the caller to a waitlist signup. A REQUEST, not a binding — it grants '
  'no ability to receive that number''s messages. Update-only so it cannot '
  'enqueue a stranger for cold outreach; uniform return so it cannot enumerate.';

-----------------------------------------------------------------------
-- 3. scout_pending_claim — what the bot asks at first contact.
--
--    Returns the account waiting on this handle, if any, WITHOUT binding
--    anything. The bot uses it to decide whether to offer the connection.
-----------------------------------------------------------------------
create or replace function public.scout_pending_claim(p_handle text)
returns table(claimed_by uuid, email text)
language sql stable security definer
set search_path = public, auth as $$
  select s.claimed_by_user_id, u.email
  from public.scout_signups s
  join auth.users u on u.id = s.claimed_by_user_id
  where s.phone_e164 = p_handle
    and s.claimed_by_user_id is not null
    and s.user_id is null
  limit 1;
$$;
revoke all on function public.scout_pending_claim(text) from public, anon, authenticated;

-----------------------------------------------------------------------
-- 4. scout_claim_pending_signup — the YES.
--
--    This is where the claim finally becomes a binding, and the only thing that
--    changed between §2 and here is that a message arrived from the phone. That
--    is the proof, and it is the only proof available without sending a code to
--    a line we do not yet have.
--
--    Returns THE SAME SHAPE as scout_claim_link_code (0213 §6) — user_id,
--    prior_user_id, prior_bin_board_id — so the service's existing linkTo()
--    adoption path runs against it completely unmodified. That function already
--    knows how to carry a shell account's Bin across, in the right order, with
--    scout_mark_adopted only after the move lands. Matching its contract is
--    cheaper and far safer than writing a second adoption.
-----------------------------------------------------------------------
create or replace function public.scout_claim_pending_signup(
  p_platform text,
  p_handle   text,
  p_service  text default null
)
returns table(
  user_id            uuid,
  prior_user_id      uuid,
  prior_bin_board_id uuid
)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_user        uuid;
  v_prior       uuid;
  v_prior_bin   uuid;
  v_prior_shell boolean := false;
begin
  select s.claimed_by_user_id into v_user
    from public.scout_signups s
   where s.phone_e164 = p_handle
     and s.claimed_by_user_id is not null
     and s.user_id is null
   limit 1;

  if v_user is null then
    return;                                  -- zero rows = "nothing claimed"
  end if;

  -- Who held this handle BEFORE the bind below re-points it. Almost always the
  -- shell account minted a moment ago by this very burst.
  select i.user_id into v_prior
    from public.scout_identities i
   where i.platform = p_platform and i.handle = p_handle;

  if v_prior is not null and v_prior <> v_user then
    select coalesce(a.is_shell, false), a.bin_board_id
      into v_prior_shell, v_prior_bin
      from public.scout_accounts a
     where a.user_id = v_prior;
  end if;

  perform public.scout_bind_identity(p_platform, p_handle, v_user, p_service, false);

  -- The loop is closed: they were texted, and they replied. THIS is what
  -- user_id has always meant, and it is only now true.
  update public.scout_signups
     set user_id = v_user, updated_at = now()
   where phone_e164 = p_handle;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (v_user, 'scout_signup_connected',
            jsonb_build_object('platform', p_platform, 'adopting', v_prior_shell));
  exception when others then null;
  end;

  return query select
    v_user,
    case when v_prior_shell then v_prior     else null::uuid end,
    case when v_prior_shell then v_prior_bin else null::uuid end;
end;
$$;
revoke all on function public.scout_claim_pending_signup(text, text, text) from public, anon, authenticated;

-----------------------------------------------------------------------
-- 5. scout_claim_invites — carry the claim out to the drain.
--
--    The invite is the first thing most of these people will ever see from
--    Scout, and "there is already an account waiting for this number" belongs
--    in it rather than in a follow-up. Adding a column to the return type means
--    the signature changes, so the old one has to go first.
-----------------------------------------------------------------------
drop function if exists public.scout_claim_invites(int);

create or replace function public.scout_claim_invites(p_limit int default 5)
returns table (id uuid, phone_e164 text, attempts int, has_claim boolean)
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_daily_max int;
  v_sent_today int;
  v_budget int;
begin
  select coalesce((c.value ->> 'max')::int, 40) into v_daily_max
  from public.app_config c where c.key = 'scout_invite_daily_max';
  v_daily_max := coalesce(v_daily_max, 40);

  select count(*) into v_sent_today
  from public.scout_signups s where s.sent_at > now() - interval '24 hours';

  v_budget := least(greatest(coalesce(p_limit, 5), 0), greatest(v_daily_max - v_sent_today, 0));
  if v_budget <= 0 then
    return;
  end if;

  return query
  with claimed as (
    select s.id
    from public.scout_signups s
    where s.status = 'pending'
      and s.attempts < 3
    order by s.created_at
    limit v_budget
    -- SKIP LOCKED so a second drain process takes different rows rather than
    -- blocking on the first one's transaction.
    for update skip locked
  )
  update public.scout_signups u
     set attempts = u.attempts + 1,
         updated_at = now()
    from claimed
   where u.id = claimed.id
  returning u.id, u.phone_e164, u.attempts, (u.claimed_by_user_id is not null);
end;
$$;
revoke all on function public.scout_claim_invites(int) from public;
revoke all on function public.scout_claim_invites(int) from authenticated, anon;

-----------------------------------------------------------------------
-- 6. scout_my_status — give it a caller, and make it answer.
--
--    Written in 0213 and NEVER CALLED by anything since. It is the natural
--    place to show somebody a pending claim on their account — which matters,
--    because a claim needs to be visible to the person it is attached to. That
--    is the safety valve for §2: an unconfirmed claim you can see is one you
--    can dispute.
--
--    It also could not have served that purpose as written: it selects
--    `from scout_accounts where user_id = auth.uid()`, and somebody who signed
--    up on the web and has never texted Scout has no such row, so it returned
--    zero rows for exactly the people this panel is now for. Restructured to
--    answer for any authenticated caller, with the scout_accounts fields left
--    null when there is no account yet.
-----------------------------------------------------------------------
drop function if exists public.scout_my_status();

create or replace function public.scout_my_status()
returns table(
  is_shell             boolean,
  bin_board_id         uuid,
  handle_masked        text,
  card_count           integer,
  pending_claim_masked text
)
language sql stable security definer
set search_path = public, auth as $$
  select
    coalesce(a.is_shell, false),
    a.bin_board_id,
    -- Last four only. This panel gets opened on shared screens, and the last
    -- four is enough to tell two devices apart.
    (select '••••' || right(i.handle, 4)
       from public.scout_identities i
      where i.user_id = auth.uid()
      order by i.created_at asc
      limit 1),
    (select count(*)::integer
       from public.card_index ci
      where ci.board_id = a.bin_board_id),
    -- A number this account has asked for but not yet proved it holds. Same
    -- masking, same reason.
    (select '••••' || right(s.phone_e164, 4)
       from public.scout_signups s
      where s.claimed_by_user_id = auth.uid()
        and s.user_id is null
      order by s.claimed_at desc nulls last
      limit 1)
  from (select auth.uid() as uid) me
  left join public.scout_accounts a on a.user_id = me.uid
  where me.uid is not null;
$$;
revoke all on function public.scout_my_status() from public, anon;
grant execute on function public.scout_my_status() to authenticated;

comment on function public.scout_my_status() is
  'What a signed-in user may know about their own Scout state, including a '
  'pending unconfirmed claim on a phone number. Answers for any authenticated '
  'caller, including one with no scout_accounts row.';
