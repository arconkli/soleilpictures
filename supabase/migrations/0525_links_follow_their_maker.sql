-- 0525_links_follow_their_maker.sql
--
-- An invite link (claim_collab_link) and a view link (_resolve_share_target)
-- work only while the account that made it can still edit the cluster
-- (_user_can_write_board, 0524). Removing someone, unsharing a cluster from
-- them or making them a viewer ends their links at once, without anyone
-- having to find and revoke them. Every other check is unchanged.
--
-- Bodies re-emitted from the live definitions; 0521's editor-limit doors in
-- claim_collab_link (_editor_admit and the viewer fallback) are untouched.

CREATE OR REPLACE FUNCTION public.claim_collab_link(p_token uuid)
 RETURNS TABLE(workspace_id uuid, board_id uuid, role text, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
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
  -- 0525: and a link works only while the account that made it can still
  -- edit the cluster. Removed, unshared or made a viewer, their links stop.
  if not public._user_can_write_board(v_link.created_by, v_link.board_id) then
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

CREATE OR REPLACE FUNCTION public._resolve_share_target(p_token uuid, p_board_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(root_id uuid, target_id uuid, include_subboards boolean, allow_indexing boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_root    uuid;
  v_include boolean;
  v_allow   boolean;
  v_target  uuid;
  v_creator uuid;
begin
  select l.board_id, l.include_subboards, l.allow_indexing, l.created_by
    into v_root, v_include, v_allow, v_creator
  from public_share_links l
  where l.token = p_token
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now());
  if v_root is null then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;
  -- 0371: a link stops working when the account that made it is banned (or
  -- is a new account on a sending hold), or when the cluster's owner is
  -- banned. Same answer as an expired link: a takedown says nothing about why.
  -- 0525: and when the account that made it can no longer edit the cluster.
  if public._sharer_suspended(v_creator)
     or not public._user_can_write_board(v_creator, v_root)
     or exists (select 1 from boards b join workspaces w on w.id = b.workspace_id
                 where b.id = v_root and public._user_banned(w.created_by)) then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  v_target := coalesce(p_board_id, v_root);

  if v_target <> v_root then
    if not coalesce(v_include, false) then
      raise exception 'sub-boards are not shared by this link' using errcode = 'P0002';
    end if;
    if not exists (
      with recursive chain as (
        select id, parent_board_id from boards where id = v_target
        union all
        select b.id, b.parent_board_id
        from boards b join chain c on b.id = c.parent_board_id
      )
      select 1 from chain where id = v_root
    ) then
      raise exception 'board is not part of this shared link' using errcode = 'P0002';
    end if;
  end if;

  if not exists (select 1 from boards b where b.id = v_target and b.deleted_at is null) then
    raise exception 'invalid or expired share link' using errcode = 'P0002';
  end if;

  return query select v_root, v_target, coalesce(v_include, false), coalesce(v_allow, false);
end;
$function$;


-- The 0311 habit: prove the grants, don't trust them.
do $$
begin
  if has_function_privilege('anon', 'public.claim_collab_link(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.claim_collab_link(uuid)', 'EXECUTE') then
    raise exception '0525: claim_collab_link grants changed';
  end if;
  if has_function_privilege('anon', 'public._resolve_share_target(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._resolve_share_target(uuid,uuid)', 'EXECUTE') then
    raise exception '0525: _resolve_share_target is client-callable';
  end if;
end $$;
