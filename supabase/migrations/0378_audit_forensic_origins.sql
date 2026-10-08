-- 0378 — where an abusive account came from outlives it (audit FOR-1, FOR-2).
--
-- The 2026-09-20 invite blast came from throwaway accounts, and nothing
-- recorded where they connected from: auth.audit_log_entries keeps no
-- addresses, and an invitation loses its inviter when the account is deleted.
-- Whether the next throwaway account is the same person was unanswerable.
--
-- For abuse prevention only, and never the address itself:
--
--   - _request_origin(): the caller's network (an IPv4 address, or an IPv6
--     /64, which is what a phone keeps while its address rotates) and its
--     user-agent, as HMACs keyed with a salt held in Vault. Only a browser's
--     own request counts: a Worker or a server runtime calling on someone's
--     behalf carries its own address, which everyone it serves would appear
--     to share.
--   - request_origins: one row per account, day, kind, network and browser.
--     Written by the presence heartbeat (touch_presence) and by inserts into
--     pending_invites, public_share_links and outbound_ledger, so an account
--     driven by a script that never opens the app is placed too. Server-only,
--     deleted with the account, kept 365 days.
--   - an account action's evidence (_account_evidence) lists the account's
--     networks and the other accounts seen on them within a week, and that
--     snapshot outlives the account (account_actions has no foreign key).
--   - check_abuse_signals pages when several accounts made in the last day
--     share one network.

begin;

-- ── 1. The salt ─────────────────────────────────────────────────────────────
-- Rotating it unlinks every stored hash from every new one.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'forensic_origin_salt') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'forensic_origin_salt',
      'Keys the request_origins hashes (0378). Rotating it unlinks every stored hash.');
  end if;
end $$;

-- ── 2. Where a request comes from ───────────────────────────────────────────

create table if not exists public.request_origins (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null default current_date,
  kind          text not null check (kind in ('session', 'invite', 'share_link', 'email')),
  ip_hash       text not null,
  ua_hash       text not null,
  ip_source     text,
  country       text,
  first_seen_at timestamptz not null default now(),
  primary key (user_id, day, kind, ip_hash, ua_hash)
);
create index if not exists request_origins_ip_idx on public.request_origins (ip_hash, day);
alter table public.request_origins enable row level security;
revoke all on table public.request_origins from public, anon, authenticated;

create or replace function public._request_origin(out ip_hash text, out ua_hash text, out ip_source text)
language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  v_h    jsonb;
  v_ip   inet;
  v_net  text;
  v_salt text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return;
  end;
  if v_h is null or v_h ? 'cf-worker'
     or coalesce(v_h->>'x-client-info', '') ~* '(deno|node)' then
    return;
  end if;
  begin
    -- cf-connecting-ip is Cloudflare's, and a client can't supply its own.
    -- x-forwarded-for is never read: its first entry is whatever the client sent.
    if nullif(trim(v_h->>'cf-connecting-ip'), '') is not null then
      v_ip := trim(v_h->>'cf-connecting-ip')::inet;
      ip_source := 'cf';
    elsif nullif(trim(v_h->>'x-real-ip'), '') is not null then
      v_ip := trim(v_h->>'x-real-ip')::inet;
      ip_source := 'real';
    else
      return;
    end if;
    v_net := case when family(v_ip) = 6 then network(set_masklen(v_ip, 64))::text else host(v_ip) end;
  exception when others then
    ip_source := null;
    return;
  end;
  select s.decrypted_secret into v_salt from vault.decrypted_secrets s where s.name = 'forensic_origin_salt';
  if v_salt is null then
    ip_source := null;
    return;
  end if;
  ip_hash := encode(hmac(v_net, v_salt, 'sha256'), 'hex');
  ua_hash := encode(hmac(left(coalesce(v_h->>'user-agent', ''), 512), v_salt, 'sha256'), 'hex');
end;
$$;

-- Notes the signed-in caller's origin. Never fails what they were doing.
create or replace function public._note_origin(p_kind text)
returns void
language plpgsql security definer
set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  o record;
begin
  if v_uid is null then return; end if;
  select * into o from public._request_origin();
  if o.ip_hash is null then return; end if;
  insert into public.request_origins (user_id, kind, ip_hash, ua_hash, ip_source, country)
  values (v_uid, p_kind, o.ip_hash, o.ua_hash, o.ip_source, public.request_country())
  on conflict do nothing;
exception when others then
  null;
end;
$$;

