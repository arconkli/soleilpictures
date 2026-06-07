-- 0124_grant_logs_outreach.sql
--
-- Issuing a paid grant counts as outreach. We personally reach out to everyone we
-- grant, so admin_grant_paid_access now also writes a user_outreach row per email
-- (unified by email — 0123), making granted people show as "contacted" on the
-- Users + Waitlist tabs automatically. Body is the live 0085 function with one
-- added insert in the loop.

create or replace function public.admin_grant_paid_access(
  p_emails text[],
  p_duration_days integer default null,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
revoke all on function public.admin_grant_paid_access(text[], int, text) from public;
grant execute on function public.admin_grant_paid_access(text[], int, text) to authenticated;
