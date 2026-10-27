-- 0705 — Drafts: what someone makes in ChatGPT or Claude before they have an
-- account, and how they keep it.
--
-- Someone asks ChatGPT or Claude for a moodboard and the AI reaches for
-- Clusters. They have no account, and stopping them at a sign-in before they
-- have seen anything is where they would leave. So the MCP server's own
-- endpoint (/mcp) lets the AI start without one: the first thing it makes
-- creates a DRAFT, and every answer carries a link to keep it.
--
-- A draft is an ordinary free account nobody has claimed yet. The Worker makes
-- the auth user the way it makes a service identity (apiAuth.js), with an
-- undeliverable address, draft+<id>@draft.soleilpictures.com, and it gets a
-- workspace and a root cluster from get_or_create_personal_workspace, as a
-- Scout account does. The API then acts as it through the same user session as
-- any API caller, so RLS, the 50-card trigger (enforce_demo_card_cap_trg, which
-- caps the 'demo' tier) and the 5 GB upload gates apply without a second
-- authorization path. Its profile is set to 'demo' and is_service, which the
-- admin's demo, trial and money counters already leave out.
--
-- The AI finds the draft again by the key every answer carries (`dk_…`, passed
-- back as the tools' `draft` argument), or by ChatGPT's anonymous user id. Both
-- tokens are derived in the Worker from a secret and the draft's id, so they
-- can be shown again on any later answer; only their sha256 is stored here.
--
-- KEEPING is the draft's workspace changing hands (keep_mcp_draft): its owner,
-- its owner membership, who made its clusters, and its stored bytes move to the
-- person keeping it, exactly as transfer_workspace_ownership moves them.
-- Nothing is copied and nothing moves between workspaces, so nothing that
-- carries a workspace_id (40-odd tables) can be left pointing at the old one.
-- Someone new finds it as their own workspace on their first visit; someone
-- who already has one gets it as a second workspace named after its cluster.
--
-- Drafts last 30 days from their last change. mcp_draft_reap (the Worker's
-- daily cron) deletes an expired draft's workspace, whose files go to the R2
-- tombstones the nightly sweep reads, and hands back the auth users the Worker
-- then deletes: expired drafts' and kept drafts' alike.
--
-- Nothing is mailed to a synthetic address: _email_deliverable now says no for
-- the draft, service and Scout domains, and lifecycle_claim_send asks it
-- before every lifecycle send. A draft is not a signup: _admin_entered_code
-- leaves out synthetic addresses.

set local lock_timeout = '3s';

-- ── 1. The table ─────────────────────────────────────────────────────────────
-- Service role only: RLS on and no policy, and nothing granted to a client.
create table if not exists public.mcp_drafts (
  id            uuid primary key,
  user_id       uuid unique references auth.users(id) on delete set null,
  workspace_id  uuid references public.workspaces(id) on delete set null,
  key_hash      text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  keep_hash     text not null unique check (keep_hash ~ '^[0-9a-f]{64}$'),
  subject_hash  text check (subject_hash ~ '^[0-9a-f]{64}$'),
  host          text not null default 'other' check (host in ('chatgpt', 'claude', 'other')),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  claimed_at    timestamptz,
  claimed_by    uuid references auth.users(id) on delete set null,
  reaped_at     timestamptz,
  req_window    timestamptz not null default now(),
  req_count     integer not null default 0
);

comment on table public.mcp_drafts is
  '0705: a draft made through /mcp before its maker has an account. user_id is a real auth user with a draft+…@draft.soleilpictures.com address; keep_mcp_draft hands its workspace to whoever keeps it.';

-- One live draft per ChatGPT user: the next conversation finds the same one.
create unique index if not exists mcp_drafts_live_subject
  on public.mcp_drafts (subject_hash)
  where subject_hash is not null and claimed_at is null and reaped_at is null;
create index if not exists mcp_drafts_due
  on public.mcp_drafts (expires_at)
  where reaped_at is null;
create index if not exists mcp_drafts_created
  on public.mcp_drafts (created_at);

alter table public.mcp_drafts enable row level security;
revoke all on table public.mcp_drafts from public, anon, authenticated;

-- ── 2. Synthetic addresses ───────────────────────────────────────────────────
-- Addresses the product makes up and no mailbox receives: a draft's, a service
-- identity's (0362) and a Scout shell's (0206).
create or replace function public._synthetic_address(p_email text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(lower(p_email) ~ '@(draft|service|scout)\.soleilpictures\.com$', false);
$$;
revoke execute on function public._synthetic_address(text) from public, anon, authenticated;

-- 0237's body, after a check that the address can receive mail at all.
create or replace function public._email_deliverable(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, auth as $$
  select not exists (
    select 1 from auth.users u
     where u.id = p_user_id and public._synthetic_address(u.email)
  )
  and not exists (
    select 1
    from (
      select max(es.bounced_at)   as last_bounce,
             max(es.delivered_at) as last_delivery
      from public.email_sends es
      join auth.users u on lower(u.email) = lower(es.recipient_email)
      where u.id = p_user_id
    ) s
    where s.last_bounce is not null
      and (s.last_delivery is null or s.last_delivery < s.last_bounce)
  );
$$;
revoke all on function public._email_deliverable(uuid) from public, anon, authenticated;

-- 0461's body, without the accounts nobody signs in to.
create or replace function public._admin_entered_code()
returns table (entered_id uuid)
language sql stable security definer set search_path = public
as $$
  -- Cheapest evidence first. Asking for a code can make none of it.
  select u.id
    from auth.users u
   where u.email_confirmed_at is not null
     -- 0705: a draft, a service identity or a Scout shell never typed a code.
     and not public._synthetic_address(u.email)
     and (   u.id in (select w.created_by from public.workspaces w)
          or u.id in (select d.user_id from public.user_active_day d)
          or (select count(*) from auth.sessions s where s.user_id = u.id) > 1
          or exists (select 1 from public.analytics_events e
                      where e.user_id = u.id and e.session_id is not null));
$$;
revoke all on function public._admin_entered_code() from public, anon, authenticated;
grant execute on function public._admin_entered_code() to service_role;

-- ── 3. Admitting, registering and finding a draft (the Worker, service role) ─

-- Room for one more draft, or for more draft bytes, today. Two ceilings across
-- every draft at once, so a script that skips the AI cannot fill the database
-- or the bucket: a day's new drafts and a day's bytes stored in drafts. Hitting
-- either pages the owner once a day and answers 'paused'.
create or replace function public.mcp_draft_admit(p_kind text default 'create')
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  c_daily_drafts constant integer := 200;
  c_daily_bytes  constant bigint  := 21474836480;   -- 20 GiB
  v_n     integer;
  v_bytes bigint;
begin
  if p_kind = 'bytes' then
    select coalesce(sum(i.size_bytes), 0)::bigint into v_bytes
      from public.images i
      join public.mcp_drafts d on d.workspace_id = i.workspace_id
     where d.claimed_at is null and d.reaped_at is null
       and i.created_at > now() - interval '24 hours';
    if v_bytes >= c_daily_bytes then
      perform public.ops_alert_raise('mcp_drafts', 'Drafts stopped storing new files for today',
        format('Drafts made through /mcp stored %s bytes in the last 24 hours, the ceiling in mcp_draft_admit (0705). New pictures in drafts are refused until the day rolls over.', v_bytes),
        true, 'mcp_drafts:bytes', interval '24 hours');
      return 'paused';
    end if;
    return 'ok';
  end if;

  select count(*) into v_n from public.mcp_drafts where created_at > now() - interval '24 hours';
  if v_n >= c_daily_drafts then
    perform public.ops_alert_raise('mcp_drafts', 'New drafts paused for today',
      format('%s drafts were made through /mcp in the last 24 hours, the ceiling in mcp_draft_admit (0705). ChatGPT and Claude are asking people to sign in until the day rolls over.', v_n),
      true, 'mcp_drafts:create', interval '24 hours');
    return 'paused';
  end if;
  return 'ok';
end;
$$;
revoke execute on function public.mcp_draft_admit(text) from public, anon, authenticated;

-- The auth user exists and get_or_create_personal_workspace has given it a
-- workspace; record it as a draft. Returns when it expires.
create or replace function public.mcp_draft_register(
  p_id uuid, p_user_id uuid, p_workspace_id uuid,
  p_key_hash text, p_keep_hash text, p_subject_hash text default null, p_host text default 'other')
returns timestamptz
language plpgsql security definer
set search_path = public, auth
as $$
declare
  -- Drafts last this long after their last change.
  c_lifetime constant interval := interval '30 days';
  v_exp timestamptz := now() + c_lifetime;
begin
  if not exists (select 1 from auth.users u
                  where u.id = p_user_id
                    and lower(u.email) = 'draft+' || p_id::text || '@draft.soleilpictures.com') then
    raise exception 'not a draft identity' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspaces w
                  where w.id = p_workspace_id and w.created_by = p_user_id and w.org_id is null) then
    raise exception 'that workspace is not the draft''s own' using errcode = '22023';
  end if;

  -- Capped like any free account (the cap trigger caps 'demo' only), and left
  -- out of the people-counting the admin does for real accounts.
  update public.profiles set tier = 'demo', is_service = true where user_id = p_user_id;

  -- A ChatGPT user's expired, unreaped draft gives up its subject to the new one.
  if p_subject_hash is not null then
    update public.mcp_drafts set subject_hash = null
     where subject_hash = p_subject_hash and claimed_at is null and reaped_at is null
       and expires_at <= now();
  end if;

  insert into public.mcp_drafts (id, user_id, workspace_id, key_hash, keep_hash, subject_hash, host, expires_at)
  values (p_id, p_user_id, p_workspace_id, p_key_hash, p_keep_hash, p_subject_hash,
          case when p_host in ('chatgpt', 'claude') then p_host else 'other' end, v_exp);
  return v_exp;
end;
$$;
revoke execute on function public.mcp_draft_register(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;

-- The draft a call belongs to: by its key first, else by ChatGPT's subject.
-- One row; `state` is live | kept | expired | rate_limited | unknown. Every
-- call counts toward the hour's window; a write also pushes the expiry out.
create or replace function public.mcp_draft_resolve(
  p_key_hash text, p_subject_hash text default null, p_write boolean default false)
returns table (draft_id uuid, user_id uuid, workspace_id uuid, state text, host text,
               expires_at timestamptz, req_count integer, req_limit integer, req_reset timestamptz)
language plpgsql security definer
set search_path = public
as $$
declare
  c_lifetime  constant interval := interval '30 days';
  -- Requests an hour for one draft, as for a new account's connected app (0704).
  c_req_limit constant integer := 300;
  d       public.mcp_drafts;
  v_count integer;
  v_reset timestamptz;
begin
  if p_key_hash is not null then
    select * into d from public.mcp_drafts m where m.key_hash = p_key_hash;
  end if;
  if d.id is null and p_subject_hash is not null then
    -- The live one if there is one, else the newest, so a kept draft says so.
    select * into d from public.mcp_drafts m
     where m.subject_hash = p_subject_hash
     order by (m.claimed_at is null and m.reaped_at is null) desc, m.created_at desc
     limit 1;
  end if;
  if d.id is null then
    return query select null::uuid, null::uuid, null::uuid, 'unknown'::text, null::text,
                        null::timestamptz, null::integer, c_req_limit, null::timestamptz;
    return;
  end if;
  if d.claimed_at is not null then
    return query select d.id, null::uuid, d.workspace_id, 'kept'::text, d.host,
                        d.expires_at, null::integer, c_req_limit, null::timestamptz;
    return;
  end if;
  if d.reaped_at is not null or d.expires_at <= now() or d.user_id is null or d.workspace_id is null then
    return query select d.id, null::uuid, null::uuid, 'expired'::text, d.host,
                        d.expires_at, null::integer, c_req_limit, null::timestamptz;
    return;
  end if;

  update public.mcp_drafts m
     set req_window   = case when now() - m.req_window > interval '1 hour' then now() else m.req_window end,
         req_count    = case when now() - m.req_window > interval '1 hour' then 1 else m.req_count + 1 end,
         last_used_at = now(),
         expires_at   = case when p_write then now() + c_lifetime else m.expires_at end
   where m.id = d.id
  returning m.req_count, m.req_window + interval '1 hour', m.expires_at into v_count, v_reset, d.expires_at;

  return query select d.id, d.user_id, d.workspace_id,
                      case when v_count > c_req_limit then 'rate_limited' else 'live' end,
                      d.host, d.expires_at, v_count, c_req_limit, v_reset;
end;
$$;
revoke execute on function public.mcp_draft_resolve(text, text, boolean) from public, anon, authenticated;

-- The cluster a draft opens on: its most recently changed live top-level
-- cluster, else the root itself.
create or replace function public._mcp_draft_main_board(p_workspace_id uuid)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select b.id from public.boards b
       join public.boards r on r.id = b.parent_board_id
      where b.workspace_id = p_workspace_id and r.workspace_id = p_workspace_id
        and r.parent_board_id is null and r.deleted_at is null and b.deleted_at is null
      order by b.updated_at desc, b.created_at desc limit 1),
    (select r.id from public.boards r
      where r.workspace_id = p_workspace_id and r.parent_board_id is null and r.deleted_at is null
      order by r.created_at limit 1));
$$;
revoke execute on function public._mcp_draft_main_board(uuid) from public, anon, authenticated;

-- ── 4. The keep page's view (the Worker, service role) ───────────────────────
-- What /keep/<token> shows: the draft's state, and while it is live the same
-- bundle a share link's viewer reads (get_share_bundle's shape), for its main
-- cluster or one of the draft's own clusters the page asks for.
create or replace function public.mcp_draft_keep_view(p_keep_hash text, p_board_id uuid default null)
returns json
language plpgsql security definer
set search_path = public
as $$
declare
  d          public.mcp_drafts;
  v_target   uuid;
  v_board    record;
  v_snapshot text;
  v_keys     text[];
  v_meta     json;
  v_nav      json;
  v_cards    integer;
  v_limit    integer;
