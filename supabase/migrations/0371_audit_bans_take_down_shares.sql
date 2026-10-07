-- 0371 — a ban takes down what the account shared.
--
-- A ban (admin-account-action: profiles.banned_at plus the native auth ban)
-- stopped the account signing in, and that was all. The 2026-10-06 audit
-- found everything it had put out into the world still working: its share
-- links and published clusters kept serving, and its invitations and invite
-- links still let people in.
--
-- The rule is dynamic, not a sweep: what a banned account owns, made or sent
-- is refused at the point it is served or redeemed, so lifting the ban brings
-- all of it back exactly as it was, and nothing needs undoing.
--
--   1. _user_banned(uid), and _sharer_suspended(uid) — banned, or an account
--      under a week old whose sharing is on hold (0369): what a brand-new
--      account sends out stops working while it is under review.
--   2. Share links, published clusters and published grid layouts stop
--      serving: both resolvers (every public RPC goes through one) and the
--      three listings that read the tables directly (the sitemap, /explore,
--      related clusters, the image index).
--   3. Pending invitations held for review (0369 stamps held_at) or sent by a
--      suspended account cannot be claimed or previewed; neither can its
--      invite links. A suspended account claims nothing either.
--
-- 0373 is the other half (split for size; 0372 belongs to another session):
-- the owner shortcuts, keys and OAuth, shares on trashed clusters,
-- self-deletion, and the record of every account action.

begin;

-- ── 1. Who counts as banned, or as a new account under review ───────────────

