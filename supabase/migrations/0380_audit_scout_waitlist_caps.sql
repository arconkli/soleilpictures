-- 0380 — the Scout waitlist can't be filled by a script (audit OM-7).
--
-- Every number on scout_signups is one the bot will text once it launches.
-- scout_request_invite capped a connection at 3 numbers an hour, and only when
-- the Worker had managed to hash its address; without the hash there was no
-- limit at all. Nothing capped the list as a whole, so a script could queue
-- thousands of strangers' numbers for the bot to text, 40 a day, for weeks.
--
-- Now: no hash, no signup (the Worker refuses first, and so does this); a
-- connection adds at most c_ip_hour numbers an hour and c_ip_day a day; and the
-- list holds at most scout_pending_max pending numbers (app_config, default
-- c_pending_max). A full list answers 'full', which the Worker shows, and pages
-- the owner once a day. Signups are serialized, so no cap can be raced.
--
-- This replaces the live definition, which had drifted from 0210's text.

begin;

CREATE OR REPLACE FUNCTION public.scout_request_invite(p_phone text, p_source text DEFAULT NULL::text, p_ip_hash text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_utm jsonb DEFAULT '{}'::jsonb, p_consent_version text DEFAULT 'v1'::text)
 RETURNS TABLE(status text, is_new boolean, queued_ahead integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  c_ip_hour     constant int := 3;
  c_ip_day      constant int := 5;
  c_pending_max constant int := 300;
  v_existing public.scout_signups%rowtype;
  v_daily_max int;
  v_sent_today int;
  v_ip_hour int;
  v_ip_day int;
  v_pending_max int;
  v_status text;
  v_new boolean := false;
begin
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'a valid phone number is required' using errcode = '22023';
  end if;
  -- No hash, no signup (0380): without it no per-connection limit can apply.
  if p_ip_hash is null or length(p_ip_hash) < 16 then
    raise exception 'a network origin is required' using errcode = '22023';
  end if;

  -- NOTE the alias. `status`, `is_new` and `queued_ahead` are OUT parameters of
  -- this function, so an UNQUALIFIED reference to a column of the same name is
  -- ambiguous and Postgres refuses to run the query at all.
  select * into v_existing from public.scout_signups s where s.phone_e164 = p_phone;
  if found then
    return query select v_existing.status, false,
      (select count(*)::int from public.scout_signups s
        where s.status = 'pending' and s.created_at < v_existing.created_at);
    return;
  end if;

  -- One signup at a time, so two submits can't both read a count under a cap.
  perform pg_advisory_xact_lock(hashtext('scout_waitlist'));

  select count(*) filter (where s.created_at > now() - interval '1 hour'),
         count(*)
    into v_ip_hour, v_ip_day
    from public.scout_signups s
   where s.ip_hash = p_ip_hash and s.created_at > now() - interval '24 hours';
  if v_ip_hour >= c_ip_hour or v_ip_day >= c_ip_day then
    raise exception 'too many requests from this address' using errcode = '53400';
  end if;

  -- The whole list has a ceiling. Every pending number is one the bot will
  -- text, so a flood could otherwise queue weeks of texts to strangers. A full
  -- list answers 'full' rather than raising, so the page survives to be sent.
  select coalesce((c.value ->> 'max')::int, c_pending_max) into v_pending_max
    from public.app_config c where c.key = 'scout_pending_max';
  if (select count(*) from public.scout_signups s where s.status = 'pending')
       >= coalesce(v_pending_max, c_pending_max) then
    perform public.ops_alert_raise('scout_waitlist_full',
      'The Scout waitlist is full',
      'New numbers are being turned away. If this is real demand, raise app_config scout_pending_max; if not, look at where the signups came from.',
      true, 'scout:waitlist_full', interval '24 hours');
    return query select 'full'::text, false, null::int;
    return;
  end if;

  insert into public.scout_signups (phone_e164, source, ip_hash, country, utm, consent_version)
  values (p_phone, p_source, p_ip_hash, p_country, coalesce(p_utm, '{}'::jsonb), p_consent_version)
  returning * into v_existing;
  v_new := true;

  select coalesce((c.value ->> 'max')::int, 40) into v_daily_max
  from public.app_config c where c.key = 'scout_invite_daily_max';
  select count(*) into v_sent_today
  from public.scout_signups s where s.sent_at > now() - interval '24 hours';

  v_status := v_existing.status;

  begin
    insert into public.analytics_events (user_id, event, props)
    values (null, 'scout_signup_requested',
            jsonb_build_object(
              'source', p_source,
              'country', p_country,
              'over_daily_cap', v_sent_today >= coalesce(v_daily_max, 40),
              'utm', coalesce(p_utm, '{}'::jsonb)));
  exception when others then null;
  end;

  return query select v_status, v_new,
    (select count(*)::int from public.scout_signups s
      where s.status = 'pending' and s.created_at < v_existing.created_at);
end;
$function$;

do $$
begin
  if has_function_privilege('anon', 'public.scout_request_invite(text,text,text,text,jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.scout_request_invite(text,text,text,text,jsonb,text)', 'execute') then
    raise exception '0380: scout_request_invite is client-callable';
  end if;
end $$;

commit;
