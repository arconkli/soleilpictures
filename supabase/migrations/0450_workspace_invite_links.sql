-- 0450 — one link that brings someone into a whole workspace.
--
-- An invite link today (create_collab_link, 0189/0373) opens one cluster, and
-- a whole workspace takes one email per person. The first-run setup (boards
-- lib/workspaceSetup.js, preview only) asks a new owner to bring their people
-- in, and people share links far more often than they type addresses, so its
-- invite step offers "Copy invite link". Whoever opens the link and signs in
-- becomes an editor (or a viewer) of the whole workspace, never more.
--
-- Nothing calls these yet. They are applied ahead of the client so the
-- preview can be tried against the real database; the client and the docs
-- land with the sidebar's release.
--
-- A link sends no email, so neither the invite budget nor the outbound gate
-- sees it. It has its own bounds, tighter for an account under three days
-- old (_account_is_new, 0375), which is who the first-run setup serves:
--
--   - a link lasts 30 days and 25 joins (a new account's: 7 days, 5 joins);
--   - an account makes at most 10 links a day (a new account: 3);
--   - 15 joins on one link inside 10 minutes turns it off for good and pages
--     (ops_alert_raise, 0369); the people it already let in stay;
--   - the 0371 rule, read where the link is used rather than swept: while the
--     account that made it is banned, on any sending hold, or no longer the
--     owner or a co-owner, or while the workspace's owner is banned, the link
--     opens nothing and previews nothing. Lifting that brings it back.
--
-- The one anonymous call, the preview, returns the workspace's name and the
-- maker's first name only while the link is live, both cleaned the way
-- invitation emails clean names (_safe_label below is safeLabel.mjs in SQL:
-- links, invisible characters and control characters out, cut to length),
-- and never an address. The lures of 2026-09-20 were names served from our
-- domain; this is another place a name is served from it.
--
-- Joining through a link writes workspace_members with soleil.ws_link_join
-- set, and the member email trigger stays quiet for it: the person just
-- clicked Join, so "you were added to a workspace" would only repeat that.
-- The maker hears about the join the way a collab-link join is heard about
-- (_joined_notification). A new account (under a week old) that joins counts
-- as the maker's referral, as on a collab link (claim_collab_link, 0371).
-- The server event is workspace_link_claimed; a link's token never goes into
-- analytics.

begin;

-- ── 1. The links, and who came in through each ──────────────────────────────

create table if not exists public.workspace_invite_links (
  token          uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  role           text not null check (role in ('editor', 'viewer')),
  created_by     uuid not null references auth.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  max_uses       integer not null check (max_uses between 1 and 100),
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoked_reason text check (revoked_reason in ('manager', 'burst'))
);
create index if not exists workspace_invite_links_reuse_idx
  on public.workspace_invite_links (workspace_id, created_by, role) where revoked_at is null;
create index if not exists workspace_invite_links_maker_day_idx
  on public.workspace_invite_links (created_by, created_at desc);

-- The use count and the burst window both read this, and it is the record
-- of which link let whom in. user_id deliberately has no foreign key: the
-- record outlives the account, like account_actions (0371).
create table if not exists public.workspace_invite_link_joins (
  id           bigint generated always as identity primary key,
  token        uuid not null references public.workspace_invite_links(token) on delete cascade,
  workspace_id uuid not null,
  user_id      uuid not null,
  joined_at    timestamptz not null default now()
);
create index if not exists workspace_invite_link_joins_token_idx
  on public.workspace_invite_link_joins (token, joined_at desc);

-- Server-only: every read and write goes through the functions below.
alter table public.workspace_invite_links enable row level security;
alter table public.workspace_invite_link_joins enable row level security;
revoke all on table public.workspace_invite_links from public, anon, authenticated;
revoke all on table public.workspace_invite_link_joins from public, anon, authenticated;
revoke all on sequence public.workspace_invite_link_joins_id_seq from public, anon, authenticated;

-- ── 2. A name someone typed, made safe to show ──────────────────────────────

-- safeLabel (supabase/functions/_shared/email/safeLabel.mjs) in SQL, for a
-- name a public call returns. Same steps in the same order: NFKC, invisible
-- characters dropped (so a split domain closes up and is caught), controls to
-- spaces, look-alike full stops to ".", anything shaped like a link removed,
-- spaces collapsed, a dangling lead-in trimmed, cut to p_max characters with
-- an ellipsis. workspaceInviteLink.test.mjs keeps the two in step. The
-- special characters are \x escapes, never \u ones: the tooling these
-- files pass through rewrites a \u escape into the invisible character itself.
create or replace function public._safe_label(p_value text, p_max integer default 60, p_fallback text default '')
returns text
language plpgsql immutable
set search_path = public as $$
declare
  s text := normalize(coalesce(p_value, ''), NFKC);
  n integer := greatest(coalesce(p_max, 60), 1);
begin
  s := regexp_replace(s, '[\xad\x34f\x61c\x115f\x1160\x17b4\x17b5\x180b-\x180f\x200b-\x200f\x202a-\x202e\x2060-\x206f\x3164\xfe00-\xfe0f\xfeff\xffa0\xfff0-\xfff8\x1bca0-\x1bca3\x1d173-\x1d17a\xe0000-\xe0fff]', '', 'g');
  s := regexp_replace(s, '[\x01-\x1f\x7f-\x9f\x2028\x2029]', ' ', 'g');
  s := translate(s, chr(12290) || chr(65377) || chr(8228) || chr(8231), '....');
  s := regexp_replace(s, '[[:alpha:]][[:alnum:]+.-]*://\S*', ' ', 'gi');
  s := regexp_replace(s, 'www\.\S*', ' ', 'gi');
  s := regexp_replace(s, '[[:alnum:]][[:alnum:]_-]*(\.[[:alnum:]_-]+)*\.[[:alpha:]]{2,}([/?#]\S*)?', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  s := btrim(regexp_replace(s, '[\s:;,\x2013\x2014-]+$', ''));
  if s = '' then
    return p_fallback;
  end if;
  if char_length(s) > n then
    s := rtrim(left(s, greatest(1, n - 1))) || chr(8230);
  end if;
  return s;
end;
$$;

-- ── 3. Whether a link opens anything right now ──────────────────────────────

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
                          and m.role = 'coowner')));