create or replace function public._tg_note_origin()
returns trigger
language plpgsql security definer
set search_path = public as $$
begin
  perform public._note_origin(tg_argv[0]);
  return null;
end;
$$;

drop trigger if exists pending_invites_note_origin on public.pending_invites;
create trigger pending_invites_note_origin after insert on public.pending_invites
  for each statement execute function public._tg_note_origin('invite');
drop trigger if exists public_share_links_note_origin on public.public_share_links;
create trigger public_share_links_note_origin after insert on public.public_share_links
  for each statement execute function public._tg_note_origin('share_link');
drop trigger if exists outbound_ledger_note_origin on public.outbound_ledger;
create trigger outbound_ledger_note_origin after insert on public.outbound_ledger
  for each statement execute function public._tg_note_origin('email');

-- The heartbeat every signed-in tab sends: one row a day per network and browser.
create or replace function public.touch_presence() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_presence (user_id, last_seen_at, updated_at)
  values (auth.uid(), now(), now())
  on conflict (user_id)
  do update set last_seen_at = now(), updated_at = now();
  perform public._note_origin('session');
end;
$$;

create or replace function public.purge_old_request_origins(p_days integer)
returns integer
language plpgsql security definer
set search_path = public as $$
declare v_n integer;
begin
  delete from public.request_origins where day < current_date - p_days;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 3. Evidence and the fleet alert ─────────────────────────────────────────

create or replace function public._account_evidence(p_user uuid)
returns jsonb
language sql stable security definer
set search_path = public, auth as $$
  select jsonb_build_object(
    'account_created_at', (select u.created_at from auth.users u where u.id = p_user),
    'last_sign_in_at',    (select u.last_sign_in_at from auth.users u where u.id = p_user),
    'workspaces_owned',   (select count(*) from public.workspaces w where w.created_by = p_user),
    'clusters_owned',     (select count(*) from public.boards b
                             join public.workspaces w on w.id = b.workspace_id
                            where w.created_by = p_user and b.deleted_at is null),
    'cluster_names',      (select coalesce(jsonb_agg(left(x.name, 80)), '[]'::jsonb)
                             from (select b.name from public.boards b
                                     join public.workspaces w on w.id = b.workspace_id
                                    where w.created_by = p_user
                                    order by b.created_at desc limit 20) x),
    'live_share_links',   (select count(*) from public.public_share_links l
                            where l.created_by = p_user and l.revoked_at is null
                              and (l.expires_at is null or l.expires_at > now())),
    'published_clusters', (select count(*) from public.public_boards pb
                             join public.boards b on b.id = pb.board_id
                             join public.workspaces w on w.id = b.workspace_id
                            where pb.published_at is not null
                              and (w.created_by = p_user or pb.submitted_by = p_user)),
    'invitations_sent',   (select count(*) from public.pending_invites i where i.invited_by = p_user),
    'invitation_domains', (select coalesce(jsonb_object_agg(x.d, x.n), '{}'::jsonb)
                             from (select split_part(lower(i.email), '@', 2) as d, count(*) as n
                                     from public.pending_invites i
                                    where i.invited_by = p_user
                                    group by 1 order by 2 desc limit 15) x),
    'outbound_7d',        (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
                             from (select l.template || ':' || l.state as k, count(*) as n
                                     from public.outbound_ledger l
                                    where l.actor = p_user and l.created_at > now() - interval '7 days'
                                    group by 1) x),
    -- 0378: where it connected from, and who else did.
    'networks',           (select coalesce(jsonb_agg(jsonb_build_object(
                                     'net', left(x.ip_hash, 10), 'days', x.days, 'last_seen', x.last_day,
                                     'country', x.country, 'via', x.kinds)
                                     order by x.last_day desc), '[]'::jsonb)
                             from (select o.ip_hash, count(distinct o.day) as days, max(o.day) as last_day,
                                          max(o.country) as country, jsonb_agg(distinct o.kind) as kinds
                                     from public.request_origins o
                                    where o.user_id = p_user and o.day > current_date - 90
                                    group by o.ip_hash order by max(o.day) desc limit 10) x),
    'related_accounts',   (select coalesce(jsonb_agg(jsonb_build_object(
                                     'user_id', y.user_id, 'email', y.email, 'created_at', y.created_at,
                                     'shared_networks', y.nets, 'same_browser', y.same_ua, 'banned', y.banned)
                                     order by y.same_ua desc, y.nets desc), '[]'::jsonb)
                             from (select b.user_id, u.email::text as email, u.created_at,
                                          count(distinct b.ip_hash) as nets,
                                          count(distinct b.ip_hash) filter (where b.ua_hash = a.ua_hash) as same_ua,
                                          bool_or(p.banned_at is not null) as banned
                                     from public.request_origins a
                                     join public.request_origins b
                                       on b.ip_hash = a.ip_hash and b.user_id <> a.user_id
                                      and b.day between a.day - 7 and a.day + 7
                                     join auth.users u on u.id = b.user_id
                                     left join public.profiles p on p.user_id = b.user_id
                                    where a.user_id = p_user and a.day > current_date - 90
                                    group by b.user_id, u.email, u.created_at
                                    order by 5 desc, 4 desc limit 20) y)
  );
