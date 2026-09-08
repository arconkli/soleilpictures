-- 0312_admin_audit_log.sql
--
-- Privileged admin actions left no trail. Of the mutating admin_* RPCs, only
-- admin_grant_paid_access wrote anything durable (a user_outreach row, because
-- granting is a communication); tier changes trailed into analytics_events via
-- _log_tier_change (purged after 400 days); admin_export_user_data — which
-- returns a user's auth row, profile, subscription, feedback, grants, every
-- analytics event and every client error — recorded nothing at all. For a tool
-- holding production material, "who exported whose data, when" is not a nice
-- to have.
--
-- One narrow table, one helper, one read RPC, and one line added to each of
-- the six most sensitive admin functions right after their admin guard. The
-- function bodies are otherwise byte-for-byte what was deployed (taken from
-- pg_get_functiondef, not retyped), so behaviour is unchanged.
--
-- admin_export_user_data was declared STABLE. Postgres forbids writes inside a
-- STABLE function ("cannot execute INSERT in a non-volatile function"), so it
-- becomes VOLATILE here. It only ever reads; the marker changed, not the work.
--
-- Retention: 400 days, matching analytics_events, via the same 03:xx purge
-- window. Read access: admins only, through admin_audit_recent().

create table if not exists public.admin_audit_log (
  id       bigint generated always as identity primary key,
  actor    uuid,
  action   text not null,
  target   text,
  payload  jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc);

alter table public.admin_audit_log enable row level security;
-- The policy needs the table privilege underneath it; the policy itself is
-- what narrows SELECT to admins. No client role can write.
grant select on public.admin_audit_log to authenticated;
revoke insert, update, delete on public.admin_audit_log from anon, authenticated;
revoke select on public.admin_audit_log from anon;
drop policy if exists "admin audit read" on public.admin_audit_log;
create policy "admin audit read" on public.admin_audit_log
  for select to authenticated using (public.is_admin());

