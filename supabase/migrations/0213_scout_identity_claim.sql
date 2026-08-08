-- Soleil Scout — making the bot work with accounts and boards that already exist.
--
-- 0206 shipped both halves of account linking: scout_create_link_code (in-app)
-- and scout_claim_link_code (bot). Those work. What it did NOT cover is the
-- order of operations the /scout landing funnel actually produces:
--
--   text FIRST  → a shell account and a Scout Bin are minted behind the sender
--   sign up LATER → a SECOND account, with their photos stranded in the shell
--
-- No existing account carries a phone number, so an inbound handle can never be
-- recognised as an existing user. The shell account is unavoidable. The fix
-- therefore lives at the moment the sender CLAIMS it, not when it is minted,
-- and it has two shapes:
--
--   1. They have no other account → attach a real email to the shell account
--      in place. Nothing moves. Handled by the Worker (auth.admin), not here.
--   2. They already have an account → they link from it with a code, and the
--      shell Bin's cards are ADOPTED into their real Bin. §5 and §6 below.
--
-- Doing this now is deliberate: scout_identities, scout_accounts and
-- scout_ingest_log are all at zero rows, so there is nothing to backfill and
-- no one to strand. This is the last cheap moment to get the identity model
-- right.
--
-- Also fixes two authorization bugs found while writing the above (§1).

-----------------------------------------------------------------------
-- 1. scout_can_write_board — ONE predicate for "may this user write here".
--
--    Scout had its own hand-rolled version inlined in scout_set_target_board
--    and scout_set_bin_board, and it was wrong in three ways:
--
--      a. It checked `workspaces.created_by = p_user_id` — the workspace
--         OWNER — so a member of a team workspace could not target its boards
--         at all. It also broke scout_set_bin_board for anyone whose oldest
--         workspace is one they did not create: get_or_create_personal_workspace
--         returns exactly that workspace, the Bin gets created there, and
--         pinning it then silently fails (the call site .catch()es). Two live
--         users are in that state today.
--      b. It checked `board_shares.role in ('editor','owner')`, but that column
--         is `check (role in ('viewer','editor'))` (0013) — 'owner' has never
--         been a value it can hold. Dead branch.
--      c. It did not walk the parent chain, so a share granted on a parent
--         board did not grant write on its children — which is what
--         can_write_board (0188) has always meant everywhere else.
--
--    This mirrors can_write_board(uuid) exactly, including the waitlist gate,
--    but takes the user EXPLICITLY: the bot calls through the service role,
--    where auth.uid() is null and the real can_write_board would deny
--    everything. Keeping the two in the same shape is the point — if 0188's
--    semantics ever change, this is the one other place to change.
-----------------------------------------------------------------------
create or replace function public.scout_can_write_board(
  p_board_id uuid,
  p_user_id  uuid
)
returns boolean
language sql stable security definer
set search_path = public, auth as $$
  with recursive t as (
    select coalesce(
      (select tier from public.profiles where user_id = p_user_id),
      'demo'
    ) as tier
  ),
  chain as (
    select id, workspace_id, parent_board_id
    from public.boards where id = p_board_id and deleted_at is null
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from public.boards b
    join chain c on b.id = c.parent_board_id
  )
  select case
    when p_user_id is null or p_board_id is null then false
    when (select tier from t) = 'waitlist' then false
    else exists (
      select 1 from chain
      where exists (
             select 1 from public.workspace_members m
             where m.workspace_id = chain.workspace_id and m.user_id = p_user_id
           )
         or exists (
             select 1 from public.workspaces w
             where w.id = chain.workspace_id and w.created_by = p_user_id
           )
         or exists (
             select 1 from public.board_shares s
             where s.board_id = chain.id
               and s.user_id  = p_user_id
               and s.role     = 'editor'
           )
    )
  end;
$$;
revoke all on function public.scout_can_write_board(uuid, uuid) from public;
revoke all on function public.scout_can_write_board(uuid, uuid) from authenticated, anon;

comment on function public.scout_can_write_board(uuid, uuid) is
  'Explicit-user mirror of can_write_board(uuid), for service-role callers where '
  'auth.uid() is null. Keep the two in lockstep.';

-----------------------------------------------------------------------
-- 2. scout_set_target_board / scout_set_bin_board — adopt the predicate.
--    Bodies otherwise unchanged from 0206 §8 and 0209 §4.
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
begin
  if p_board_id is not null and not public.scout_can_write_board(p_board_id, p_user_id) then
    return false;
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