$$;

create or replace function public.check_abuse_signals()
returns integer
language plpgsql security definer
set search_path = public, auth as $$
declare
  c_fleet_accounts constant integer := 5;
  v_signups integer;
  v_n integer := 0;
  r record;
begin
  select count(*) into v_signups from auth.users where created_at > now() - interval '1 hour';
  -- Far above any real hour's signups.
  if v_signups > 15 then
    if public.ops_alert_raise('signups',
         v_signups || ' accounts created in the last hour',
         'Far more than usual. Could be a launch, could be a throwaway-account fleet.',
         true, 'signups:hour', interval '1 hour') is not null then
      v_n := v_n + 1;
    end if;
  end if;
  -- Several accounts made in the last day on one network (0378): the shape of
  -- a throwaway fleet, or a team signing up together. The alert names them,
  -- and each one's evidence lists the accounts it shares a network with.
  for r in
    select o.ip_hash, count(distinct o.user_id) as n,
           string_agg(distinct u.email::text, ', ') as emails
      from public.request_origins o
      join auth.users u on u.id = o.user_id
     where o.day >= current_date - 1
       and u.created_at > now() - interval '24 hours'
     group by o.ip_hash
    having count(distinct o.user_id) >= c_fleet_accounts
  loop
    if public.ops_alert_raise('signup_network',
         r.n || ' accounts created in the last day share one network',
         'Could be a team signing up together, could be one person with many accounts. Accounts: '
           || left(r.emails, 1500),
         true, 'signup_network:' || left(r.ip_hash, 16), interval '24 hours') is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  -- Held mail nobody has looked at in 6 hours is mentioned again, once a day.
  if exists (select 1 from public.outbound_ledger l where l.state = 'held' and l.created_at < now() - interval '6 hours') then
    perform public.ops_alert_raise('held_reminder',
      'Held emails are still waiting for a decision',
      (select count(*) || ' held, oldest ' || to_char(min(l.created_at), 'YYYY-MM-DD HH24:MI') || ' UTC. They expire after 7 days.'
         from public.outbound_ledger l where l.state = 'held'),
      true, 'held:reminder', interval '24 hours');
  end if;
  return v_n;
end;
$$;

revoke execute on function public._request_origin() from public, anon, authenticated;
revoke execute on function public._note_origin(text) from public, anon, authenticated;
revoke execute on function public._tg_note_origin() from public, anon, authenticated;
revoke execute on function public.purge_old_request_origins(integer) from public, anon, authenticated;

select cron.schedule('purge-request-origins', '29 3 * * *', $$select public.purge_old_request_origins(365)$$);

-- ── Proofs ──────────────────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array['public._request_origin()', 'public._note_origin(text)',
                           'public._tg_note_origin()', 'public.purge_old_request_origins(integer)',
                           'public._account_evidence(uuid)', 'public.check_abuse_signals()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '0378: % is client-callable', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.touch_presence()', 'execute') then
    raise exception '0378: touch_presence lost its grant';
  end if;
  if has_table_privilege('anon', 'public.request_origins', 'select')
     or has_table_privilege('authenticated', 'public.request_origins', 'select')
     or has_table_privilege('authenticated', 'public.request_origins', 'insert') then
    raise exception '0378: request_origins is client-readable or writable';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.request_origins'::regclass) then
    raise exception '0378: request_origins has no RLS';
  end if;
  if not exists (select 1 from vault.secrets where name = 'forensic_origin_salt') then
    raise exception '0378: the salt is missing';
  end if;
  if (select count(*) from pg_trigger where tgname in ('pending_invites_note_origin',
        'public_share_links_note_origin', 'outbound_ledger_note_origin') and not tgisinternal) <> 3 then
    raise exception '0378: an origin trigger is missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'purge-request-origins' and active) then
    raise exception '0378: the retention job is missing';
  end if;
end $$;

commit;