-- Called only from inside SECURITY DEFINER admin functions, which run as the
-- owner; no client role needs EXECUTE (and under 0311's defaults none gets it
-- for free, but authenticated still does — revoke it explicitly).
create or replace function public._audit(p_action text, p_target text, p_payload jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.admin_audit_log (actor, action, target, payload)
  values (auth.uid(), p_action, p_target, coalesce(p_payload, '{}'::jsonb));
$$;
revoke all on function public._audit(text, text, jsonb) from public, anon, authenticated;

create or replace function public.admin_audit_recent(p_limit integer default 200)
returns table(id bigint, actor uuid, actor_email text, action text, target text, payload jsonb, at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $$
begin
  perform public._require_admin();
  return query
    select l.id, l.actor, u.email::text, l.action, l.target, l.payload, l.at
    from public.admin_audit_log l
    left join auth.users u on u.id = l.actor
    order by l.at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;
revoke all on function public.admin_audit_recent(integer) from public, anon;
grant execute on function public.admin_audit_recent(integer) to authenticated;

create or replace function public.purge_old_admin_audit(p_days integer default 400)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  delete from public.admin_audit_log where at < now() - make_interval(days => p_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_old_admin_audit(integer) from public, anon, authenticated;
select cron.schedule('purge_old_admin_audit', '38 3 * * *', $$ select public.purge_old_admin_audit(400); $$)
  where not exists (select 1 from cron.job where jobname = 'purge_old_admin_audit');

-- ── The six functions, each with one added line after its guard ──────────────

CREATE OR REPLACE FUNCTION public.admin_export_user_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sessions uuid[];
  v_result   jsonb;
begin
  perform public._require_admin();
  perform public._audit('export_user_data', p_user_id::text, '{}'::jsonb);

  select array_agg(distinct session_id)
    into v_sessions
    from public.analytics_events
   where user_id = p_user_id and session_id is not null;

  select jsonb_build_object(
    'exported_at', now(),
    'user_id',     p_user_id,
    'auth', (
      select jsonb_build_object(
               'email',           u.email,
               'created_at',      u.created_at,
               'last_sign_in_at', u.last_sign_in_at)
        from auth.users u where u.id = p_user_id
    ),
    'profile',      (select to_jsonb(p) from public.profiles p      where p.user_id = p_user_id),
    'subscription', (select to_jsonb(s) from public.subscriptions s where s.user_id = p_user_id),
    'feedback',     (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at), '[]'::jsonb)
                       from public.feedback f where f.user_id = p_user_id),
    'paid_grants',  (select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
                       from public.paid_grants g where g.user_id = p_user_id),
    'analytics_events', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at), '[]'::jsonb)
        from public.analytics_events e
       where e.user_id = p_user_id
          or (v_sessions is not null and e.session_id = any(v_sessions))
    ),
    'client_errors', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.occurred_at), '[]'::jsonb)
        from public.client_errors c
       where c.user_id = p_user_id
          or (v_sessions is not null and c.session_id = any(v_sessions))
    ),
    -- ADDED 0248
    'usage_sessions', (
      select coalesce(jsonb_agg(to_jsonb(us) order by us.started_at), '[]'::jsonb)
        from public.usage_session us where us.user_id = p_user_id
    ),
    'active_days', (
      select coalesce(jsonb_agg(to_jsonb(ad) order by ad.day), '[]'::jsonb)
        from public.user_active_day ad where ad.user_id = p_user_id
    )
  ) into v_result;

  return v_result;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_set_tier(p_user_id uuid, p_tier text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._require_admin();
  perform public._audit('set_tier', p_user_id::text, jsonb_build_object('tier', p_tier));

  if p_user_id = auth.uid() then
    raise exception 'you cannot change your own tier' using errcode = '42501';
  end if;
  if p_tier not in ('admin', 'paid', 'demo', 'waitlist') then
    raise exception 'invalid tier %', p_tier using errcode = '22023';
  end if;

  if p_tier in ('demo', 'waitlist') then
    if exists (
      select 1 from public.subscriptions
      where user_id = p_user_id and status in ('active', 'trialing')
    ) then
      raise exception 'user has an active Stripe subscription — cancel it first'
        using errcode = '42501';
    end if;
    update public.paid_grants
       set revoked_at = now(), revoked_by = auth.uid()
     where user_id = p_user_id and revoked_at is null;
  end if;

  insert into public.profiles (user_id, tier)
  values (p_user_id, p_tier)
  on conflict (user_id) do update set tier = excluded.tier;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_paid_access(p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_admin_uid uuid := auth.uid();
  v_user_id   uuid;
  v_has_sub   boolean;
begin
  perform public._require_admin();
  perform public._audit('revoke_paid_access', p_email, '{}'::jsonb);

  if v_email = '' then
    raise exception 'email required' using errcode = '22023';
  end if;

  update public.paid_grants
     set revoked_at = now(), revoked_by = v_admin_uid
   where email = v_email
     and revoked_at is null
  returning user_id into v_user_id;

  if not found then
    raise exception 'no active grant for %', p_email using errcode = 'P0002';
  end if;

  if v_user_id is null then
    return;
  end if;

  select exists (
    select 1 from public.subscriptions
     where user_id = v_user_id and status in ('active', 'trialing')
  ) into v_has_sub;

  if not v_has_sub then
    update public.profiles set tier = 'demo'
     where user_id = v_user_id and tier = 'paid';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_account_quota_bytes(p_user_id uuid, p_bytes bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  perform public._audit('set_account_quota_bytes', p_user_id::text, jsonb_build_object('bytes', p_bytes));
  update public.profiles
     set storage_quota_bytes = case when p_bytes is null or p_bytes <= 0 then null else p_bytes end
   where user_id = p_user_id;
  return public._storage_quota_bytes(p_user_id);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_review_public_board(p_board_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_slug text; v_submitted_by uuid; v_reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  if not is_admin() then raise exception 'admin only' using errcode='42501'; end if;
  perform public._audit('review_public_board', p_board_id::text, jsonb_build_object('approve', p_approve, 'reason', p_reason));
  if p_approve then
    update public_boards set published_at=coalesce(published_at, now()), review_status='approved',
      review_reason=null, updated_at=now() where board_id=p_board_id
      returning slug, submitted_by into v_slug, v_submitted_by;
  else
    update public_boards set review_status='rejected', review_reason=v_reason,
      published_at=null, updated_at=now() where board_id=p_board_id
      returning slug, submitted_by into v_slug, v_submitted_by;
  end if;
  if v_submitted_by is not null and v_submitted_by <> auth.uid() then
    insert into share_notifications (user_id, board_id, role, shared_by, kind, detail)
    values (v_submitted_by, p_board_id, 'viewer', auth.uid(),
      case when p_approve then 'explore_approved' else 'explore_rejected' end,
      case when p_approve then v_slug else v_reason end);
  end if;
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'slug', v_slug);
end $function$;

CREATE OR REPLACE FUNCTION public.admin_grant_paid_access(p_emails text[], p_duration_days integer DEFAULT NULL::integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin_uid    uuid := auth.uid();
  v_admin_email  text;
  v_expires_at   timestamptz;
  v_email_in     text;
  v_email        text;
  v_user_id      uuid;
  v_note         text := nullif(trim(coalesce(p_note, '')), '');
  v_invalid      int := 0;
  v_granted      int := 0;
  v_linked       int := 0;
  v_pending      int := 0;
begin
  perform public._require_admin();
  perform public._audit('grant_paid_access', array_to_string(p_emails, ','), jsonb_build_object('duration_days', p_duration_days, 'note', p_note));

  if p_duration_days is not null then
    if p_duration_days <= 0 then
      raise exception 'duration_days must be positive or null (for forever)'
        using errcode = '22023';
    end if;
    v_expires_at := now() + (p_duration_days || ' days')::interval;
  end if;

  select email::text into v_admin_email from auth.users where id = v_admin_uid;

  if p_emails is null or array_length(p_emails, 1) is null then
    return jsonb_build_object(
      'total', 0, 'granted', 0, 'linked_existing_user', 0,
      'pending_signup', 0, 'invalid', 0
    );
  end if;

  foreach v_email_in in array p_emails loop
    v_email := lower(trim(coalesce(v_email_in, '')));
    if v_email = '' or position('@' in v_email) = 0 then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    select id into v_user_id from auth.users where email = v_email;

    insert into public.paid_grants (
      email, user_id, expires_at, granted_at,
      granted_by, granted_by_email, revoked_at, revoked_by, note
    ) values (
      v_email, v_user_id, v_expires_at, now(),
      v_admin_uid, v_admin_email, null, null, v_note
    )
    on conflict (email) do update set
      user_id          = coalesce(excluded.user_id, public.paid_grants.user_id),
      expires_at       = excluded.expires_at,
      granted_at       = excluded.granted_at,
      granted_by       = excluded.granted_by,
      granted_by_email = excluded.granted_by_email,
      revoked_at       = null,
      revoked_by       = null,
      note             = excluded.note;

    -- Granting is a personal communication → log it as outreach (unified by email).
    insert into public.user_outreach (user_id, email, reached_by, reached_by_email, note)
    values (
      v_user_id, v_email, v_admin_uid, v_admin_email,
      'Sent paid grant' || case when v_note is not null then ' — ' || v_note else '' end
    );

    v_granted := v_granted + 1;
    if v_user_id is null then
      v_pending := v_pending + 1;
    else
      v_linked := v_linked + 1;
      update public.profiles set tier = 'paid'
       where user_id = v_user_id and tier <> 'admin';
    end if;
  end loop;

  return jsonb_build_object(
    'total',                array_length(p_emails, 1),
    'granted',              v_granted,
    'linked_existing_user', v_linked,
    'pending_signup',       v_pending,
    'invalid',              v_invalid
  );
end;
$function$;