begin
  select * into d from public.mcp_drafts m where m.keep_hash = p_keep_hash;
  if d.id is null then
    return json_build_object('state', 'unknown');
  end if;
  if d.claimed_at is not null then
    return json_build_object('state', 'kept', 'host', d.host);
  end if;
  if d.reaped_at is not null or d.expires_at <= now() or d.workspace_id is null then
    return json_build_object('state', 'expired', 'host', d.host);
  end if;

  v_target := public._mcp_draft_main_board(d.workspace_id);
  if p_board_id is not null and exists (
       select 1 from public.boards b
        where b.id = p_board_id and b.workspace_id = d.workspace_id and b.deleted_at is null) then
    v_target := p_board_id;
  end if;

  select b.id, b.name, b.view, b.cover, b.bg_color into v_board from public.boards b where b.id = v_target;
  select s.doc into v_snapshot from public.board_state s where s.board_id = v_target;

  -- get_share_bundle's three key sets, for this board.
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
  from (
    select i.storage_path as k from public.images i
     where i.storage_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_path from public.images i
     where i.preview_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
    union
    select i.preview_sm_path from public.images i
     where i.preview_sm_path is not null and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
  ) s;

  select coalesce(jsonb_object_agg(i.storage_path, jsonb_build_object(
           'blur', i.blur_hash, 'preview', i.preview_path, 'preview_w', i.preview_w, 'preview_h', i.preview_h,
           'preview_sm', i.preview_sm_path, 'preview_sm_w', i.preview_sm_w, 'preview_sm_h', i.preview_sm_h)),
         '{}'::jsonb)::json
    into v_meta
    from public.images i
   where i.storage_path is not null
     and (i.board_id = v_target or v_target = any(i.referenced_in_board_ids))
     and (i.blur_hash is not null or i.preview_path is not null);

  -- Every live cluster in the draft but its root, so the page can move between them.
  select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.created_at), '[]'::json)
    into v_nav
    from public.boards b
   where b.workspace_id = d.workspace_id and b.parent_board_id is not null and b.deleted_at is null;

  v_cards := public._owner_card_count(d.user_id);
  select coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0) into v_limit
    from public.profiles p where p.user_id = d.user_id;

  return json_build_object(
    'state', 'live',
    'host', d.host,
    'expires_at', d.expires_at,
    'card_count', v_cards,
    'card_limit', coalesce(v_limit, 50),
    'bundle', json_build_object(
      'board', json_build_object('id', v_board.id, 'name', v_board.name, 'view', v_board.view,
                                 'cover', v_board.cover, 'bg_color', v_board.bg_color),
      'snapshot', v_snapshot,
      'image_keys', v_keys,
      'image_meta', v_meta,
      'role', 'viewer',
      'root_id', v_target,
      'include_subboards', true,
      'nav_boards', v_nav,
      'join', null));