-- "Explicitly banned", not "has no profile": this guards other people's
-- content, so an account without a profile row keeps its links working.
create or replace function public._user_banned(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public as $$
  select p_user is not null
     and exists (select 1 from public.profiles p
                  where p.user_id = p_user and p.banned_at is not null);
$$;

-- Banned, or an account under a week old whose sharing is on hold (0369).
-- What a brand-new account sent out stops working while it is under review;
-- an established account on a hold keeps its links (a false positive should
-- not break every link someone has had for months).
create or replace function public._sharer_suspended(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, auth as $$
  select p_user is not null
     and exists (select 1 from public.profiles p
                   join auth.users u on u.id = p.user_id
                  where p.user_id = p_user
                    and (p.banned_at is not null
                         or (p.send_hold_at is not null
                             and u.created_at > now() - interval '7 days')));
$$;

-- ── 2. Shared and published content stops serving ─────────────────────────

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
  if public._sharer_suspended(v_creator)
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

CREATE OR REPLACE FUNCTION public._resolve_published_board(p_slug text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select pb.board_id
  from public_boards pb
  join boards b on b.id = pb.board_id
  join workspaces w on w.id = b.workspace_id
  where pb.slug = p_slug
    and pb.published_at is not null
    and b.deleted_at is null
    -- 0371: nothing a banned account owns or submitted stays published.
    and not public._user_banned(w.created_by)
    and not public._user_banned(pb.submitted_by)
$function$;

CREATE OR REPLACE FUNCTION public.list_public_boards()
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object(
    'slug',             pb.slug,
    'seo_title',        coalesce(pb.seo_title, b.name),
    'seo_description',  pb.seo_description,
    'target_keyword',   pb.target_keyword,
    'priority',         pb.priority,
    'published_at',     pb.published_at,
    'thumb_key',        b.thumb_key,
    'thumb_updated_at', b.thumb_updated_at,
    'thumb_version',    b.thumb_version,
    'card_count',       b.card_count,
    'updated_at',       greatest(pb.updated_at, b.updated_at)
  ) order by pb.priority desc, pb.published_at desc), '[]'::json)
  from public_boards pb
  join boards b on b.id = pb.board_id
  join workspaces w on w.id = b.workspace_id
  where pb.published_at is not null and b.deleted_at is null
    -- 0371: nothing a banned account owns or submitted stays published.
    and not public._user_banned(w.created_by)
    and not public._user_banned(pb.submitted_by);
$function$;

CREATE OR REPLACE FUNCTION public.list_public_board_images(p_board_limit integer DEFAULT 150, p_per_board integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_out json;
begin
  with pubs as (
    select pb.board_id, pb.slug
    from public_boards pb
    join boards b on b.id = pb.board_id and b.deleted_at is null
    join workspaces w on w.id = b.workspace_id
    where pb.published_at is not null
      -- 0371: nothing a banned account owns or submitted stays published.
      and not public._user_banned(w.created_by)
      and not public._user_banned(pb.submitted_by)
    order by pb.priority desc nulls last, pb.published_at desc
    limit greatest(1, least(coalesce(p_board_limit, 150), 500))
  ),
  picked as (
    select p.slug, ci.kind, ci.title, ci.meta, ci.board_id, ci.card_id, ci.updated_at,
           row_number() over (
             partition by p.board_id
             order by ci.updated_at desc, ci.card_id
           ) - 1 as i
    from pubs p
    join lateral (
      with recursive sub as (
        select id from boards where id = p.board_id and deleted_at is null
        union all
        select b.id from boards b join sub s on b.parent_board_id = s.id
        where b.deleted_at is null
      )
      select c.board_id, c.card_id, c.kind, c.title, c.meta, c.updated_at
      from card_index c
      where c.board_id in (select id from sub)
        and c.kind in ('image','note','doc','link')
      order by c.updated_at desc, c.card_id
      limit 60
    ) ci on true
  ),
  imgs as (
    select pk.slug, pk.i,
           coalesce(nullif(ca.alt, ''), pk.meta->>'alt', nullif(pk.title, '')) as title,
           row_number() over (partition by pk.slug order by pk.i) as rn
    from picked pk
    left join card_alts ca on ca.board_id = pk.board_id and ca.card_id = pk.card_id
    where pk.kind = 'image' and (pk.meta->>'src') like 'r2:%'
  )
  select coalesce(
           json_agg(json_build_object('slug', slug, 'i', i, 'title', title)
                    order by slug, i),
           '[]'::json)
    into v_out
  from imgs
  where rn <= greatest(1, least(coalesce(p_per_board, 30), 100));
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_related_public_boards(p_slug text, p_limit integer DEFAULT 6)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_target uuid;
begin
  v_target := _resolve_published_board(p_slug);
  if v_target is null then return '[]'::json; end if;
  return (
    select coalesce(json_agg(json_build_object('slug', t.slug, 'seo_title', t.seo_title)
             order by t.overlap desc, t.published_at desc), '[]'::json)
    from (
      select pb.slug, coalesce(pb.seo_title, b.name) as seo_title, x.overlap, pb.published_at
      from (
        select bt2.board_id, count(*) as overlap
        from board_tags bt1
        join board_tags bt2 on bt2.tag_id = bt1.tag_id and bt2.board_id <> bt1.board_id
        where bt1.board_id = v_target
        group by bt2.board_id
      ) x
      join public_boards pb on pb.board_id = x.board_id and pb.published_at is not null
      join boards b on b.id = pb.board_id and b.deleted_at is null
      join workspaces w on w.id = b.workspace_id
      -- 0371: nothing a banned account owns or submitted is recommended.
      where not public._user_banned(w.created_by)
        and not public._user_banned(pb.submitted_by)
      order by x.overlap desc, pb.published_at desc
      limit greatest(1, least(coalesce(p_limit, 6), 24))
    ) t
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public._resolve_published_grid_layout(p_slug text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.layout_id
  from public_grid_layouts p
  join grid_layouts g on g.id = p.layout_id
  where p.slug = p_slug
    and p.published_at is not null
    and g.deleted_at is null
    -- 0371: nothing a banned account made or submitted stays published.
    and not public._user_banned(g.created_by)
    and not public._user_banned(p.submitted_by);
$function$;

CREATE OR REPLACE FUNCTION public.list_public_grid_layouts(p_limit integer DEFAULT 120)
 RETURNS TABLE(slug text, title text, description text, body jsonb, use_count integer, published_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.slug, p.title, p.description, g.body, p.use_count, p.published_at
  from public_grid_layouts p
  join grid_layouts g on g.id = p.layout_id
  where p.published_at is not null and g.deleted_at is null
    -- 0371: nothing a banned account made or submitted stays published.
    and not public._user_banned(g.created_by)
    and not public._user_banned(p.submitted_by)
  order by p.use_count desc, p.published_at desc
  limit greatest(1, least(coalesce(p_limit, 120), 500));
$function$;

CREATE OR REPLACE FUNCTION public.get_grid_layout_by_token(p_token uuid)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select json_build_object('name', g.name, 'body', g.body)
  from grid_layouts g
  where g.share_token = p_token and g.deleted_at is null
    -- 0371: a layout link dies with its maker's account.
    and not public._sharer_suspended(g.created_by);
$function$;

-- ── 3. Invitations and invite links from a suspended sender do nothing ────

CREATE OR REPLACE FUNCTION public.claim_pending_invite(p_token uuid)
 RETURNS TABLE(workspace_id uuid, board_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
#variable_conflict use_column
declare
  v_row           pending_invites%rowtype;
  v_caller_email  text;
  v_fresh         boolean := false;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to claim invite' using errcode = '42501';
  end if;
  -- 0371: a suspended account acts on nothing.
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;

  select email into v_caller_email from auth.users where id = auth.uid();

  select * into v_row from pending_invites where token = p_token;
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  if v_row.expires_at <= now() then
    raise exception 'invite has expired' using errcode = '22023';
  end if;
  -- 0371: an invitation held while its sender is under review, or one from a
  -- banned account, does nothing.
  if v_row.held_at is not null or public._sharer_suspended(v_row.invited_by) then
    raise exception 'this invitation is no longer valid' using errcode = '22023';
  end if;

  if lower(v_row.email) <> lower(coalesce(v_caller_email, '')) then
    raise exception 'this invite is for a different email' using errcode = '42501';
  end if;

  if v_row.claimed_at is not null and v_row.claimed_by is distinct from auth.uid() then
    raise exception 'invite already claimed' using errcode = '22023';
  end if;

  v_fresh := v_row.claimed_at is null;

  if v_row.board_id is not null then
    insert into board_shares (board_id, user_id, role, invited_by)
    values (v_row.board_id, auth.uid(),
            case when v_row.role = 'editor' then 'editor' else 'viewer' end,
            v_row.invited_by)
    on conflict (board_id, user_id) do nothing;
  else
    insert into workspace_members (workspace_id, user_id, role)
    values (v_row.workspace_id, auth.uid(),
            case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
    on conflict (workspace_id, user_id) do nothing;
  end if;

  update pending_invites
     set claimed_at = coalesce(claimed_at, now()),
         claimed_by = coalesce(claimed_by, auth.uid())
   where id = v_row.id;

  if v_fresh then
    perform public._joined_notification(
      v_row.invited_by, v_row.board_id, v_row.workspace_id, v_row.role, auth.uid());
  end if;

  return query select v_row.workspace_id, v_row.board_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._claim_pending_invites_for_user(p_user_id uuid, p_email text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_row    pending_invites%rowtype;
  v_count  integer := 0;
  v_email_norm text := lower(trim(coalesce(p_email, '')));
begin
  if v_email_norm = '' or p_user_id is null then
    return 0;
  end if;

  for v_row in
    select * from pending_invites
    where lower(email) = v_email_norm
      and claimed_at is null
      and expires_at > now()
      -- 0371: not one held for review, nor one from a banned sender.
      and held_at is null
      and not public._sharer_suspended(invited_by)
  loop
    begin
      if v_row.board_id is not null then
        insert into board_shares (board_id, user_id, role, invited_by)
        values (v_row.board_id, p_user_id,
                case when v_row.role = 'editor' then 'editor' else 'viewer' end,
                v_row.invited_by)
        on conflict (board_id, user_id) do nothing;
      else
        insert into workspace_members (workspace_id, user_id, role)
        values (v_row.workspace_id, p_user_id,
                case when v_row.role = 'viewer' then 'viewer' else 'editor' end)
        on conflict (workspace_id, user_id) do nothing;
      end if;

      update pending_invites
         set claimed_at = now(),
             claimed_by = p_user_id
       where id = v_row.id;

      perform public._joined_notification(
        v_row.invited_by, v_row.board_id, v_row.workspace_id, v_row.role, p_user_id);

      v_count := v_count + 1;
    exception when others then
      raise warning '_claim_pending_invites_for_user: claim id=% failed: %', v_row.id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.peek_pending_invite_email(p_token uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text;
begin
  select email into v_email
  from pending_invites
  where token = p_token
    and claimed_at is null
    and expires_at > now()
    -- 0371: a held or dead invitation prefills nothing.
    and held_at is null
    and not public._sharer_suspended(invited_by);
  return v_email;
end;
$function$;

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
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public._user_banned(uuid) from public, anon, authenticated;
revoke execute on function public._sharer_suspended(uuid) from public, anon, authenticated;

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  v_fn   text;
  v_need text;
  r      record;
begin
  foreach v_fn in array array[
    'public._user_banned(uuid)',
    'public._sharer_suspended(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0371: % is client-executable', v_fn;
    end if;
  end loop;

  -- The public readers stay public.
  foreach v_fn in array array[
    'public.list_public_boards()',
    'public.get_share_meta(uuid,uuid)',
    'public.get_public_board_page(text)',
    'public.list_public_grid_layouts(integer)',
    'public.get_grid_layout_by_token(uuid)',
    'public.peek_pending_invite_email(uuid)'] loop
    if not has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0371: % lost its public grant', v_fn;
    end if;
  end loop;

  for r in
    select * from (values
      ('public._resolve_share_target(uuid,uuid)',            '_sharer_suspended(v_creator)'),
      ('public._resolve_published_board(text)',              '_user_banned(pb.submitted_by)'),
      ('public.list_public_boards()',                        '_user_banned(w.created_by)'),
      ('public.list_public_board_images(integer,integer)',   '_user_banned(w.created_by)'),
      ('public.get_related_public_boards(text,integer)',     '_user_banned(w.created_by)'),
      ('public._resolve_published_grid_layout(text)',        '_user_banned(g.created_by)'),
      ('public.list_public_grid_layouts(integer)',           '_user_banned(g.created_by)'),
      ('public.get_grid_layout_by_token(uuid)',              '_sharer_suspended(g.created_by)'),
      ('public.claim_pending_invite(uuid)',                  'v_row.held_at is not null'),
      ('public._claim_pending_invites_for_user(uuid,text)',  'and held_at is null'),
      ('public.peek_pending_invite_email(uuid)',             'and held_at is null'),
      ('public.claim_collab_link(uuid)',                     '_sharer_suspended(v_link.created_by)')
    ) as t(fn, marker)
  loop
    select prosrc into v_need from pg_proc where oid = r.fn::regprocedure;
    if position(r.marker in v_need) = 0 then
      raise exception '0371: % lacks its check (%)', r.fn, r.marker;
    end if;
  end loop;
end $$;

commit;
