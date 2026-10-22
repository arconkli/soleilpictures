-- 0530: Teams, part 2 — every access path learns about teams.
--
-- STATUS: written 2026-10-22. NOT APPLIED until the owner says go.
--
-- One rule, in one helper: _org_ws_role_for(ws, user) is the role a person
-- has in a team workspace through the team, in the workspace vocabulary.
--
--   team role       team-visible workspace    private team workspace
--   owner, admin    coowner                   coowner (hand-overs)
--   member          editor                    nothing (explicit rows only)
--   viewer          viewer                    nothing
--
-- A team that isn't active (organizations.status <> 'active', S3's
-- view_only) fails closed: owner and admins read every team workspace, members
-- and viewers read the team-visible ones, and nobody writes or manages through
-- the team. S3 adds the matching branch for explicit rows.
--
-- Null for a closed team, a personal workspace (no org_id) or no org row, so
-- the team never reaches a personal workspace. A person's access is the
-- stronger of their explicit workspace_members / board_shares grant and this.
-- With no organization rows (0522's hold), every branch below is null/false
-- and every predicate answers exactly as before.
--
-- Each re-emitted function is its live body (pg_get_functiondef, read
-- 2026-10-22, the same text as the latest migration named beside it) with the
-- lines marked 0530 and nothing else changed. Rebased on: the md5 of each
-- live prosrc, which Task 9 compares with live before applying (amendment F):
--
--   is_workspace_member              0001_init.sql                                             39baddb5e06cb4ee0aee8003bd1cf2a7
--   _workspace_member_can_write      0391_workspace_coowner.sql                                877424a1536495e53f4f2d9d23b7ca63
--   can_manage_workspace             0394_suspended_coowner_manages_nothing.sql                674afb1abcd78873f94f995edd4a3d52
--   my_workspace_ids                 0319_read_suspend_gate.sql                                b42ce2d6ce5627a58c8fd43dba0be191
--   my_readable_board_ids            0526_trashed_shares_grant_nothing.sql                     ce07690230251e57a4a4338c33d816ab
--   _user_can_read_board             0207_comment_mention_notifications.sql                    7139e58939b83b5ba859bf3d26fbb46f
--   scout_can_write_board            0213_scout_identity_claim.sql                             d84bafdbb68d28affa685b201615bc26
--   _file_share_reaches              0527_inbox_proof.sql                                      e3db5a677b3d4744b1315e4ee692e19d
--   _workspace_invite_link_live      0450_workspace_invite_links.sql                           87ba2c28305b56149dbb2b7092b886d2
--   workspace_user_directory         0084_lock_down_views.sql                                  1965b0f7bc6ea715923d08dd88c014ec
--   merge_workspace_settings         0392_workspace_name_icon_managers_only.sql                93c83b4933e4173f0e951bed570bea63
--   get_or_create_personal_workspace 0400_personal_workspace_is_your_own.sql                   c2c63f41e298ae968bf3e2d938618cc9
--   transfer_workspace_ownership     0524_offboarding.sql                                      e398ef6dd71d383856078376c8c5e957
--   prepare_account_deletion         0388_audit_deletion_heir_can_edit.sql                     ee01d2408bd3e001f9470d2f52504ddb
--   prepare_admin_account_deletion   0408_admin_deletion_hands_workspaces_over.sql             4b00b65abe90e06945b6127209466070
--   my_deletion_impact               0388_audit_deletion_heir_can_edit.sql                     15d4204fd20945ca7fe9461b0b3c20f4
--
-- Inherit the branch without a text change, because they already route
-- through the functions above: can_read_board, can_write_board,
-- can_write_workspace, board_tree, the realtime ws:/board:/y: policies, the
-- workspaces / workspace_members / pending_invites / board_shares / boards /
-- grid_layouts / conversations / conversation_participants policies, and the
-- upload party. No policy text changes here.
--
-- Deliberately unchanged:
--   * board_workspace_owner: S2b re-keys who pays.
--   * create_workspace_with_root: no overload or DROP; 0532 adds
--     create_team_workspace instead.
--   * delete_workspace: already owner-only (created_by = the team owner).
--   * leave_workspace, remove_workspace_member, set_workspace_member_role:
--     they act on explicit rows; a team admin reaches them through
--     can_manage_workspace.
--   * _deletion_heir: a team owner can't be deleted (refused below).
--   * _board_readers: Schedule's fan-out; Schedule never ships.
--   * can_message, list_messageable_users, users_by_ids, the member_profiles
--     read policy: they pair explicit rows, so people who share only a team
--     neither DM each other nor see each other's addresses through them until
--     S4 decides.
--   * claim_collab_link: a team viewer opening an edit link gets today's
--     'noop'; asking to edit goes through the team (ask_team_for_edit, 0532).
--
-- New: can_open_workspace (the workspace room's door) and my_workspace_role.
-- The party's minute re-checks are the security session's (PTY-1):
-- party_board_access (0620, 0621: read = my_readable_board_ids, write =
-- can_write_board) and party_workspace_access (0622: _actor_active and
-- is_workspace_member), each asked as that person. The org branch here
-- reaches both through those predicates unchanged. The proofs below require
-- both live.

begin;

-- ── 1. The helpers ──────────────────────────────────────────────────────────

create or replace function public._org_ws_role_for(p_ws uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           -- A team that isn't active (S3: view_only) fails closed: everyone
           -- reads, nobody writes or manages through the team.
           when o.status <> 'active' then
             case when m.role in ('owner', 'admin') then 'viewer'
                  when w.org_visibility = 'team' then 'viewer'
             end
           when m.role in ('owner', 'admin') then 'coowner'
           when w.org_visibility = 'team' and m.role = 'member' then 'editor'
           when w.org_visibility = 'team' and m.role = 'viewer' then 'viewer'
         end
    from public.workspaces w
    join public.organizations o on o.id = w.org_id and o.closed_at is null
    join public.org_members m on m.org_id = w.org_id and m.user_id = p_user
   where w.id = p_ws
     and p_user is not null;
$$;

-- The team workspaces the caller can open (any team role on a team-visible
-- one; owner/admin on every one). One query, for the two set readers.
create or replace function public._my_org_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(w.id), '{}'::uuid[])
    from public.org_members m
    join public.organizations o on o.id = m.org_id and o.closed_at is null
    join public.workspaces w on w.org_id = m.org_id
   where m.user_id = auth.uid()
     and (m.role in ('owner', 'admin') or w.org_visibility = 'team');
$$;

-- Rank of a workspace role, for "the stronger of two".
create or replace function public._ws_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_role when 'owner' then 6 when 'coowner' then 5 when 'admin' then 4
                     when 'editor' then 3 when 'service' then 2 when 'viewer' then 1 else 0 end;
$$;

-- ── 2. The choke points ─────────────────────────────────────────────────────

create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  )
  -- 0530: or the team's role for them here.
  or public._org_ws_role_for(ws, auth.uid()) is not null;
$$;

create or replace function public._workspace_member_can_write(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public._workspace_member_role(ws) in ('owner', 'coowner', 'admin', 'editor', 'service'), false)
      -- 0530: a team owner/admin anywhere in the team, a member where the team can see.
      or coalesce(public._org_ws_role_for(ws, auth.uid()) in ('coowner', 'editor'), false);
$$;

create or replace function public.can_manage_workspace(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public._actor_active()
     and (
       exists (select 1 from public.workspaces w
                where w.id = ws and w.created_by = auth.uid())
       or exists (select 1 from public.workspace_members m
                   where m.workspace_id = ws and m.user_id = auth.uid()
                     and m.role = 'coowner')
       -- 0530: the team's owner and admins manage every team workspace.
       or public._org_ws_role_for(ws, auth.uid()) = 'coowner'
     );
$$;

create or replace function public.my_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  -- 0530: explicit rows, plus the team workspaces the caller can open
  -- (unnest, not = any: an array test isn't sargable).
  select case when public._actor_active()
              then coalesce((select array_agg(distinct s.id) from (
                     select wm.workspace_id as id from workspace_members wm where wm.user_id = auth.uid()
                     union all
                     select unnest(public._my_org_workspace_ids())) s), '{}'::uuid[])
              else '{}'::uuid[] end;
$$;

create or replace function public.my_readable_board_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive roots as (
    select b.id, b.parent_board_id
    from boards b
    where b.workspace_id in (
            select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
            union all
            select unnest(public._my_org_workspace_ids())   -- 0530
          )
       or exists (
            -- 0526: a share on a cluster in the trash grants nothing.
            select 1 from board_shares s where s.board_id = b.id and s.user_id = auth.uid()
               and b.deleted_at is null
          )
    union
    select c.id, c.parent_board_id
    from boards c join roots r on c.parent_board_id = r.id
  )
  select case when public._actor_active()
              then coalesce(array_agg(id), '{}'::uuid[])
              else '{}'::uuid[] end
  from roots;
$$;

-- ── 3. The per-user helpers (asked about someone other than the caller) ────

create or replace function public._user_can_read_board(p_user_id uuid, p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select id, workspace_id, parent_board_id
    from boards where id = p_board_id
    union all
    select b.id, b.workspace_id, b.parent_board_id
    from boards b join chain c on b.id = c.parent_board_id
  )
  select exists (
    select 1 from chain
    where exists (
        select 1 from workspace_members m
        where m.workspace_id = chain.workspace_id and m.user_id = p_user_id
      )
       or exists (
        select 1 from board_shares s
        where s.board_id = chain.id and s.user_id = p_user_id
      )
       -- 0530: or the team lets them in here.
       or public._org_ws_role_for(chain.workspace_id, p_user_id) is not null
  );
$$;

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
         -- 0530: a team owner/admin, or a member where the team can see.
         or coalesce(public._org_ws_role_for(chain.workspace_id, p_user_id) in ('coowner', 'editor'), false)
    )
  end;
$$;

create or replace function public._file_share_reaches(p_share public.file_shares, p_user uuid)
returns boolean
language plpgsql stable security definer
set search_path = '' as $$
declare
  v_email text;
begin
  if p_user is null or p_share.id is null or public._user_banned(p_user) then
    return false;
  end if;
  if exists (select 1 from public.workspaces w
              where w.id = p_share.workspace_id and w.created_by = p_user)
     or exists (select 1 from public.workspace_members m
                 where m.workspace_id = p_share.workspace_id and m.user_id = p_user)
     -- 0530: or the team lets them into the workspace.
     or public._org_ws_role_for(p_share.workspace_id, p_user) is not null then
    return true;
  end if;
  if exists (
       with recursive chain as (
         select b.id, b.parent_board_id, b.deleted_at
           from public.boards b where b.id = p_share.board_id
         union all
         select b.id, b.parent_board_id, b.deleted_at
           from public.boards b join chain c on b.id = c.parent_board_id
       )
       select 1 from chain
        join public.board_shares s on s.board_id = chain.id and s.user_id = p_user
       where chain.deleted_at is null) then
    return true;
  end if;
  select lower(u.email) into v_email
    from auth.users u where u.id = p_user and u.email_confirmed_at is not null
      and public._user_proved_inbox(p_user);
  if exists (select 1 from public.file_share_people p
              where p.share_id = p_share.id and p.revoked_at is null
                and not public._sharer_suspended(p.invited_by)
                and public._user_can_write_board(p.invited_by, p_share.board_id)
                and (p.user_id = p_user
                     or (p.user_id is null and v_email is not null and p.email = v_email))) then
    return true;
  end if;
  if p_share.link_access = 'comment'
     and exists (select 1 from public.file_comments c
                  where c.share_id = p_share.id and c.author = p_user and c.deleted_at is null) then
    return true;
  end if;
  return false;
end;
$$;

-- A link a team admin makes (create_workspace_invite_link accepts them via
-- can_manage_workspace) must be live, or it is born dead.
create or replace function public._workspace_invite_link_live(p_token uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select exists (
    select 1
      from public.workspace_invite_links l
      join public.workspaces w on w.id = l.workspace_id
     where l.token = p_token
       and l.revoked_at is null
       and l.expires_at > now()
       and (select count(*) from public.workspace_invite_link_joins j where j.token = l.token) < l.max_uses
       -- 0371: banned, or new and under review ...
       and not public._sharer_suspended(l.created_by)
       -- ... and here any sending hold at all, until it is released ...
       and not exists (select 1 from public.profiles p
                        where p.user_id = l.created_by and p.send_hold_at is not null)
       -- ... and the maker must still run the workspace, whose owner is not banned.
       and not public._user_banned(w.created_by)
       and (w.created_by = l.created_by
            or exists (select 1 from public.workspace_members m
                        where m.workspace_id = l.workspace_id
                          and m.user_id = l.created_by
                          and m.role = 'coowner')
            -- 0530: or a team owner/admin, who manages every team workspace.
            or public._org_ws_role_for(l.workspace_id, l.created_by) = 'coowner'));
$$;

-- In a team workspace, a member reads names, never addresses: the email (and
-- the email-as-title fallback) only for the owner/admins or your own row.
-- Personal workspaces are unchanged.
create or replace function public.workspace_user_directory()
returns table(
  user_id      uuid,
  workspace_id uuid,
  title        text,
  email        text,
  created_at   timestamptz
)
language sql
security definer
stable
set search_path = public, auth
as $$
  select
    wm.user_id,
    wm.workspace_id,
    case when w.org_id is null or wm.user_id = auth.uid() or public.can_manage_workspace(wm.workspace_id)
         then coalesce(u.raw_user_meta_data->>'full_name', u.email)
         -- 0530: in a team workspace a member reads names, never addresses.
         else coalesce(nullif(btrim(p.display_name), ''), u.raw_user_meta_data->>'full_name', 'Someone')
    end as title,
    case when w.org_id is null or wm.user_id = auth.uid() or public.can_manage_workspace(wm.workspace_id)
         then u.email end as email,
    u.created_at
  from public.workspace_members wm
  join public.workspaces w on w.id = wm.workspace_id
  join auth.users u on u.id = wm.user_id
  left join public.profiles p on p.user_id = wm.user_id
  where public.is_workspace_member(wm.workspace_id);
$$;

create or replace function public.merge_workspace_settings(p_workspace_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_settings jsonb;
begin
  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'coowner', 'admin', 'editor')
  )
  -- 0530: or the team lets them edit here ('service' stays out, as today).
  and not coalesce(public._org_ws_role_for(p_workspace_id, auth.uid()) in ('coowner', 'editor'), false) then
    raise exception 'Not authorised to update workspace settings.';
  end if;

  -- 0392: the icon is identity, like the name — the owner's or a co-owner's.
  if coalesce(p_patch, '{}'::jsonb) ? 'icon_url'
     and not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can change the icon'
      using errcode = '42501';
  end if;

  update public.workspaces
     set settings = settings || coalesce(p_patch, '{}'::jsonb)
   where id = p_workspace_id
   returning settings into v_settings;

  return v_settings;
end;
$function$;

-- ── 4. Ownership invariants ─────────────────────────────────────────────────

create or replace function public.get_or_create_personal_workspace(p_user_id uuid, p_name text default 'Soleil')
returns workspaces
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lock_key bigint := hashtextextended('ws_bootstrap:' || p_user_id::text, 0);
  v_ws       workspaces%rowtype;
  v_root_id  uuid;
begin
  -- 0303: a JWT-bearing caller may only bootstrap its OWN workspace.
  -- auth.uid() is null under service_role, which is how the Scout shell-user
  -- provisioning path legitimately passes another user's id.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not authorized to bootstrap a workspace for another user'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(v_lock_key);
  -- 0400: a workspace you own, never one you were invited into.
  select w.* into v_ws from workspaces w
   where w.created_by = p_user_id
     and w.org_id is null            -- 0530: a team's workspace is never your personal one
   order by w.created_at asc limit 1;
  if not found then
    insert into workspaces (name, created_by) values (p_name, p_user_id) returning * into v_ws;
    insert into workspace_members (workspace_id, user_id, role) values (v_ws.id, p_user_id, 'owner');
  end if;
  -- 0275: `deleted_at is null` was missing here. Without it this found the
  -- tombstone of a deleted root and skipped the heal, which is the exact
  -- reason the heal never fired for the accounts it was written to rescue.
  select id into v_root_id from boards
  where workspace_id = v_ws.id and parent_board_id is null and deleted_at is null
  order by created_at asc limit 1;
  if v_root_id is null then
    insert into boards (workspace_id, parent_board_id, name, view, created_by)
      values (v_ws.id, null, 'Studio', 'canvas', p_user_id) returning id into v_root_id;
    insert into board_state (board_id, doc) values (v_root_id, '') on conflict (board_id) do nothing;
  end if;
  return v_ws;
end;
$function$;

create or replace function public.transfer_workspace_ownership(p_workspace_id uuid, p_new_owner uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_old     uuid;
  v_name    text;
  v_tier    text;
  v_cap     integer;
  v_count   integer;
  v_role    text;
  v_bytes   bigint;
  v_objects bigint;
  v_integrations jsonb;
  v_note    text := '';
  v_org     uuid;   -- 0530
begin
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  -- A banned account's clusters stop serving, so it can't be handed one.
  if public._user_banned(p_new_owner) then
    raise exception 'that account cannot own a workspace' using errcode = '42501';
  end if;
  if p_new_owner = auth.uid() then
    raise exception 'cannot transfer ownership to yourself'
      using errcode = '22023';
  end if;

  select created_by, name, org_id into v_old, v_name, v_org from workspaces where id = p_workspace_id;  -- 0530: org_id
  if v_old is null then
    raise exception 'workspace % not found', p_workspace_id using errcode = '42704';
  end if;
  -- 0530: a team workspace's owner is the team's owner; it leaves the team first.
  if v_org is not null then
    raise exception 'a team workspace belongs to its team; move it out of the team first'
      using errcode = '42501', hint = 'team_workspace';
  end if;
  if v_old <> auth.uid() then
    raise exception 'only the current owner can transfer ownership'
      using errcode = '42501';
  end if;
  select role into v_role from workspace_members
   where workspace_id = p_workspace_id and user_id = p_new_owner;
  if v_role is null then
    raise exception 'new owner must already be a workspace member'
      using errcode = '42704';
  end if;
  -- 0397: only someone who can edit it. A viewer or a service account would
  -- receive a workspace they cannot run, from an owner just demoted to editor.
  if v_role not in ('coowner', 'admin', 'editor') then
    raise exception 'only an editor or co-owner can become the owner — make them an editor first'
      using errcode = '42501';
  end if;

  update workspaces set created_by = p_new_owner where id = p_workspace_id;
  update workspace_members set role = 'owner'
    where workspace_id = p_workspace_id and user_id = p_new_owner;
  update workspace_members set role = 'editor'
    where workspace_id = p_workspace_id and user_id = v_old;

  -- 0524: the outgoing owner's integrations stop with their ownership. Their
  -- webhooks go inactive, the service accounts they made are disabled and
  -- those accounts' tokens revoked; the new owner sets up their own. The
  -- outgoing owner stays an editor, so nothing else of theirs is touched.
  v_integrations := public._offboard_integrations(p_workspace_id, v_old);
  perform public._log_security_event('workspace.ownership_transferred', p_workspace_id,
    jsonb_build_object('from_user', v_old, 'to_user', p_new_owner) || v_integrations);
  if coalesce((v_integrations ->> 'webhooks')::int, 0) + coalesce((v_integrations ->> 'service_accounts')::int, 0) > 0 then
    v_note := ' The previous owner''s webhooks and API service accounts were turned off; set up your own in Settings.';
  end if;

  -- 0397: the workspace's stored files now count toward the new owner, as the
  -- nightly reconcile would decide; move them now rather than at 03:55 UTC.
  -- 0411: only the files that count (_image_counts) — the rollup holds no others.
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
    into v_bytes, v_objects
    from public.images i
   where i.workspace_id = p_workspace_id
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  perform public._storage_usage_apply(v_old, -v_bytes, -v_objects);
  perform public._storage_usage_apply(p_new_owner, v_bytes, v_objects);

  -- 0395: tell the new owner, with their own numbers (counted AFTER the
  -- hand-over, so this workspace is included). Only the free plan has a card
  -- cap (enforce_demo_card_cap_trg), so only it gets numbers.
  begin
    select coalesce(p.tier, 'demo'), coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
      into v_tier, v_cap
      from public.profiles p where p.user_id = p_new_owner;
    v_tier  := coalesce(v_tier, 'demo');
    v_cap   := coalesce(v_cap, 50);
    v_count := public._owner_card_count(p_new_owner);

    insert into public.notifications (user_id, kind, workspace_id, actor_id, title, body, data)
    values (
      p_new_owner,
      'workspace.ownership_received',
      p_workspace_id,
      auth.uid(),
      format('You now own "%s"', coalesce(nullif(btrim(v_name), ''), 'a workspace')),
      case
        when v_tier = 'demo' and v_count > v_cap then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards, so no new cards can be added to workspaces you own until you upgrade or clear space.', v_count, v_cap)
        when v_tier = 'demo' then
          format('Its cards, files and storage now count toward your plan. You''re at %s of %s cards.', v_count, v_cap)
        else
          'Its cards, files and storage now count toward your plan.'
      end || v_note,
      jsonb_build_object(
        'card_count', v_count,
        'card_limit', case when v_tier = 'demo' then v_cap end,
        'over_limit', (v_tier = 'demo' and v_count > v_cap)
      )
    );
  exception when others then
    raise warning 'transfer_workspace_ownership: could not notify the new owner of %: %', p_workspace_id, sqlerrm;
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_xfer int := 0;
  v_del  int := 0;
  r record;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;
  -- 0371: a banned account cannot delete itself: that would take the record
  -- of what it did with it and free the address to sign up again. An admin
  -- can still delete it (admin-account-action does not come through here).
  if public._user_banned(p_user_id) then
    raise exception 'this account is suspended; contact support to close it' using errcode = '42501';
  end if;
  -- 0530: an open team always has its owner (organizations_open_has_owner).
  if exists (select 1 from public.organizations o
              where o.owner_id = p_user_id and o.closed_at is null) then
    raise exception 'this account owns a team; close the team first'
      using errcode = '42501', hint = 'team_owner';
  end if;

  -- 0388: the heir is the longest-standing member who can EDIT — owner, admin
  -- or editor; never a viewer, a service account or a banned account — and
  -- becomes the owner in workspace_members as well as created_by. A workspace
  -- with no such member goes with the account, like one nobody else is in.
  for r in
    select w.id, public._deletion_heir(w.id, p_user_id) as to_user
      from workspaces w
     where w.created_by = p_user_id
  loop
    if r.to_user is not null then
      update workspaces set created_by = r.to_user where id = r.id;
      update workspace_members set role = 'owner' where workspace_id = r.id and user_id = r.to_user;
      v_xfer := v_xfer + 1;
    end if;
  end loop;

  delete from workspaces w where w.created_by = p_user_id;
  get diagnostics v_del = row_count;

  return jsonb_build_object('workspaces_transferred', v_xfer,
                            'workspaces_deleted', v_del);
end;
$function$;

create or replace function public.prepare_admin_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_xfer int := 0;
  v_left int := 0;
  r record;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required' using errcode = '22004';
  end if;
  -- 0530: an open team always has its owner; admin tooling for a banned team
  -- owner is an S4 item.
  if exists (select 1 from public.organizations o
              where o.owner_id = p_user_id and o.closed_at is null) then
    raise exception 'this account owns a team; close the team first'
      using errcode = '42501', hint = 'team_owner';
  end if;

  for r in
    select w.id, public._deletion_heir(w.id, p_user_id) as to_user
      from workspaces w
     where w.created_by = p_user_id
  loop
    if r.to_user is not null then
      update workspaces set created_by = r.to_user where id = r.id;
      update workspace_members set role = 'owner' where workspace_id = r.id and user_id = r.to_user;
      v_xfer := v_xfer + 1;
    end if;
  end loop;

  select count(*) into v_left from workspaces w where w.created_by = p_user_id;

  return jsonb_build_object('workspaces_transferred', v_xfer,
                            'workspaces_left', v_left);
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_deletion_impact()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- The same heir rule prepare_account_deletion applies (_deletion_heir,
  -- 0388), so the confirmation screen names the person who will own it.
  with me as (select auth.uid() as uid),
  mine as (
    select w.id, w.name, public._deletion_heir(w.id, (select uid from me)) as heir_id
      from workspaces w
     where w.created_by = (select uid from me)
  )
  select jsonb_build_object(
    'workspaces_deleted', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from mine where heir_id is null), '[]'::jsonb),
    'workspaces_transferred', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name,
                                          'to_name', coalesce(nullif(p.display_name, ''), 'a collaborator')) order by m.name)
      from mine m left join profiles p on p.user_id = m.heir_id
      where m.heir_id is not null), '[]'::jsonb),
    'clusters_deleted', coalesce((
      select count(*) from boards b
      where b.workspace_id in (select id from mine where heir_id is null)
        and b.deleted_at is null), 0),
    'memberships_dropped', coalesce((
      select count(*) from workspace_members m
      join workspaces w on w.id = m.workspace_id
      where m.user_id = (select uid from me)
        and w.created_by is distinct from (select uid from me)), 0),
    'subscription_active', exists (
      select 1 from subscriptions s
      where s.user_id = (select uid from me)
        and s.status in ('active', 'trialing')),
    -- 0530: deletion is refused while this is true (close the team first).
    'owns_team', exists (
      select 1 from public.organizations o
      where o.owner_id = (select uid from me)
        and o.closed_at is null)
  );