end;
$$;
revoke execute on function public.mcp_draft_keep_view(text, uuid) from public, anon, authenticated;

-- ── 5. Keeping it (the person, signed in) ────────────────────────────────────
-- The hand-over: the draft's workspace becomes the keeper's, as
-- transfer_workspace_ownership hands a workspace over (its owner, the owner's
-- membership, who made its clusters, the stored bytes), without its "already a
-- member" rule, which a draft's keeper never is. keep_mcp_draft's alone.
create or replace function public._mcp_draft_hand_over(
  p_draft_id uuid, p_keeper uuid, p_beside_own boolean, p_name text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  d         public.mcp_drafts;
  v_bytes   bigint;
  v_objects bigint;
begin
  select * into d from public.mcp_drafts m where m.id = p_draft_id;

  -- The owner first, so the member row below is the owner's own and mails nobody.
  -- Beside an older workspace of theirs it also counts as newer, so that one stays
  -- the workspace get_or_create_personal_workspace (oldest first) opens.
  perform set_config('soleil.quiet_member_email', '1', true);
  update public.workspaces
     set created_by = p_keeper,
         name = case when p_beside_own and nullif(btrim(p_name), '') is not null then left(btrim(p_name), 80) else name end,
         created_at = case when p_beside_own then now() else created_at end
   where id = d.workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (d.workspace_id, p_keeper, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  delete from public.workspace_members where workspace_id = d.workspace_id and user_id = d.user_id;
  update public.boards set created_by = p_keeper
   where workspace_id = d.workspace_id and created_by is not distinct from d.user_id;
  -- The draft's auth user is deleted after this; what it added is the keeper's.
  update public.images set uploaded_by = p_keeper
   where workspace_id = d.workspace_id and uploaded_by = d.user_id;
  -- import_jobs.owner_id cascades with its auth user, which goes next.
  update public.import_jobs set owner_id = p_keeper where owner_id = d.user_id;

  -- 0397/0411: the counted bytes follow the owner now, not at 03:55 UTC.
  select coalesce(sum(i.size_bytes), 0)::bigint, count(*)::bigint
    into v_bytes, v_objects
    from public.images i
   where i.workspace_id = d.workspace_id
     and public._image_counts(i.deleted_at, i.storage_path, i.ref_count, i.live_board_ids, i.first_referenced_at);
  perform public._storage_usage_apply(d.user_id, -v_bytes, -v_objects);
  perform public._storage_usage_apply(p_keeper, v_bytes, v_objects);

  update public.mcp_drafts set claimed_at = now(), claimed_by = p_keeper where id = d.id;
end;
$$;
revoke execute on function public._mcp_draft_hand_over(uuid, uuid, boolean, text) from public, anon, authenticated;

-- The token is the one in /keep/<token>.
create or replace function public.keep_mcp_draft(p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_me      uuid := auth.uid();
  v_email   text;
  d         public.mcp_drafts;
  v_has_own boolean;
  v_board   uuid;
  v_name    text;
  v_tier    text;
  v_cap     integer;
  v_count   integer;
begin
  if v_me is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  select u.email into v_email from auth.users u where u.id = v_me;
  if v_email is null or public._synthetic_address(v_email) then
    raise exception 'sign in with your own email address to keep a draft'
      using errcode = '42501', hint = 'not_a_person';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'that is not a keep link' using errcode = '22023', hint = 'draft_unknown';
  end if;

  select * into d from public.mcp_drafts m
   where m.keep_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
   for update;
  if d.id is null then
    raise exception 'there is no draft at that link' using errcode = 'P0002', hint = 'draft_unknown';
  end if;
  if d.claimed_at is not null then
    if d.claimed_by = v_me then
      -- Twice, from two tabs or a retry: the same answer, nothing done again.
      return jsonb_build_object('status', 'kept', 'already', true, 'workspace_id', d.workspace_id,
                                'board_id', public._mcp_draft_main_board(d.workspace_id));
    end if;
    raise exception 'someone has already kept this draft' using errcode = '42501', hint = 'draft_kept';
  end if;
  if d.reaped_at is not null or d.expires_at <= now() or d.workspace_id is null or d.user_id is null then
    raise exception 'this draft has been deleted' using errcode = 'P0002', hint = 'draft_expired';
  end if;

  -- Someone who already has a workspace of their own gets this one beside it,
  -- named after its cluster; someone new gets it as theirs.
  v_has_own := exists (select 1 from public.workspaces w
                        where w.created_by = v_me and w.org_id is null and w.id <> d.workspace_id);
  v_board := public._mcp_draft_main_board(d.workspace_id);
  select b.name into v_name from public.boards b where b.id = v_board and b.parent_board_id is not null;
  perform public._mcp_draft_hand_over(d.id, v_me, v_has_own, v_name);

  perform public._log_security_event('workspace.draft_kept', d.workspace_id,
    jsonb_build_object('draft_id', d.id, 'host', d.host, 'from_user', d.user_id));
  begin
    insert into public.analytics_events (user_id, event, props)
    values (v_me, 'mcp_draft_kept', jsonb_build_object('host', d.host, 'beside_own', v_has_own));
  exception when others then null;
  end;

  select coalesce(p.tier, 'demo'), coalesce(p.card_cap_base, 50) + coalesce(p.bonus_card_credits, 0)
    into v_tier, v_cap
    from public.profiles p where p.user_id = v_me;
  v_count := public._owner_card_count(v_me);

  return jsonb_build_object(
    'status', 'kept',
    'already', false,
    'workspace_id', d.workspace_id,
    'board_id', v_board,
    'beside_own', v_has_own,
    'card_count', v_count,
    'card_limit', case when coalesce(v_tier, 'demo') = 'demo' then coalesce(v_cap, 50) end);
end;
$$;
revoke execute on function public.keep_mcp_draft(text) from public, anon;
grant execute on function public.keep_mcp_draft(text) to authenticated;

-- ── 6. Clearing up (the Worker's daily cron, service role) ──────────────────
-- Expired drafts lose their workspace (its files are tombstoned by
-- images_tombstone_r2_keys for the nightly R2 sweep); expired and kept drafts
-- alike hand back their auth user for the Worker to delete. A row whose user
-- is still there after an earlier reap comes back again until it is gone
-- (user_id is set null when the auth user is deleted). Rows past their reap
-- by 90 days are forgotten, so an old link says "gone" for that long.
create or replace function public.mcp_draft_reap(p_limit integer default 25)
returns table (draft_id uuid, user_id uuid, outcome text)
language plpgsql security definer
set search_path = public
as $$
declare
  d record;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 200));
begin
  for d in
    select m.* from public.mcp_drafts m
     where (m.reaped_at is null and (m.claimed_at is not null or m.expires_at <= now()))
        or (m.reaped_at is not null and m.user_id is not null)
     order by coalesce(m.reaped_at, m.claimed_at, m.expires_at)
     limit v_limit
     for update skip locked
  loop
    if d.reaped_at is null then
      if d.claimed_at is null and d.workspace_id is not null then
        delete from public.workspaces w
         where w.id = d.workspace_id and w.created_by is not distinct from d.user_id;
      end if;
      -- The subject stays: a ChatGPT user whose draft was kept is still told
      -- to connect their account, rather than handed a fresh draft.
      update public.mcp_drafts m set reaped_at = now() where m.id = d.id;
    end if;
    draft_id := d.id;
    user_id  := d.user_id;
    outcome  := case when d.claimed_at is null then 'expired' else 'kept' end;
    return next;
  end loop;

  delete from public.mcp_drafts m where m.reaped_at < now() - interval '90 days' and m.user_id is null;
end;
$$;
revoke execute on function public.mcp_draft_reap(integer) from public, anon, authenticated;

-- ── 7. The 0311 habit: prove the grants and the rules ────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._synthetic_address(text)',
    'public._email_deliverable(uuid)',
    'public._admin_entered_code()',
    'public.mcp_draft_admit(text)',
    'public.mcp_draft_register(uuid, uuid, uuid, text, text, text, text)',
    'public.mcp_draft_resolve(text, text, boolean)',
    'public._mcp_draft_main_board(uuid)',
    'public.mcp_draft_keep_view(text, uuid)',
    'public._mcp_draft_hand_over(uuid, uuid, boolean, text)',
    'public.mcp_draft_reap(integer)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0705: % is callable by a client', f;
    end if;
  end loop;
  foreach f in array array[
    'public.mcp_draft_admit(text)',
    'public.mcp_draft_register(uuid, uuid, uuid, text, text, text, text)',
    'public.mcp_draft_resolve(text, text, boolean)',
    'public.mcp_draft_keep_view(text, uuid)',
    'public.mcp_draft_reap(integer)'
  ] loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '0705: the Worker (service_role) cannot run %', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.keep_mcp_draft(text)', 'execute') then
    raise exception '0705: keep_mcp_draft is callable signed out';
  end if;
  if not has_function_privilege('authenticated', 'public.keep_mcp_draft(text)', 'execute') then
    raise exception '0705: a signed-in person cannot run keep_mcp_draft';
  end if;
  if has_table_privilege('anon', 'public.mcp_drafts', 'select')
     or has_table_privilege('authenticated', 'public.mcp_drafts', 'select') then
    raise exception '0705: mcp_drafts is readable by a client';
  end if;
  if not public._synthetic_address('draft+00000000-0000-0000-0000-000000000000@draft.soleilpictures.com')
     or not public._synthetic_address('svc+x@SERVICE.soleilpictures.com')
     or not public._synthetic_address('telegram-ab12@scout.soleilpictures.com')
     or public._synthetic_address('sam@soleilpictures.com')
     or public._synthetic_address('draft@example.com')
     or public._synthetic_address('x@draft.soleilpictures.com.example.com')
     or public._synthetic_address(null) then
    raise exception '0705: _synthetic_address does not match exactly the three made-up domains';
  end if;
end;
$$;