create or replace function public.scout_set_bin_board(
  p_user_id  uuid,
  p_board_id uuid
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
begin
  if p_user_id is null or p_board_id is null then
    return false;
  end if;
  if not public.scout_can_write_board(p_board_id, p_user_id) then
    return false;
  end if;

  insert into public.scout_accounts (user_id, bin_board_id)
  values (p_user_id, p_board_id)
  on conflict (user_id) do update
    set bin_board_id = excluded.bin_board_id,
        updated_at   = now();

  return true;
end;
$$;
revoke all on function public.scout_set_bin_board(uuid, uuid) from public;
revoke all on function public.scout_set_bin_board(uuid, uuid) from authenticated, anon;

-----------------------------------------------------------------------
-- 3. scout_find_board — "put these in the diner board", across EVERYTHING
--    the user can write to.
--
--    The bot previously listed boards from one workspace and matched in JS
--    (pipeline.js findBoardByName), which meant a linked user's boards in a
--    team workspace, or boards shared with them, were invisible — precisely
--    the boards a pre-existing account is most likely to care about.
--
--    Ranking is the same three tiers the JS used, and the reason is unchanged:
--    "diner" should find "Diner Recce" without a fuzzy matcher that would also
--    find "Dinner Party". Ties break oldest-first so the answer is stable
--    across calls.
--
--    The write predicate is applied AFTER the name filter so the recursive
--    chain walk runs over a handful of candidates rather than every board.
-----------------------------------------------------------------------
create or replace function public.scout_find_board(
  p_user_id uuid,
  p_query   text,
  p_limit   int default 5
)
returns table(board_id uuid, name text, workspace_id uuid, rank int)
language sql stable security definer
set search_path = public, auth as $$
  with q as (
    select lower(btrim(coalesce(p_query, ''))) as needle
  ),
  matched as (
    select b.id, b.name, b.workspace_id,
           case
             when lower(b.name) = (select needle from q)                then 0
             when lower(b.name) like (select needle from q) || '%'      then 1
             else 2
           end as rank,
           b.created_at
    from public.boards b
    where b.deleted_at is null
      and (select needle from q) <> ''
      -- position() rather than like '%'||needle||'%' so a needle containing
      -- % or _ is matched literally instead of as a wildcard.
      and position((select needle from q) in lower(b.name)) > 0
  )
  select m.id, m.name, m.workspace_id, m.rank
  from matched m
  where public.scout_can_write_board(m.id, p_user_id)
  order by m.rank asc, m.created_at asc
  limit greatest(1, least(coalesce(p_limit, 5), 25));
$$;
revoke all on function public.scout_find_board(uuid, text, int) from public;
revoke all on function public.scout_find_board(uuid, text, int) from authenticated, anon;

-----------------------------------------------------------------------
-- 4. scout_my_status — what a signed-in user may know about their own
--    Scout state. Drives the "add your email" prompt for a shell account.
--
--    An RPC rather than a select policy on scout_accounts, deliberately.
--    That table holds `refresh_token` — the headless Yjs peer's session — and
--    Supabase grants ALL on every public table to authenticated by default, so
--    a policy added for one column exposes every column added later. Same
--    reasoning as 0208/0210. RLS-with-no-policies stays the posture; this
--    function is the only door, and it names the columns it returns.
-----------------------------------------------------------------------
create or replace function public.scout_my_status()
returns table(
  is_shell      boolean,
  bin_board_id  uuid,
  handle_masked text,
  card_count    integer
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
      where i.user_id = a.user_id
      order by i.created_at asc
      limit 1),
    (select count(*)::integer
       from public.card_index ci
      where ci.board_id = a.bin_board_id)
  from public.scout_accounts a
  where a.user_id = auth.uid();
$$;
-- anon is revoked EXPLICITLY. Supabase's default privileges grant EXECUTE on
-- every new public function to anon and authenticated by name, so `revoke from
-- public` does not touch them — the first pass of this migration left both
-- client-facing functions callable by anon. Both happen to return nothing when
-- auth.uid() is null, but that is a property of today's bodies, not a control.
revoke all on function public.scout_my_status() from public, anon;
grant execute on function public.scout_my_status() to authenticated;

-----------------------------------------------------------------------
-- 5. scout_accounts.adopted_by / adopted_at — a shell account whose cards
--    have been moved into a real one. Kept, never deleted: the auth.users row
--    is the FK target for scout_ingest_log and analytics_events, and deleting
--    it would rewrite history to say the ingest never happened.
-----------------------------------------------------------------------
alter table public.scout_accounts
  add column if not exists adopted_by uuid references auth.users(id) on delete set null,
  add column if not exists adopted_at timestamptz;

comment on column public.scout_accounts.adopted_by is
  'For a shell account: the real account that claimed its handle and took its '
  'Bin cards. Set once; presence means the shell is spent, not that it is gone.';

-----------------------------------------------------------------------
-- 6. scout_claim_link_code — now reports the shell account it displaced.
--
--    Binding re-points scout_identities to the claiming user, so the handle
--    moves on its own. What was missing is that the shell account's Bin stays
--    behind holding the photos. Returning the prior user and its Bin is what
--    lets the caller move them (the move itself is a triple write and has to
--    happen in the service, not here).
--
--    CORRECTION: that first sentence was not true when this migration was
--    written — scout_bind_identity's ON CONFLICT did not update user_id, so the
--    handle did not move at all. 0214 fixes it. This migration depends on that
--    one; they were split only because 0213 had already been applied.
--
--    Only reported when the prior account is a SHELL. Re-linking a handle
--    between two real accounts is a person changing their mind about which of
--    their accounts to text into — moving their cards for them would be a
--    surprise, and destructive.
--
--    DROP FIRST: this changes the return type from uuid to a record, and
--    `create or replace` cannot do that (42P13 "cannot change return type of
--    existing function") — the whole migration would abort. Same reasoning as
--    0209 §3. Only the Scout service calls this, never a browser, so its
--    momentary absence inside the transaction is unreachable.
-----------------------------------------------------------------------
drop function if exists public.scout_claim_link_code(text, text, text, text);

create or replace function public.scout_claim_link_code(
  p_code     text,
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
  v_user       uuid;
  v_prior      uuid;
  v_prior_bin  uuid;
  v_prior_shell boolean := false;
begin
  update public.scout_link_codes
     set claimed_at = now(), claimed_by = p_handle
   where code = upper(btrim(p_code))
     and claimed_at is null
     and expires_at > now()
  returning scout_link_codes.user_id into v_user;

  if v_user is null then
    return;                                  -- zero rows = "no such code"
  end if;

  -- Who held this handle BEFORE the bind below re-points it.
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

  begin
    insert into public.analytics_events (user_id, event, props)
    values (v_user, 'scout_link_code_claimed',
            jsonb_build_object('platform', p_platform, 'adopting', v_prior_shell));
  exception when others then null;
  end;

  return query select
    v_user,
    case when v_prior_shell then v_prior     else null::uuid end,
    case when v_prior_shell then v_prior_bin else null::uuid end;
end;
$$;
revoke all on function public.scout_claim_link_code(text, text, text, text) from public;
revoke all on function public.scout_claim_link_code(text, text, text, text) from authenticated, anon;

-----------------------------------------------------------------------
-- 7. scout_mark_adopted — close the books on a shell account once its cards
--    have actually landed. Called AFTER the move, so an interrupted adoption
--    leaves the flag unset and a retry does the remaining work.
--
--    Refuses to mark a non-shell account, and refuses to overwrite an existing
--    adopted_by: both would be a bug in the caller, and silently accepting
--    either would make the audit trail lie about who holds the cards.
-----------------------------------------------------------------------
create or replace function public.scout_mark_adopted(
  p_shell_user_id uuid,
  p_new_user_id   uuid
)
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_ok boolean := false;
begin
  if p_shell_user_id is null or p_new_user_id is null or p_shell_user_id = p_new_user_id then
    return false;
  end if;

  update public.scout_accounts
     set adopted_by = p_new_user_id,
         adopted_at = now(),
         updated_at = now()
   where user_id = p_shell_user_id
     and is_shell
     and adopted_by is null;

  get diagnostics v_ok = row_count;

  if v_ok then
    begin
      insert into public.analytics_events (user_id, event, props)
      values (p_new_user_id, 'scout_shell_adopted',
              jsonb_build_object('shell_user_id', p_shell_user_id));
    exception when others then null;
    end;
  end if;

  return v_ok;
end;
$$;
revoke all on function public.scout_mark_adopted(uuid, uuid) from public;
revoke all on function public.scout_mark_adopted(uuid, uuid) from authenticated, anon;

-----------------------------------------------------------------------
-- 8. scout_settle_shell — a shell account that has attached a real email is
--    no longer a shell.
--
--    /api/scout/claim cannot do this. It hands the address change to Supabase's
--    own email-change flow, which completes when the user follows a link in
--    their inbox — out of band, with no webhook back to us. So rather than
--    trust anyone's word for it, this reads the account's CURRENT address and
--    clears the flag only once it has genuinely stopped being synthetic.
--
--    Self-keyed on auth.uid() and granted to authenticated: the app calls it on
--    load, so the flag settles the next time the user opens Clusters after
--    confirming. Taking a p_user_id instead would mean trusting a caller to
--    name whose shell status to clear.
--
--    The domain literal is the one syntheticEmail() mints in scoutIdentity.js.
--    If that ever changes, this has to change with it — which is why the check
--    is written as "not synthetic" rather than as a list of real domains.
-----------------------------------------------------------------------
create or replace function public.scout_settle_shell()
returns boolean
language plpgsql security definer
set search_path = public, auth as $$
declare
  v_email text;
  v_ok    boolean := false;
begin
  if auth.uid() is null then
    return false;
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null or v_email like '%@scout.soleilpictures.com' then
    return false;
  end if;

  update public.scout_accounts
     set is_shell = false, updated_at = now()
   where user_id = auth.uid() and is_shell;

  get diagnostics v_ok = row_count;

  if v_ok then
    begin
      insert into public.analytics_events (user_id, event, props)
      values (auth.uid(), 'scout_shell_claimed', '{}'::jsonb);
    exception when others then null;
    end;
  end if;

  return v_ok;
end;
$$;
revoke all on function public.scout_settle_shell() from public, anon;   -- see §4 on anon
grant execute on function public.scout_settle_shell() to authenticated;
