-- Scout — make binding a handle to a different account actually move it.
--
-- Found by running the two-account scenario against real Postgres while
-- building 0213: claim a code from account B using a handle already bound to
-- account A, and the handle stays on A. 0213's own header asserts the opposite
-- ("binding already re-points scout_identities") — that comment was wrong, and
-- this migration is what makes it true.
--
-- TWO BUGS, both in the same "handle changes hands" path. Neither has ever
-- fired in production: the bot is not deployed and scout_identities is empty.
-- That is the only reason this is a fix and not an incident.
--
--   1. scout_bind_identity's ON CONFLICT (platform, handle) updated
--      last_seen_at and service but NOT user_id. So the one flow whose entire
--      purpose is re-pointing a handle — scout_claim_link_code, "connect the
--      account I already have" — left the handle pointing at the old account.
--      Everything the user texted afterwards kept landing in the account they
--      were trying to leave.
--
--   2. scout_threads is `unique (platform, thread_key)` and
--      scout_set_target_board upserts on that key without touching user_id.
--      scout_resolve_identity joins threads on user_id AND platform AND
--      thread_key, so a thread row left behind on the old account never
--      matches again: "/board Diner Recce" would answer "Switched to Diner
--      Recce" and then quietly keep collecting in the Bin, forever, with no
--      error anywhere. A silent lie is worse than a failure.
--
-- Re-pointing is safe to do unconditionally here. Reaching scout_bind_identity
-- with a claim means possessing BOTH the phone (to send the message) and a
-- live code from inside the target account (to prove it is theirs). Neither
-- alone is enough.

-----------------------------------------------------------------------
-- 1. scout_bind_identity — the handle follows the claim.
--
--    is_shell keeps its 0206 semantics exactly: it only ever clears, never
--    re-arms, so binding a real account over a shell handle cannot demote it.
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
declare
  v_prior uuid;
begin
  select i.user_id into v_prior
    from public.scout_identities i
   where i.platform = p_platform and i.handle = p_handle;

  insert into public.scout_accounts (user_id, is_shell)
  values (p_user_id, p_is_shell)
  on conflict (user_id) do update
    -- Never re-flag a real account as a shell; is_shell only ever clears.
    set is_shell = scout_accounts.is_shell and excluded.is_shell,
        updated_at = now();

  insert into public.scout_identities (platform, handle, user_id, service)
  values (p_platform, p_handle, p_user_id, p_service)
  on conflict (platform, handle) do update
    set user_id      = excluded.user_id,
        last_seen_at = now(),
        service      = coalesce(excluded.service, scout_identities.service);

  -- The handle just changed hands. Any conversation state still filed under the
  -- previous account has to follow it, or the unique (platform, thread_key)
  -- constraint means the new owner can never create their own row for that
  -- thread and their sticky board target silently never applies.
  --
  -- target_board_id is CLEARED rather than carried: it points into the previous
  -- account's workspace, which the new owner most likely cannot write to. New
  -- cards collecting in their own Bin is the correct default, and they can
  -- re-aim with one message. pending_move goes too — it is a half-finished
  -- instruction about boards that are no longer in play.
  if v_prior is not null and v_prior <> p_user_id then
    update public.scout_threads
       set user_id         = p_user_id,
           target_board_id = null,
           pending_move    = null,
           pending_move_at = null,
           updated_at      = now()
     where platform = p_platform
       and user_id  = v_prior;
  end if;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (p_user_id, 'scout_identity_bound',
            jsonb_build_object('platform', p_platform, 'is_shell', p_is_shell,
                               'service', p_service, 'rebound', v_prior is not null and v_prior <> p_user_id));
  exception when others then null;
  end;
end;
$$;
revoke all on function public.scout_bind_identity(text, text, uuid, text, boolean) from public;
revoke all on function public.scout_bind_identity(text, text, uuid, text, boolean) from authenticated, anon;