$function$;

-- ── 5. New RPCs ─────────────────────────────────────────────────────────────

-- The workspace room's door (party/auth.ts): may the caller be in this workspace?
create or replace function public.can_open_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public._actor_active() and public.is_workspace_member(p_workspace_id);
$$;

-- What the app should call the caller's role here: the stronger of their row
-- and the team's. Null when they have neither, or are suspended.
create or replace function public.my_workspace_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r from (
    select (select m.role from public.workspace_members m
             where m.workspace_id = p_workspace_id and m.user_id = auth.uid()) as r
    union all
    select public._org_ws_role_for(p_workspace_id, auth.uid())
  ) x
  where public._actor_active() and r is not null
  order by public._ws_role_rank(r) desc
  limit 1;
$$;

-- ── 6. Grants (0311) ────────────────────────────────────────────────────────
-- create or replace kept every re-emitted function's ACL; the proofs below
-- re-assert them.

revoke execute on function public._org_ws_role_for(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._my_org_workspace_ids() from public, anon, authenticated;
revoke execute on function public._ws_role_rank(text) from public, anon, authenticated;

revoke execute on function public.can_open_workspace(uuid) from public, anon;
revoke execute on function public.my_workspace_role(uuid) from public, anon;
grant execute on function public.can_open_workspace(uuid) to authenticated;
grant execute on function public.my_workspace_role(uuid) to authenticated;


-- Re-emitted functions that were already client-proof: restated, so the file
-- that now defines each one says so (no ACL changes; the live ACLs already
-- hold only postgres and service_role).
revoke execute on function public._workspace_member_can_write(uuid) from public, anon, authenticated;
revoke execute on function public._user_can_read_board(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._file_share_reaches(public.file_shares, uuid) from public, anon, authenticated;
revoke execute on function public._workspace_invite_link_live(uuid) from public, anon, authenticated;
revoke execute on function public.scout_can_write_board(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
revoke execute on function public.prepare_admin_account_deletion(uuid) from public, anon, authenticated;

-- ── 7. Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──

do $$
declare
  v_fn text;
begin
  -- The rooms' re-checks are the security session's (0620–0622, PTY-1). The
  -- party's minute alarms ask them, so they are live before the org branch is.
  foreach v_fn in array array[
    'public.party_board_access(uuid,uuid[])', 'public.party_workspace_access(uuid,uuid[])'] loop
    if to_regprocedure(v_fn) is null then
      raise exception '0530 needs the security session''s % (0620–0622) live first', v_fn;
    end if;
  end loop;

  -- Not callable by any client.
  foreach v_fn in array array[
    'public._org_ws_role_for(uuid,uuid)', 'public._my_org_workspace_ids()', 'public._ws_role_rank(text)',
    'public._workspace_member_can_write(uuid)', 'public._user_can_read_board(uuid,uuid)',
    'public._file_share_reaches(public.file_shares,uuid)', 'public._workspace_invite_link_live(uuid)',
    'public.scout_can_write_board(uuid,uuid)',
    'public.party_board_access(uuid,uuid[])', 'public.party_workspace_access(uuid,uuid[])'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0530: % is client-executable', v_fn;
    end if;
  end loop;

  -- The deletion paths run as the service role only.
  foreach v_fn in array array[
    'public.prepare_account_deletion(uuid)', 'public.prepare_admin_account_deletion(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0530: % is client-executable', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0530: % lost its service_role grant', v_fn;
    end if;
  end loop;

  -- The party's re-checks are the service role's.
  foreach v_fn in array array[
    'public.party_board_access(uuid,uuid[])', 'public.party_workspace_access(uuid,uuid[])'] loop
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0530: % is not callable by the service role', v_fn;
    end if;
  end loop;

  -- Signed in only.
  foreach v_fn in array array[
    'public.can_manage_workspace(uuid)', 'public.workspace_user_directory()',
    'public.merge_workspace_settings(uuid,jsonb)', 'public.get_or_create_personal_workspace(uuid,text)',
    'public.transfer_workspace_ownership(uuid,uuid)', 'public.my_deletion_impact()',
    'public.can_open_workspace(uuid)', 'public.my_workspace_role(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0530: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0530: % is not callable signed in', v_fn;
    end if;
  end loop;

  -- RLS evaluates these for anon SELECTs too (0319); they keep their grants.
  foreach v_fn in array array[
    'public.is_workspace_member(uuid)', 'public.my_workspace_ids()', 'public.my_readable_board_ids()'] loop
    if not has_function_privilege('anon', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0530: % lost a grant RLS needs', v_fn;
    end if;
  end loop;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('_org_ws_role_for', '_my_org_workspace_ids', '_ws_role_rank',
                                  'is_workspace_member', '_workspace_member_can_write', 'can_manage_workspace',
                                  'my_workspace_ids', 'my_readable_board_ids', '_user_can_read_board',
                                  'scout_can_write_board', '_file_share_reaches', '_workspace_invite_link_live',
                                  'workspace_user_directory', 'merge_workspace_settings',
                                  'get_or_create_personal_workspace', 'transfer_workspace_ownership',
                                  'prepare_account_deletion', 'prepare_admin_account_deletion',
                                  'my_deletion_impact', 'can_open_workspace', 'my_workspace_role',
                                  'party_board_access', 'party_workspace_access')
              group by p.proname having count(*) > 1) then
    raise exception '0530: an overload exists (PGRST203)';
  end if;

  -- Applying this changes nothing for anyone: no team exists, so no branch fires.
  if exists (select 1 from public.organizations) then
    raise exception '0530: an organization exists';
  end if;
  if cardinality(public._my_org_workspace_ids()) <> 0 then
    raise exception '0530: the team branch reaches a workspace with no team';
  end if;
  if public._org_ws_role_for((select w.id from public.workspaces w limit 1), gen_random_uuid()) is not null then
    raise exception '0530: a stranger has a team role';
  end if;
end $$;

commit;
