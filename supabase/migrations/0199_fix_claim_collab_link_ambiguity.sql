-- 0199: fix claim_collab_link "column reference board_id is ambiguous"
--
-- The 0189 function declares RETURNS TABLE(workspace_id, board_id, role,
-- status), which makes each result column a PL/pgSQL OUT variable. The
-- board_shares insert ends with `on conflict (board_id, user_id)`, and
-- PL/pgSQL applies variable substitution inside the ON CONFLICT inference
-- column list — so `board_id` there is ambiguous between the OUT variable
-- and the table column, and the whole claim aborts with 42702 for any
-- genuinely NEW joiner. (The owner/member `noop` and existing-share
-- `upgraded`/`already` paths all return before reaching the insert, which
-- is why owner-side testing never hit it.)
--
-- Fix: `#variable_conflict use_column` — inside this function every
-- ambiguous unqualified identifier resolves to the table column. All
-- variable references in query positions are v_-prefixed or p_-prefixed,
-- so the pragma changes nothing else. The RETURNS TABLE column names are
-- part of the client contract (callers read .workspace_id/.board_id/
-- .role/.status) and must not be renamed. Body otherwise verbatim 0189.

create or replace function public.claim_collab_link(p_token uuid)
returns table(workspace_id uuid, board_id uuid, role text, status text)
language plpgsql security definer
set search_path = public, auth as $$
#variable_conflict use_column
declare
  v_link         public_share_links%rowtype;
  v_workspace    uuid;
  v_owner        uuid;
  v_existing     board_shares%rowtype;
  v_cap          integer;
  v_editor_seats integer;
  v_joiner_name  text;
  v_status       text := 'joined';
  v_is_new_user  boolean;
  v_has_card     boolean;
  v_ref_ins      int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join' using errcode = '42501';
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

  select b.workspace_id, w.created_by into v_workspace, v_owner
  from boards b join workspaces w on w.id = b.workspace_id
  where b.id = v_link.board_id and b.deleted_at is null;
  if v_workspace is null then
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
      update board_shares bs
         set role = 'editor', via_link_token = coalesce(bs.via_link_token, v_link.token)
       where bs.board_id = v_link.board_id and bs.user_id = auth.uid();
      return query select v_workspace, v_link.board_id, 'editor'::text, 'upgraded'::text;
    else
      return query select v_workspace, v_link.board_id, v_existing.role, 'already'::text;
    end if;
    return;
  end if;

  -- Dormant editor-seat brake (0188): only bites when an admin sets a cap.
  if v_link.role = 'editor' then
    v_cap := public._collab_editor_cap();
    if v_cap is not null then
      select count(distinct bs.user_id) into v_editor_seats
      from board_shares bs
      join boards b     on b.id = bs.board_id
      join workspaces w on w.id = b.workspace_id
      where w.created_by = v_owner and bs.role = 'editor';
      if v_editor_seats >= v_cap then
        raise exception 'this workspace has reached its free editor limit'
          using errcode = '42501';
      end if;
    end if;
  end if;

  insert into board_shares (board_id, user_id, role, invited_by, via_link_token)
  values (v_link.board_id, auth.uid(), v_link.role, v_link.created_by, v_link.token)
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
      values (v_link.created_by, v_link.board_id, v_link.role, auth.uid(), 'joined', v_joiner_name);
    end if;
  exception when others then
    raise warning 'claim_collab_link: joined notification failed: %', sqlerrm;
  end;

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
            jsonb_build_object('board_id', v_link.board_id, 'role', v_link.role, 'status', v_status));
  exception when others then null;
  end;

  return query select v_workspace, v_link.board_id, v_link.role, v_status;
end;
$$;
revoke all on function public.claim_collab_link(uuid) from public;
grant execute on function public.claim_collab_link(uuid) to authenticated;
