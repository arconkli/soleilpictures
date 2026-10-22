-- 0521: the 10-editor limit (0520) at every door an editor comes in through.
--
-- STATUS: written 2026-10-21. Applied 2026-10-21 (owner's go), switched off.
--
-- Each function below is its live body (pg_get_functiondef, 2026-10-21) with
-- the lines marked 0521 and nothing else changed. With app_config.editor_limit
-- off, _editor_admit answers 'ok' before it counts, so every door behaves as
-- it did.
--
--   share_board, invite_workspace_member   an editor invite or share: refused when full
--   set_workspace_member_role              viewer → editor or co-owner: refused when full
--   restore_board_share                    undoing an editor's removal: refused when full
--   claim_collab_link                      an edit link: in as a viewer when full
--   claim_workspace_invite_link            the same for a whole-workspace link
--
-- Not checked, on purpose:
--   * claim_pending_invite and the signup backstop: the invite held its place
--     when it was sent;
--   * transfer_workspace_ownership and the deletion heir: an account over the
--     limit keeps everyone, which is the freeze (S2b re-emits the transfer and
--     adds a freeze line to its notice);
--   * service_account_register: not a person;
--   * making a link: a link holds no place; the person opening it is checked.
--
-- The check always sits behind its own `if`: Postgres doesn't promise to
-- evaluate `and` left to right, and _editor_admit takes a lock.
--
-- 0188's brake (_collab_editor_cap) is no longer called from share_board or
-- claim_collab_link; the function and its app_config row go at launch.

begin;

-- ── share_board ─────────────────────────────────────────────────────────────

create or replace function public.share_board(p_board_id uuid, p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner                uuid;
  v_is_owner             boolean;
  v_user                 uuid;
  v_workspace            uuid;
  v_my_tier              text;
  v_existing_invited_by  uuid;
  v_email_norm           text := lower(trim(p_email));
begin
  if p_role not in ('viewer','editor') then
    raise exception 'role must be viewer or editor' using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once. Owners never reach
  -- can_write_board below, so they never met this check before.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce(
    (select tier from public.profiles where user_id = auth.uid()),
    'demo'
  ) into v_my_tier;

  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  -- (The 0147 "demo can only invite viewers" block was here. Editor
  -- collaboration is open on every plan; owner-pays caps (0187) are the
  -- resource gate. The 10-editor limit (0520) is checked below.)

  select b.workspace_id into v_workspace
  from boards b where b.id = p_board_id;
  if v_workspace is null then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;

  select w.created_by into v_owner from workspaces w where w.id = v_workspace;
  -- 0391: a co-owner manages everyone's shares, like the owner.
  v_is_owner := public.can_manage_workspace(v_workspace);
  if not v_is_owner and not can_write_board(p_board_id) then
    raise exception 'you do not have permission to share this board'
      using errcode = '42501';
  end if;

  -- 0521: 0188's dormant editor-seat brake was here. The 10-editor limit
  -- replaces it, checked below wherever an editor is granted, before any
  -- invite is spent or email sent.

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- Pending path: invitee has no account yet. Re-inviting/refreshing is an
    -- "add" action — allowed for owners and editors; latest inviter owns the
    -- not-yet-claimed pending row.
    --
    -- 0521: a waiting editor invite holds a place, so it needs a free one
    -- (re-sending one that already holds it passes).
    if p_role = 'editor' then
      if public._editor_admit(v_workspace, null, v_email_norm) = 'full' then
        perform public._editor_refuse(v_workspace);
      end if;
    end if;
    --
    -- 0358: only a NEW row fires the invite email (the trigger is AFTER
    -- INSERT), so only a new row spends budget; a refresh does not.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.board_id = p_board_id
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    --
    -- The predicate must match pending_invites_board_unclaimed_uniq EXACTLY —
    -- including `board_id is not null`. Without it Postgres cannot infer the
    -- arbiter and every call raises 42P10 (see migration 0227's header).
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, v_workspace, p_board_id, p_role, auth.uid())
    on conflict (lower(email), board_id) where claimed_at is null and board_id is not null
    do update set role       = excluded.role,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot share with yourself' using errcode = '22023';
  end if;

  -- Editors may add anyone, but may only CHANGE an existing share if they
  -- created it. A brand-new INSERT is always allowed (subject to tier/role).
  select invited_by into v_existing_invited_by
  from board_shares where board_id = p_board_id and user_id = v_user;
  if FOUND then
    if not v_is_owner and v_existing_invited_by is distinct from auth.uid() then
      raise exception 'you can only change the access of people you invited'
        using errcode = '42501';
    end if;
    -- 0521: a viewer made an editor takes a place; an editor staying one
    -- already has it.
    if p_role = 'editor' then
      if public._editor_admit(v_workspace, v_user, v_email_norm) = 'full' then
        perform public._editor_refuse(v_workspace);
      end if;
    end if;
    -- 0360: they already have access, so this is a role change, not a new
    -- share. It sends no email and spends no budget; before, the panel's role
    -- picker re-sent "X shared Y with you" and used up an invite every time.
    update board_shares
       set role = p_role, invited_by = auth.uid()
     where board_id = p_board_id and user_id = v_user;
    return 'granted';
  end if;

  -- 0521: a new editor share takes a place.
  if p_role = 'editor' then
    if public._editor_admit(v_workspace, v_user, v_email_norm) = 'full' then
      perform public._editor_refuse(v_workspace);
    end if;
  end if;

  -- 0358: the share_notifications row below emails `board_shared`, so a new
  -- share spends budget.
  perform public._invite_budget_take();

  insert into board_shares (board_id, user_id, role, invited_by)
  values (p_board_id, v_user, p_role, auth.uid())
  on conflict (board_id, user_id)
  do update set role = excluded.role,
                invited_by = auth.uid();

  insert into share_notifications (user_id, board_id, role, shared_by)
  values (v_user, p_board_id, p_role, auth.uid());

  return 'granted';
end;
$function$;

-- ── invite_workspace_member ─────────────────────────────────────────────────

create or replace function public.invite_workspace_member(p_workspace_id uuid, p_email text, p_role text default 'editor')
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user        uuid;
  v_my_tier     text;
  v_email_norm  text := lower(trim(p_email));
begin
  if p_role not in ('editor','viewer') then
    raise exception 'workspace member role must be editor or viewer'
      using errcode = '22023';
  end if;

  -- 0358: a banned account stops inviting at once.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select coalesce((select tier from public.profiles where user_id = auth.uid()), 'demo')
    into v_my_tier;
  if v_my_tier = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;

  -- 0391: the owner or a co-owner.
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can add members'
      using errcode = '42501';
  end if;

  select id into v_user from auth.users where email = v_email_norm;

  if v_user is null then
    -- 0521: a waiting editor invite holds a place, so it needs a free one
    -- (re-sending one that already holds it passes).
    if p_role = 'editor' then
      if public._editor_admit(p_workspace_id, null, v_email_norm) = 'full' then
        perform public._editor_refuse(p_workspace_id);
      end if;
    end if;
    -- 0358: only a new pending row fires the invite email, so only it spends.
    if not exists (select 1 from pending_invites pi
                    where lower(pi.email) = v_email_norm
                      and pi.workspace_id = p_workspace_id
                      and pi.board_id is null
                      and pi.claimed_at is null) then
      perform public._invite_budget_take();
    end if;
    -- 0318: 'workspace' is what both claim paths turn into an editor membership;
    -- a viewer invite must stay 'viewer' or the claim promotes it.
    insert into pending_invites (email, workspace_id, board_id, role, invited_by)
    values (v_email_norm, p_workspace_id, null,
            case when p_role = 'viewer' then 'viewer' else 'workspace' end,
            auth.uid())
    on conflict (lower(email), workspace_id) where claimed_at is null and board_id is null
    do update set role       = case when p_role = 'viewer' then 'viewer' else 'workspace' end,
                  invited_by = auth.uid(),
                  expires_at = now() + interval '30 days';
    return 'pending';
  end if;

  if v_user = auth.uid() then
    raise exception 'cannot invite yourself' using errcode = '22023';
  end if;

  -- 0358: an existing member is told so without spending budget; a new one
  -- gets the `workspace_invite` email, so it spends.
  if exists (select 1 from workspace_members m
              where m.workspace_id = p_workspace_id and m.user_id = v_user) then
    return 'already_member';
  end if;

  -- 0521: a new editing member takes a place.
  if p_role = 'editor' then
    if public._editor_admit(p_workspace_id, v_user, v_email_norm) = 'full' then
      perform public._editor_refuse(p_workspace_id);
    end if;
  end if;

  perform public._invite_budget_take();

  begin
    insert into workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, v_user, p_role);
  exception when unique_violation then
    return 'already_member';
  end;

  return 'granted';
end;
$function$;

-- ── set_workspace_member_role ───────────────────────────────────────────────

create or replace function public.set_workspace_member_role(p_workspace_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_owner uuid;
begin
  if p_role not in ('coowner', 'editor', 'viewer') then
    raise exception 'role must be coowner, editor or viewer' using errcode = '22023';
  end if;
  select created_by into v_owner from workspaces where id = p_workspace_id;
  if v_owner is null or not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can change roles' using errcode = '42501';
  end if;
  if p_user_id = v_owner then
    raise exception 'the owner''s role is ownership; transfer it instead' using errcode = '42501';
  end if;
  -- 0521: a viewer made an editor or co-owner takes a place; a move between
  -- editor and co-owner, or down to viewer, doesn't.
  if p_role in ('coowner', 'editor')
     and exists (select 1 from workspace_members m
                  where m.workspace_id = p_workspace_id
                    and m.user_id = p_user_id
                    and m.role = 'viewer') then
    if public._editor_admit(p_workspace_id, p_user_id, null) = 'full' then
      perform public._editor_refuse(p_workspace_id);
    end if;
  end if;
  update workspace_members
     set role = p_role
   where workspace_id = p_workspace_id
     and user_id = p_user_id
     and role in ('coowner', 'editor', 'viewer');
  if not found then
    raise exception 'not a member with a changeable role' using errcode = 'P0002';
  end if;
end;
$function$;

-- ── restore_board_share ─────────────────────────────────────────────────────

create or replace function public.restore_board_share(p_board_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  r            public.board_share_removals%rowtype;
  v_is_manager boolean;
  v_workspace  uuid;
begin
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select * into r from public.board_share_removals s
   where s.board_id = p_board_id and s.user_id = p_user_id;
  -- An undo, not a share: the remover, while the undo is on screen.
  if not found or r.removed_by is distinct from auth.uid()
     or r.removed_at < now() - interval '15 minutes' then
    raise exception 'that access can no longer be put back' using errcode = '42501';
  end if;

  select b.workspace_id, public.can_manage_workspace(b.workspace_id)
    into v_workspace, v_is_manager
    from public.boards b where b.id = p_board_id and b.deleted_at is null;
  if not found then
    raise exception 'board % not found', p_board_id using errcode = '42704';
  end if;
  if not coalesce(v_is_manager, false) and not public.can_write_board(p_board_id) then
    raise exception 'you do not have permission to manage this board''s access'
      using errcode = '42501';
  end if;

  -- 0521: putting an editor back takes a place again, and someone may have
  -- taken it since.
  if r.role = 'editor' then
    if public._editor_admit(v_workspace, r.user_id, null) = 'full' then
      perform public._editor_refuse(v_workspace);
    end if;
  end if;

  -- No _invite_budget_take and no share_notifications row: nothing is sent.
  insert into public.board_shares (board_id, user_id, role, invited_by, created_at, via_link_token)
  values (r.board_id, r.user_id, r.role,
          (select u.id from auth.users u where u.id = r.invited_by),
          r.shared_at,
          (select l.token from public.public_share_links l where l.token = r.via_link_token))
  on conflict (board_id, user_id) do nothing;
  return 'restored';
end $function$;

-- ── claim_collab_link ───────────────────────────────────────────────────────

create or replace function public.claim_collab_link(p_token uuid)
returns table(workspace_id uuid, board_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public, auth
as $function$
#variable_conflict use_column
declare
  v_link         public_share_links%rowtype;
  v_workspace    uuid;
  v_owner        uuid;
  v_existing     board_shares%rowtype;
  v_role         text;
  v_fallback     boolean := false;
  v_joiner_name  text;
  v_status       text := 'joined';
  v_is_new_user  boolean;
  v_has_card     boolean;
  v_ref_ins      int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join' using errcode = '42501';
  end if;
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select * into v_link from public_share_links where token = p_token;
  if not found or v_link.kind is distinct from 'invite' then
    raise exception 'invite link not found' using errcode = 'P0002';
  end if;
  if v_link.revoked_at is not null then
    raise exception 'this invite link was turned off' using errcode = '22023';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'this invite link has expired' using errcode = '22023';
  end if;
  -- 0371: a link from a banned account, or a new one under review, is off.
  if public._sharer_suspended(v_link.created_by) then
    raise exception 'this invite link was turned off' using errcode = '22023';
  end if;

  select b.workspace_id, w.created_by into v_workspace, v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = v_link.board_id and b.deleted_at is null;
  if v_workspace is null then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;
  -- 0371: and nobody joins a banned account's cluster.
  if public._user_banned(v_owner) then
    raise exception 'board no longer exists' using errcode = 'P0002';
  end if;

  -- Already the owner / a workspace member — nothing to grant.
  if v_owner = auth.uid() or is_workspace_member(v_workspace) then
    return query select v_workspace, v_link.board_id, 'owner'::text, 'noop'::text;
    return;
  end if;

  select * into v_existing
  from board_shares bs
  where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
  if found then
    if v_existing.role = 'viewer' and v_link.role = 'editor' then
      -- 0521: when the account has no room for another editor, a viewer who
      -- opens an edit link stays a viewer, is told why, and the owner hears.
      if public._editor_admit(v_workspace, auth.uid(), null) = 'full' then
        perform public._editor_limit_fallback(v_workspace, v_link.board_id, auth.uid(), 'collab_link', true);
        return query select v_workspace, v_link.board_id, 'viewer'::text, 'already'::text;
        return;
      end if;
      update board_shares bs
         set role = 'editor', via_link_token = coalesce(bs.via_link_token, v_link.token)
       where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
      return query select v_workspace, v_link.board_id, 'editor'::text, 'upgraded'::text;
    else
      return query select v_workspace, v_link.board_id, v_existing.role, 'already'::text;
    end if;
    return;
  end if;

  -- 0521: 0188's dormant brake was here, and it refused the join. The
  -- 10-editor limit lets them in as a viewer instead, then tells them why and
  -- tells the owner (below, once the share exists).
  v_role := v_link.role;
  if v_link.role = 'editor' then
    if public._editor_admit(v_workspace, auth.uid(), null) = 'full' then
      v_role := 'viewer';
      v_fallback := true;
    end if;
  end if;

  insert into board_shares (board_id, user_id, role, invited_by, via_link_token)
  values (v_link.board_id, auth.uid(), v_role, v_link.created_by, v_link.token)
  on conflict (board_id, user_id) do nothing;

  -- Payoff notification to the link creator (in-app toast + email via the
  -- share_notifications trigger). Never let it break the claim.
  begin
    if v_link.created_by is not null and v_link.created_by <> auth.uid() then
      select coalesce(nullif(p.display_name, ''), u.email, 'Someone')
        into v_joiner_name
      from auth.users u
      left join public.profiles p on p.user_id = u.id
      where u.id = auth.uid();
      insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
      values (v_link.created_by, v_link.board_id, v_role, auth.uid(), 'joined', v_joiner_name);
    end if;
  exception when others then
    raise warning 'claim_collab_link: joined notification failed: %', sqlerrm;
  end;

  -- 0521: in as a viewer because the account is full: say so, both ways.
  if v_fallback then
    perform public._editor_limit_fallback(v_workspace, v_link.board_id, auth.uid(), 'collab_link', false);
  end if;

  -- Referral ledger (0163 parity): a NEW account (< 7 days) joining via a
  -- collab link credits the link creator, source='collab'. If the referee
  -- already placed their first card, grant the referrer reward immediately
  -- (the _stamp_first_card trigger has already fired and won't again).
  begin
    select (u.created_at > now() - interval '7 days') into v_is_new_user
    from auth.users u where u.id = auth.uid();
    if coalesce(v_is_new_user, false)
       and v_link.created_by is not null
       and v_link.created_by <> auth.uid() then
      insert into public.referrals (referrer_id, referee_id, source, status, meta)
      values (v_link.created_by, auth.uid(), 'collab', 'pending',
              jsonb_build_object('via', 'invite_link', 'token', v_link.token::text))
      on conflict (referee_id) do nothing;
      get diagnostics v_ref_ins = row_count;
      if v_ref_ins > 0 then
        update public.profiles
           set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
         where user_id = auth.uid();
        insert into public.analytics_events (user_id, event, props)
        values (auth.uid(), 'referral_signup',
                jsonb_build_object('source', 'collab', 'via', 'invite_link'));
        select (first_card_at is not null) into v_has_card
        from public.profiles where user_id = auth.uid();
        if coalesce(v_has_card, false) then
          perform public.grant_referral_reward(auth.uid());
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'claim_collab_link: referral block failed: %', sqlerrm;
  end;

  -- Server-fired analytics (mirrors referral_signup's pattern).
  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'invite_link_claimed',
            jsonb_build_object('board_id', v_link.board_id, 'role', v_role, 'status', v_status));
  exception when others then null;
  end;

  return query select v_workspace, v_link.board_id, v_role, v_status;
end;
$function$;

-- ── claim_workspace_invite_link ─────────────────────────────────────────────

create or replace function public.claim_workspace_invite_link(p_token uuid)
returns table(workspace_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public, auth
as $function$
#variable_conflict use_column
declare
  c_burst        constant integer  := 15;
  c_burst_window constant interval := interval '10 minutes';
  v_link        public.workspace_invite_links%rowtype;
  v_owner       uuid;
  v_mine        text;
  v_recent      integer;
  v_ins         integer := 0;
  v_role        text;
  v_fallback    boolean := false;
  v_is_new_user boolean;
  v_has_card    boolean;
  v_ref_ins     integer := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  -- One join at a time per link, so the use count and the burst count are exact.
  select * into v_link from public.workspace_invite_links l where l.token = p_token for update;
  if not found or not public._workspace_invite_link_live(p_token) then
    return query select null::uuid, null::text, 'dead'::text;
    return;
  end if;

  select w.created_by into v_owner from public.workspaces w where w.id = v_link.workspace_id;
  if v_owner = auth.uid() then
    return query select v_link.workspace_id, 'owner'::text, 'member'::text;
    return;
  end if;
  select m.role into v_mine from public.workspace_members m
   where m.workspace_id = v_link.workspace_id and m.user_id = auth.uid();
  if v_mine is not null then
    return query select v_link.workspace_id, v_mine, 'member'::text;
    return;
  end if;

  -- A burst: the link is being passed around far beyond a team. Turn it off
  -- for good and page; the people already in stay in.
  select count(*) into v_recent
    from public.workspace_invite_link_joins j
   where j.token = v_link.token and j.joined_at > now() - c_burst_window;
  if v_recent >= c_burst then
    update public.workspace_invite_links l
       set revoked_at = now(), revoked_reason = 'burst'
     where l.token = v_link.token;
    perform public.ops_alert_raise(
      'workspace_link_burst',
      'A workspace invite link was turned off for too many joins at once',
      v_recent || ' joins within ' || (extract(epoch from c_burst_window) / 60)::integer
        || ' minutes on one link into workspace ' || v_link.workspace_id
        || ', made by ' || v_link.created_by
        || E'.\nThe link is off for good. The people it let in are still members.',
      true, 'workspace_link_burst:' || v_link.workspace_id, interval '1 hour', v_link.created_by);
    return query select null::uuid, null::text, 'dead'::text;
    return;
  end if;

  -- 0521: when the account has no room for another editor, an edit link lets
  -- them in as a viewer; the join still counts toward the link's uses.
  v_role := v_link.role;
  if v_link.role = 'editor' then
    if public._editor_admit(v_link.workspace_id, auth.uid(), null) = 'full' then
      v_role := 'viewer';
      v_fallback := true;
    end if;
  end if;

  -- They clicked Join; the member email trigger skips this insert.
  perform set_config('soleil.ws_link_join', '1', true);
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_link.workspace_id, auth.uid(), v_role)
  on conflict (workspace_id, user_id) do nothing;
  get diagnostics v_ins = row_count;
  perform set_config('soleil.ws_link_join', '', true);
  if v_ins = 0 then
    return query select v_link.workspace_id,
      (select m.role from public.workspace_members m
        where m.workspace_id = v_link.workspace_id and m.user_id = auth.uid()),
      'member'::text;
    return;
  end if;

  insert into public.workspace_invite_link_joins (token, workspace_id, user_id)
  values (v_link.token, v_link.workspace_id, auth.uid());

  -- The maker hears about it (in-app, and email through share_notifications).
  -- _joined_notification never raises.
  perform public._joined_notification(v_link.created_by, null, v_link.workspace_id, v_role, auth.uid());

  -- 0521: in as a viewer because the account is full: say so, both ways.
  if v_fallback then
    perform public._editor_limit_fallback(v_link.workspace_id, null, auth.uid(), 'workspace_link', false);
  end if;

  -- A new account joining is the maker's referral, as on a collab link.
  begin
    select (u.created_at > now() - interval '7 days') into v_is_new_user
    from auth.users u where u.id = auth.uid();
    if coalesce(v_is_new_user, false) and v_link.created_by <> auth.uid() then
      insert into public.referrals (referrer_id, referee_id, source, status, meta)
      values (v_link.created_by, auth.uid(), 'collab', 'pending',
              jsonb_build_object('via', 'workspace_link', 'workspace_id', v_link.workspace_id::text))
      on conflict (referee_id) do nothing;
      get diagnostics v_ref_ins = row_count;
      if v_ref_ins > 0 then
        update public.profiles
           set bonus_card_credits = coalesce(bonus_card_credits, 0) + 25
         where user_id = auth.uid();
        insert into public.analytics_events (user_id, event, props)
        values (auth.uid(), 'referral_signup',
                jsonb_build_object('source', 'collab', 'via', 'workspace_link'));
        select (first_card_at is not null) into v_has_card
        from public.profiles where user_id = auth.uid();
        if coalesce(v_has_card, false) then
          perform public.grant_referral_reward(auth.uid());
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'claim_workspace_invite_link: referral block failed: %', sqlerrm;
  end;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (auth.uid(), 'workspace_link_claimed',
            jsonb_build_object('workspace_id', v_link.workspace_id, 'role', v_role, 'status', 'joined'));
  exception when others then null;
  end;

  return query select v_link.workspace_id, v_role, 'joined'::text;
end;
$function$;

-- ── Proofs (the 0311 habit) ─────────────────────────────────────────────────
-- create or replace kept each door's grants; prove it, and that no overload
-- appeared.

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.share_board(uuid,text,text)',
    'public.invite_workspace_member(uuid,text,text)',
    'public.set_workspace_member_role(uuid,uuid,text)',
    'public.restore_board_share(uuid,uuid)',
    'public.claim_collab_link(uuid)',
    'public.claim_workspace_invite_link(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0521: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0521: % is not callable signed in', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('share_board', 'invite_workspace_member', 'set_workspace_member_role',
                                  'restore_board_share', 'claim_collab_link', 'claim_workspace_invite_link')
              group by p.proname having count(*) > 1) then
    raise exception '0521: a door has an overload (PGRST203)';
  end if;
end $$;

commit;