$$;

-- ── 4. Making and turning off a link ────────────────────────────────────────

-- Returns the token. A second tap returns the live link already made for the
-- same workspace and role, so a workspace collects one link per maker, not one
-- per tap.
create or replace function public.create_workspace_invite_link(p_workspace_id uuid, p_role text default 'editor')
returns uuid
language plpgsql security definer
set search_path = public as $$
declare
  c_links_per_day     constant integer := 10;
  c_new_links_per_day constant integer := 3;
  c_uses              constant integer := 25;
  c_new_uses          constant integer := 5;
  c_days              constant integer := 30;
  c_new_days          constant integer := 7;
  v_new   boolean;
  v_made  integer;
  v_token uuid;
begin
  -- A link is sharing: an account on a sending hold, or suspended, makes none.
  if not public._actor_can_send() then
    raise exception 'sharing is paused on this account while we review unusual activity'
      using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception 'role must be editor or viewer' using errcode = '22023';
  end if;
  if coalesce((select p.tier from public.profiles p where p.user_id = auth.uid()), 'demo') = 'waitlist' then
    raise exception 'your account isn''t active yet' using errcode = '42501';
  end if;
  if not public.can_manage_workspace(p_workspace_id) then
    raise exception 'only the workspace owner or a co-owner can make an invite link'
      using errcode = '42501';
  end if;

  -- One maker at a time, so a double tap makes one link and the day's count holds.
  perform pg_advisory_xact_lock(hashtext('workspace_invite_link:' || auth.uid()::text));

  select l.token into v_token
    from public.workspace_invite_links l
   where l.workspace_id = p_workspace_id
     and l.role = p_role
     and l.created_by = auth.uid()
     and l.revoked_at is null
     and public._workspace_invite_link_live(l.token)
   order by l.created_at desc
   limit 1;
  if v_token is not null then
    return v_token;
  end if;

  v_new := public._account_is_new();
  select count(*) into v_made
    from public.workspace_invite_links l
   where l.created_by = auth.uid()
     and l.created_at > now() - interval '1 day';
  if v_made >= (case when v_new then c_new_links_per_day else c_links_per_day end) then
    raise exception 'invite link limit reached: try again tomorrow'
      using errcode = '54000', hint = 'link_limit';
  end if;

  insert into public.workspace_invite_links (workspace_id, role, created_by, expires_at, max_uses)
  values (p_workspace_id, p_role, auth.uid(),
          now() + make_interval(days => case when v_new then c_new_days else c_days end),
          case when v_new then c_new_uses else c_uses end)
  returning workspace_invite_links.token into v_token;
  return v_token;
