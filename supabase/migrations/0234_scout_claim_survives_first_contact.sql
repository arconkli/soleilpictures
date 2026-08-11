-- Scout — a pending claim must survive the shell account that arrives with it.
--
-- FOUND BY RUNNING IT. 0233 made the claim lookups ignore any row whose
-- `user_id` was set, on the reasoning that a number which has already texted in
-- belongs to whoever proved they hold it — a web claim must not reach past that.
-- Correct, and it disabled the entire feature on the first message.
--
-- The sequence, which no amount of reading the two files side by side made
-- obvious:
--
--   1. They text Scout for the first time. resolveOrCreateIdentity mints a
--      SHELL account, because nothing is bound yet — content must land
--      somewhere before any question is asked.
--   2. runBurst fires scout_link_signup_user: "someone we texted has texted
--      back, stamp their user onto the signup row". That has always been right;
--      before claims existed, the shell account WAS their account.
--   3. scout_signups.user_id is now the shell's id, so `user_id is null` is
--      false, so the claim is invisible…
--   4. …and the offer is never made, on the one message where it matters.
--
-- Observed end to end: the welcome went out without the offer, and the "YES"
-- that should have connected the account was ingested as a sticky note instead.
--
-- The fix is to say what was actually meant. "This number has not been claimed
-- by a REAL account yet" — a shell that has not been adopted is the state the
-- offer exists to resolve, not evidence that the question is settled. Both
-- columns keep their meaning and the reply is still counted in the funnel.

create or replace function public.scout_pending_claim(p_handle text)
returns table(claimed_by uuid, email text)
language sql stable security definer
set search_path = public, auth as $$
  select s.claimed_by_user_id, u.email
  from public.scout_signups s
  join auth.users u on u.id = s.claimed_by_user_id
  where s.phone_e164 = p_handle
    and s.claimed_by_user_id is not null
    -- Unanswered, OR answered only by an un-adopted shell — which is exactly
    -- the account this offer exists to replace.
    and (
      s.user_id is null
      or exists (
        select 1 from public.scout_accounts a
         where a.user_id = s.user_id
           and a.is_shell
           and a.adopted_by is null
      )
    )
  limit 1;
$$;
revoke all on function public.scout_pending_claim(text) from public, anon, authenticated;

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
  -- Same predicate as scout_pending_claim, and they must stay identical: an
  -- offer the bot makes and a connection it then refuses to perform is worse
  -- than never offering.
  select s.claimed_by_user_id into v_user
    from public.scout_signups s
   where s.phone_e164 = p_handle
     and s.claimed_by_user_id is not null
     and (
       s.user_id is null
       or exists (
         select 1 from public.scout_accounts a
          where a.user_id = s.user_id and a.is_shell and a.adopted_by is null
       )
     )
   limit 1;

  if v_user is null then
    return;
  end if;

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

  -- Re-point the reply at the REAL account. It already said "they answered";
  -- now it says which of their accounts answered, which is what the column has
  -- always been for.
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

-- scout_claim_signup keeps 0233's stricter `user_id is null`, deliberately.
-- That one is called by a BROWSER, and the question it answers is different:
-- "may this account attach itself to this number?" A number that has already
-- texted anybody — shell or not — is one somebody is demonstrably holding, and
-- a web form is not the place to contest that.