end;
$$;

-- The owner or a co-owner turns a link off. It stays off.
create or replace function public.revoke_workspace_invite_link(p_token uuid)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_workspace uuid;
begin
  if not public._actor_active() then
    raise exception 'this account is suspended' using errcode = '42501';
  end if;
  select l.workspace_id into v_workspace
    from public.workspace_invite_links l where l.token = p_token;
  if v_workspace is null or not public.can_manage_workspace(v_workspace) then
    raise exception 'only the workspace owner or a co-owner can turn off its invite links'
      using errcode = '42501';
  end if;
  update public.workspace_invite_links l
     set revoked_at = now(), revoked_by = auth.uid(), revoked_reason = 'manager'
   where l.token = p_token and l.revoked_at is null;
end;
$$;

-- ── 5. What the link says before anyone signs in ────────────────────────────

-- status: 'live' (names filled in), 'member' (the signed-in caller is already
-- in the workspace), or 'dead' — expired, used up, turned off, taken down or
-- never existed, all alike: a takedown says nothing about why (0371).
create or replace function public.peek_workspace_invite_link(p_token uuid)
returns table (status text, workspace_name text, inviter_name text, role text)
language plpgsql stable security definer
set search_path = public as $$
#variable_conflict use_column
declare
  v_workspace uuid;
  v_role      text;
  v_maker     uuid;
  v_name      text;
  v_owner     uuid;
  v_first     text;
begin
  if p_token is null or not public._workspace_invite_link_live(p_token) then
    return query select 'dead'::text, null::text, null::text, null::text;
    return;
  end if;

  select l.workspace_id, l.role, l.created_by, w.name, w.created_by
    into v_workspace, v_role, v_maker, v_name, v_owner
    from public.workspace_invite_links l
    join public.workspaces w on w.id = l.workspace_id
   where l.token = p_token;

  -- A first name someone chose to show, never an address.
  select split_part(btrim(p.display_name), ' ', 1) into v_first
    from public.profiles p where p.user_id = v_maker;
  if v_first like '%@%' then
    v_first := null;
  end if;

  return query select
    case when auth.uid() is not null
              and (v_owner = auth.uid()
                   or exists (select 1 from public.workspace_members m
                               where m.workspace_id = v_workspace and m.user_id = auth.uid()))
         then 'member' else 'live' end,
    public._safe_label(v_name, 60, 'a workspace'),
    public._safe_label(v_first, 30, 'Someone'),
    v_role;
end;
$$;

-- ── 6. Joining ──────────────────────────────────────────────────────────────

-- status: 'joined', 'member' (already in it; role is theirs), or 'dead'.
-- Signing in is required and a suspended account joins nothing; both raise.
create or replace function public.claim_workspace_invite_link(p_token uuid)
returns table (workspace_id uuid, role text, status text)
language plpgsql security definer
set search_path = public, auth as $$
#variable_conflict use_column
declare
  c_burst        constant integer  := 15;
  c_burst_window constant interval := interval '10 minutes';
  v_link        public.workspace_invite_links%rowtype;
  v_owner       uuid;
  v_mine        text;
  v_recent      integer;
  v_ins         integer := 0;
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

  -- They clicked Join; the member email trigger skips this insert.
  perform set_config('soleil.ws_link_join', '1', true);
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_link.workspace_id, auth.uid(), v_link.role)
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
  perform public._joined_notification(v_link.created_by, null, v_link.workspace_id, v_link.role, auth.uid());

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
            jsonb_build_object('workspace_id', v_link.workspace_id, 'role', v_link.role, 'status', 'joined'));
  exception when others then null;
  end;

  return query select v_link.workspace_id, v_link.role, 'joined'::text;
end;
$$;

-- ── 7. The member email stays quiet for someone who joined by link ──────────

-- 0362's trigger, unchanged except for the early return marked 0450.
create or replace function public._tg_workspace_member_email()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_owner_id        uuid;
  v_workspace_name  text;
  v_recipient_email text;
  v_inviter_name    text;
begin
  -- 0360: a service identity has an undeliverable address on purpose; mailing
  -- it would only bounce, on the domain that carries everyone's sign-in codes.
  if new.role = 'service' then
    return new;
  end if;

  -- 0450: they joined through a workspace invite link just now, so "you were
  -- added" would only repeat what they did.
  if current_setting('soleil.ws_link_join', true) = '1' then
    return new;
  end if;

  select w.created_by, w.name
  into v_owner_id, v_workspace_name
  from public.workspaces w
  where w.id = new.workspace_id;

  if v_owner_id is null or new.user_id = v_owner_id then
    return new;
  end if;

  if not public._email_pref_enabled(new.user_id, 'email_workspace_invite') then
    return new;
  end if;

  select email into v_recipient_email
  from auth.users where id = new.user_id;
  if v_recipient_email is null then return new; end if;

  select coalesce(nullif(p.display_name, ''), u.email, 'Someone on Clusters')
  into v_inviter_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = v_owner_id;

  perform public._notify_email(
    'workspace_invite',
    v_recipient_email,
    jsonb_build_object(
      'workspaceName', coalesce(v_workspace_name, 'a workspace'),
      'inviterName',   coalesce(v_inviter_name,   'Someone on Clusters'),
      'role',          coalesce(new.role, 'member'),
      'workspaceId',   new.workspace_id::text
    )
  );

  return new;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke execute on function public._safe_label(text, integer, text) from public, anon, authenticated;
revoke execute on function public._workspace_invite_link_live(uuid) from public, anon, authenticated;
revoke execute on function public._tg_workspace_member_email() from public, anon, authenticated;

revoke all on function public.create_workspace_invite_link(uuid, text) from public, anon;
revoke all on function public.revoke_workspace_invite_link(uuid) from public, anon;
revoke all on function public.claim_workspace_invite_link(uuid) from public, anon;
grant execute on function public.create_workspace_invite_link(uuid, text) to authenticated, service_role;
grant execute on function public.revoke_workspace_invite_link(uuid) to authenticated, service_role;
grant execute on function public.claim_workspace_invite_link(uuid) to authenticated, service_role;

-- The preview is the one call a signed-out visitor makes.
revoke all on function public.peek_workspace_invite_link(uuid) from public;
grant execute on function public.peek_workspace_invite_link(uuid) to anon, authenticated, service_role;

-- ── Proofs (the 0311 habit: a REVOKE reporting success proves nothing) ──────

do $$
declare
  v_fn  text;
  v_src text;
  r     record;
begin
  foreach v_fn in array array[
    'public._safe_label(text,integer,text)',
    'public._workspace_invite_link_live(uuid)',
    'public._tg_workspace_member_email()'] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0450: % is client-executable', v_fn;
    end if;
  end loop;

  foreach v_fn in array array[
    'public.create_workspace_invite_link(uuid,text)',
    'public.revoke_workspace_invite_link(uuid)',
    'public.claim_workspace_invite_link(uuid)'] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0450: % is callable signed out', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0450: % is not callable signed in', v_fn;
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.peek_workspace_invite_link(uuid)', 'execute') then
    raise exception '0450: the preview is not callable signed out';
  end if;

  foreach v_fn in array array['public.workspace_invite_links', 'public.workspace_invite_link_joins'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = v_fn::regclass) then
      raise exception '0450: % has row level security off', v_fn;
    end if;
    if exists (select 1 from pg_policy pol where pol.polrelid = v_fn::regclass) then
      raise exception '0450: % has a policy; every path is a function', v_fn;
    end if;
    if has_table_privilege('anon', v_fn, 'select,insert,update,delete')
       or has_table_privilege('authenticated', v_fn, 'select,insert,update,delete') then
      raise exception '0450: a client can touch %', v_fn;
    end if;
  end loop;

  -- Every way in checks what it must.
  for r in
    select * from (values
      ('public._workspace_invite_link_live(uuid)',          'public._sharer_suspended(l.created_by)'),
      ('public._workspace_invite_link_live(uuid)',          'p.send_hold_at is not null'),
      ('public._workspace_invite_link_live(uuid)',          'public._user_banned(w.created_by)'),
      ('public._workspace_invite_link_live(uuid)',          'm.role = ''coowner'''),
      ('public.create_workspace_invite_link(uuid,text)',    'if not public._actor_can_send() then'),
      ('public.create_workspace_invite_link(uuid,text)',    'public.can_manage_workspace(p_workspace_id)'),
      ('public.create_workspace_invite_link(uuid,text)',    'public._account_is_new()'),
      ('public.revoke_workspace_invite_link(uuid)',         'if not public._actor_active() then'),
      ('public.revoke_workspace_invite_link(uuid)',         'public.can_manage_workspace(v_workspace)'),
      ('public.claim_workspace_invite_link(uuid)',          'if not public._actor_active() then'),
      ('public.claim_workspace_invite_link(uuid)',          'public._workspace_invite_link_live(p_token)'),
      ('public.claim_workspace_invite_link(uuid)',          'for update'),
      ('public.peek_workspace_invite_link(uuid)',           'public._workspace_invite_link_live(p_token)'),
      ('public.peek_workspace_invite_link(uuid)',           'public._safe_label(v_name, 60'),
      ('public._tg_workspace_member_email()',               'new.role = ''service'''),
      ('public._tg_workspace_member_email()',               'soleil.ws_link_join')
    ) as t(fn, marker)
  loop
    select prosrc into v_src from pg_proc where oid = r.fn::regprocedure;
    if position(r.marker in v_src) = 0 then
      raise exception '0450: % lacks its check (%)', r.fn, r.marker;
    end if;
  end loop;

  -- The cleaner does what safeLabel does to a lure, and leaves a name alone.
  if public._safe_label('Verify now at https://secure-login.example/x or www.evil.example', 60, '')
       ~* '(https?:|www\.|\.example)' then
    raise exception '0450: _safe_label kept a link';
  end if;
  if public._safe_label('evil' || chr(8203) || '.example login', 60, '') <> 'login' then
    raise exception '0450: _safe_label let an invisible character split a domain';
  end if;
  if public._safe_label('Lost Time', 60, '') <> 'Lost Time'
     or char_length(public._safe_label(repeat('x', 100), 60, '')) <> 60 then
    raise exception '0450: _safe_label changed a plain name or missed the length';
  end if;
end $$;

commit;
